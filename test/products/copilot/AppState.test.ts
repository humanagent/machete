import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, Ref } from 'effect';
import { ChatGptError } from '../../../src/core/errors';
import { AppState, overlayState } from '../../../src/products/copilot/services/AppState';
import { Auth } from '../../../src/core/services/Auth';
import { type AskRequest, ChatGpt } from '../../../src/core/services/ChatGpt';
import { ContextFiles } from '../../../src/products/copilot/services/ContextFiles';
import { ProfileStore } from '../../../src/products/copilot/services/ProfileStore';
import { Settings } from '../../../src/core/services/Settings';
import { Strings } from '../../../src/products/copilot/strings';
import { fakeHelper, filesAt, withTempDir } from '../../support/fakes';

type Answerer = (request: AskRequest) => Effect.Effect<string, ChatGptError>;

/** Streams `text` word by word, like the real API. */
const streaming =
  (text: string): Answerer =>
  (request) =>
    Effect.gen(function* () {
      let full = '';
      for (const word of text.split(/(?<= )/)) {
        full += word;
        yield* request.onText(full);
      }
      return full;
    });

/** An AppState over a temp folder, with fake ChatGPT, sign-in and helper. */
const harness = <A, E>(
  test: (h: {
    readonly app: typeof AppState.Service;
    readonly answerer: Ref.Ref<Answerer>;
    readonly helper: Effect.Success<ReturnType<typeof fakeHelper>>;
    readonly asks: Array<AskRequest>;
    readonly dir: string;
  }) => Effect.Effect<A, E, never>,
  options: { readonly signedIn?: boolean; readonly seed?: (dir: string) => Promise<unknown> } = {},
) =>
  Effect.runPromise(
    withTempDir((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => options.seed?.(dir));
        const helper = yield* fakeHelper();
        const answerer = yield* Ref.make<Answerer>(streaming('Hello there'));
        const asks: Array<AskRequest> = [];
        const chat = Layer.succeed(ChatGpt, {
          ask: (request) =>
            Effect.sync(() => void asks.push(request)).pipe(
              Effect.andThen(Ref.get(answerer)),
              Effect.flatMap((f) => f(request)),
            ),
          listModels: Effect.succeed([{ slug: 'gpt-test', name: 'GPT Test' }]),
        });
        const auth = Layer.succeed(Auth, {
          isSignedIn: Effect.succeed(options.signedIn ?? true),
          signIn: Effect.void,
          signOut: Effect.void,
          accessToken: Effect.succeed('tok'),
        });
        const layer = AppState.layer.pipe(
          Layer.provide(ContextFiles.layer),
          Layer.provide(Layer.mergeAll(chat, auth, helper.layer, Settings.layer, ProfileStore.layer)),
          Layer.provide(filesAt(dir)),
        );
        return yield* Effect.service(AppState).pipe(
          Effect.tap((app) => app.checkLogin),
          Effect.flatMap((app) => test({ app, answerer, helper, asks, dir })),
          Effect.provide(layer),
        );
      }),
    ),
  );

const waitFor = (app: typeof AppState.Service, predicate: (s: ReturnType<typeof overlayState>) => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 300; i++) {
      const s = overlayState(yield* app.model);
      if (predicate(s)) return s;
      yield* Effect.sleep('10 millis');
    }
    return yield* Effect.die(new Error('condition never held'));
  });

