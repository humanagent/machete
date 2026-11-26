import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer, Ref, Stream } from 'effect';
import { ChatGptError } from '../../../core/errors';
import {
  AppState,
  copilotState,
  MAX_EXCHANGES,
  MAX_LINES,
  panelState,
  sameState,
} from '../../../apps/copilot/services/AppState';
import { Auth } from '../../../core/services/Auth';
import { type AskRequest, ChatGpt } from '../../../core/services/ChatGpt';
import { ContextFiles } from '../../../apps/copilot/services/ContextFiles';
import { ProfileStore } from '../../../apps/copilot/services/ProfileStore';
import { SessionStore } from '../../../apps/copilot/services/SessionStore';
import { Settings } from '../../../core/services/Settings';
import { Strings } from '../../../apps/copilot/strings';
import { fakeHelper, filesAt, withTempDir } from '../../support/fakes';
import { linesOf, lineText, play } from '../../support/meeting';

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
          Layer.provide(
            Layer.mergeAll(chat, auth, helper.layer, Settings.layer, ProfileStore.layer, SessionStore.layer),
          ),
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

const waitFor = (app: typeof AppState.Service, predicate: (s: ReturnType<typeof copilotState>) => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 300; i++) {
      const s = copilotState(yield* app.model);
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
        return { replaced, after: copilotState(yield* app.model) };
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
          return { s: copilotState(yield* app.model), asks: asks.length };
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
        return copilotState(yield* app.model);
      }),
    );
    expect(s.exchanges).toEqual([]);
    expect(s.lines.length).toBe(2);
  });

  test('stopping keeps the recording as a session, opens it and names it; the helper dying stops with an explanation', async () => {
    const result = await harness(({ app, answerer, helper }) =>
      Effect.gen(function* () {
        yield* Ref.set(answerer, streaming('"Hiring Chat with Ana."'));
        yield* app.setAutoAnswer(false);
        yield* app.toggleListening;
        yield* helper.emit({ type: 'commit', speaker: 'them', text: 'Hi, I am Ana.' });
        yield* helper.emit({ type: 'partial', speaker: 'me', text: 'typing' });
        yield* waitFor(app, (x) => x.partialMe === 'typing');
        yield* app.toggleListening;
        // The last words land after stopping, and still belong to it.
        yield* helper.emit({ type: 'commit', speaker: 'me', text: 'Nice to meet you.' });
        const opened = yield* waitFor(app, (x) => x.page === 'session' && x.session?.title !== '');
        yield* app.collapseToggle;
        const list = copilotState(yield* app.model);
        yield* app.collapseToggle;
        const chat = copilotState(yield* app.model);
        yield* app.openSession(list.sessions[0]?.id ?? '');
        const reopened = copilotState(yield* app.model);
        // A recording with nothing said leaves nothing behind.
        yield* app.toggleListening;
        yield* app.toggleListening;
        yield* Effect.sleep('400 millis');
        const afterEmpty = copilotState(yield* app.model);
        yield* app.toggleListening;
        yield* helper.emit({ type: 'exit' });
        const died = yield* waitFor(app, (x) => !x.isListening);
        return { opened, list, chat, reopened, afterEmpty, died, calls: helper.log.calls };
      }),
    );
    expect(result.opened).toMatchObject({ isListening: false, partialMe: '', cardVisible: true });
    expect(result.opened.session?.title).toBe('Hiring Chat with Ana');
    expect(result.opened.session?.lines.map((l) => l.text)).toEqual(['Hi, I am Ana.', 'Nice to meet you.']);
    expect(result.list.page).toBe('sessions');
    expect(result.list.sessions.map((x) => x.title)).toEqual(['Hiring Chat with Ana']);
    expect(result.chat.page).toBe('chat');
    expect(result.reopened.session?.lines.length).toBe(2);
    expect(result.afterEmpty.sessions.length).toBe(1);
    expect(result.died.errorText).toContain('Transcription stopped unexpectedly');
    expect(result.calls.filter((c) => c === 'listen.start').length).toBe(3);
  });

  test('recording again before the last one is saved keeps each in its own session', async () => {
    const result = await harness(({ app, helper }) =>
      Effect.gen(function* () {
        yield* app.setAutoAnswer(false);
        yield* app.toggleListening;
        yield* helper.emit({ type: 'commit', speaker: 'me', text: 'First.' });
        yield* waitFor(app, (x) => x.lines.length === 1);
        yield* app.toggleListening;
        yield* app.toggleListening; // again, while the first is still being saved
        yield* helper.emit({ type: 'commit', speaker: 'me', text: 'Second.' });
        yield* waitFor(app, (x) => x.lines.length === 2);
        yield* app.toggleListening;
        const done = yield* waitFor(app, (x) => x.sessions.length === 2);
        const said: Array<ReadonlyArray<string>> = [];
        for (const x of done.sessions) {
          yield* app.openSession(x.id);
          said.push((copilotState(yield* app.model).session?.lines ?? []).map((l) => l.text));
        }
        return said;
      }),
    );
    // Newest first.
    expect(result).toEqual([['Second.'], ['First.']]);
  });

  test('Follow answers a question as soon as it is heard, with Thinking… while it does', async () => {
    const result = await harness(({ app, answerer, helper, asks }) =>
      Effect.gen(function* () {
        yield* app.setAutoAnswer(false);
        yield* app.toggleFollow;
        yield* waitFor(app, (x) => x.followMode && !x.followBusy && x.isListening);
        yield* Ref.set(answerer, (request) =>
          Effect.sleep('100 millis').pipe(Effect.andThen(streaming('Four plus four is eight.')(request))),
        );
        const before = asks.length;
        yield* helper.emit({ type: 'commit', speaker: 'me', text: 'Cuánto es 4 + 4' });
        const thinking = yield* waitFor(app, (x) => x.isThinking);
        const answered = yield* waitFor(app, (x) => !x.isThinking && x.exchanges.length > 0);
        return { thinking, answered, asked: asks.length - before };
      }),
    );
    expect(result.thinking.followBusy).toBe(true);
    expect(result.asked).toBe(1);
    expect(result.answered.exchanges.at(-1)?.answer).toBe('Four plus four is eight.');
  });

  test('Follow stays quiet on SILENT and speaks up otherwise, without opening the panel', async () => {
    const result = await harness(({ app, answerer, helper }) =>
      Effect.gen(function* () {
        yield* Ref.set(answerer, streaming('SILENT'));
        yield* app.collapseToggle; // collapse the card
        yield* app.toggleFollow;
        yield* waitFor(app, (x) => x.followMode && !x.followBusy && x.isListening);
        yield* Effect.sleep('100 millis');
        const quiet = copilotState(yield* app.model);
        return { quiet, calls: helper.log.calls };
      }),
    );
    expect(result.quiet.exchanges).toEqual([]);
    expect(result.quiet.followMode).toBe(true);
    expect(result.calls).toContain('listen.start');
  });
});

