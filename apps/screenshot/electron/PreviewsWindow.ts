// The floating previews: each screenshot stays at the bottom left of the screen you're on until you use it or close it.
// The window never takes focus and is hidden from screen sharing (and from the next screenshot).
import { app, BrowserWindow, ipcMain, nativeImage, screen } from 'electron';
import { Context, Effect, FiberHandle, Layer, Option, Ref, Schema, Semaphore } from 'effect';
import { Channels } from '../../../core/channels';
import { activeScreen, placeOnActive } from '../../../core/electron/ActiveScreen';
import { preloadFile, rendererFile } from '../../../core/electron/paths';
import { Clipboard } from '../../../core/electron/Platform';
import { stackGlass } from '../../../core/glass';
import { dragOut, setGlass } from '../../../core/electron/Glass';
import { makeRunner } from '../../../core/electron/Runner';
import { PreviewsCommand, type PreviewsState } from '../ipc';
import { Screenshots, type Shot } from '../services/Screenshots';
import { ScreenshotEditor } from './EditorWindow';

/** The renderer lays out the same sizes: a card, a gap, and room for its shadow. */
const CARD = { width: 220, height: 150 };
const GAP = 10;
const MARGIN = 16;
const MAX = 5;
/** How wide the picture under the pointer is. */
const DRAGGED = 120;

interface Floating extends Shot {
  readonly thumb: string;
}

export class ScreenshotPreviews extends Context.Service<
  ScreenshotPreviews,
  { readonly full: Effect.Effect<void>; readonly area: Effect.Effect<void> }
