import { expect, test } from 'bun:test';
import { Effect, Layer, Stream } from 'effect';
import { HelperError } from '../../core/errors';
import { ModifierTaps } from '../../core/services/ModifierTaps';
import { PermissionsGuide } from '../../core/services/PermissionsGuide';
import { fakeHelper } from '../support/fakes';

const run = <A>(
  f: (
    taps: typeof ModifierTaps.Service,
    helper: Effect.Success<ReturnType<typeof fakeHelper>>,
  ) => Effect.Effect<A, unknown, import('effect').Scope.Scope>,
  overrides: Parameters<typeof fakeHelper>[0] = {},
) => {
  let guided = 0;
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* fakeHelper(overrides);
        const guide = Layer.succeed(PermissionsGuide, {
          show: Effect.sync(() => void guided++),
          showIfMissing: Effect.void,
        });
        return yield* Effect.gen(function* () {
          return yield* f(yield* ModifierTaps, helper);
        }).pipe(Effect.provide(ModifierTaps.layer.pipe(Layer.provide(Layer.mergeAll(helper.layer, guide)))));
      }),
    ).pipe(Effect.orDie),
  ).then((value) => ({ value, guided }));
};
const settle = Effect.sleep('20 millis');
const watches = (calls: ReadonlyArray<string>) => calls.filter((c) => c === 'modifiers.watch').length;

test('watches nothing until a shortcut needs it, then once', async () => {
  const { value } = await run((taps, helper) =>
    Effect.gen(function* () {
      yield* helper.emit({ type: 'ready' });
      yield* settle;
      const before = watches(helper.log.calls);
      yield* taps.need;
      yield* taps.need;
      yield* settle;
      return [before, watches(helper.log.calls)];
    }),
  );
  expect(value).toEqual([0, 1]);
});

test('each tap arrives by name', async () => {
  const { value } = await run((taps, helper) =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      const stream = yield* taps.taps;
      yield* stream.pipe(
        Stream.runForEach((k) => Effect.sync(() => void seen.push(k))),
        Effect.forkScoped,
      );
      yield* helper.emit({ type: 'clipboard', text: 'x' });
      yield* helper.emit({ type: 'modifier', key: 'RightCommand' });
      yield* settle;
      return seen;
    }),
  );
  expect(value).toEqual(['RightCommand']);
});

test('after the helper restarts the watch is armed again', async () => {
  const { value } = await run((taps, helper) =>
    Effect.gen(function* () {
      yield* taps.need;
      yield* settle;
      yield* helper.emit({ type: 'ready' });
      yield* settle;
      return watches(helper.log.calls);
    }),
  );
  expect(value).toBe(2);
});

test('without Input Monitoring the guide opens once and it keeps trying', async () => {
  let attempts = 0;
  const { guided } = await run((taps) => taps.need.pipe(Effect.andThen(Effect.sleep('5.3 seconds'))), {
    watchModifiers: Effect.suspend(() => {
      attempts++;
      return Effect.fail(new HelperError({ message: 'input-monitoring' }));
    }),
  });
  expect(guided).toBe(1);
  expect(attempts).toBe(2);
}, 10_000);
