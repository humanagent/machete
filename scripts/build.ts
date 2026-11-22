// Bundles the app into out/: the main process and preloads for Electron's Node (CommonJS),
// the three windows for the browser, plus their HTML and CSS.
import { cp, rm } from 'node:fs/promises';
import { Console, Effect } from 'effect';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}out`;
const production = process.argv.includes('--production');
const WINDOWS = ['overlay', 'manage', 'dictation'] as const;

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
        entrypoints: [`${root}src/main/main.ts`],
        outdir: `${out}/main`,
        target: 'node',
        format: 'cjs',
        external: ['electron'],
      }),
      bundle({
        entrypoints: WINDOWS.map((n) => `${root}src/preload/${n}.ts`),
        outdir: `${out}/preload`,
        target: 'node',
        format: 'cjs',
        external: ['electron'],
      }),
      ...WINDOWS.map((name) =>
        bundle({
          entrypoints: [`${root}src/renderer/${name}/main.ts`],
          outdir: `${out}/renderer/${name}`,
          target: 'browser',
          format: 'iife',
        }),
      ),
    ],
    { concurrency: 'unbounded' },
  );
  yield* Effect.forEach(WINDOWS, (name) =>
    Effect.promise(() =>
      cp(`${root}src/renderer/${name}`, `${out}/renderer/${name}`, {
        recursive: true,
        filter: (src) => !src.endsWith('.ts'),
      }),
    ),
  );
  yield* Console.log(`built out/ (${production ? 'production' : 'development'})`);
});

Effect.runPromise(program).catch(() => process.exit(1));