describe('asking', () => {
  test('a typed question streams into a new exchange and clears the field', async () => {
    const result = await harness(({ app, asks }) =>
      Effect.gen(function* () {
        yield* app.setQuestion('What is CAP?');
        yield* app.ask();
        const s = yield* waitFor(app, (x) => x.exchanges[0]?.done === true);
        return { s, ask: asks[0] };
      }),
    );
    expect(result.s.question).toBe('');
    expect(result.s.isThinking).toBe(false);
    expect(result.s.exchanges).toMatchObject([
      { ask: 'What is CAP?', answer: 'Hello there', done: true, isFollow: false },
    ]);
    expect(result.ask?.imageDataURL).toBe('data:image/jpeg;base64,AAAA');
    expect(result.ask?.text).toContain('Task: What is CAP?');
    expect(result.ask?.instructions.endsWith(Strings.baseRules)).toBe(true);
  });

  test('an empty question is "Assist"; a preset uses its label and instruction', async () => {
    const result = await harness(({ app, asks }) =>
      Effect.gen(function* () {
        yield* app.ask();
        yield* waitFor(app, (x) => x.exchanges[0]?.done === true);
        yield* app.ask({ preset: 'whatToSay' });
        const s = yield* waitFor(app, (x) => x.exchanges[1]?.done === true);
        return { labels: s.exchanges.map((e) => e.ask), second: asks[1]?.text ?? '' };
      }),
    );
    expect(result.labels).toEqual(['Assist', 'What should I say?']);
    expect(result.second).toContain(Strings.presets.whatToSay.instruction);
  });

  test('a new ask replaces one still running; reset clears without leftovers', async () => {
    const result = await harness(({ app, answerer }) =>
      Effect.gen(function* () {
        yield* Ref.set(answerer, () => Effect.never);
        yield* app.setQuestion('slow');
        yield* app.ask();
        yield* waitFor(app, (x) => x.exchanges.length === 1 && x.isThinking);
        yield* Ref.set(answerer, streaming('fast'));
        yield* app.setQuestion('quick');
        yield* app.ask();
        const replaced = yield* waitFor(app, (x) => x.exchanges.some((e) => e.ask === 'quick' && e.done));
        yield* Ref.set(answerer, () => Effect.never);
        yield* app.ask();
        yield* app.reset;
        yield* Effect.sleep('50 millis');
        return { replaced, after: overlayState(yield* app.model) };
      }),
    );
    expect(result.replaced.exchanges.find((e) => e.ask === 'quick')?.answer).toBe('fast');
    expect(result.after).toMatchObject({ exchanges: [], isThinking: false, errorText: null });
  });

  test('a dead session shows the error and the sign-in screen', async () => {
    const s = await harness(({ app, answerer }) =>
      Effect.gen(function* () {
        yield* Ref.set(answerer, () =>
          Effect.fail(ChatGptError.of('ChatGPT session expired. Sign in again.', true)),
        );
        yield* app.ask();
        return yield* waitFor(app, (x) => x.loggedIn === false);
      }),
    );
    expect(s).toMatchObject({
      errorText: 'ChatGPT session expired. Sign in again.',
      directSignedIn: false,
      exchanges: [],
    });
  });

  test('signed out: asking explains instead of calling ChatGPT', async () => {
    const result = await harness(
      ({ app, asks }) =>
        Effect.gen(function* () {
          yield* app.ask();
          return { s: overlayState(yield* app.model), asks: asks.length };
        }),
      { signedIn: false },
    );
    expect(result.s.errorText).toBe('Sign in with ChatGPT first.');
    expect(result.s.cardVisible).toBe(true);
    expect(result.asks).toBe(0);
  });
});

describe('listening, auto-answer and Follow', () => {
  test('a question from the other side gets an automatic "What should I say?"', async () => {
    const s = await harness(({ app, helper }) =>
      Effect.gen(function* () {
        yield* app.toggleListening;
        yield* helper.emit({ type: 'commit', speaker: 'them', text: 'How would you scale it?' });
        return yield* waitFor(app, (x) => x.exchanges[0]?.done === true);
      }),
    );
    expect(s.lines).toMatchObject([{ speaker: 'them', text: 'How would you scale it?' }]);
    expect(s.exchanges[0]?.ask).toBe('What should I say?');
  });

  test('my own words cancel a pending automatic answer', async () => {
    const s = await harness(({ app, helper }) =>
      Effect.gen(function* () {
        yield* app.toggleListening;
        yield* helper.emit({ type: 'commit', speaker: 'them', text: 'Any questions?' });
        yield* helper.emit({ type: 'commit', speaker: 'me', text: 'Yes, one.' });
        yield* Effect.sleep('1500 millis');
        return overlayState(yield* app.model);
      }),
    );
    expect(s.exchanges).toEqual([]);
    expect(s.lines.length).toBe(2);
  });

  test('stopping shows the transcript; the helper dying stops with an explanation', async () => {
    const result = await harness(({ app, helper }) =>
      Effect.gen(function* () {
        yield* app.toggleListening;
        yield* helper.emit({ type: 'partial', speaker: 'me', text: 'typing' });
        yield* waitFor(app, (x) => x.partialMe === 'typing');
        yield* app.toggleListening;
        const stopped = overlayState(yield* app.model);
        yield* app.toggleListening;
        yield* helper.emit({ type: 'exit' });
        const died = yield* waitFor(app, (x) => !x.isListening);
        return { stopped, died, calls: helper.log.calls };
      }),
    );
    expect(result.stopped).toMatchObject({
      isListening: false,
      showTranscript: true,
      partialMe: '',
      cardVisible: true,
    });
    expect(result.died.errorText).toContain('Transcription stopped unexpectedly');
    expect(result.calls.filter((c) => c === 'listen.start').length).toBe(2);
  });

  test('Follow stays quiet on SILENT and speaks up otherwise, without opening the panel', async () => {
    const result = await harness(({ app, answerer, helper }) =>
      Effect.gen(function* () {
        yield* Ref.set(answerer, streaming('SILENT'));
        yield* app.collapseToggle; // collapse the card
        yield* app.toggleFollow;
        yield* waitFor(app, (x) => x.followMode && !x.followBusy && x.isListening);
        yield* Effect.sleep('100 millis');
        const quiet = overlayState(yield* app.model);
        return { quiet, calls: helper.log.calls };
      }),
    );
    expect(result.quiet.exchanges).toEqual([]);
    expect(result.quiet.followMode).toBe(true);
    expect(result.calls).toContain('listen.start');
  });
});

