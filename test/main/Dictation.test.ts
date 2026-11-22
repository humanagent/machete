import { expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { type AppModel, AppState, type AppStateShape } from '../../src/main/services/AppState';
import { HelperError } from '../../src/main/errors';
import { Dictation, DictationPill } from '../../src/main/services/Dictation';
import { PermissionsGuide } from '../../src/main/services/PermissionsGuide';
import type { DictationEvent } from '../../src/shared/ipc';
import { fakeHelper } from '../support/fakes';

const run = <A>(
  f: (h: {
    dictation: typeof Dictation.Service;
    pill: Array<string>;
    helper: Effect.Success<ReturnType<typeof fakeHelper>>;
  }) => Effect.Effect<A>,
  overrides: Parameters<typeof fakeHelper>[0] = {},
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* fakeHelper(overrides);
        const pill: Array<string> = [];
        const note = (s: string) => Effect.sync(() => void pill.push(s));
        const pillLayer = Layer.succeed(DictationPill, {
          show: (app) => note(`show:${app}`),
          send: (event: DictationEvent) => note(event._tag === 'Level' ? 'level' : event._tag),
          hide: note('hide'),
          captureEscape: () => note('esc:on'),
          releaseEscape: note('esc:off'),
        });
        // Dictation only reads its language from the app state.
        const app = Layer.succeed(AppState, {
          model: Effect.succeed({ dictationLanguage: 'es-419' } as AppModel),
        } as AppStateShape);
        const guide = Layer.succeed(PermissionsGuide, { show: Effect.void, showIfMissing: Effect.void });
        const layer = Dictation.layer.pipe(
          Layer.provide(Layer.mergeAll(helper.layer, pillLayer, app, guide)),
        );
        return yield* Effect.service(Dictation).pipe(
          Effect.flatMap((dictation) => f({ dictation, pill, helper })),
          Effect.provide(layer),
        );
      }),
    ),
  );

test('toggle starts, toggle again types the words into the app that had focus', async () => {
  const result = await run(({ dictation, pill, helper }) =>
    Effect.gen(function* () {
      yield* dictation.toggle;
      const recording = yield* dictation.phase;
      yield* dictation.toggle;
      return {
        recording,
        idle: yield* dictation.phase,
        pill: [...pill],
        calls: helper.log.calls,
        typed: helper.log.typed,
      };
    }),
  );
  expect(result.recording).toBe('recording');
  expect(result.idle).toBe('idle');
  expect(result.pill).toEqual(['show:TextEdit', 'esc:on', 'Finishing', 'hide', 'esc:off', 'hide']);
  expect([...result.calls].sort()).toEqual(['dictate.start', 'dictate.stop:false', 'rightcmd.watch']);
  expect(result.typed).toEqual(['hola mundo']);
});

test('the right ⌘ key toggles too, and cancel types nothing', async () => {
  const result = await run(({ dictation, helper }) =>
    Effect.gen(function* () {
      yield* helper.emit({ type: 'rightcmd' });
      for (let i = 0; i < 50 && (yield* dictation.phase) !== 'recording'; i++)
        yield* Effect.sleep('5 millis');
      const afterKey = yield* dictation.phase;
      yield* dictation.cancel;
      return { afterKey, phase: yield* dictation.phase, typed: helper.log.typed, calls: helper.log.calls };
    }),
  );
  expect(result.afterKey).toBe('recording');
  expect(result.phase).toBe('idle');
  expect(result.typed).toEqual([]);
  expect(result.calls).toContain('dictate.stop:true');
});

test('without Input Monitoring it opens the permissions guide once and keeps retrying', async () => {
  let guided = 0;
  let attempts = 0;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* fakeHelper({
          watchRightCommand: Effect.suspend(() =>
            ++attempts < 3 ? Effect.fail(new HelperError({ message: 'input-monitoring' })) : Effect.void,
          ),
        });
        const pill = Layer.succeed(DictationPill, {
          show: () => Effect.void,
          send: () => Effect.void,
          hide: Effect.void,
          captureEscape: () => Effect.void,
          releaseEscape: Effect.void,
        });
        const app = Layer.succeed(AppState, {
          model: Effect.succeed({ dictationLanguage: 'en-US' } as AppModel),
        } as AppStateShape);
        const guide = Layer.succeed(PermissionsGuide, {
          show: Effect.sync(() => void guided++),
          showIfMissing: Effect.void,
        });
        yield* Effect.service(Dictation).pipe(
          Effect.andThen(Effect.sleep('50 millis')),
          Effect.provide(Dictation.layer.pipe(Layer.provide(Layer.mergeAll(helper.layer, pill, app, guide)))),
        );
      }),
    ),
  );
  expect(guided).toBe(1);
});

const settle = Effect.sleep('20 millis');

test('a dictation that cannot start says why in the pill, then hides it', async () => {
  const result = await run(
    ({ dictation, pill }) =>
      Effect.gen(function* () {
        yield* dictation.toggle;
        return { pill: [...pill], phase: yield* dictation.phase };
      }),
    { dictateStart: () => Effect.fail(new HelperError({ message: 'no microphone' })) },
  );
  expect(result.pill).toContain('Failed');
});

test('the voice level reaches the pill; helper errors are only logged', async () => {
  const pill = await run(({ dictation, pill, helper }) =>
    Effect.gen(function* () {
      yield* dictation.toggle;
      yield* helper.emit({ type: 'dictation.level', level: 0.4 });
      yield* helper.emit({ type: 'dictation.error', message: 'glitch' });
      yield* settle;
      return [...pill];
    }),
  );
  expect(pill).toContain('level');
  expect(pill).not.toContain('Failed');
});

test('dictation listens in its own language, not the call language', async () => {
  const locales: Array<string> = [];
  await run(({ dictation }) => dictation.toggle, {
    dictateStart: (locale) => Effect.sync(() => void locales.push(locale)),
  });
  expect(locales).toEqual(['es-419']);
});
