// Machete's icon in the Dock: hidden unless Settings says otherwise.
import { app } from 'electron';
import { Context, Effect, Layer, Ref } from 'effect';
import { dockStep } from '../dock';
import { Settings } from '../services/Settings';

export class Dock extends Context.Service<
  Dock,
  { readonly hidden: Effect.Effect<boolean>; readonly setHidden: (hidden: boolean) => Effect.Effect<void> }
>()('machete/Dock') {
  static readonly layer = Layer.effect(
    Dock,
    Effect.gen(function* () {
      const settings = yield* Settings;
      // Packaged, Info.plist (LSUIElement) starts it out of the Dock; in development it starts in it.
      const shown = yield* Ref.make(!app.isPackaged);
      const apply = (hidden: boolean) =>
        Effect.gen(function* () {
          const step = dockStep(yield* Ref.get(shown), hidden);
          if (step === 'none' || process.platform !== 'darwin') return;
          yield* Ref.set(shown, step === 'show');
          if (step === 'hide') app.dock?.hide();
          else yield* Effect.promise(() => app.dock?.show() ?? Promise.resolve());
        });
      const hidden = Effect.map(settings.get, (s) => s.hideDock);
      yield* hidden.pipe(Effect.flatMap(apply));
      return {
        hidden,
        setHidden: (on) =>
          settings.update({ hideDock: on }).pipe(
            Effect.catch((e) => Effect.logWarning(`dock: ${e.message}`)),
            Effect.andThen(apply(on)),
          ),
      };
    }),
  );
}
