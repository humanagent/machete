// Bundles the app into out/: the main process and preloads for Electron's Node (CommonJS),
// the three windows for the browser, plus their HTML and CSS.
import { cp, rm } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}out`;
const production = process.argv.includes('--production');

await rm(out, { recursive: true, force: true });

const common = {
  minify: production,
  sourcemap: production ? ('none' as const) : ('linked' as const),
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

const builds = [
  Bun.build({
    ...common,
    entrypoints: [`${root}src/main/main.ts`],
    outdir: `${out}/main`,
    target: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  Bun.build({
    ...common,
    entrypoints: ['overlay', 'manage', 'dictation'].map((n) => `${root}src/preload/${n}.ts`),
    outdir: `${out}/preload`,
    target: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  ...['overlay', 'manage', 'dictation'].map((name) =>
    Bun.build({
      ...common,
      entrypoints: [`${root}src/renderer/${name}/main.ts`],
      outdir: `${out}/renderer/${name}`,
      target: 'browser',
      format: 'iife',
    }),
  ),
];

const results = await Promise.all(builds);
const failed = results.filter((r) => !r.success);
if (failed.length > 0) {
  for (const r of failed) for (const log of r.logs) console.error(log);
  process.exit(1);
}

for (const name of ['overlay', 'manage', 'dictation']) {
  await cp(`${root}src/renderer/${name}`, `${out}/renderer/${name}`, {
    recursive: true,
    filter: (src) => !src.endsWith('.ts'),
  });
}
console.log(`built out/ (${production ? 'production' : 'development'})`);
