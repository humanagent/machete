import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RADIUS } from '../../core/design/tokens';
import {
  copilotGlass,
  hasGlass,
  loadOnce,
  panelGlass,
  shapes,
  stackGlass,
  type GlassAddon,
} from '../../core/glass';

const root = join(import.meta.dir, '../..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

test('only macOS 26 and later have it', () => {
  expect(hasGlass('darwin', '26.6.2')).toBe(true);
  expect(hasGlass('darwin', '27.0')).toBe(true);
  expect(hasGlass('darwin', '15.7')).toBe(false);
  expect(hasGlass('darwin', '14.0')).toBe(false);
  expect(hasGlass('win32', '26.0')).toBe(false);
  expect(hasGlass('darwin', '')).toBe(false);
});

describe('where it goes', () => {
  test('a panel: the whole window, growing with it', () => {
    expect(shapes(panelGlass, { width: 800, height: 520 })).toEqual([0, 0, 800, 520, RADIUS.panel, 1]);
  });
  test('the Copilot: inside its margin, never negative', () => {
    expect(shapes(copilotGlass(8), { width: 656, height: 74 })).toEqual([8, 8, 640, 58, RADIUS.copilot, 1]);
    expect(shapes(copilotGlass(8), { width: 10, height: 10 })).toEqual([8, 8, 0, 0, RADIUS.copilot, 1]);
    // A capsule while it's only the bar.
    expect(RADIUS.copilot * 2).toBe(58);
  });
  test('the previews: one per card, under each other', () => {
    const spec = stackGlass({ width: 220, height: 150 }, 2, 10, 16);
    expect(shapes(spec, { width: 252, height: 342 })).toEqual([
      ...[16, 16, 220, 150, RADIUS.card, 0],
      ...[16, 176, 220, 150, RADIUS.card, 0],
    ]);
    expect(shapes(stackGlass({ width: 220, height: 150 }, 0, 10, 16), { width: 0, height: 0 })).toEqual([]);
  });
});

describe('an addon that fails is only no glass', () => {
  const good: GlassAddon = { setGlass: () => true };
  test('loaded once', () => {
    let times = 0;
    const get = loadOnce(() => (times++, good));
    expect([get(), get()]).toEqual([good, good]);
    expect(times).toBe(1);
  });
  test('it throws, it isn’t there or it isn’t what it should be', () => {
    let times = 0;
    const broken = loadOnce(() => {
      times++;
      throw new Error('dlopen');
    });
    expect([broken(), broken()]).toEqual([undefined, undefined]);
    expect(times).toBe(1);
    expect(loadOnce(() => undefined)()).toBeUndefined();
    expect(loadOnce(() => ({}) as GlassAddon)()).toBeUndefined();
  });
});

const built = join(root, 'native/bin/machete-glass.node');
test.skipIf(process.platform !== 'darwin' || !existsSync(built))(
  'the real one loads and refuses what isn’t ours',
  () => {
    const m: { exports: Partial<GlassAddon> } = { exports: {} };
    process.dlopen(m, built);
    const set = m.exports.setGlass!;
    expect(set(Buffer.alloc(8), [0, 0, 10, 10, 4, 1], [0, 0, 0, 1])).toBe(false);
    expect(set(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), [0, 0, 10, 10, 4, 1], [0, 0, 0, 1])).toBe(false);
    expect(set(Buffer.alloc(3), [], [0, 0, 0, 1])).toBe(false);
    expect(set(Buffer.alloc(8), [1, 2], [0, 0, 0, 1])).toBe(false);
    expect((set as (...args: Array<unknown>) => boolean)()).toBe(false);
    expect((set as (...args: Array<unknown>) => boolean)('x', 'y', 'z')).toBe(false);
  },
);

test('one place asks for it, and every floating window does', () => {
  for (const f of new Bun.Glob('{apps,core}/**/*.ts').scanSync(root))
    if (f !== 'core/electron/Glass.ts') expect([f, /machete-glass|dlopen/.test(read(f))]).toEqual([f, false]);
  for (const f of [
    'core/electron/Panel.ts',
    'apps/copilot/electron/CopilotWindow.ts',
    'apps/dictation/electron/PillWindow.ts',
    'apps/screenshot/electron/PreviewsWindow.ts',
  ])
    expect([f, read(f).includes('setGlass(')]).toEqual([f, true]);
});

test('it’s packaged and signed with the app', () => {
  const { mac, extraFiles } = JSON.parse(read('package.json')).build;
  expect(mac.binaries).toContain('Contents/MacOS/machete-glass.node');
  expect(extraFiles[0].filter).toContain('machete-glass.node');
  expect(read('scripts/sign-local.ts')).toContain('machete-glass.node');
});
