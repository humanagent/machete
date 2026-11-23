// Bundles the app into out/: the main process and preloads for Electron's Node (CommonJS),
// the windows for the browser, plus their HTML and CSS.
import { cp, rm } from 'node:fs/promises';
import { Console, Effect } from 'effect';
import { APPS } from '../apps';
import { tokensCss } from '../core/design/tokens';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}out`;
const production = process.argv.includes('--production');
/** Each window's folder: its preload and its renderer (main.ts, index.html, styles). Apps declare theirs. */
const WINDOWS: Record<string, { readonly preload: string; readonly renderer: string }> = {
  settings: { preload: 'core/preload/settings.ts', renderer: 'core/renderer/settings' },
  permissions: { preload: 'core/preload/permissions.ts', renderer: 'core/renderer/permissions' },
};
for (const app of APPS)
  for (const [name, folder] of Object.entries(app.windows ?? {})) {
    if (WINDOWS[name]) throw new Error(`${app.id}: another window is already called "${name}"`);
    WINDOWS[name] = { preload: `apps/${app.id}/preload/${name}.ts`, renderer: `apps/${app.id}/${folder}` };
  }
const names = Object.keys(WINDOWS);

class BuildFailed extends Error {}

const common = {
  minify: production,
  sourcemap: production ? ('none' as const) : ('linked' as const),
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

const bundle = (config: Parameters<typeof Bun.build>[0]) =>
  Effect.tryPromise(() => Bun.build({ ...common, ...config })).pipe(
    Effect.flatMap((result) =>
      result.success
        ? Effect.void
        : Effect.forEach(result.logs, (log) => Console.error(log)).pipe(
            Effect.andThen(Effect.fail(new BuildFailed(String(config.entrypoints)))),
          ),
    ),
  );

const program = Effect.gen(function* () {
  yield* Effect.promise(() => rm(out, { recursive: true, force: true }));
  yield* Effect.all(
    [
      bundle({
        entrypoints: [`${root}core/main.ts`],
        outdir: `${out}/main`,
        target: 'node',
        format: 'cjs',
        external: ['electron'],
      }),
      bundle({
        entrypoints: names.map((n) => `${root}${WINDOWS[n]!.preload}`),
        outdir: `${out}/preload`,
        // Flat: out/preload/<window>.js, wherever the product keeps it.
        naming: '[name].[ext]',
        target: 'node',
        format: 'cjs',
        external: ['electron'],
      }),
      ...names.map((name) =>
        bundle({
          entrypoints: [`${root}${WINDOWS[name]!.renderer}/main.ts`],
          outdir: `${out}/renderer/${name}`,
          target: 'browser',
          format: 'iife',
        }),
      ),
    ],
    { concurrency: 'unbounded' },
  );
  yield* Effect.forEach(names, (name) =>
    Effect.promise(() =>
      cp(`${root}${WINDOWS[name]!.renderer}`, `${out}/renderer/${name}`, {
        recursive: true,
        filter: (src) => !src.endsWith('.ts'),
      }),
    ),
  );
  // The design: one stylesheet for every window.
  const components = yield* Effect.promise(() => Bun.file(`${root}core/design/machete.css`).text());
  yield* Effect.promise(() => Bun.write(`${out}/renderer/machete.css`, `${tokensCss()}\n${components}`));
  yield* Console.log(`built out/ (${production ? 'production' : 'development'})`);
});

Effect.runPromise(program).catch(() => process.exit(1));
