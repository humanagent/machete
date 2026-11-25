// The calculator panel (⇧⌘D): your sheet on the left, each line's result on the right.
import { ipcMain } from 'electron';
import { Context, Effect, Layer, Option, Ref, Schema } from 'effect';
import { Channels } from '../../../core/channels';
import { Clipboard } from '../../../core/electron/Platform';
import { Invisibility } from '../../../core/electron/Invisibility';
import { makePanel } from '../../../core/electron/Panel';
import { makeRunner } from '../../../core/electron/Runner';
import { CalculatorCommand, type CalculatorState } from '../ipc';
import { Calculator } from '../services/Calculator';

export class CalculatorWindow extends Context.Service<
  CalculatorWindow,
  { readonly toggle: Effect.Effect<void> }
>()('machete/CalculatorWindow') {
  static readonly layer = Layer.effect(
    CalculatorWindow,
    Effect.gen(function* () {
      const calculator = yield* Calculator;
      const clipboard = yield* Clipboard;
      const run = yield* makeRunner<never>();
      const panel = yield* makePanel('calculator', { width: 420, height: 455 });
      const opened = yield* Ref.make(0);
      const invisibility = yield* Invisibility;

      const send = (w: Electron.BrowserWindow) =>
        Effect.gen(function* () {
          const { text, rates } = yield* calculator.get;
          const state: CalculatorState = {
            text,
            rates,
            opened: yield* Ref.get(opened),
          };
          if (!w.isDestroyed()) w.webContents.send(Channels.calculatorState, state);
        });

      const decode = Schema.decodeUnknownOption(CalculatorCommand);
      const onCommand = (_event: Electron.IpcMainEvent, raw: unknown) =>
        Option.map(decode(raw), (command) =>
          run(
            CalculatorCommand.match(command, {
              SetText: ({ text }) => calculator.setText(text),
              Copy: ({ text }) => clipboard.write(text),
              Close: () => panel.hide,
            }),
          ),
        );
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.calculatorCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.calculatorCommand, onCommand)),
      );

      return {
        toggle: panel.visible.pipe(
          Effect.flatMap(
            Option.match({
              onSome: () => panel.hide,
              onNone: () =>
                panel
                  .open((w) =>
                    Ref.update(opened, (n) => n + 1).pipe(
                      Effect.tap(() => Effect.sync(() => invisibility.follow(w, 'calculator'))),
                      Effect.andThen(send(w)),
                    ),
                  )
                  .pipe(
                    // Fresh rates arrive a moment later, if the kept ones are old.
                    Effect.andThen(calculator.refreshRates),
                    Effect.flatMap((changed) =>
                      changed
                        ? panel.visible.pipe(
                            Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: send })),
                          )
                        : Effect.void,
                    ),
                  ),
            }),
          ),
        ),
      };
    }),
  );
}
