// The screenshot editor: adds a frame (your wallpaper or a color behind it), then copies or saves.
import { ipcMain } from 'electron';
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect';
import { Channels } from '../../../core/channels';
import { Invisibility } from '../../../core/electron/Invisibility';
import { makePanel } from '../../../core/electron/Panel';
import { makeRunner } from '../../../core/electron/Runner';
import { NativeHelper } from '../../../core/services/NativeHelper';
import { EditorCommand, type EditorState } from '../ipc';
import { Screenshots } from '../services/Screenshots';

export interface EditorResult {
  /** False: it didn't work, so the editor stays open. */
  readonly copy: (png: Uint8Array) => Effect.Effect<boolean>;
  readonly save: (png: Uint8Array) => Effect.Effect<boolean>;
}

const PNG = 'data:image/png;base64,';
/** Its canvas and pictures are full size, so it doesn't stay around like the other panels. */
const IDLE_MS = 5_000;

export class ScreenshotEditor extends Context.Service<
  ScreenshotEditor,
  { readonly open: (png: Uint8Array, result: EditorResult) => Effect.Effect<void> }
>()('machete/ScreenshotEditor') {
  static readonly layer = Layer.effect(
    ScreenshotEditor,
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      const helper = yield* NativeHelper;
      const run = yield* makeRunner<never>();
      const panel = yield* makePanel('editor', { width: 860, height: 600 }, IDLE_MS);
      // Clicking elsewhere doesn't lose what you're doing.
      yield* panel.keepOpen(true);
      const opened = yield* Ref.make(0);
      const invisibility = yield* Invisibility;
      const result = yield* Ref.make(Option.none<EditorResult>());

      const finish = (dataURL: string, use: (r: EditorResult, png: Uint8Array) => Effect.Effect<boolean>) =>
        Effect.gen(function* () {
          const target = yield* Ref.get(result);
          if (Option.isNone(target) || !dataURL.startsWith(PNG)) return;
          const done = yield* use(target.value, Buffer.from(dataURL.slice(PNG.length), 'base64'));
          if (!done) return;
          yield* Ref.set(result, Option.none());
          yield* panel.hide;
        });

      const decode = Schema.decodeUnknownOption(EditorCommand);
      const onCommand = (_event: Electron.IpcMainEvent, raw: unknown) =>
        Option.map(decode(raw), (command) =>
          run(
            EditorCommand.match(command, {
              SetFrame: ({ frame }) => screenshots.setFrame(frame),
              Copy: ({ png }) => finish(png, (r, bytes) => r.copy(bytes)),
              Save: ({ png }) => finish(png, (r, bytes) => r.save(bytes)),
              Close: () => Ref.set(result, Option.none()).pipe(Effect.andThen(panel.hide)),
            }),
          ),
        );
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.editorCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.editorCommand, onCommand)),
      );

      return {
        open: (png, then) =>
          Effect.gen(function* () {
            yield* Ref.set(result, Option.some(then));
            const wallpaper = yield* helper.wallpaper.pipe(Effect.orElseSucceed(() => ''));
            const state: EditorState = {
              opened: yield* Ref.updateAndGet(opened, (n) => n + 1),
              image: PNG + Buffer.from(png).toString('base64'),
              wallpaper,
              frame: yield* screenshots.frame,
            };
            yield* panel.open((w) =>
              Effect.sync(() => {
                invisibility.follow(w, 'editor');
                w.webContents.send(Channels.editorState, state);
              }),
            );
          }),
      };
    }),
  );
}
