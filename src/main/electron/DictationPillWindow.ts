// The dictation pill: where the words will go and the voice level. It never takes focus, so the text
// lands in your app, and it is always hidden from screen sharing.
import { BrowserWindow, globalShortcut, ipcMain, Menu, screen } from 'electron';
import { Effect, Layer, Option, Schema } from 'effect';
import { Channels, DictationCommand, type DictationEvent } from '../../shared/ipc';
import { Dictation, DictationPill } from '../services/Dictation';
import { preloadFile, rendererFile } from './paths';
import { makeRunner } from './Runner';

// The window is the pill (no margin): macOS draws the blur, rounded corners and shadow.
const WIDTH = 300;
const HEIGHT = 70;

export const DictationPillLive = Layer.effect(
  DictationPill,
  Effect.gen(function* () {
    const win = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const w = new BrowserWindow({
          width: WIDTH,
          height: HEIGHT,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          hasShadow: true,
          focusable: false,
          ...(process.platform === 'darwin'
            ? { vibrancy: 'hud' as const, visualEffectState: 'active' as const, roundedCorners: true }
            : {}),
          acceptFirstMouse: true,
          alwaysOnTop: true,
          ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
          hiddenInMissionControl: true,
          webPreferences: {
            preload: preloadFile('dictation'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        w.setAlwaysOnTop(true, 'status');
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        w.setContentProtection(true);
        void w.loadFile(rendererFile('dictation'));
        return w;
      }),
      (w) => Effect.sync(() => w.isDestroyed() || w.destroy()),
    );

    const ready = Effect.callback<void>((resume) => {
      if (!win.webContents.isLoading()) resume(Effect.void);
      else win.webContents.once('did-finish-load', () => resume(Effect.void));
    });
    const send = (event: DictationEvent) =>
      Effect.sync(() => {
        if (!win.isDestroyed()) win.webContents.send(Channels.dictationEvent, event);
      });

    return {
      show: (app, icon) =>
        Effect.gen(function* () {
          const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
          win.setBounds({
            x: Math.round(area.x + (area.width - WIDTH) / 2),
            y: Math.round(area.y + area.height - HEIGHT - 28),
            width: WIDTH,
            height: HEIGHT,
          });
          yield* ready;
          yield* send({ _tag: 'Show', app, icon });
          win.showInactive();
        }),
      send,
      hide: Effect.sync(() => {
        if (!win.isDestroyed()) win.hide();
      }),
      captureEscape: (onEscape) =>
        makeRunner<never>().pipe(
          Effect.map((run) => {
            globalShortcut.register('Escape', () => run(onEscape));
          }),
        ),
      releaseEscape: Effect.sync(() => globalShortcut.unregister('Escape')),
    };
  }),
);

/** Clicking the pill offers Finish / Cancel. */
export const DictationMenuLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const dictation = yield* Dictation;
    const run = yield* makeRunner<never>();
    const decode = Schema.decodeUnknownOption(DictationCommand);
    const onCommand = (event: Electron.IpcMainEvent, raw: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (Option.isNone(decode(raw)) || !window) return;
      Menu.buildFromTemplate([
        { label: 'Finish recording', click: () => run(dictation.finish) },
        { label: 'Cancel recording', click: () => run(dictation.cancel) },
      ]).popup({ window });
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => ipcMain.on(Channels.dictationCommand, onCommand)),
      () => Effect.sync(() => ipcMain.off(Channels.dictationCommand, onCommand)),
    );
  }),
);
