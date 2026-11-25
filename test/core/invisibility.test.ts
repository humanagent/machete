// Invisibility: each panel's own, kept by its name.
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

test('each panel starts invisible, and its ghost changes only that one', () => {
  const it = makeInvisibility();
  const [a, b] = [fakeWindow(1), fakeWindow(2)];
  it.follow(a.w, 'a');
  it.follow(b.w, 'b');
  expect([a.seen.protected, b.seen.protected]).toEqual([true, true]);
  it.toggle(1);
  expect([it.invisible('a'), it.invisible('b')]).toEqual([false, true]);
  expect([a.seen.protected, b.seen.protected]).toEqual([false, true]);
  expect([a.seen.told.at(-1), b.seen.told.at(-1)]).toEqual([false, true]);
  it.toggle(1);
  expect([a.seen.protected, b.seen.protected]).toEqual([true, true]);
});

test('a panel made again is what it was, and its page is told when it loads', () => {
  const it = makeInvisibility();
  const a = fakeWindow(1);
  it.follow(a.w, 'a');
  it.toggle(1);
  a.close();
  const [again, other] = [fakeWindow(2), fakeWindow(3)];
  it.follow(again.w, 'a');
  it.follow(other.w, 'b');
  expect([again.seen.protected, other.seen.protected]).toEqual([false, true]);
  again.seen.told.length = 0;
  again.load();
  expect(again.seen.told).toEqual([false]);
});

test('only a window that follows can change it, following twice is once, and a closed one is let go', () => {
  const it = makeInvisibility();
  const a = fakeWindow(1);
  it.toggle(99);
  it.follow(a.w, 'a');
  it.follow(a.w, 'a');
  expect([a.listeners(), it.invisible('a')]).toEqual([1, true]);
  a.close();
  it.toggle(1);
  expect(it.invisible('a')).toBe(true);
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
