// What every mini app has to be, whoever wrote it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { APPS } from '../apps';

const root = join(import.meta.dir, '../apps');

test('every folder in apps/ is an app in the list, and only those', () => {
  const folders = readdirSync(root).filter((f) => statSync(join(root, f)).isDirectory());
  expect(folders.sort()).toEqual(APPS.map((a) => a.id).sort());
});

test('windows have different names', () => {
  const names = APPS.flatMap((a) => Object.keys(a.windows ?? {}));
  expect(new Set([...names, 'settings', 'permissions']).size).toBe(names.length + 2);
});

for (const app of APPS)
  describe(app.id, () => {
    test('has a name, an icon and a lower-case id', () => {
      expect(app.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(app.name.trim()).not.toBe('');
      expect(app.icon).toMatch(/^<(path|circle|rect)/);
      expect(app.icon).not.toMatch(/script|on\w+=/i);
    });

    test('names its shortcuts and settings once, and its menu line is one of them', () => {
      for (const list of [app.shortcuts, app.settings ?? []])
        expect(new Set(list.map((x) => x.name)).size).toBe(list.length);
      if (app.menu !== undefined) expect(app.shortcuts.map((s) => s.name)).toContain(app.menu);
    });

    test('has the files its manifest names', () => {
      expect(existsSync(join(root, app.id, 'electron/index.ts'))).toBe(true);
      for (const [name, folder] of Object.entries(app.windows ?? {})) {
        expect(existsSync(join(root, app.id, `preload/${name}.ts`))).toBe(true);
        for (const f of ['index.html', 'main.ts'])
          expect(existsSync(join(root, app.id, folder, f))).toBe(true);
      }
    });
  });

test('no window can be minimized: it would put Machete in the Dock', () => {
  const base = join(import.meta.dir, '..');
  const files = [...new Bun.Glob('{apps,core}/**/*.ts').scanSync(base)];
  const windows = files
    .map((f) => [f, readFileSync(join(base, f), 'utf8')] as const)
    .filter(([, text]) => text.includes('new BrowserWindow('));
  expect(windows.length).toBeGreaterThan(4);
  expect(windows.filter(([, text]) => !text.includes('minimizable: false')).map(([f]) => f)).toEqual([]);
  expect(
    windows.filter(
      ([, t]) => t.includes('setVisibleOnAllWorkspaces') && !t.includes('skipTransformProcessType: true'),
    ),
  ).toEqual([]);
});

test('the packaged app is out of the Dock by its Info.plist, and only Dock.ts asks at run time', () => {
  const base = join(import.meta.dir, '..');
  const { build } = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
  expect(build.mac.extendInfo.LSUIElement).toBe(true);
  for (const f of new Bun.Glob('{apps,core}/**/*.ts').scanSync(base)) {
    if (f === 'core/electron/Dock.ts') continue;
    const code = readFileSync(join(base, f), 'utf8');
    expect(code).not.toMatch(/setActivationPolicy|\.dock\?*\.(show|hide)\(/);
    // Without this, macOS is asked to make it a Dock app for a moment.
    if (code.includes('setVisibleOnAllWorkspaces(true'))
      expect(code).toContain('skipTransformProcessType: true');
  }
});
