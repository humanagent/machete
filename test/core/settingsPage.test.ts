import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS } from '../../apps';
import type { AppManifest } from '../../core/app';
import { HOTKEYS } from '../../core/hotkeys';
import { pageOf, type Row } from '../../core/settingsPage';

const page = pageOf(APPS);
const tab = (name: string) => page.find((t) => t.name === name)!;
const kinds = (rows: ReadonlyArray<Row>) => rows.map((r) => r.row);

describe('the Settings page', () => {
  test('General, then a tab per app, in the menu’s order', () => {
    expect(page.map((t) => t.name)).toEqual(['General', ...APPS.map((a) => a.name)]);
  });

  test('every shortcut is in its app’s tab, once, and nowhere else', () => {
    const shown = page.flatMap((t) =>
      t.rows.flatMap((r) => (r.row === 'shortcut' ? [[t.app, r.info.id] as const] : [])),
    );
    expect(shown.map(([, id]) => id).sort()).toEqual(HOTKEYS.map((k) => k.id).sort());
    for (const [app, id] of shown) expect(id.startsWith(`${app}.`)).toBe(true);
  });

  test('every setting is shown once', () => {
    const shown = page.flatMap((t) => t.rows.flatMap((r) => (r.row === 'setting' ? [r.field] : [])));
    expect(shown.sort()).toEqual(
      APPS.flatMap((a) => (a.settings ?? []).map((s) => `${a.id}.${s.name}`)).sort(),
    );
  });

  test('General has the account, the model, the Dock icon, permissions and resetting the shortcuts', () => {
    expect(kinds(tab('General').rows)).toEqual([
      'setting',
      'setting',
      'dock',
      'permissions',
      'resetShortcuts',
    ]);
  });

  test('the bots have their own panel: Settings only has the button that opens it', () => {
    const bots = tab('Copilot').rows.find((r) => r.row === 'setting' && r.field === 'copilot.bots');
    expect(bots?.row === 'setting' && bots.setting.kind).toBe('action');
    expect(APPS.find((a) => a.id === 'copilot')?.windows).toHaveProperty('bots');
  });

  test('Windows can be turned off; an app with only shortcuts has no heading', () => {
    expect(kinds(tab('Windows').rows)).toEqual(['switch', 'shortcut', 'shortcut', 'shortcut']);
    expect(kinds(tab('Rewrite').rows)).toEqual(['shortcut', 'shortcut']);
    expect(kinds(tab('Dictation').rows)).toEqual(['setting', 'heading', 'shortcut']);
  });

  test('an app with nothing to set still has its tab', () => {
    const bare: AppManifest = { id: 'x', name: 'X', icon: '<path/>', shortcuts: [], menu: 'none' };
    expect(pageOf([bare], [])[1]).toEqual({ app: 'x', name: 'X', icon: '<path/>', rows: [] });
  });
});

test('nothing in Settings is transparent', () => {
  const read = (f: string) => readFileSync(join(import.meta.dir, '../..', f), 'utf8');
  const css = read('core/renderer/settings/styles.css');
  expect(css).not.toMatch(/backdrop-filter|background[^;]*(rgba\(|transparent)/);
  expect(css).not.toMatch(/--(bg|box|bar|on|over|line): *rgba/);
  expect(read('core/electron/SettingsWindow.ts')).not.toMatch(
    /vibrancy|transparent: true|setContentProtection/,
  );
});
