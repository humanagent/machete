import { expect, test } from 'bun:test';
import { Effect, Layer, Option } from 'effect';
import { type AppModel, AppState, type AppStateShape } from '../../../src/products/copilot/services/AppState';
import {
  Dictation,
  type DictationPhase,
  DictationPill,
} from '../../../src/products/dictation/services/Dictation';
import { ChatGptError, HelperError } from '../../../src/core/errors';
import { ChatGpt, type ChatGptShape } from '../../../src/core/services/ChatGpt';
import { PermissionsGuide } from '../../../src/core/services/PermissionsGuide';
import { fit, instructions, PRESETS } from '../../../src/products/rewrite/presets';
import { MAX_LENGTH, Rewrite } from '../../../src/products/rewrite/services/Rewrite';
import { fakeHelper } from '../../support/fakes';

interface Options {
  readonly helper?: Parameters<typeof fakeHelper>[0];
  readonly signedIn?: boolean;
  readonly phase?: DictationPhase;
  readonly ask?: ChatGptShape['ask'];
}

const run = (f: (rewrite: typeof Rewrite.Service) => Effect.Effect<unknown>, options: Options = {}) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* fakeHelper(options.helper ?? {});
        const pill: Array<string> = [];
        const asked: Array<string> = [];
        let guided = 0;
        const note = (s: string) => Effect.sync(() => void pill.push(s));
        const layer = Rewrite.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              helper.layer,
              Layer.succeed(DictationPill, {
                show: () => note('show'),
                send: (e) =>
                  note(e._tag === 'Working' ? e.text : e._tag === 'Failed' ? `!${e.message}` : e._tag),
                hide: note('hide'),
                captureEscape: () => Effect.void,
                releaseEscape: Effect.void,
              }),
              Layer.succeed(Dictation, {
                phase: Effect.succeed(options.phase ?? 'idle'),
                toggle: Effect.void,
                finish: Effect.void,
                cancel: Effect.void,
              }),
              Layer.succeed(AppState, {
                model: Effect.succeed({
                  directSignedIn: options.signedIn ?? true,
                  model: 'gpt-test',
                } as AppModel),
              } as AppStateShape),
              Layer.succeed(PermissionsGuide, {
                show: Effect.sync(() => void guided++),
                showIfMissing: Effect.void,
              }),
              Layer.succeed(ChatGpt, {
                ask: (req) =>
                  Effect.sync(() => void asked.push(req.text)).pipe(
                    Effect.andThen(options.ask ? options.ask(req) : Effect.succeed('hola mundo')),
                  ),
                listModels: Effect.succeed([]),
              }),
            ),
          ),
        );
        yield* Effect.service(Rewrite).pipe(Effect.flatMap(f), Effect.provide(layer));
        return { pill, asked, guided, replaced: helper.log.calls.filter((c) => c.startsWith('selection')) };
      }),
    ),
  );
const fix = (options: Options = {}) => run((r) => r.fix, options);

test('fix replaces the selection in the app it came from', async () => {
  const r = await fix();
  expect(r.asked).toEqual(['hola mudno']);
  expect(r.replaced).toEqual(['selection.replace:7:hola mundo']);
  expect(r.pill).toEqual(['show', 'Rewriting', 'hide']);
});

test('nothing selected, or a password: it says so and asks nothing', async () => {
  for (const [why, says] of [
    ['no-selection', '!Select some text first'],
    ['secure', "!Password fields can't be read"],
  ] as const) {
    const r = await fix({ helper: { readSelection: Effect.fail(new HelperError({ message: why })) } });
    expect(r.pill).toContain(says);
    expect(r.asked).toEqual([]);
  }
}, 15_000);

test('without Accessibility the permissions guide opens', async () => {
  const r = await fix({
    helper: { readSelection: Effect.fail(new HelperError({ message: 'accessibility' })) },
  });
  expect(r.guided).toBe(1);
  expect(r.pill).toEqual([]);
});

test('signed out, or too long: nothing is sent', async () => {
  expect((await fix({ signedIn: false })).asked).toEqual([]);
  const long = { text: 'a'.repeat(MAX_LENGTH + 1), pid: 7 };
  expect((await fix({ helper: { readSelection: Effect.succeed(long) } })).asked).toEqual([]);
}, 15_000);

test('a failure, an empty reply or the same text leaves the selection alone', async () => {
  const asks: ReadonlyArray<ChatGptShape['ask']> = [
    () => Effect.fail(ChatGptError.of('usage limit')),
    () => Effect.succeed('  '),
    () => Effect.succeed('hola mudno'),
  ];
  for (const ask of asks) expect((await fix({ ask })).replaced).toEqual([]);
}, 15_000);

test('when the app is no longer in front, it says the text was copied', async () => {
  const r = await fix({ helper: { replaceSelection: () => Effect.succeed(false) } });
  expect(r.pill).toContain('Copied: paste it with ⌘V');
});

test('while dictation records, its pill is left alone', async () => {
  const r = await fix({ phase: 'recording' });
  expect(r.pill).toEqual([]);
  expect(r.replaced).toHaveLength(1);
});

test('a second press while working does nothing', async () => {
  const r = await run((rewrite) => Effect.all([rewrite.fix, rewrite.fix], { concurrency: 2 }), {
    ask: () => Effect.sleep('20 millis').pipe(Effect.as('hola mundo')),
  });
  expect(r.asked).toHaveLength(1);
});

test('the panel reads first and applies any instruction later', async () => {
  const seen: Array<string> = [];
  await run(
    (rewrite) =>
      rewrite.select.pipe(Effect.flatMap((s) => rewrite.apply(Option.getOrThrow(s), 'as a pirate'))),
    { ask: (req) => Effect.sync(() => (seen.push(req.instructions), 'ahoy')) },
  );
  expect(seen[0]).toContain('as a pirate');
});

test('the reply keeps the spaces around the selection', () => {
  expect(fit('  hola mudno\n', 'hola mundo')).toBe('  hola mundo\n');
  expect(fit('a', ' b \n')).toBe('b');
});

test('every preset has its own id, and the text is never a request', () => {
  expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  expect(instructions('x')).toContain('never a request');
});
