// Invisibility: one state for every window that follows it.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Haunted, makeInvisibility } from '../../core/invisibility';

const fakeWindow = (id: number) => {
  const seen = { protected: undefined as boolean | undefined, told: [] as Array<boolean>, destroyed: false };
  let closed = () => {};
  let loaded: Array<() => void> = [];
  const w: Haunted = {
    isDestroyed: () => seen.destroyed,
    setContentProtection: (on) => (seen.protected = on),
    once: (_event, listener) => (closed = listener),
    webContents: {
      id,
      send: (_channel, invisible) => seen.told.push(invisible),
      on: (_event, listener) => loaded.push(listener),
    },
  };
  return {
    w,
    seen,
    load: () => loaded.forEach((f) => f()),
    close: () => {
      seen.destroyed = true;
      closed();
    },
    listeners: () => loaded.length,
  };
};

test('starts invisible; any ghost changes it for every window', () => {
  const it = makeInvisibility();
  const [a, b] = [fakeWindow(1), fakeWindow(2)];
  it.follow(a.w);
  it.follow(b.w);
  expect([it.invisible(), a.seen.protected, b.seen.protected]).toEqual([true, true, true]);
  it.toggle(1);
  expect([it.invisible(), a.seen.protected, b.seen.protected]).toEqual([false, false, false]);
  expect([a.seen.told.at(-1), b.seen.told.at(-1)]).toEqual([false, false]);
  it.toggle(2);
  expect([it.invisible(), a.seen.protected, b.seen.protected]).toEqual([true, true, true]);
});

test('a window made later is what Machete is by then, and its page is told when it loads', () => {
  const it = makeInvisibility();
  const a = fakeWindow(1);
  it.follow(a.w);
  it.toggle(1);
  const late = fakeWindow(2);
  it.follow(late.w);
  expect(late.seen.protected).toBe(false);
  late.seen.told.length = 0;
  late.load();
  expect(late.seen.told).toEqual([false]);
});

test('only a window that follows can change it, following twice is once, and a closed one is let go', () => {
  const it = makeInvisibility();
  const a = fakeWindow(1);
  it.toggle(99);
  expect(it.invisible()).toBe(true);
  it.follow(a.w);
  it.follow(a.w);
  expect(a.listeners()).toBe(1);
  a.close();
  it.toggle(1);
  expect(it.invisible()).toBe(true);
  it.follow(a.w);
  expect(a.seen.protected).toBe(true);
});

test('every page with a ghost has its bridge, and nobody has another eye', () => {
  const root = join(import.meta.dir, '../..');
  const read = (f: string) => readFileSync(join(root, f), 'utf8');
  const pages = [...new Bun.Glob('apps/*/renderer/**/index.html').scanSync(root)];
  const haunted = pages.filter((f) => read(f).includes('id="ghost"'));
  expect(haunted.length).toBe(8);
  for (const f of haunted) {
    const [, app, , page] = f.split('/') as [string, string, string, string];
    const preload = `apps/${app}/preload/${page === 'index.html' ? app : page}.ts`;
    expect([f, read(preload).includes('exposeGhost()')]).toEqual([f, true]);
    expect([f, read(f.replace('index.html', 'main.ts')).includes('ghost()')]).toEqual([f, true]);
  }
  for (const f of pages) expect([f, /i-eye|class="eye"/.test(read(f))]).toEqual([f, false]);
});
