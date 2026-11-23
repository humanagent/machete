// What the Settings window shows, from the apps' manifests: plain data, drawn by its renderer.
import type { AppManifest, Setting } from './app';
import { HOTKEYS, type HotkeyInfo } from './hotkeys';

export type Row =
  | { readonly row: 'setting'; readonly field: string; readonly setting: Setting }
  | { readonly row: 'switch'; readonly app: string }
  | { readonly row: 'heading'; readonly text: string }
  | { readonly row: 'shortcut'; readonly info: HotkeyInfo; readonly icon: string }
  | { readonly row: 'dock' }
  | { readonly row: 'permissions' }
  | { readonly row: 'resetShortcuts' };

export interface Tab {
  /** The app's id; empty in General. */
  readonly app: string;
  readonly name: string;
  readonly icon: string;
  readonly rows: ReadonlyArray<Row>;
}

const GENERAL =
  '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>';

const settingsOf = (app: AppManifest, general: boolean): ReadonlyArray<Row & { readonly row: 'setting' }> =>
  (app.settings ?? [])
    .filter((s) => (s.general ?? false) === general)
    .map((setting) => ({ row: 'setting', field: `${app.id}.${setting.name}`, setting }));

/** General first, then a tab per app: its settings and its shortcuts. */
export const pageOf = (
  apps: ReadonlyArray<AppManifest>,
  hotkeys: ReadonlyArray<HotkeyInfo> = HOTKEYS,
): ReadonlyArray<Tab> => [
  {
    app: '',
    name: 'General',
    icon: GENERAL,
    rows: [
      ...apps.flatMap((a) => settingsOf(a, true)),
      { row: 'dock' },
      { row: 'permissions' },
      { row: 'resetShortcuts' },
    ],
  },
  ...apps.map((app): Tab => {
    const own = settingsOf(app, false);
    const shortcuts = hotkeys
      .filter((k) => k.app === app.id)
      .map((info): Row => ({ row: 'shortcut', info, icon: app.icon }));
    return {
      app: app.id,
      name: app.name,
      icon: app.icon,
      rows: [
        ...own,
        // Nothing to open: its shortcuts can be turned off instead.
        ...(app.menu === undefined ? [{ row: 'switch', app: app.id } as const] : []),
        ...(own.length > 0 && shortcuts.length > 0 ? [{ row: 'heading', text: 'Shortcuts' } as const] : []),
        ...shortcuts,
      ],
    };
  }),
];