describe('a long recording', () => {
  for (const minutes of [30, 60])
    test(`${minutes} minutes: nothing is lost, and the panel hears nothing until it ends`, async () => {
      const result = await harness(({ app, helper }) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* app.setAutoAnswer(false);
            yield* app.toggleListening;
            let updates = 0;
            let heaviest = 0;
            yield* app.changes.pipe(
              Stream.map(panelState),
              Stream.changesWith(sameState),
              Stream.runForEach((s) =>
                Effect.sync(() => {
                  updates++;
                  if (s.isListening) heaviest = Math.max(heaviest, JSON.stringify(s).length);
                }),
              ),
              Effect.forkScoped,
            );
            yield* Effect.sleep('20 millis');
            yield* play(minutes, helper.emit);
            yield* waitFor(app, (s) => s.lines.length === linesOf(minutes));
            const during = updates;
            yield* app.toggleListening;
            yield* Effect.sleep('20 millis');
            return { during, heaviest, lines: panelState(yield* app.model).lines };
          }),
        ),
      );
      // Some 230 events a minute come in; none of them reaches the panel.
      expect(result.during).toBe(1);
      expect(result.heaviest).toBeLessThan(2000);
      expect(result.lines.map((l) => l.text)).toEqual(
        Array.from({ length: linesOf(minutes) }, (_, i) => lineText(i)),
      );
    }, 30_000);

  test('60 minutes with an answer every minute: memory stays flat and each question stays the same size', async () => {
    const heap = () => {
      Bun.gc(true);
      return process.memoryUsage().heapUsed / 1e6;
    };
    const result = await harness(({ app, helper, asks }) =>
      Effect.gen(function* () {
        yield* app.setAutoAnswer(false);
        yield* app.toggleListening;
        const at = new Map<number, number>();
        yield* play(60, helper.emit, (minute) =>
          Effect.gen(function* () {
            yield* app.setQuestion(`question ${minute}`);
            yield* app.ask();
            yield* waitFor(app, (x) => x.exchanges.some((e) => e.ask === `question ${minute}` && e.done));
            if (minute === 20 || minute === 60) at.set(minute, heap());
          }),
        );
        const lengths = asks.map((a) => a.text.length);
        asks.length = 0;
        return { growth: at.get(60)! - at.get(20)!, lengths };
      }),
    );
    expect(result.lengths.length).toBe(60);
    // 40 more minutes of transcript are less than half a megabyte; the rest of the room is the collector's.
    expect(result.growth).toBeLessThan(12);
    expect(result.lengths.at(-1)!).toBeLessThan(result.lengths[29]! * 1.1);
  }, 60_000);

  test('past the cap only the oldest lines go', async () => {
    const extra = 50;
    const lines = await harness(({ app, helper }) =>
      Effect.gen(function* () {
        yield* app.setAutoAnswer(false);
        yield* app.toggleListening;
        const minutes = Math.ceil((MAX_LINES + extra) / linesOf(1));
        yield* play(minutes, helper.emit);
        yield* waitFor(app, (s) => s.lines.at(-1)?.text === lineText(linesOf(minutes) - 1));
        return (yield* app.model).lines;
      }),
    );
    expect(lines.length).toBe(MAX_LINES);
  }, 60_000);

  test('the chat keeps a fixed number of answers, the newest', async () => {
    const s = await harness(({ app }) =>
      Effect.gen(function* () {
        for (let i = 0; i < MAX_EXCHANGES + 5; i++) {
          yield* app.setQuestion(`q${i}`);
          yield* app.ask();
          yield* waitFor(app, (x) => x.exchanges.some((e) => e.ask === `q${i}` && e.done));
        }
        return copilotState(yield* app.model);
      }),
    );
    expect(s.exchanges.length).toBe(MAX_EXCHANGES);
    expect(s.exchanges.at(-1)?.ask).toBe(`q${MAX_EXCHANGES + 4}`);
  });
});

