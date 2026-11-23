// The bundle Electron loads: built once, then checked for what each process can and cannot contain.
import { beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';

const root = join(import.meta.dir, '..');
const out = join(root, 'out');

beforeAll(async () => {
  await $`bun ${join(root, 'scripts/build.ts')}`.quiet();
}, 60_000);

test('main process and preloads are CommonJS with electron left external', async () => {
  const main = await readFile(join(out, 'main/main.js'), 'utf8');
  expect(main).toContain('require("electron")');
  for (const name of ['copilot', 'bots', 'dictation', 'settings']) {
    const preload = await readFile(join(out, `preload/${name}.js`), 'utf8');
    expect(preload).toContain('require("electron")');
    expect(preload).toContain('exposeInMainWorld');
    // Sandboxed preloads stay tiny: no Effect runtime in them.
    expect(preload.length).toBeLessThan(4_000);
  }
});

test('each window has its page, styles and an IIFE bundle', async () => {
  for (const name of ['copilot', 'bots', 'dictation', 'settings']) {
    const html = await readFile(join(out, `renderer/${name}/index.html`), 'utf8');
    expect(html).toContain('<script src="main.js"></script>');
    const bundle = await readFile(join(out, `renderer/${name}/main.js`), 'utf8');
    expect(bundle.trimStart().startsWith('(() => {')).toBe(true);
    expect(bundle).not.toContain('require(');
  }
  expect(existsSync(join(out, 'renderer/copilot/styles.css'))).toBe(true);
  expect(existsSync(join(out, 'renderer/settings/styles.css'))).toBe(true);
});
