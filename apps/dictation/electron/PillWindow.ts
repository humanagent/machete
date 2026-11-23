// The dictation pill: where the words will go and the voice level. It never takes focus, so the text
// lands in your app, and it is always hidden from screen sharing.
import { BrowserWindow, globalShortcut, ipcMain, Menu } from 'electron';
import { Effect, Layer, Option, Schema } from 'effect';
import { Channels } from '../../../core/ipc';
import { DictationCommand, type DictationEvent } from '../ipc';
import { Dictation, DictationPill } from '../services/Dictation';
import { preloadFile, rendererFile } from '../../../core/electron/paths';
import { placeOnActive } from '../../../core/electron/ActiveScreen';
import { pillGlass } from '../../../core/glass';
import { setGlass } from '../../../core/electron/Glass';
import { hideWindow, releaseWhenIdle } from '../../../core/electron/Idle';
import { makeRunner } from '../../../core/electron/Runner';

// The window is the pill (no margin): macOS draws the blur, rounded corners and shadow.
const WIDTH = 300;
const HEIGHT = 70;

/** How long a hidden pill keeps its process: dictations come in bursts. */
const IDLE_MS = 5 * 60_000;

const create = () => {
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
  // Not while it's being made: the first time it shows.
  w.once('show', () => setGlass(w, pillGlass));
  w.webContents.on('render-process-gone', () => w.isDestroyed() || w.destroy());
  return w;
};

export const DictationPillLive = Layer.effect(
  DictationPill,
  Effect.gen(function* () {
    let win: BrowserWindow | undefined;
    let loaded = false;
    /** What it shows now, or will once its page loads: showing it never waits, so the microphone doesn't either. */
    let showing: { readonly app: string; readonly icon: string } | undefined;
    /** The last thing said over it (Finishing, Failed…), for a page that is still loading. */
    let said: DictationEvent | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => win?.isDestroyed() || win?.destroy()));

    const post = (event: DictationEvent) => {
      if (win && loaded && !win.isDestroyed()) win.webContents.send(Channels.dictationEvent, event);
    };
    const present = () => {
      if (!win || win.isDestroyed() || !loaded || !showing) return;
      placeOnActive(win, 'bottom', { width: WIDTH, height: HEIGHT });
      post({ _tag: 'Show', ...showing });
      if (said) post(said);
      win.showInactive();
    };
    const open = () => {
      if (win && !win.isDestroyed()) return present();
      const w = create();
      win = w;
      loaded = false;
      releaseWhenIdle(w, IDLE_MS);
      w.on('closed', () => {
        if (win === w) win = undefined;
      });
      w.webContents.once('did-finish-load', () => {
        if (win !== w) return;
        loaded = true;
        present();
      });
      void w.loadFile(rendererFile('dictation')).catch(() => w.isDestroyed() || w.destroy());
    };

    return {
      show: (app, icon) =>
        Effect.sync(() => {
          showing = { app, icon };
          said = undefined;
          open();
        }),
      send: (event) =>
        Effect.sync(() => {
          if (event._tag !== 'Level') said = event;
          post(event);
        }),
      hide: Effect.sync(() => {
        showing = undefined;
        said = undefined;
        if (win) hideWindow(win);
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
      const menu = Menu.buildFromTemplate([
        { label: 'Finish recording', click: () => run(dictation.finish) },
        { label: 'Cancel recording', click: () => run(dictation.cancel) },
      ]);
      // Rewrite shows its progress in the pill too: nothing to finish then.
      run(
        dictation.phase.pipe(
          Effect.map((phase) => {
            if (phase !== 'idle') menu.popup({ window });
          }),
        ),
      );
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => ipcMain.on(Channels.dictationCommand, onCommand)),
      () => Effect.sync(() => ipcMain.off(Channels.dictationCommand, onCommand)),
    );
  }),
);
