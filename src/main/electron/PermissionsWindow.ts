// "Set up Machete": one row per permission, live. Allow opens the System Settings pane and the guide moves
// beside it with the app icon to drag into the list, the way macOS 26 adds an app to a Privacy list.
import { resolve } from 'node:path';
import { app as electronApp, BrowserWindow, ipcMain, nativeImage, screen, systemPreferences } from 'electron';
import { Duration, Effect, FiberHandle, Layer, Option, Ref, Schedule, Schema } from 'effect';
import { Channels, PermissionsCommand, type PermissionsState } from '../../shared/ipc';
import {
  besideSettings,
  missing,
  NOTHING_GRANTED,
  type PermissionKey,
  permission,
} from '../../shared/permissions';
import { ExternalBrowser } from '../services/ExternalBrowser';
import { NativeHelper } from '../services/NativeHelper';
import { PermissionsGuide } from '../services/PermissionsGuide';
import { preloadFile, rendererFile } from './paths';
import { makeRunner } from './Runner';

const WIDTH = 380;
const HEIGHT = 500;

/** Machete.app (or Electron.app in development): what gets dropped into the list. */
const bundlePath = () => resolve(process.execPath, '..', '..', '..');

export const PermissionsWindowLive = Layer.effect(
  PermissionsGuide,
  Effect.gen(function* () {
    const helper = yield* NativeHelper;
    const browser = yield* ExternalBrowser;
    const run = yield* makeRunner<never>();
    const poller = yield* FiberHandle.make<void, never>();
    const current = yield* Ref.make<Option.Option<BrowserWindow>>(Option.none());

    const thumbnail = yield* Effect.promise(() =>
      nativeImage
        .createThumbnailFromPath(bundlePath(), { width: 256, height: 256 })
        .catch(() => nativeImage.createEmpty()),
    );
    const state = yield* Ref.make<PermissionsState>({
      status: NOTHING_GRANTED,
      guiding: null,
      needsRestart: false,
      icon: thumbnail.isEmpty() ? '' : thumbnail.toDataURL(),
    });

    const push = Effect.gen(function* () {
      const win = yield* Ref.get(current);
      const s = yield* Ref.get(state);
      if (Option.isSome(win) && !win.value.isDestroyed())
        win.value.webContents.send(Channels.permissionsState, s);
    });

    /** Sits beside System Settings while it is guiding a drag. */
    const followSettings = Effect.gen(function* () {
      const win = yield* Ref.get(current);
      if (Option.isNone(win) || win.value.isDestroyed()) return;
      const bounds = yield* helper.settingsWindow;
      if (Option.isNone(bounds)) return;
      const area = screen.getDisplayMatching(bounds.value).workArea;
      const at = besideSettings(bounds.value, { width: WIDTH, height: HEIGHT }, area);
      const now = win.value.getBounds();
      if (now.x !== at.x || now.y !== at.y) win.value.setPosition(at.x, at.y, true);
    });

    /** Whether `state.status` is a real reading yet (the first one must not count as "just granted"). */
    const measured = yield* Ref.make(false);

    const refresh = Effect.gen(function* () {
      const status = yield* helper.permissionStatus.pipe(
        Effect.tapError((e) => Effect.logWarning(`permissions: ${e.message}`)),
        Effect.orElseSucceed(() => NOTHING_GRANTED),
      );
      const before = yield* Ref.get(state);
      const known = yield* Ref.getAndSet(measured, true);
      const justGranted = (key: PermissionKey) =>
        known && before.status[key] !== 'granted' && status[key] === 'granted';
      const guiding = before.guiding !== null && status[before.guiding] === 'granted' ? null : before.guiding;
      yield* Ref.set(state, {
        ...before,
        status,
        guiding,
        needsRestart: before.needsRestart || justGranted('screen'),
      });
      if (!known || JSON.stringify(before.status) !== JSON.stringify(status) || guiding !== before.guiding) {
        yield* Effect.logInfo(`permissions: ${JSON.stringify(status)}`);
        yield* push;
      }
      if (guiding !== null) yield* followSettings;
    });

    const create = Effect.sync(() => {
      const win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        title: 'Set up Machete',
        show: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        titleBarStyle: 'hiddenInset',
        vibrancy: 'under-window',
        visualEffectState: 'active',
        backgroundColor: '#00000000',
        acceptFirstMouse: true,
        webPreferences: {
          preload: preloadFile('permissions'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      // Above System Settings, so the icon can be dragged onto it; hidden from screen sharing like all of Machete.
      win.setAlwaysOnTop(true, 'floating');
      win.setContentProtection(true);
      void win.loadFile(rendererFile('permissions'));
      win.once('ready-to-show', () => {
        win.center();
        win.show();
      });
      win.webContents.on('did-finish-load', () => run(push));
      win.on('closed', () =>
        run(Ref.set(current, Option.none()).pipe(Effect.andThen(FiberHandle.clear(poller)))),
      );
      return win;
    });

    const show = Effect.gen(function* () {
      const existing = yield* Ref.get(current);
      if (Option.isSome(existing) && !existing.value.isDestroyed()) {
        existing.value.show();
      } else {
        yield* Ref.set(current, Option.some(yield* create));
      }
      electronApp.focus({ steal: true });
      yield* FiberHandle.run(
        poller,
        refresh.pipe(Effect.repeat(Schedule.spaced(Duration.seconds(1))), Effect.asVoid),
        {
          onlyIfMissing: true,
        },
      );
    });

    const allow = (key: PermissionKey) =>
      Effect.gen(function* () {
        const p = permission(key);
        const s = yield* Ref.get(state);
        if (p.method === 'prompt' && s.status[key] === 'not-determined') {
          yield* Effect.promise(() => systemPreferences.askForMediaAccess('microphone'));
          return yield* refresh;
        }
        yield* browser.open(p.pane);
        yield* Ref.update(state, (x) => ({ ...x, guiding: p.method === 'drag' ? key : null }));
        yield* push;
        // System Settings takes a moment to open and lay out the pane.
        yield* followSettings.pipe(Effect.delay(Duration.millis(700)));
      });

    const decode = Schema.decodeUnknownOption(PermissionsCommand);
    const onCommand = (event: Electron.IpcMainEvent, raw: unknown) => {
      const win = Effect.runSync(Ref.get(current));
      if (Option.isNone(win) || event.sender !== win.value.webContents) return;
      Option.match(decode(raw), {
        onNone: () => run(Effect.logWarning('permissions: ignored a malformed command')),
        onSome: (command) =>
          PermissionsCommand.match(command, {
            Allow: ({ key }) => run(allow(key)),
            // Must start inside the renderer's dragstart, synchronously.
            Drag: () => event.sender.startDrag({ file: bundlePath(), icon: thumbnail.resize({ width: 64 }) }),
            Restart: () => {
              electronApp.relaunch();
              electronApp.quit();
            },
            Close: () => win.value.close(),
          }),
      });
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => ipcMain.on(Channels.permissionsCommand, onCommand)),
      () => Effect.sync(() => ipcMain.off(Channels.permissionsCommand, onCommand)),
    );
    yield* Effect.addFinalizer(() =>
      Ref.get(current).pipe(Effect.map(Option.map((w) => w.isDestroyed() || w.destroy()))),
    );

    return {
      show,
      showIfMissing: helper.permissionStatus.pipe(
        Effect.flatMap((status) => (missing(status).length > 0 ? show : Effect.void)),
        Effect.catch((e) => Effect.logWarning(`permissions: ${e.message}`)),
      ),
    };
  }),
);