>()('machete/ScreenshotPreviews') {
  static readonly layer = Layer.effect(
    ScreenshotPreviews,
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      const editor = yield* ScreenshotEditor;
      const clipboard = yield* Clipboard;
      const run = yield* makeRunner<never>();
      const shots = yield* Ref.make<ReadonlyArray<Floating>>([]);
      const current = yield* Ref.make(Option.none<BrowserWindow>());
      yield* Effect.addFinalizer(() =>
        Ref.get(current).pipe(Effect.map(Option.map((w) => w.isDestroyed() || w.destroy()))),
      );

      const create = Effect.callback<BrowserWindow>((resume) => {
        const w = new BrowserWindow({
          width: CARD.width + MARGIN * 2,
          height: CARD.height + MARGIN * 2,
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
          hasShadow: false,
          focusable: false,
          acceptFirstMouse: true,
          alwaysOnTop: true,
          hiddenInMissionControl: true,
          ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
          webPreferences: {
            preload: preloadFile('previews'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        w.setAlwaysOnTop(true, 'status');
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        w.setContentProtection(true);
        w.once('closed', () => resume(Effect.die(new Error('previews: closed before it loaded'))));
        w.webContents.on('render-process-gone', () => w.isDestroyed() || w.destroy());
        w.webContents.once('did-finish-load', () => resume(Effect.succeed(w)));
        void w.loadFile(rendererFile('previews')).catch(() => w.isDestroyed() || w.destroy());
      });
      // Built with the first screenshot.
      const lock = yield* Semaphore.make(1);
      const window = lock.withPermit(
        Effect.gen(function* () {
          const existing = (yield* Ref.get(current)).pipe(Option.filter((w) => !w.isDestroyed()));
          if (Option.isSome(existing)) return existing.value;
          const w = yield* create;
          yield* Ref.set(current, Option.some(w));
          return w;
        }),
      );

      const put = (w: BrowserWindow, count: number) =>
        placeOnActive(w, 'bottomLeft', {
          width: CARD.width + MARGIN * 2,
          height: count * CARD.height + (count - 1) * GAP + MARGIN * 2,
        });

      // While there are previews they follow you to another screen, once you've been there for a moment.
      const follow = yield* FiberHandle.make<void, never>();
      const following = Effect.gen(function* () {
        let there = 0;
        let count = (yield* Ref.get(shots)).length;
        while (count > 0) {
          yield* Effect.sleep('1 second');
          count = (yield* Ref.get(shots)).length;
          if (count === 0 || screen.getAllDisplays().length < 2) continue;
          const w = yield* window;
          there = activeScreen().id === screen.getDisplayMatching(w.getBounds()).id ? 0 : there + 1;
          if (there < 2) continue;
          there = 0;
          put(w, count);
        }
      });

      const show = Effect.gen(function* () {
        const list = yield* Ref.get(shots);
        if (list.length === 0) {
          yield* FiberHandle.clear(follow);
          const last = yield* Ref.getAndSet(current, Option.none());
          if (Option.isSome(last) && !last.value.isDestroyed()) last.value.destroy();
          return;
        }
        const w = yield* window;
        put(w, list.length);
        setGlass(w, stackGlass(CARD, list.length, GAP, MARGIN));
        const state: PreviewsState = { shots: list.map(({ id, thumb }) => ({ id, thumb })) };
        w.webContents.send(Channels.previewsState, state);
        w.showInactive();
        yield* FiberHandle.run(follow, following, { onlyIfMissing: true });
      });

      const hide = (shot: Shot) =>
        Ref.update(shots, (list) => list.filter((s) => s.id !== shot.id)).pipe(Effect.andThen(show));
      const drop = (shot: Shot) => hide(shot).pipe(Effect.andThen(screenshots.discard(shot)));

      const add = (shot: Shot) =>
        Effect.gen(function* () {
          const image = nativeImage.createFromPath(shot.file);
          if (image.isEmpty()) return yield* screenshots.discard(shot);
          const { width, height } = image.getSize();
          // Twice the card, for Retina; small screenshots as they are.
          const scale = Math.min(1, Math.max((CARD.width * 2) / width, (CARD.height * 2) / height));
          const thumb = image.resize({ width: Math.max(1, Math.round(width * scale)) }).toDataURL();
          const all = [{ ...shot, thumb }, ...(yield* Ref.get(shots))];
          yield* Ref.set(shots, all.slice(0, MAX));
          yield* Effect.forEach(all.slice(MAX), screenshots.discard);
          yield* show;
        });

      const take = (full: boolean) =>
        Effect.gen(function* () {
          const shot = yield* screenshots.take(
            full ? { _tag: 'Full', rect: activeScreen().bounds } : { _tag: 'Area' },
          );
          if (Option.isNone(shot)) return;
          yield* Effect.logInfo(`screenshot: ${full ? 'full screen' : 'area'}`);
          yield* add(shot.value);
        });

      const withPng = (shot: Floating, use: (png: Uint8Array) => Effect.Effect<boolean>) =>
        screenshots.read(shot).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => drop(shot),
              onSome: (png) => use(png).pipe(Effect.flatMap((done) => (done ? drop(shot) : Effect.void))),
            }),
          ),
        );
      const save = (png: Uint8Array) =>
        screenshots.save(png, app.getPath('desktop')).pipe(Effect.map(Option.isSome));

      // It goes once something takes it. Its file stays until Machete quits: whoever took it may read it later.
      const drag = (shot: Floating, page: Electron.WebContents) =>
        Effect.gen(function* () {
          const w = BrowserWindow.fromWebContents(page);
          const taken = w ? yield* dragOut(w, shot.file, DRAGGED) : Option.none<boolean>();
          if (Option.isSome(taken)) return yield* taken.value ? hide(shot) : Effect.void;
          // Electron doesn't say how it ended: it stays.
          const icon = nativeImage.createFromDataURL(shot.thumb).resize({ width: DRAGGED });
          page.startDrag({ file: shot.file, icon });
        });

      const decode = Schema.decodeUnknownOption(PreviewsCommand);
      const onCommand = (event: Electron.IpcMainEvent, raw: unknown) =>
        Option.map(decode(raw), (command) =>
          run(
            Effect.gen(function* () {
              const shot = (yield* Ref.get(shots)).find((s) => s.id === command.id);
              if (!shot) return;
              const dropIf = (done: boolean) => (done ? drop(shot) : Effect.void);
              yield* PreviewsCommand.match(command, {
                Edit: () =>
                  withPng(shot, (png) =>
                    editor
                      .open(png, {
                        copy: (edited) => clipboard.writeImage(edited).pipe(Effect.tap(dropIf)),
                        save: (edited) => save(edited).pipe(Effect.tap(dropIf)),
                      })
                      .pipe(Effect.as(false)),
                  ),
                Copy: () => withPng(shot, clipboard.writeImage),
                Save: () => withPng(shot, save),
                Duplicate: () =>
                  screenshots
                    .duplicate(shot)
                    .pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: add }))),
                Drag: () => drag(shot, event.sender),
                Close: () => drop(shot),
              });
            }),
          ),
        );
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.previewsCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.previewsCommand, onCommand)),
      );

      return { full: take(true), area: take(false) };
    }),
  );
}
