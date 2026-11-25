// The quick panels (clipboard, snippets): a non-activating, translucent window, so the app you're in keeps
// focus and whatever you pick is typed right there. Built on first use, hidden when it loses focus, and
// hidden from screen sharing until it follows Invisibility.
import { BrowserWindow } from 'electron';
import { Effect, Option, Ref, type Scope, Semaphore } from 'effect';
import { draggedTo, type Point } from '../place';
import { placeOnActive } from './ActiveScreen';
import { panelGlass } from '../glass';
import { setGlass } from './Glass';
import { hideWindow, releaseWhenIdle } from './Idle';
import { preloadFile, rendererFile, type Window } from './paths';

/** How long a closed panel keeps its process, so opening it again is instant. */
const IDLE_MS = 60_000;

export interface Panel {
  /** The window if it was built and is on screen. */
  readonly visible: Effect.Effect<Option.Option<BrowserWindow>>;
  /** Builds it if needed, puts it on the screen you're on, calls `before`, then shows and focuses it. */
  readonly open: (before: (w: BrowserWindow) => Effect.Effect<void>) => Effect.Effect<void>;
  readonly hide: Effect.Effect<void>;
  /** While true (a dialog is open over it, or it stays until closed), losing focus doesn't hide it. */
  readonly keepOpen: (keep: boolean) => Effect.Effect<void>;
}

export const makePanel = (
  name: Window,
  size: { readonly width: number; readonly height: number },
  idleMs = IDLE_MS,
): Effect.Effect<Panel, never, Scope.Scope> =>
  Effect.gen(function* () {
    const current = yield* Ref.make<Option.Option<BrowserWindow>>(Option.none());
    let keep = false;
    // Where you dragged it (only the calculator and the screenshot editor can be), and where we put it.
    let dragged: Point | undefined;
    let ours: Point | undefined;
    yield* Effect.addFinalizer(() =>
      Ref.get(current).pipe(Effect.map(Option.map((w) => w.isDestroyed() || w.destroy()))),
    );

    const create = Effect.callback<BrowserWindow>((resume) => {
      const w = new BrowserWindow({
        ...size,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: true,
        alwaysOnTop: true,
        hiddenInMissionControl: true,
        ...(process.platform === 'darwin'
          ? {
              type: 'panel' as const,
              vibrancy: 'popover' as const,
              visualEffectState: 'active' as const,
              roundedCorners: true,
            }
          : {}),
        webPreferences: {
          preload: preloadFile(name),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      w.setAlwaysOnTop(true, 'pop-up-menu');
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      w.setContentProtection(true);
      w.on('blur', () => keep || hideWindow(w));
      releaseWhenIdle(w, idleMs);
      // A page that can't load, or died: the next time it's opened there's a new one.
      w.on('closed', () => {
        resume(Effect.die(new Error(`${name}: its window closed before it loaded`)));
      });
      w.webContents.on('render-process-gone', () => w.isDestroyed() || w.destroy());
      w.on('moved', () => {
        dragged = draggedTo(w.getBounds(), ours, dragged);
      });
      w.webContents.once('did-finish-load', () => {
        setGlass(w, panelGlass);
        resume(Effect.succeed(w));
      });
      void w.loadFile(rendererFile(name)).catch(() => w.isDestroyed() || w.destroy());
    });

    const lock = yield* Semaphore.make(1);
    // One at a time: two presses while the page loads would make two windows, and nothing would close the first.
    const window = lock.withPermit(
      Effect.gen(function* () {
        const existing = (yield* Ref.get(current)).pipe(Option.filter((w) => !w.isDestroyed()));
        if (Option.isSome(existing)) return existing.value;
        const w = yield* create;
        yield* Ref.set(current, Option.some(w));
        return w;
      }),
    );

    return {
      visible: Ref.get(current).pipe(Effect.map(Option.filter((w) => !w.isDestroyed() && w.isVisible()))),
      open: (before) =>
        Effect.gen(function* () {
          const w = yield* window;
          ours = placeOnActive(w, 'center', size, dragged);
          yield* before(w);
          w.showInactive();
          w.focus();
        }),
      hide: Ref.get(current).pipe(Effect.map(Option.map(hideWindow)), Effect.asVoid),
      keepOpen: (k) =>
        Effect.sync(() => {
          keep = k;
        }),
    };
  });
