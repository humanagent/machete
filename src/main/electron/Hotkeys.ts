// Global shortcuts. ⌥ is Alt and ⌘ is Ctrl on Windows.
import { globalShortcut } from 'electron';
import { Effect, Layer } from 'effect';
import { AppState } from '../services/AppState';
import { Dictation } from '../services/Dictation';
import { OverlayWindow } from './OverlayWindow';
import { makeRunner } from './Runner';

export const HotkeysLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const app = yield* AppState;
    const overlay = yield* OverlayWindow;
    const dictation = yield* Dictation;
    const run = yield* makeRunner<never>();
    const keys: ReadonlyArray<readonly [string, Effect.Effect<void>]> = [
      ['Alt+Return', app.ask()],
      ['Alt+\\', overlay.toggle],
      ['CommandOrControl+[', overlay.toggle],
      ['Alt+M', app.toggleListening],
      ['Alt+S', app.ask({ preset: 'whatToSay' })],
      ['Alt+R', app.reset],
      ['Alt+Space', overlay.focusInput],
      ['Alt+D', dictation.toggle],
    ];
    for (const [accelerator, effect] of keys) {
      const ok = globalShortcut.register(accelerator, () => run(effect));
      if (!ok) yield* Effect.logWarning(`hotkeys: failed to register ${accelerator}`);
    }
    yield* Effect.addFinalizer(() => Effect.sync(() => globalShortcut.unregisterAll()));
  }),
);
