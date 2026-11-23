// Modifier keys used on their own: the helper reports when a right-hand ⌥, ⌘, ⌃ or ⇧ is tapped with nothing else.
// Needs Input Monitoring. Without it the permissions guide opens once, and it keeps trying, so it starts working as
// soon as the permission is granted. Nothing is watched until a shortcut uses one of these keys.
import { Context, Duration, Effect, FiberHandle, Layer, Ref, Schedule, Stream, type Scope } from 'effect';
import { NativeHelper } from './NativeHelper';
import { PermissionsGuide } from './PermissionsGuide';

export interface ModifierTapsShape {
  /** Starts watching, if it isn't yet. */
  readonly need: Effect.Effect<void>;
  /** Each tap: "RightAlt", "RightCommand", "RightControl" or "RightShift". */
  readonly taps: Effect.Effect<Stream.Stream<string>, never, Scope.Scope>;
}

export class ModifierTaps extends Context.Service<ModifierTaps, ModifierTapsShape>()('machete/ModifierTaps') {
  static readonly layer = Layer.effect(
    ModifierTaps,
    Effect.gen(function* () {
      const helper = yield* NativeHelper;
      const guide = yield* PermissionsGuide;
      const needed = yield* Ref.make(false);
      const explained = yield* Ref.make(false);
      const watching = yield* FiberHandle.make<void, never>();
      const explain = Ref.getAndSet(explained, true).pipe(
        Effect.flatMap((done) => (done ? Effect.void : guide.show)),
      );
      const arm = helper.watchModifiers.pipe(
        Effect.tapError((e) => (e.message === 'input-monitoring' ? explain : Effect.void)),
        Effect.retry(Schedule.spaced(Duration.seconds(5))),
        Effect.tap(() => Effect.logInfo('modifiers: ready')),
        Effect.ignore,
      );

      // A restarted helper has to be told again.
      const events = yield* helper.subscribe;
      yield* events.pipe(
        Stream.filter((e) => e.type === 'ready'),
        Stream.runForEach(() =>
          Ref.get(needed).pipe(Effect.flatMap((on) => (on ? FiberHandle.run(watching, arm) : Effect.void))),
        ),
        Effect.forkScoped,
      );

      return {
        need: Ref.getAndSet(needed, true).pipe(
          Effect.flatMap((was) =>
            was || !helper.available ? Effect.void : Effect.asVoid(FiberHandle.run(watching, arm)),
          ),
        ),
        taps: helper.subscribe.pipe(
          Effect.map(Stream.flatMap((e) => (e.type === 'modifier' ? Stream.make(e.key) : Stream.empty))),
        ),
      } satisfies ModifierTapsShape;
    }),
  );
}
