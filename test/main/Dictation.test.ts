import { expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { type AppModel, AppState, type AppStateShape } from '../../src/main/services/AppState';
import { Dictation, DictationPill } from '../../src/main/services/Dictation';
import type { DictationEvent } from '../../src/shared/ipc';
import { fakeHelper } from '../support/fakes';

const run = <A>(
  f: (h: {
    dictation: typeof Dictation.Service;
    pill: Array<string>;
    helper: Effect.Success<ReturnType<typeof fakeHelper>>;
  }) => Effect.Effect<A>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* fakeHelper();
        const pill: Array<string> = [];
        const note = (s: string) => Effect.sync(() => void pill.push(s));
        const pillLayer = Layer.succeed(DictationPill, {
          show: (app) => note(`show:${app}`),
          send: (event: DictationEvent) => note(event._tag === 'Level' ? 'level' : event._tag),
          hide: note('hide'),
          captureEscape: () => note('esc:on'),
          releaseEscape: note('esc:off'),
        });
        // Dictation only reads the transcription language from the app state.
        const app = Layer.succeed(AppState, {
          model: Effect.succeed({ language: 'es-ES' } as AppModel),
        } as AppStateShape);
        const layer = Dictation.layer.pipe(Layer.provide(Layer.mergeAll(helper.layer, pillLayer, app)));
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
