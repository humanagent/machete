// The copilot: a floating, non-activating panel at the top center of the built-in display.
// Hidden from screen sharing unless the eye says otherwise; its top edge stays put as the content grows.
import { BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { Context, Effect, Layer, Option, Ref, Schema, Stream } from 'effect';
import { Channels } from '../../../core/ipc';
import { CopilotCommand, type CopilotKeys } from '../ipc';
import { AppState, copilotState } from '../services/AppState';
import { Clipboard } from '../../../core/electron/Platform';
import { preloadFile, rendererFile } from '../../../core/electron/paths';
import { placeOnActive } from '../../../core/electron/ActiveScreen';
import { Hotkeys } from '../../../core/electron/Hotkeys';
import { type HotkeyID, label } from '../../../core/hotkeys';
import { copilotGlass } from '../../../core/glass';
import { setGlass } from '../../../core/electron/Glass';
import { makeRunner } from '../../../core/electron/Runner';
import { BotsWindow } from './BotsWindow';

/** Margin around the panel, so its shadow isn't clipped. */
export const PAD = 8;
const MIN_CARD_WIDTH = 480;

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
  readonly window: BrowserWindow;
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
      const run = yield* makeRunner<never>();
      const initial = yield* app.model;

      const win = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new BrowserWindow({
              width: initial.cardWidth + PAD * 2,
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
            }),
        ),
        (w) => Effect.sync(() => w.isDestroyed() || w.destroy()),
      );
      win.setAlwaysOnTop(true, 'status');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      win.setContentProtection(!initial.visibleInCapture);
      // Links in answers open in the browser, never inside the panel.
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (isHttp(url)) void shell.openExternal(url);
        return { action: 'deny' };
      });
      win.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        if (isHttp(url)) void shell.openExternal(url);
      });

      const geometry = yield* Ref.make<Geometry>({
        placedOnce: false,
        anchorTop: null,
        anchorMidX: null,
        userResizing: false,
      });
      const anchorHere = Effect.sync(() => win.getBounds()).pipe(
        Effect.flatMap((b) =>
          Ref.update(geometry, (g) => ({ ...g, anchorTop: b.y, anchorMidX: b.x + b.width / 2 })),
        ),
      );

      /** Nothing shows it on its own: the log says what did. */
      const showFor = (why: string) =>
        Effect.gen(function* () {
          if (win.isVisible()) return;
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

      /** Size requested by the renderer for its content. */
      const layout = (width: number, height: number) =>
        Effect.gen(function* () {
          const g = yield* Ref.get(geometry);
          if (g.userResizing) return;
          const size = { width: Math.round(width), height: Math.round(height) };
          const b = win.getBounds();
          if (b.width === size.width && b.height === size.height) return;
          win.setBounds(anchoredBounds(b, { top: g.anchorTop, midX: g.anchorMidX }, size));
        });

      win.on('moved', () => run(anchorHere));
      // Dragging an edge resizes the card (only while the card shows).
      win.on('will-resize', (_event, next) =>
        run(
          Ref.update(geometry, (g) => ({ ...g, userResizing: true })).pipe(
            Effect.andThen(app.setCardSize(next.width - PAD * 2, next.height - PAD * 2, false)),
          ),
        ),
      );
      win.on('resized', () =>
        run(
          Effect.gen(function* () {
            const g = yield* Ref.getAndUpdate(geometry, (x) => ({ ...x, userResizing: false }));
            if (!g.userResizing) return;
            yield* anchorHere;
            const b = win.getBounds();
            yield* app.setCardSize(b.width - PAD * 2, b.height - PAD * 2, true);
          }),
        ),
      );

      /** Window position when a drag started. */
      const dragOrigin = yield* Ref.make<readonly [number, number]>([0, 0]);
      const dragStart = Effect.sync(() => win.getPosition()).pipe(
        Effect.flatMap(([x, y]) => Ref.set(dragOrigin, [x ?? 0, y ?? 0] as const)),
      );
      const dragMove = (dx: number, dy: number) =>
        Ref.get(dragOrigin).pipe(
          Effect.map(([x, y]) => win.setPosition(Math.round(x + dx), Math.round(y + dy))),
        );

      const botsMenu = (x: number, y: number) =>
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

      const handle = (command: CopilotCommand) =>
        CopilotCommand.match(command, {
          Layout: ({ width, height }) => layout(width, height),
          DragStart: () => dragStart,
          DragMove: ({ dx, dy }) => dragMove(dx, dy),
          SetQuestion: ({ question }) => app.setQuestion(question),
          Ask: ({ question }) => app.setQuestion(question).pipe(Effect.andThen(app.ask())),
          Collapse: () => app.collapseToggle,
          ToggleFollow: () => app.toggleFollow,
          ToggleCapture: () => app.toggleCaptureVisibility,
          ToggleListening: () => app.toggleListening,
          ToggleTranscript: () => app.toggleTranscript,
          Reset: () => app.reset,
          Login: () => app.login,
          SetCardHeight: ({ height, persist }) => app.setCardHeight(height, persist),
          Copy: ({ text }) => clipboard.write(text),
          BotsMenu: ({ x, y }) => botsMenu(x, y),
        });

      const decode = Schema.decodeUnknownOption(CopilotCommand);
      const onCommand = (event: Electron.IpcMainEvent, raw: unknown) => {
        if (event.sender !== win.webContents) return;
        Option.match(decode(raw), {
          onNone: () => run(Effect.logWarning('copilot: ignored a malformed command')),
          onSome: (command) => run(handle(command)),
        });
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.copilotCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.copilotCommand, onCommand)),
      );

      // The renderer draws every state change; the window follows the parts it owns.
      const render = app.changes.pipe(
        Stream.map(copilotState),
        Stream.runForEach((s) =>
          Effect.sync(() => {
            if (win.isDestroyed()) return;
            win.webContents.send(Channels.copilotState, s);
            win.setContentProtection(!s.visibleInCapture);
            if (win.isResizable() !== s.cardVisible) win.setResizable(s.cardVisible);
          }),
        ),
      );
      const loaded = Effect.callback<void>((resume) => {
        win.webContents.once('did-finish-load', () => resume(Effect.void));
      });
      // Not while Machete opens: the first time it's called.
      win.once('show', () => setGlass(win, copilotGlass(PAD)));
      yield* Effect.sync(() => void win.loadFile(rendererFile('copilot')));
      yield* loaded.pipe(Effect.andThen(render), Effect.forkScoped);
      // The keys shown on the panel are the ones in Settings.
      const showKeys = hotkeys.changes.pipe(
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
      yield* loaded.pipe(Effect.andThen(showKeys), Effect.forkScoped);
      const signals = yield* app.signals;
      yield* signals.pipe(
        Stream.runForEach((signal) => (signal._tag === 'ShowPanel' ? showFor(signal.why) : Effect.void)),
        Effect.forkScoped,
      );

      return {
        window: win,
        toggle: Effect.suspend(() => (win.isVisible() ? Effect.sync(() => win.hide()) : showFor('toggle'))),
        focusInput: showFor('type a question').pipe(
          Effect.andThen(Effect.sync(() => win.focus())),
          Effect.andThen(app.focusInput),
        ),
      } satisfies CopilotWindowShape;
    }),
  );
}
