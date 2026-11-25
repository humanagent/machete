// The copilot: a floating, non-activating panel at the top center of the built-in display.
// Hidden from screen sharing unless the ghost says otherwise; its top edge stays put as the content grows.
import { BrowserWindow, ipcMain, Menu, shell } from 'electron';
import {
  Context,
  Deferred,
  Effect,
  FiberHandle,
  Layer,
  Option,
  Ref,
  Schema,
  Semaphore,
  Stream,
} from 'effect';
import { Channels } from '../../../core/ipc';
import type { TranscriptLine } from '../domain';
import { CopilotCommand, type CopilotKeys, type PanelUpdate } from '../ipc';
import { AppState, panelState, sameState } from '../services/AppState';
import { Clipboard } from '../../../core/electron/Platform';
import { preloadFile, rendererFile } from '../../../core/electron/paths';
import { placeOnActive } from '../../../core/electron/ActiveScreen';
import { Hotkeys } from '../../../core/electron/Hotkeys';
import { Invisibility } from '../../../core/electron/Invisibility';
import { type HotkeyID, label } from '../../../core/hotkeys';
import { copilotGlass } from '../../../core/glass';
import { setGlass } from '../../../core/electron/Glass';
import { hideWindow, releaseWhenIdle } from '../../../core/electron/Idle';
import { makeRunner } from '../../../core/electron/Runner';
import { BotsWindow } from './BotsWindow';

/** Margin around the panel, so its shadow isn't clipped. */
export const PAD = 8;
const MIN_CARD_WIDTH = 480;
/** How long a hidden panel keeps its process, so calling it again is instant. What it shows lives in AppState. */
const IDLE_MS = 5 * 60_000;
/** Between two states sent to the panel: an answer arrives in many more pieces than can be seen. */
const FRAME = '40 millis';

interface Geometry {
  readonly placedOnce: boolean;
  readonly anchorTop: number | null;
  readonly anchorMidX: number | null;
  readonly userResizing: boolean;
}

/** Bounds that keep the top edge and the horizontal center where they were. */
export const anchoredBounds = (
  current: { readonly x: number; readonly y: number; readonly width: number },
  anchor: { readonly top: number | null; readonly midX: number | null },
  size: { readonly width: number; readonly height: number },
) => {
  const top = anchor.top ?? current.y;
  const mid = anchor.midX ?? current.x + current.width / 2;
  return { x: Math.round(mid - size.width / 2), y: top, width: size.width, height: size.height };
};

export interface CopilotWindowShape {
  readonly toggle: Effect.Effect<void>;
  readonly focusInput: Effect.Effect<void>;
}

const isHttp = (url: string) => /^https?:/i.test(url);