describe('panel', () => {
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
        const selected = copilotState(yield* app.model).currentProfileName;
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

describe('showing the panel', () => {
  /** Who asked for the panel while `act` ran. */
  const shownBy = (
    act: (app: typeof AppState.Service) => Effect.Effect<unknown>,
    options: { signedIn?: boolean } = {},
  ) =>
    harness(
      ({ app }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const why: Array<string> = [];
            const signals = yield* app.signals;
            yield* signals.pipe(
              Stream.runForEach((s) => Effect.sync(() => void why.push(s.why))),
              Effect.forkScoped,
            );
            yield* act(app);
            yield* Effect.sleep('60 millis');
            return why;
          }),
        ),
      options,
    );

  test('opening Machete never does, signed in or not', async () => {
    expect(await shownBy((app) => app.checkLogin)).toEqual([]);
    expect(await shownBy((app) => app.checkLogin, { signedIn: false })).toEqual([]);
  });

  test('changing its settings or its bots never does', async () => {
    const why = await shownBy((app) =>
      Effect.all([app.setAutoAnswer(false), app.addProfile, app.setGlassOpacity(0.8), app.reset]),
    );
    expect(why).toEqual([]);
  });

  test('asking does', async () => {
    expect(await shownBy((app) => app.setQuestion('Hi').pipe(Effect.andThen(app.ask())))).toEqual(['ask']);
  });
});
