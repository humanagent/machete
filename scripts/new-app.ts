// bun run new-app <id> "<Name>": a new mini app that already works (a panel with its shortcut), added to Machete.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const root = process.env['MACHETE_ROOT'] ?? new URL('..', import.meta.url).pathname;
const [id, name] = process.argv.slice(2);
const stop = (message: string): never => {
  console.error(message);
  process.exit(1);
};
if (!id || !name)
  stop('Usage: bun run new-app <id> "<Name>"   e.g. bun run new-app color-picker "Color picker"');
if (!/^[a-z][a-z0-9-]*$/.test(id!))
  stop('The id is lower case: letters, numbers and dashes, starting with a letter.');
if (existsSync(`${root}/apps/${id}`)) stop(`apps/${id} already exists.`);

const camel = id!.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const Pascal = camel[0]!.toUpperCase() + camel.slice(1);
const title = name!.replaceAll("'", '’').replaceAll('`', '').replaceAll('<', '').replaceAll('*/', '');

const files: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify(
    { name: `@machete/${id}`, version: '0.0.0', private: true, description: `${title}.` },
    null,
    2,
  )}\n`,
  'app.ts': `import { defineApp } from '../../core/app';

export const ${camel} = defineApp({
  id: '${id}',
  name: '${title}',
  // What's inside a 24×24 stroked <svg>.
  icon: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  // Without keys it starts with no shortcut: people record one in Settings.
  shortcuts: [{ name: 'toggle', title: 'Show or hide', keys: [] }],
  menu: 'toggle',
  windows: { '${id}': 'renderer' },
});
`,
  'ipc.ts': `// What the main process and the window say to each other. Every message is checked against its schema.
import { Schema } from 'effect';

export const CHANNELS = { state: '${id}:state', command: '${id}:command' } as const;

export const ${Pascal}State = Schema.Struct({ count: Schema.Number });
export type ${Pascal}State = typeof ${Pascal}State.Type;

export const ${Pascal}Command = Schema.TaggedUnion({ Add: {}, Close: {} });
export type ${Pascal}Command = typeof ${Pascal}Command.Type;

export interface ${Pascal}Bridge {
  readonly onState: (listener: (state: ${Pascal}State) => void) => () => void;
  readonly send: (command: ${Pascal}Command) => void;
}
`,
  [`preload/${id}.ts`]: `// Exposes the window's bridge as \`window.app\`. Nothing else from Node or Electron reaches the page.
import { contextBridge, ipcRenderer } from 'electron';
import { listen } from '../../../core/preload/listen';
import { CHANNELS, type ${Pascal}Bridge, type ${Pascal}State } from '../ipc';

const bridge: ${Pascal}Bridge = {
  onState: listen<${Pascal}State>(CHANNELS.state),
  send: (command) => ipcRenderer.send(CHANNELS.command, command),
};

contextBridge.exposeInMainWorld('app', bridge);
`,
  'electron/index.ts': `// What ${title} does in Machete: its shortcuts and, if it has any, its settings.
import { ipcMain } from 'electron';
import { Effect, Option, Ref, Schema } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { makePanel } from '../../../core/electron/Panel';
import { makeRunner } from '../../../core/electron/Runner';
import { ${camel} } from '../app';
import { CHANNELS, ${Pascal}Command, type ${Pascal}State } from '../ipc';

export const ${Pascal}App = runApp(
  ${camel},
  Effect.gen(function* () {
    const run = yield* makeRunner<never>();
    const panel = yield* makePanel('${id}', { width: 320, height: 160 });
    const count = yield* Ref.make(0);

    const send = (w: Electron.BrowserWindow) =>
      Ref.get(count).pipe(
        Effect.map((n) => {
          const state: ${Pascal}State = { count: n };
          if (!w.isDestroyed()) w.webContents.send(CHANNELS.state, state);
        }),
      );
    const redraw = panel.visible.pipe(
      Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: send })),
    );

    const decode = Schema.decodeUnknownOption(${Pascal}Command);
    const onCommand = (_event: Electron.IpcMainEvent, raw: unknown) =>
      Option.map(decode(raw), (command) =>
        run(
          ${Pascal}Command.match(command, {
            Add: () => Ref.update(count, (n) => n + 1).pipe(Effect.andThen(redraw)),
            Close: () => panel.hide,
          }),
        ),
      );
    yield* Effect.acquireRelease(
      Effect.sync(() => ipcMain.on(CHANNELS.command, onCommand)),
      () => Effect.sync(() => ipcMain.off(CHANNELS.command, onCommand)),
    );

    return {
      shortcuts: {
        toggle: panel.visible.pipe(
          Effect.flatMap(Option.match({ onSome: () => panel.hide, onNone: () => panel.open(send) })),
        ),
      },
    };
  }),
);
`,
  'renderer/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'"
    />
    <title>${title.replaceAll('&', '&amp;')}</title>
    <link rel="stylesheet" href="../machete.css" />
    <!-- What things look like is in core/design; here, only where they go. -->
    <style>
      .panel {
        display: grid;
        place-items: center;
      }
    </style>
  </head>
  <body>
    <div class="panel">
      <button id="add" class="btn primary" type="button"></button>
    </div>
    <script src="main.js"></script>
  </body>
</html>
`,
  'renderer/main.ts': `// A pure view of the state; every click is a command to the main process.
import { Effect, Stream } from 'effect';
import { byId, fromBridge, runMain } from '../../../core/renderer/runtime';
import type { ${Pascal}Bridge, ${Pascal}State } from '../ipc';

// Not \`declare global\`: each window has its own bridge.
const app = (window as unknown as { readonly app: ${Pascal}Bridge }).app;

const add = byId<HTMLButtonElement>('add');
add.addEventListener('click', () => app.send({ _tag: 'Add' }));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') app.send({ _tag: 'Close' });
});

const render = (s: ${Pascal}State) => Effect.sync(() => void (add.textContent = \`Pressed \${s.count} times\`));
runMain(fromBridge(app.onState).pipe(Stream.runForEach(render)));
`,
};

for (const [file, text] of Object.entries(files)) {
  const path = `${root}/apps/${id}/${file}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
const insert = async (file: string, importLine: string, marker: RegExp, entry: string) => {
  const path = `${root}/${file}`;
  const text = await readFile(path, 'utf8');
  const imports = text.lastIndexOf('\nimport ');
  const end = text.indexOf('\n', imports + 1);
  const withImport = `${text.slice(0, end + 1)}${importLine}\n${text.slice(end + 1)}`;
  const changed = withImport.replace(marker, (close) => `${entry}${close}`);
  if (changed === withImport) stop(`${file} doesn't look as expected: add ${id} there by hand.`);
  await writeFile(path, changed);
};
await insert('apps/index.ts', `import { ${camel} } from './${id}/app';`, /\n\];/, `\n  ${camel},`);
await insert(
  'apps/main.ts',
  `import { ${Pascal}App } from './${id}/electron';`,
  /\n\);/,
  `\n  ${Pascal}App,`,
);

console.log(`apps/${id} is in Machete. Next:
  bun fmt && bun run verify   # types, format, tests
  bun start                   # it's in the menu: ${title}`);
