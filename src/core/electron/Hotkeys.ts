// Global shortcuts. ⌥ is Alt and ⌘ is Ctrl on Windows. Each product registers its own keys with `hotkeys`.
import { globalShortcut } from 'electron';
import { Effect, Layer } from 'effect';
import { makeRunner } from './Runner';

export type Hotkey = readonly [accelerator: string, action: Effect.Effect<void>];

/** A layer that holds `keys` for as long as it runs; another app holding a key is logged, not fatal. */
export const hotkeys = <E, R>(keys: Effect.Effect<ReadonlyArray<Hotkey>, E, R>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const run = yield* makeRunner<never>();
      for (const [accelerator, action] of yield* keys) {
        const ok = globalShortcut.register(accelerator, () => run(action));
        if (!ok) yield* Effect.logWarning(`hotkeys: failed to register ${accelerator}`);
        yield* Effect.addFinalizer(() => Effect.sync(() => globalShortcut.unregister(accelerator)));
      }
    }),
  );
