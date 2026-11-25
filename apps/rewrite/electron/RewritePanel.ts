// The rewrite panel (⌥⇧⌘G): pick what to do with the selected text, or type it.
import { ipcMain } from 'electron';
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect';
import { Channels } from '../../../core/channels';
import { Invisibility } from '../../../core/electron/Invisibility';
import { makePanel } from '../../../core/electron/Panel';
import { makeRunner } from '../../../core/electron/Runner';
import type { Selected } from '../../../core/services/NativeHelper';
import { RewriteCommand, type RewriteState } from '../ipc';
import { Rewrite } from '../services/Rewrite';

export class RewritePanel extends Context.Service<RewritePanel, { readonly toggle: Effect.Effect<void> }>()(
  'machete/RewritePanel',
) {
  static readonly layer = Layer.effect(
    RewritePanel,
    Effect.gen(function* () {
      const rewrite = yield* Rewrite;
      const run = yield* makeRunner<never>();
      const panel = yield* makePanel('rewrite', { width: 420, height: 356 });
      const selected = yield* Ref.make(Option.none<Selected>());
      const opened = yield* Ref.make(0);
      const invisibility = yield* Invisibility;

      const apply = (instruction: string) =>
        Effect.gen(function* () {
          const target = yield* Ref.getAndSet(selected, Option.none());
          yield* panel.hide;
          // Your app's window takes the keyboard back before the text is pasted there.
          yield* Effect.sleep('60 millis');
          if (Option.isSome(target) && instruction.trim() !== '')
            yield* rewrite.apply(target.value, instruction);
        });

      const decode = Schema.decodeUnknownOption(RewriteCommand);
      const onCommand = (_event: Electron.IpcMainEvent, raw: unknown) =>
        Option.map(decode(raw), (command) =>
          run(
            RewriteCommand.match(command, {
              Apply: ({ instruction }) => apply(instruction),
              Close: () => panel.hide,
            }),
          ),
        );
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.rewriteCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.rewriteCommand, onCommand)),
      );

      const open = Effect.gen(function* () {
        // Read before opening: the panel takes the keyboard.
        const target = yield* rewrite.select;
        if (Option.isNone(target)) return;
        yield* Ref.set(selected, target);
        const state: RewriteState = {
          text: target.value.text.trim().slice(0, 300),
          opened: yield* Ref.updateAndGet(opened, (n) => n + 1),
        };
        yield* panel.open((w) =>
          Effect.sync(() => {
            invisibility.follow(w);
            w.webContents.send(Channels.rewriteState, state);
          }),
        );
      });

      return {
        toggle: panel.visible.pipe(
          Effect.flatMap(Option.match({ onSome: () => panel.hide, onNone: () => open })),
        ),
      };
    }),
  );
}
