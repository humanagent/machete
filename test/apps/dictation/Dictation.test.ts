import { expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { type AppModel, AppState, type AppStateShape } from '../../../apps/copilot/services/AppState';
import { HelperError } from '../../../core/errors';
import { ChatGpt, type ChatGptShape } from '../../../core/services/ChatGpt';
import { ChatGptError } from '../../../core/errors';
import {
  Dictation,
  DictationPill,
  polishModel,
  usablePolish,
} from '../../../apps/dictation/services/Dictation';
import { PermissionsGuide } from '../../../core/services/PermissionsGuide';
import type { DictationEvent } from '../../../apps/dictation/ipc';
import { fakeHelper } from '../../support/fakes';

const run = <A>(
  f: (h: {
    dictation: typeof Dictation.Service;
    pill: Array<string>;
    helper: Effect.Success<ReturnType<typeof fakeHelper>>;
  }) => Effect.Effect<A>,
  overrides: Parameters<typeof fakeHelper>[0] = {},
  options: {
    signedIn?: boolean;
    ask?: ChatGptShape['ask'];
    asked?: Array<string>;
  } = {},
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
          model: Effect.succeed({
            dictationLanguage: 'es-419',
            directSignedIn: options.signedIn ?? false,
            model: 'gpt-test',
          } as AppModel),
        } as AppStateShape);
        const guide = Layer.succeed(PermissionsGuide, { show: Effect.void, showIfMissing: Effect.void });
        const chat = Layer.succeed(ChatGpt, {
          ask: (req) =>
            Effect.sync(() => void options.asked?.push(`${req.model}|${req.text}`)).pipe(
              Effect.andThen(options.ask ? options.ask(req) : Effect.succeed('Hola, mundo.')),
            ),
          listModels: Effect.succeed([]),
        });
        const layer = Dictation.layer.pipe(
          Layer.provide(Layer.mergeAll(helper.layer, pillLayer, app, guide, chat)),
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
  expect([...result.calls].sort()).toEqual(['dictate.start', 'dictate.stop:false']);
  expect(result.typed).toEqual(['hola mundo']);
});

test('cancel types nothing', async () => {
  const result = await run(({ dictation, helper }) =>
    Effect.gen(function* () {
      yield* dictation.toggle;
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

const settle = Effect.sleep('20 millis');

test('a dictation that cannot start says why in the pill, then hides it', async () => {
  const result = await run(
    ({ dictation, pill, helper }) =>
      Effect.gen(function* () {
        yield* dictation.toggle;
        return { pill: [...pill], phase: yield* dictation.phase, calls: helper.log.calls };
      }),
    { dictateStart: () => Effect.fail(new HelperError({ message: 'no microphone' })) },
  );
  expect(result.pill).toContain('Failed');
  // It may have only timed out: the microphone is closed too.
  expect(result.calls).toContain('dictate.stop:true');
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

test('a recording dies with the helper: the pill says so', async () => {
  const pill = await run(({ dictation, pill, helper }) =>
    Effect.gen(function* () {
      yield* dictation.toggle;
      yield* helper.emit({ type: 'exit' });
      yield* settle;
      return [...pill];
    }),
  );
  expect(pill).toContain('Failed');
});

const dictateOnce = ({
  dictation,
  helper,
}: {
  dictation: typeof Dictation.Service;
  helper: { log: { typed: Array<string> } };
}) =>
  Effect.gen(function* () {
    yield* dictation.toggle;
    yield* dictation.toggle;
    return helper.log.typed;
  });

test('signed in, ChatGPT cleans up the transcript before it is typed', async () => {
  const asked: Array<string> = [];
  const typed = await run(dictateOnce, {}, { signedIn: true, asked });
  expect(asked).toEqual(['gpt-test|hola mundo']);
  expect(typed).toEqual(['Hola, mundo.']);
});

test('signed out, the transcript is typed as it is', async () => {
  const asked: Array<string> = [];
  const typed = await run(dictateOnce, {}, { signedIn: false, asked });
  expect(asked).toEqual([]);
  expect(typed).toEqual(['hola mundo']);
});

test('if ChatGPT fails, the raw transcript is typed', async () => {
  const typed = await run(
    dictateOnce,
    {},
    {
      signedIn: true,
      ask: () => Effect.fail(ChatGptError.of('usage limit')),
    },
  );
  expect(typed).toEqual(['hola mundo']);
});

test('a reply that is not a cleanup (empty, or an answer) is ignored', () => {
  expect(usablePolish('hola mundo', '  ')).toBe('hola mundo');
  expect(
    usablePolish(
      'qué hora es',
      'Son las 3 de la tarde en Buenos Aires, según tu zona horaria actual y el reloj del sistema.',
    ),
  ).toBe('qué hora es');
  expect(usablePolish('hola mundo', ' Hola, mundo. ')).toBe('Hola, mundo.');
});

test('the cleanup uses the quick model when the plan has it', () => {
  expect(polishModel({ model: 'gpt-6.2-sol', models: [{ slug: 'gpt-6-luna', name: 'Luna' }] })).toBe(
    'gpt-6-luna',
  );
  expect(polishModel({ model: 'gpt-6.2-sol', models: [] })).toBe('gpt-6.2-sol');
});
