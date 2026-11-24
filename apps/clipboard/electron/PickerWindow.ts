// The clipboard picker (⇧⌘V): a quick panel listing what you copied; the chosen entry is pasted into your app,
// or copied again with a double click.
import { ipcMain } from 'electron';
import { Context, Effect, Layer, Option, Ref, Schema, Stream } from 'effect';
import { Channels } from '../../../core/channels';
import { Invisibility } from '../../../core/electron/Invisibility';
import { Clipboard } from '../../../core/electron/Platform';
import { makePanel } from '../../../core/electron/Panel';
import { makeRunner } from '../../../core/electron/Runner';
import { PermissionsGuide } from '../../../core/services/PermissionsGuide';
import { ClipboardCommand, type ClipboardState } from '../ipc';
import { ClipboardHistory } from '../services/ClipboardHistory';

export class ClipboardPicker extends Context.Service<
  ClipboardPicker,
  { readonly toggle: Effect.Effect<void>; readonly clear: Effect.Effect<void> }
>()('machete/ClipboardPicker') {
  static readonly layer = Layer.effect(
    ClipboardPicker,
    Effect.gen(function* () {
      const history = yield* ClipboardHistory;
      const clipboard = yield* Clipboard;
      const guide = yield* PermissionsGuide;
      const run = yield* makeRunner<never>();
      // The list (460) and the full-text preview beside it.
      const panel = yield* makePanel('clipboard', { width: 800, height: 520 });
      const opened = yield* Ref.make(0);
      const invisibility = yield* Invisibility;

      const send = (w: Electron.BrowserWindow) =>
        Effect.gen(function* () {
          const state: ClipboardState = {
            items: yield* history.items,
            opened: yield* Ref.get(opened),
          };
          if (!w.isDestroyed()) w.webContents.send(Channels.clipboardState, state);
        });

      const paste = (text: string) =>
        panel.hide.pipe(
          // Let the panel go before ⌘V, so the keystroke reaches the app underneath.
          Effect.andThen(Effect.sleep('60 millis')),
          Effect.andThen(history.paste(text)),
          Effect.catch((e) =>
            e.message === 'accessibility' ? guide.show : Effect.logWarning(`clipboard: paste: ${e.message}`),
          ),
        );

      const decode = Schema.decodeUnknownOption(ClipboardCommand);
      const onCommand = (_event: Electron.IpcMainEvent, raw: unknown) =>
        Option.map(decode(raw), (command) =>
          run(
            ClipboardCommand.match(command, {
              Paste: ({ text }) => paste(text),
              // Nothing is typed anywhere: the panel goes, and ⌘V pastes it where you want.
              Copy: ({ text }) =>
                clipboard.write(text).pipe(Effect.andThen(history.raise(text)), Effect.andThen(panel.hide)),
              Remove: ({ text }) => history.remove(text),
              Close: () => panel.hide,
            }),
          ),
        );
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.clipboardCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.clipboardCommand, onCommand)),
      );

      // A copy made while the picker is open (or a removal) shows up in it.
      yield* history.changes.pipe(
        Stream.runForEach(() =>
          panel.visible.pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: send }))),
        ),
        Effect.forkScoped,
      );

      return {
        toggle: panel.visible.pipe(
          Effect.flatMap(
            Option.match({
              onSome: () => panel.hide,
              onNone: () =>
                panel.open((w) =>
                  Ref.update(opened, (n) => n + 1).pipe(
                    Effect.tap(() => Effect.sync(() => invisibility.follow(w))),
                    Effect.andThen(send(w)),
                  ),
                ),
            }),
          ),
        ),
        clear: history.clear,
      };
    }),
  );
}
