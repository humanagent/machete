// The menu bar item: one line per app, Settings and Quit. The shortcuts beside them are the ones in Settings.
import { app as electronApp, Menu, nativeImage, Tray } from 'electron';
import { Effect, Layer, Stream } from 'effect';
import { APPS } from '../../apps';
import { isAlone, signs } from '../hotkeys';
import { Apps } from './Apps';
import { Hotkeys } from './Hotkeys';
import { assetFile } from './paths';
import { makeRunner } from './Runner';
import { SettingsWindow } from './SettingsWindow';

export const StatusMenuLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const apps = yield* Apps;
    const hotkeys = yield* Hotkeys;
    const settings = yield* SettingsWindow;
    const run = yield* makeRunner<never>();
    const icon = nativeImage.createFromPath(assetFile('trayTemplate.png'));
    icon.setTemplateImage(true);
    const tray = yield* Effect.acquireRelease(
      Effect.sync(() => new Tray(icon)),
      (t) => Effect.sync(() => t.destroy()),
    );
    tray.setToolTip('Machete');

    const draw = Effect.gen(function* () {
      const running = yield* apps.get;
      const { keys, off } = yield* hotkeys.get;
      const line = (app: (typeof APPS)[number]): ReadonlyArray<Electron.MenuItemConstructorOptions> => {
        const it = running.get(app.id);
        if (!it) return [];
        const click = () => run(it.open);
        // Nothing to open: its line turns its shortcuts on and off.
        if (app.menu === undefined)
          return [{ label: app.name, type: 'checkbox', checked: !off.has(app.id), click }];
        const all = keys.get(`${app.id}.${app.menu}`) ?? [];
        const alone = all.find(isAlone);
        const accelerator = all.find((k) => !isAlone(k));
        return [
          {
            label: alone === undefined ? app.name : `${app.name}  (${signs(alone).join('')})`,
            // Only shown: the shortcut itself is registered for the whole Mac.
            ...(accelerator === undefined ? {} : { accelerator, registerAccelerator: false }),
            click,
          },
        ];
      };
      tray.setContextMenu(
        Menu.buildFromTemplate([
          ...APPS.flatMap(line),
          { type: 'separator' },
          { label: 'Settings…', click: () => run(settings.show) },
          { type: 'separator' },
          { label: 'Quit Machete', click: () => electronApp.quit() },
        ]),
      );
    });
    yield* Stream.merge(
      Stream.map(apps.changes, () => undefined),
      Stream.map(hotkeys.changes, () => undefined),
    ).pipe(
      Stream.runForEach(() => draw),
      Effect.forkScoped,
    );
  }),
);
