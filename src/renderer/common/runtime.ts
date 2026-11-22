// Shared pieces of the renderer programs.
import { Effect, Queue, Stream } from 'effect';

/** A stream of a bridge subscription. Only the latest value matters, so older ones are dropped. */
export const fromBridge = <A>(subscribe: (listener: (value: A) => void) => () => void): Stream.Stream<A> =>
  Stream.callback<A>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => subscribe((value) => Queue.offerUnsafe(queue, value))),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 1, strategy: 'sliding' },
  );

/** Same, keeping every value (for events where each one counts). */
export const fromBridgeAll = <A>(subscribe: (listener: (value: A) => void) => () => void): Stream.Stream<A> =>
  Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => subscribe((value) => Queue.offerUnsafe(queue, value))),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  );

/** document.getElementById that fails loudly at startup if the markup and the code disagree. */
export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el as T;
};

/** Runs a renderer program; failures are reported in the devtools console. */
export const runMain = (program: Effect.Effect<unknown>) => {
  Effect.runFork(program.pipe(Effect.catchCause((cause) => Effect.logError(cause))));
};
