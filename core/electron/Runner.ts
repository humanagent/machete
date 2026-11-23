// Electron calls back from outside any fiber (IPC, menus, shortcuts, window events).
// A Runner forks an effect with the layer's services, and logs anything that escapes instead of throwing.
import { Cause, Effect } from 'effect';

export type Run<R> = (effect: Effect.Effect<unknown, unknown, R>) => void;

export const makeRunner = <R>(): Effect.Effect<Run<R>, never, R> =>
  Effect.map(Effect.context<R>(), (context) => {
    const fork = Effect.runForkWith(context);
    return (effect) => {
      fork(
        effect.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError(Cause.pretty(cause)),
          ),
        ),
      );
    };
  });
