// "Machete Settings": everything that can be changed. The apps' manifests say what; the apps themselves say how.
import { app as electronApp, BrowserWindow, ipcMain } from 'electron';
import { Context, Effect, FiberHandle, Layer, Option, Ref, Schema, Stream } from 'effect';
import { APPS } from '../../apps';
import { Channels } from '../channels';
import { HOTKEYS, type HotkeyID, type HotkeyInfo, isHotkey, signs } from '../hotkeys';
import { missing } from '../permissions';
import { NativeHelper } from '../services/NativeHelper';
import { PermissionsGuide } from '../services/PermissionsGuide';
import { Settings } from '../services/Settings';
import { SettingsCommand, type SettingsState } from '../settings';
import { Apps } from './Apps';
import { placeOnActive } from './ActiveScreen';
import { Dock } from './Dock';
import { Hotkeys } from './Hotkeys';
import { preloadFile, rendererFile } from './paths';
import { makeRunner } from './Runner';

const appName = (id: string) => APPS.find((a) => a.id === id)?.name ?? id;

export class SettingsWindow extends Context.Service<SettingsWindow, { readonly show: Effect.Effect<void> }>()(
  'machete/SettingsWindow',
) {
  static readonly layer = Layer.effect(
    SettingsWindow,
    Effect.gen(function* () {
      const apps = yield* Apps;
      const guide = yield* PermissionsGuide;
      const helper = yield* NativeHelper;
      const hotkeys = yield* Hotkeys;
      const dock = yield* Dock;
      const settings = yield* Settings;
      const run = yield* makeRunner<never>();
      const current = yield* Ref.make(Option.none<BrowserWindow>());
      const watching = yield* FiberHandle.make<void, never>();
      const asked = yield* Ref.make(0);
      const problem = yield* Ref.make<SettingsState['problem']>(null);
      const note = yield* Ref.make('');

      const push = Effect.gen(function* () {
        const win = (yield* Ref.get(current)).pipe(Option.filter((w) => !w.isDestroyed()));
        if (Option.isNone(win)) return;
        const { keys, failed, off } = yield* hotkeys.get;
        const saved = yield* settings.get;
        const fields: Record<string, SettingsState['fields'][string]> = {};
        for (const [id, app] of yield* apps.get)
          for (const [name, control] of Object.entries(app.settings))
            fields[`${id}.${name}`] = yield* control.get;
        const state: SettingsState = {
          missing: yield* Ref.get(asked),
          off: [...off],
          fields,
          hotkeys: HOTKEYS.map(({ id }) => ({
            id,
            labels: (keys.get(id) ?? []).map((k) => signs(k).join(' ')),
            changed: saved.hotkeys[id] !== undefined,
            failed: failed.has(id),
          })),
          problem: yield* Ref.get(problem),
          note: yield* Ref.get(note),
          hideDock: yield* dock.hidden,
        };
        win.value.webContents.send(Channels.settingsState, state);
      });

      const create = Effect.sync(() => {
        const win = new BrowserWindow({
          width: 980,
          height: 660,
          minWidth: 940,
          minHeight: 460,
          title: 'Machete Settings',
          show: false,
          // A minimized window would put Machete in the Dock.
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          backgroundColor: '#0a0b0e',
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 20, y: 22 },
          webPreferences: {
            preload: preloadFile('settings'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        // Unlike the panels, it shows in screenshots and screen sharing: hidden there, it looks see-through.
        win.once('ready-to-show', () => {
          placeOnActive(win, 'center', win.getBounds());
          win.show();
        });
        win.webContents.on('did-finish-load', () => run(push));
        // Never leave the shortcuts resting.
        win.on('blur', () => run(hotkeys.pause(false)));
        win.on('closed', () =>
          run(
            Ref.set(current, Option.none()).pipe(
              Effect.andThen(FiberHandle.clear(watching)),
              Effect.andThen(hotkeys.pause(false)),
            ),
          ),
        );
        void win.loadFile(rendererFile('settings'));
        return win;
      });

      const show = Effect.gen(function* () {
        yield* Ref.set(problem, null);
        yield* Ref.set(note, '');
        const existing = (yield* Ref.get(current)).pipe(Option.filter((w) => !w.isDestroyed()));
        if (Option.isSome(existing)) {
          const b = existing.value.getBounds();
          placeOnActive(existing.value, 'center', b, b);
          existing.value.show();
        } else yield* Ref.set(current, Option.some(yield* create));
        if (process.platform === 'darwin') electronApp.focus({ steal: true });
        // Anything that changes elsewhere while the window is open shows here.
        yield* FiberHandle.run(
          watching,
          apps.get.pipe(
            Effect.flatMap((all) =>
              Stream.mergeAll(
                // Several settings share a stream: once each.
                [
                  ...new Set<Stream.Stream<unknown>>([
                    hotkeys.changes,
                    ...[...all.values()].flatMap((a) =>
                      Object.values(a.settings).flatMap((c) => (c.changes ? [c.changes] : [])),
                    ),
                  ]),
                ].map((changes: Stream.Stream<unknown>) => changes.pipe(Stream.map(() => undefined))),
                { concurrency: 'unbounded' },
              ).pipe(Stream.runForEach(() => push)),
            ),
          ),
          { onlyIfMissing: true },
        );
        const status = yield* helper.permissionStatus.pipe(Effect.option);
        yield* Ref.set(asked, Option.match(status, { onNone: () => 0, onSome: (s) => missing(s).length }));
        yield* push;
      });

      const say = (text: string) => Ref.set(note, text);
      /** Says whose those keys are, or nothing when the change went through. */
      const told = (id: HotkeyID, change: Effect.Effect<HotkeyInfo | undefined>) =>
        change.pipe(
          Effect.flatMap((other) =>
            Ref.set(
              problem,
              other
                ? { id, text: `Already used: ${appName(other.app)}, ${other.title.toLowerCase()}` }
                : null,
            ),
          ),
        );
      /** "<app>.<setting>" */
      const control = (field: string) => {
        const dot = field.indexOf('.');
        return apps.get.pipe(
          Effect.map((all) => all.get(field.slice(0, dot))?.settings[field.slice(dot + 1)]),
        );
      };
      const handle = (command: SettingsCommand): Effect.Effect<unknown> =>
        SettingsCommand.match(command, {
          Set: ({ field, value }) =>
            control(field).pipe(
              Effect.flatMap((c): Effect.Effect<unknown> => c?.set?.(value) ?? Effect.void),
            ),
          Run: ({ field }) =>
            control(field).pipe(
              Effect.flatMap((c): Effect.Effect<unknown> => c?.run ?? Effect.void),
              Effect.flatMap((text) => (typeof text === 'string' ? say(text) : Effect.void)),
            ),
          Permissions: () => guide.show,
          HideDock: ({ on }) =>
            dock.setHidden(on).pipe(
              // macOS sends the windows back when the icon goes.
              Effect.andThen(Ref.get(current)),
              Effect.map(Option.map((w) => w.isDestroyed() || w.show())),
            ),
          Shortcuts: ({ app, on }) => hotkeys.setOn(app, on),
          Recording: ({ on }) =>
            hotkeys.pause(on).pipe(Effect.andThen(on ? Ref.set(problem, null) : Effect.void)),
          SetHotkey: ({ id, keys }) => (isHotkey(id) ? told(id, hotkeys.set(id, [keys])) : Effect.void),
          ResetHotkey: ({ id }) => (isHotkey(id) ? told(id, hotkeys.reset(id)) : Effect.void),
          ResetHotkeys: () => Ref.set(problem, null).pipe(Effect.andThen(hotkeys.resetAll)),
          Close: () => Ref.get(current).pipe(Effect.map(Option.map((w) => w.isDestroyed() || w.close()))),
        });

      const decode = Schema.decodeUnknownOption(SettingsCommand);
      const onCommand = (event: Electron.IpcMainEvent, raw: unknown) => {
        const win = Option.getOrUndefined(Effect.runSync(Ref.get(current)));
        if (!win || event.sender !== win.webContents) return;
        Option.map(decode(raw), (command) => run(handle(command).pipe(Effect.andThen(push))));
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.settingsCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.settingsCommand, onCommand)),
      );
      yield* Effect.addFinalizer(() =>
        Ref.get(current).pipe(Effect.map(Option.map((w) => w.isDestroyed() || w.destroy()))),
      );

      return { show };
    }),
  );
}