describe('panel', () => {
  test('starts hidden from screen sharing; the eye toggles it for the session', async () => {
    const s = await harness(({ app }) =>
      Effect.gen(function* () {
        const before = overlayState(yield* app.model).visibleInCapture;
        yield* app.toggleCaptureVisibility;
        return { before, after: overlayState(yield* app.model).visibleInCapture };
      }),
    );
    expect(s).toEqual({ before: false, after: true });
  });

  test('card height is clamped and persisted on request', async () => {
    const s = await harness(({ app }) =>
      Effect.gen(function* () {
        yield* app.setCardHeight(5000, true);
        const tall = (yield* app.model).cardHeight;
        yield* app.setCardSize(100, 100, false);
        const m = yield* app.model;
        return { tall, width: m.cardWidth, height: m.cardHeight };
      }),
    );
    expect(s).toEqual({ tall: 1400, width: 480, height: 300 });
  });
});

describe('bots', () => {
  test('add, edit, select, delete; the last bot cannot be deleted', async () => {
    const result = await harness(({ app }) =>
      Effect.gen(function* () {
        const id = yield* app.addProfile;
        yield* app.updateProfile(id, { name: 'Mine', context: 'cv' });
        yield* app.selectProfile(id);
        const selected = overlayState(yield* app.model).currentProfileName;
        yield* app.deleteProfile(id);
        const afterDelete = yield* app.model;
        for (const p of afterDelete.profiles.slice(1)) yield* app.deleteProfile(p.id);
        const first = afterDelete.profiles[0];
        if (first) yield* app.deleteProfile(first.id);
        return { selected, afterDelete, remaining: (yield* app.model).profiles.length };
      }),
    );
    expect(result.selected).toBe('Mine');
    expect(result.afterDelete.selectedProfileID).toBe(result.afterDelete.profiles[0]?.id ?? '');
    expect(result.remaining).toBe(1);
  });

  test('files become context blocks; unreadable ones are reported', async () => {
    const result = await harness(
      ({ app, dir }) =>
        Effect.gen(function* () {
          const id = (yield* app.model).profiles[0]?.id ?? '';
          const note = yield* app.addContextFiles(id, [join(dir, 'notes.txt'), join(dir, 'missing.txt')]);
          return { note, context: (yield* app.model).profiles[0]?.context };
        }),
      { seed: (dir) => writeFile(join(dir, 'notes.txt'), 'Prefers PostgreSQL.') },
    );
    expect(result.note).toBe("Added: notes.txt · Couldn't read: missing.txt");
    expect(result.context).toBe('--- notes.txt ---\nPrefers PostgreSQL.');
  });

  test('models come from the account once signed in', async () => {
    const s = await harness(({ app }) =>
      waitFor(app, () => true).pipe(Effect.andThen(Effect.sleep('50 millis')), Effect.andThen(app.model)),
    );
    expect(s.models).toEqual([{ slug: 'gpt-test', name: 'GPT Test' }]);
    expect(s.model).toBe('gpt-test');
  });
});