export class CopilotWindow extends Context.Service<CopilotWindow, CopilotWindowShape>()(
  'machete/CopilotWindow',
) {
  static readonly layer = Layer.effect(
    CopilotWindow,
    Effect.gen(function* () {
      const app = yield* AppState;
      const clipboard = yield* Clipboard;
      const bots = yield* BotsWindow;
      const hotkeys = yield* Hotkeys;
      const invisibility = yield* Invisibility;
      const run = yield* makeRunner<never>();
      const current = yield* Ref.make<Option.Option<BrowserWindow>>(Option.none());
      const alive = Ref.get(current).pipe(Effect.map(Option.filter((w) => !w.isDestroyed())));
      const whenAlive = (f: (w: BrowserWindow) => Effect.Effect<unknown>) =>
        alive.pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (w) => f(w) })));
      yield* Effect.addFinalizer(() => alive.pipe(Effect.map(Option.map((w) => w.destroy()))));

      const geometry = yield* Ref.make<Geometry>({
        placedOnce: false,
        anchorTop: null,
        anchorMidX: null,
        userResizing: false,
      });
      const anchorHere = (win: BrowserWindow) =>
        Effect.sync(() => win.getBounds()).pipe(
          Effect.flatMap((b) =>
            Ref.update(geometry, (g) => ({ ...g, anchorTop: b.y, anchorMidX: b.x + b.width / 2 })),
          ),
        );

      /** Size requested by the renderer for its content. */
      const layout = (win: BrowserWindow, width: number, height: number) =>
        Effect.gen(function* () {
          const g = yield* Ref.get(geometry);
          if (g.userResizing) return;
          const size = { width: Math.round(width), height: Math.round(height) };
          const b = win.getBounds();
          if (b.width === size.width && b.height === size.height) return;
          win.setBounds(anchoredBounds(b, { top: g.anchorTop, midX: g.anchorMidX }, size));
        });

      /** Window position when a drag started. */
      const dragOrigin = yield* Ref.make<readonly [number, number]>([0, 0]);
      const dragStart = (win: BrowserWindow) =>
        Effect.sync(() => win.getPosition()).pipe(
          Effect.flatMap(([x, y]) => Ref.set(dragOrigin, [x ?? 0, y ?? 0] as const)),
        );
      const dragMove = (win: BrowserWindow, dx: number, dy: number) =>
        Ref.get(dragOrigin).pipe(
          Effect.map(([x, y]) => win.setPosition(Math.round(x + dx), Math.round(y + dy))),
        );

      const botsMenu = (win: BrowserWindow, x: number, y: number) =>
        Effect.gen(function* () {
          const m = yield* app.model;
          const items: Array<Electron.MenuItemConstructorOptions> = m.profiles.map((p) => ({
            label: p.name,
            type: 'checkbox',
            checked: p.id === m.selectedProfileID,
            click: () => run(app.selectProfile(p.id)),
          }));
          items.push({ type: 'separator' }, { label: 'Manage', click: () => run(bots.toggle) });
          Menu.buildFromTemplate(items).popup({ window: win, x: Math.round(x), y: Math.round(y) });
        });

      const handle = (win: BrowserWindow, command: CopilotCommand) =>
        CopilotCommand.match(command, {
          Layout: ({ width, height }) =>
            layout(win, width, height).pipe(Effect.andThen(Deferred.succeed(drawn, undefined))),
          DragStart: () => dragStart(win),
          DragMove: ({ dx, dy }) => dragMove(win, dx, dy),
          SetQuestion: ({ question }) => app.setQuestion(question),
          Ask: ({ question }) => app.setQuestion(question).pipe(Effect.andThen(app.ask())),
          Collapse: () => app.collapseToggle,
          ToggleFollow: () => app.toggleFollow,
          ToggleListening: () => app.toggleListening,
          ToggleTranscript: () => app.toggleTranscript,
          Reset: () => app.reset,
          Login: () => app.login,
          SetCardHeight: ({ height, persist }) => app.setCardHeight(height, persist),
          Copy: ({ text }) => clipboard.write(text),
          BotsMenu: ({ x, y }) => botsMenu(win, x, y),
        });

      const decode = Schema.decodeUnknownOption(CopilotCommand);
      const onCommand = (event: Electron.IpcMainEvent, raw: unknown) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const ours = Effect.runSync(alive);
        if (!win || Option.isNone(ours) || win !== ours.value) return;
        Option.match(decode(raw), {
          onNone: () => run(Effect.logWarning('copilot: ignored a malformed command')),
          onSome: (command) => run(handle(win, command)),
        });
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.copilotCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.copilotCommand, onCommand)),
      );

      // The renderer draws the state; the window follows the parts it owns. Words heard while recording aren't drawn,
      // so they never get here.
      const states = app.changes.pipe(Stream.map(panelState), Stream.changesWith(sameState));
      const draw = (win: BrowserWindow) =>
        Effect.suspend(() => {
          let sent: ReadonlyArray<TranscriptLine> | undefined;
          return states.pipe(
            Stream.buffer({ capacity: 1, strategy: 'sliding' }),
            Stream.runForEach(({ lines, ...rest }) =>
              Effect.sync(() => {
                if (win.isDestroyed()) return;
                const update: PanelUpdate = lines === sent ? rest : { ...rest, lines };
                sent = lines;
                win.webContents.send(Channels.copilotState, update);
                if (win.isResizable() !== rest.cardVisible) win.setResizable(rest.cardVisible);
              }).pipe(Effect.andThen(Effect.sleep(FRAME))),
            ),
          );
        });
      // The keys shown on the panel are the ones in Settings.
      const showKeys = (win: BrowserWindow) =>
        hotkeys.changes.pipe(
          Stream.runForEach(({ keys }) =>
            Effect.sync(() => {
              const first = (id: HotkeyID) => (keys.get(id) ?? []).slice(0, 1).map(label).join('');
              const shown: CopilotKeys = {
                ask: first('copilot.ask'),
                listen: first('copilot.listen'),
                reset: first('copilot.new'),
              };
              if (!win.isDestroyed()) win.webContents.send(Channels.copilotKeys, shown);
            }),
          ),
        );

      /** What feeds the window there is. */
      const feeding = yield* FiberHandle.make<void, never>();
      /** Done once the page has drawn its first state (it answers each one with its size). */
      let drawn = Deferred.makeUnsafe<void>();

      const create = Effect.gen(function* () {
        const m = yield* app.model;
        const g = yield* Ref.get(geometry);
        const width = m.cardWidth + PAD * 2;
        const win = new BrowserWindow({
          width,
          height: 74,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          hasShadow: true,
          resizable: false,
          movable: true,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          // NSPanel, non-activating: typing in it never steals focus from the app you're in.
          ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
          acceptFirstMouse: true,
          hiddenInMissionControl: true,
          minWidth: MIN_CARD_WIDTH + PAD * 2,
          webPreferences: {
            preload: preloadFile('copilot'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        win.setAlwaysOnTop(true, 'status');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        invisibility.follow(win, 'copilot');
        // Where the last one was.
        if (g.anchorTop !== null && g.anchorMidX !== null)
          win.setPosition(Math.round(g.anchorMidX - width / 2), g.anchorTop);
        // Links in answers open in the browser, never inside the panel.
        win.webContents.setWindowOpenHandler(({ url }) => {
          if (isHttp(url)) void shell.openExternal(url);
          return { action: 'deny' };
        });
        win.webContents.on('will-navigate', (event, url) => {
          event.preventDefault();
          if (isHttp(url)) void shell.openExternal(url);
        });
        win.on('moved', () => run(anchorHere(win)));
        // Dragging an edge resizes the card (only while the card shows).
        win.on('will-resize', (_event, next) =>
          run(
            Ref.update(geometry, (x) => ({ ...x, userResizing: true })).pipe(
              Effect.andThen(app.setCardSize(next.width - PAD * 2, next.height - PAD * 2, false)),
            ),
          ),
        );
        win.on('resized', () =>
          run(
            Effect.gen(function* () {
              const before = yield* Ref.getAndUpdate(geometry, (x) => ({ ...x, userResizing: false }));
              if (!before.userResizing || win.isDestroyed()) return;
              yield* anchorHere(win);
              const b = win.getBounds();
              yield* app.setCardSize(b.width - PAD * 2, b.height - PAD * 2, true);
            }),
          ),
        );
        // Not while it's being made: the first time it shows.
        win.once('show', () => setGlass(win, copilotGlass(PAD)));
        releaseWhenIdle(win, IDLE_MS);
        win.on('closed', () => {
          run(
            Ref.update(geometry, (x) => ({ ...x, userResizing: false })).pipe(
              Effect.andThen(alive),
              Effect.flatMap((w) => (Option.isNone(w) ? FiberHandle.clear(feeding) : Effect.void)),
            ),
          );
        });
        win.webContents.on('render-process-gone', () => win.isDestroyed() || win.destroy());
        drawn = Deferred.makeUnsafe<void>();
        yield* Ref.set(current, Option.some(win));
        yield* Effect.callback<void>((resume) => {
          win.webContents.once('did-finish-load', () => resume(Effect.void));
          win.once('closed', () => resume(Effect.die(new Error('copilot: its page did not load'))));
          void win.loadFile(rendererFile('copilot')).catch(() => win.isDestroyed() || win.destroy());
        });
        yield* FiberHandle.run(
          feeding,
          Effect.all([draw(win), showKeys(win)], { concurrency: 'unbounded', discard: true }),
        );
        // It has its size, and is there to be seen, before it shows.
        yield* Deferred.await(drawn).pipe(Effect.timeout('1 second'), Effect.ignore);
        return win;
      });
      const lock = yield* Semaphore.make(1);
      /** The panel, made if needed: never two. */
      const window = lock.withPermit(
        alive.pipe(Effect.flatMap(Option.match({ onNone: () => create, onSome: (w) => Effect.succeed(w) }))),
      );

      /** Nothing shows it on its own: the log says what did. */
      const showFor = (why: string) =>
        Effect.gen(function* () {
          const win = yield* window;
          if (win.isDestroyed() || win.isVisible()) return;
          yield* Effect.logInfo(`copilot: shown (${why})`);
          // Top center of the screen you're on; or wherever it was left, if that's on it.
          const b = win.getBounds();
          const { placedOnce } = yield* Ref.get(geometry);
          const at = placeOnActive(win, 'top', b, placedOnce ? b : undefined);
          yield* Ref.update(geometry, (g) => ({
            ...g,
            placedOnce: true,
            anchorTop: at.y,
            anchorMidX: at.x + at.width / 2,
          }));
          win.showInactive();
        });

      const signals = yield* app.signals;
      yield* signals.pipe(
        Stream.runForEach((signal) =>
          signal._tag === 'ShowPanel'
            ? showFor(signal.why).pipe(Effect.catchCause((c) => Effect.logError(c)))
            : Effect.void,
        ),
        Effect.forkScoped,
      );

      return {
        toggle: alive.pipe(
          Effect.flatMap((w) =>
            Option.isSome(w) && w.value.isVisible()
              ? Effect.sync(() => hideWindow(w.value))
              : showFor('toggle'),
          ),
        ),
        focusInput: showFor('type a question').pipe(
          Effect.andThen(whenAlive((w) => Effect.sync(() => w.focus()))),
          Effect.andThen(app.focusInput),
        ),
      } satisfies CopilotWindowShape;
    }),
  );
}
