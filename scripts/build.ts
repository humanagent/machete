// Bundles the app into out/: the main process and preloads for Electron's Node (CommonJS),
// the four windows for the browser, plus their HTML and CSS.
import { cp, rm } from 'node:fs/promises';
import { Console, Effect } from 'effect';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}out`;
const production = process.argv.includes('--production');
/** Each window's folder: its preload and its renderer (main.ts, index.html, styles). Products own their windows. */
const WINDOWS = {
  permissions: { preload: 'core/preload/permissions.ts', renderer: 'core/renderer/permissions' },
  overlay: { preload: 'products/copilot/preload/overlay.ts', renderer: 'products/copilot/renderer/overlay' },
  manage: { preload: 'products/copilot/preload/manage.ts', renderer: 'products/copilot/renderer/manage' },
  dictation: { preload: 'products/dictation/preload/dictation.ts', renderer: 'products/dictation/renderer' },
  calculator: {
    preload: 'products/calculator/preload/calculator.ts',
    renderer: 'products/calculator/renderer',
  },
  snippets: { preload: 'products/snippets/preload/snippets.ts', renderer: 'products/snippets/renderer' },
  rewrite: { preload: 'products/rewrite/preload/rewrite.ts', renderer: 'products/rewrite/renderer' },
  previews: {
    preload: 'products/screenshot/preload/previews.ts',
    renderer: 'products/screenshot/renderer/previews',
  },
  editor: {
    preload: 'products/screenshot/preload/editor.ts',
    renderer: 'products/screenshot/renderer/editor',
  },
  clipboard: { preload: 'products/clipboard/preload/clipboard.ts', renderer: 'products/clipboard/renderer' },
} as const;
const names = Object.keys(WINDOWS) as Array<keyof typeof WINDOWS>;

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
        entrypoints: [`${root}src/main.ts`],
        outdir: `${out}/main`,
        target: 'node',
        format: 'cjs',
        external: ['electron'],
      }),
      bundle({
        entrypoints: names.map((n) => `${root}src/${WINDOWS[n].preload}`),
        outdir: `${out}/preload`,
        // Flat: out/preload/<window>.js, wherever the product keeps it.
        naming: '[name].[ext]',
        target: 'node',
        format: 'cjs',
        external: ['electron'],
      }),
      ...names.map((name) =>
        bundle({
          entrypoints: [`${root}src/${WINDOWS[name].renderer}/main.ts`],
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
      cp(`${root}src/${WINDOWS[name].renderer}`, `${out}/renderer/${name}`, {
        recursive: true,
        filter: (src) => !src.endsWith('.ts'),
      }),
    ),
  );
  yield* Console.log(`built out/ (${production ? 'production' : 'development'})`);
});

Effect.runPromise(program).catch(() => process.exit(1));
