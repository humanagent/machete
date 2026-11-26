// The app's state machine. Owns everything the copilot shows (a SubscriptionRef the windows render),
// and runs the long-lived work as fibers: one ask at a time, the Follow loop, and auto-answer.
import { randomUUID } from 'node:crypto';
import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  Layer,
  Option,
  PubSub,
  Ref,
  type Scope,
  Stream,
  SubscriptionRef,
} from 'effect';
import type { Language, Model, Speaker } from '../../../core/domain';
import type {
  BotsState,
  Exchange,
  CopilotState,
  Page,
  Profile,
  ProfileFields,
  Session,
  SessionSummary,
  TranscriptLine,
} from '../domain';
import * as Logic from '../logic';
import { type PresetKey, Strings } from '../strings';
import { ChatGptError, HelperError, TimeoutError } from '../../../core/errors';
import { Auth } from '../../../core/services/Auth';
import { ChatGpt } from '../../../core/services/ChatGpt';
import { appendBlock, ContextFiles } from './ContextFiles';
import { NativeHelper } from '../../../core/services/NativeHelper';
import { newProfileID, ProfileStore } from './ProfileStore';
import { SessionStore } from './SessionStore';
import { Settings } from '../../../core/services/Settings';

const CAPTURE_TIMEOUT =
  'Screen capture timed out. Grant Screen Recording to Machete in System Settings ▸ Privacy & Security, then reopen the app.';
const ANSWER_TIMEOUT = 'ChatGPT took too long to answer. Try again.';
/** Hours of conversation (a dense one is some 15 lines a minute), so a long meeting keeps its beginning. */
export const MAX_LINES = 5000;
export const MAX_EXCHANGES = 100;
const FOLLOW_EVERY = Duration.seconds(3);
const FOLLOW_MIN_GAP_MS = 20_000;
const FOLLOW_SCREEN_CHANGE = 12;
const AUTO_ANSWER_DELAY = Duration.millis(1200);
/** The last words reach us as events after the helper says it stopped; this lets them land before saving. */
const LAST_WORDS = Duration.millis(300);
/** How long a stopped recording waits for the helper before it is saved anyway: a stuck recognizer can take a minute. */
const STOP_WAIT = Duration.seconds(3);
/** The beginning of a recording is enough to name it. */
const TITLE_LINES = 120;

/** The whole app state. `CopilotState` and `BotsState` are views of it. */
export interface AppModel {
  readonly question: string;
  readonly exchanges: ReadonlyArray<Exchange>;
  readonly isThinking: boolean;
  readonly status: string;
  readonly errorText: string | null;
  readonly isListening: boolean;
  readonly isPaused: boolean;
  readonly listenStart: number | null;
  readonly recordedBefore: number;
  readonly page: Page;
  readonly sessions: ReadonlyArray<SessionSummary>;
  readonly session: Session | null;
  readonly lines: ReadonlyArray<TranscriptLine>;
  readonly partialMe: string;
  readonly partialThem: string;
  readonly cardOpen: boolean;
  readonly collapsed: boolean;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly glassOpacity: number;
  readonly loggedIn: boolean | null;
  readonly signingIn: boolean;
  readonly directSignedIn: boolean;
  readonly followMode: boolean;
  readonly followBusy: boolean;
  readonly unseenFollow: number;
  readonly focusInputTick: number;
  readonly profiles: ReadonlyArray<Profile>;
  readonly selectedProfileID: string;
  readonly language: Language;
  readonly dictationLanguage: Language;
  readonly model: string;
  readonly models: ReadonlyArray<Model>;
  readonly autoAnswer: boolean;
}

export const DEFAULT_MODELS: ReadonlyArray<Model> = [
  { slug: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' },
  { slug: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
  { slug: 'gpt-6-luna', name: 'GPT-6-Luna' },
];

export const currentProfile = (m: AppModel): Profile | undefined =>
  m.profiles.find((p) => p.id === m.selectedProfileID) ?? m.profiles[0];

export const copilotState = (m: AppModel): CopilotState => ({
  question: m.question,
  exchanges: m.exchanges,
  isThinking: m.isThinking,
  status: m.status,
  errorText: m.errorText,
  isListening: m.isListening,
  isPaused: m.isPaused,
  listenStart: m.listenStart,
  recordedBefore: m.recordedBefore,
  page: m.page,
  sessions: m.sessions,
  session: m.session,
  lines: m.lines,
  partialMe: m.partialMe,
  partialThem: m.partialThem,
  cardOpen: m.cardOpen,
  collapsed: m.collapsed,
  cardVisible: Logic.cardVisible(m),
  cardWidth: m.cardWidth,
  cardHeight: m.cardHeight,
  glassOpacity: m.glassOpacity,
  loggedIn: m.loggedIn,
  signingIn: m.signingIn,
  directSignedIn: m.directSignedIn,
  followMode: m.followMode,
  followBusy: m.followBusy,
  unseenFollow: m.unseenFollow,
  currentProfileName: currentProfile(m)?.name ?? '',
  focusInputTick: m.focusInputTick,
});

/** What the panel draws. While recording it shows neither the transcript nor the words in progress, so several
 * updates a second don't reach it at all. */
export const panelState = (m: AppModel): CopilotState => {
  const s = copilotState(m);
  return m.isListening ? { ...s, lines: NO_LINES, partialMe: '', partialThem: '' } : s;
};
const NO_LINES: ReadonlyArray<TranscriptLine> = [];

/** Same values in every field. */
export const sameState = (a: CopilotState, b: CopilotState): boolean =>
  (Object.keys(a) as Array<keyof CopilotState>).every((k) => a[k] === b[k]);

export const botsState = (m: AppModel): BotsState => ({
  profiles: m.profiles,
  selectedProfileID: m.selectedProfileID,
});

/** Things the windows must do, beyond re-rendering the state. */
export type UiSignal = { readonly _tag: 'ShowPanel'; readonly why: 'ask' | 'recording ended' | 'sign in' };

export interface AskOptions {
  readonly preset?: PresetKey | undefined;
  /** Triggered by the app (auto-answer): never reveals a hidden panel. */
  readonly automatic?: boolean | undefined;
}

export interface AppStateShape {
  readonly model: Effect.Effect<AppModel>;
  readonly changes: Stream.Stream<AppModel>;
  /** Subscribes now; the stream lasts for the caller's scope. */
  readonly signals: Effect.Effect<Stream.Stream<UiSignal>, never, Scope.Scope>;
  // Asking
  readonly setQuestion: (question: string) => Effect.Effect<void>;
  readonly ask: (options?: AskOptions) => Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
  // Panel
  /** Opens the card and shows the panel (at launch). */
  readonly openPanel: Effect.Effect<void>;
  /** Shows a message in the panel, opening it. */
  readonly showError: (message: string) => Effect.Effect<void>;
  readonly collapseToggle: Effect.Effect<void>;
  /** The list of recordings. */
  readonly showSessions: Effect.Effect<void>;
  /** One recording, with its whole transcript. */
  readonly openSession: (id: string) => Effect.Effect<void>;
  readonly focusInput: Effect.Effect<void>;
  readonly setCardSize: (width: number, height: number, persist: boolean) => Effect.Effect<void>;
  readonly setCardHeight: (height: number, persist: boolean) => Effect.Effect<void>;
  readonly setGlassOpacity: (value: number) => Effect.Effect<void>;
  // Follow and listening
  readonly toggleFollow: Effect.Effect<void>;
  readonly toggleListening: Effect.Effect<void>;
  readonly togglePause: Effect.Effect<void>;
  readonly setLanguage: (language: Language) => Effect.Effect<void>;
  readonly setDictationLanguage: (language: Language) => Effect.Effect<void>;
  readonly setAutoAnswer: (on: boolean) => Effect.Effect<void>;
  // Bots
  readonly selectProfile: (id: string) => Effect.Effect<void>;
  readonly addProfile: Effect.Effect<string>;
  readonly deleteProfile: (id: string) => Effect.Effect<void>;
  readonly updateProfile: (id: string, fields: ProfileFields) => Effect.Effect<void>;
  /** Appends the files' text to a bot's context. Returns the note shown under the drop zone. */
  readonly addContextFiles: (id: string, files: ReadonlyArray<string>) => Effect.Effect<string>;
  // ChatGPT
  readonly setModel: (slug: string) => Effect.Effect<void>;
  readonly checkLogin: Effect.Effect<void>;
  readonly login: Effect.Effect<void>;
  readonly signOut: Effect.Effect<void>;
}

const errorMessage = (e: ChatGptError | HelperError | TimeoutError): string => e.message;

export class AppState extends Context.Service<AppState, AppStateShape>()('machete/AppState') {
  static readonly layer = Layer.effect(
    AppState,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const store = yield* ProfileStore;
      const sessionStore = yield* SessionStore;
      const auth = yield* Auth;
      const chat = yield* ChatGpt;
      const helper = yield* NativeHelper;
      const contextFiles = yield* ContextFiles;

      const saved = yield* settings.get;
      const profiles = yield* store.load;
      const sessions = yield* sessionStore.list;
      const state = yield* SubscriptionRef.make<AppModel>({
        question: '',
        exchanges: [],
        isThinking: false,
        status: 'Thinking…',
        errorText: null,
        isListening: false,
        isPaused: false,
        listenStart: null,
        recordedBefore: 0,
        page: 'chat',
        sessions,
        session: null,
        lines: [],
        partialMe: '',
        partialThem: '',
        cardOpen: false,
        // Machete starts as just the bar; asking, an error or ⌘↩ opens the card.
        collapsed: true,
        cardWidth: saved.cardWidth,
        cardHeight: saved.cardHeight,
        glassOpacity: saved.glassOpacity,
        loggedIn: null,
        signingIn: false,
        directSignedIn: false,
        followMode: false,
        followBusy: false,
        unseenFollow: 0,
        focusInputTick: 0,
        profiles,
        selectedProfileID: saved.profileID ?? profiles[0]?.id ?? newProfileID(),
        language: saved.language,
        dictationLanguage: saved.dictationLanguage,
        model: saved.model,
        models: DEFAULT_MODELS,
        autoAnswer: saved.autoAnswer,
      });
      const signals = yield* PubSub.unbounded<UiSignal>();
      const askFiber = yield* FiberHandle.make<void, never>();
      const followFiber = yield* FiberHandle.make<void, never>();
      const autoFiber = yield* FiberHandle.make<void, never>();
      const followMemory = yield* Ref.make({
        fingerprint: [] as ReadonlyArray<number>,
        at: 0,
        lastLine: undefined as string | undefined,
      });
      /** The recording under way: what becomes a session when it stops. Lines also go to `lines`, which New chat
       * clears and earlier recordings share. */
      interface Recording {
        readonly id: string;
        readonly startedAt: number;
        readonly seconds: number;
        readonly lines: ReadonlyArray<TranscriptLine>;
      }
      const recording = yield* Ref.make<Recording | null>(null);
      /** Those stopped and not saved yet, oldest first. The last one takes the words that land after stopping, until
       * a new recording starts: from then on, the new one gets them. Each is saved as itself, never in another's place. */
      const closing = yield* Ref.make<ReadonlyArray<Recording>>([]);
      /** How long the last recording ran: stray words after it was saved go at its end, not at 0:00. */
      const lastSeconds = yield* Ref.make(0);
      /** Bumped by every move between pages, so a recording saved after the user moved on doesn't pull them back. */
      const nav = yield* Ref.make(0);
      const moved = Ref.update(nav, (n) => n + 1);

      const update = (f: (m: AppModel) => AppModel) => SubscriptionRef.update(state, f);
      const get = SubscriptionRef.get(state);
      const showPanel = (why: UiSignal['why']) =>
        PubSub.publish(signals, { _tag: 'ShowPanel', why } as const).pipe(Effect.asVoid);
      const persist = (patch: Parameters<typeof settings.update>[0]) =>
        settings.update(patch).pipe(
          Effect.tapError((e) => Effect.logError(e.message)),
          Effect.ignore,
        );
      const saveProfiles = (list: ReadonlyArray<Profile>) =>
        store.save(list).pipe(
          Effect.tapError((e) => Effect.logError(e.message)),
          Effect.ignore,
        );
      const patchExchange = (id: string, f: (e: Exchange) => Exchange) =>
        update((m) => ({ ...m, exchanges: m.exchanges.map((e) => (e.id === id ? f(e) : e)) }));
      /** A Follow check replaced before it finished: nothing of it shows, not even what it had streamed. */
      const abandonedFollow = (e: Exchange) => e.isFollow && !e.done;
      const reveal = moved.pipe(
        Effect.andThen(update((m) => ({ ...m, cardOpen: true, collapsed: false, page: 'chat' as const }))),
        Effect.andThen(showPanel('ask')),
      );

      // MARK: Ask

      interface Run {
        readonly label: string;
        readonly instruction: string;
        readonly isPreset: boolean;
        readonly isFollow: boolean;
        readonly reveal: boolean;
        /** Shows Thinking… while it works, even for Follow (a question was heard). */
        readonly thinking?: boolean;
      }

      /** One request: screenshot + prompt to ChatGPT, streamed into a new exchange. Replaces any running ask. */
      const run = (r: Run) =>
        Effect.gen(function* () {
          const quiet = r.isFollow || !r.reveal;
          if (!quiet) yield* reveal;
          const m = yield* get;
          const profile = currentProfile(m);
          const prompt = Logic.buildPrompt(r.instruction, {
            lines: m.lines,
            partialMe: m.partialMe,
            partialThem: m.partialThem,
            exchanges: m.exchanges,
            context: profile?.context ?? '',
          });
          const instructions = Logic.systemPrompt({ instructions: profile?.instructions ?? '' });
          const exchange: Exchange = {
            id: randomUUID(),
            ask: r.label,
            typed: r.instruction,
            isPreset: r.isPreset,
            isFollow: r.isFollow,
            answer: null,
            done: false,
          };
          yield* update((s) => ({
            ...s,
            errorText: null,
            isThinking: !r.isFollow || r.thinking === true,
            followBusy: r.isFollow,
            status: 'Capturing screen…',
            exchanges: [...s.exchanges.filter((e) => !abandonedFollow(e)), exchange].slice(-MAX_EXCHANGES),
          }));

          const request = Effect.gen(function* () {
            if (!m.directSignedIn) return yield* ChatGptError.of('Sign in with ChatGPT first.', true);
            const image = yield* helper.captureDataURL().pipe(
              Effect.timeoutOrElse({
                duration: Duration.seconds(15),
                orElse: () => Effect.fail(new TimeoutError({ message: CAPTURE_TIMEOUT })),
              }),
            );
            yield* update((s) => ({ ...s, status: 'Asking ChatGPT…' }));
            const answer = yield* chat
              .ask({
                model: m.model,
                instructions,
                text: prompt,
                imageDataURL: image,
                effort: 'low',
                // Follow shows its answer as it comes too, once it's clearly not going to be SILENT.
                onText: (partial) =>
                  r.isFollow && !Logic.showsWhileStreaming(partial)
                    ? Effect.void
                    : patchExchange(exchange.id, (e) => ({ ...e, answer: partial })),
              })
              .pipe(
                Effect.timeoutOrElse({
                  duration: Duration.seconds(120),
                  orElse: () => Effect.fail(new TimeoutError({ message: ANSWER_TIMEOUT })),
                }),
              );
            const trimmed = answer.trim();
            if (r.isFollow && (trimmed === '' || Logic.isSilent(trimmed))) {
              // Nothing wrong: show nothing.
              yield* update((s) => ({
                ...s,
                exchanges: s.exchanges.filter((e) => e.id !== exchange.id),
                isThinking: false,
              }));
              yield* Effect.logInfo('follow: silent');
              return;
            }
            yield* update((s) => ({
              ...s,
              exchanges: s.exchanges.map((e) => (e.id === exchange.id ? { ...e, answer } : e)),
              // Follow never pops the panel open; it only flags that something new arrived.
              unseenFollow: quiet && s.collapsed ? s.unseenFollow + 1 : s.unseenFollow,
            }));
          });

          const failed = (e: ChatGptError | HelperError | TimeoutError) =>
            Effect.gen(function* () {
              yield* Effect.logWarning(`ask failed: ${e._tag}`);
              yield* update((s) => ({ ...s, errorText: errorMessage(e) }));
              if (r.isFollow) yield* setFollow(false); // don't keep hammering on errors or usage limits
              if (e._tag === 'ChatGptError' && e.needsSignIn) {
                yield* update((s) => ({ ...s, directSignedIn: false }));
                yield* refreshLoggedIn;
              }
            });

          yield* request.pipe(
            Effect.catch(failed),
            // An interrupted ask (replaced or cleared) leaves the state to whoever interrupted it.
            Effect.onExit((exit) =>
              Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
                ? Effect.void
                : update((s) => ({
                    ...s,
                    isThinking: false,
                    followBusy: false,
                    exchanges: s.exchanges
                      .map((e) => (e.id === exchange.id ? { ...e, done: true } : e))
                      .filter((e) => !(e.id === exchange.id && !e.answer)),
                  })),
            ),
          );
        });

      const startRun = (r: Run) => FiberHandle.run(askFiber, run(r)).pipe(Effect.asVoid);

      const ask = (options: AskOptions = {}) =>
        Effect.gen(function* () {
          const m = yield* get;
          if (m.loggedIn === false) {
            if (options.automatic) return;
            yield* update((s) => ({ ...s, errorText: 'Sign in with ChatGPT first.' }));
            return yield* reveal;
          }
          const preset = options.preset ? Strings.presets[options.preset] : undefined;
          const typed = preset ? preset.instruction : m.question.trim();
          if (!preset) yield* update((s) => ({ ...s, question: '' }));
          yield* startRun({
            label: preset ? preset.label : typed === '' ? 'Assist' : typed,
            instruction: typed,
            isPreset: preset !== undefined,
            isFollow: false,
            reveal: !options.automatic,
          });
        });

      const reset = Effect.gen(function* () {
        yield* FiberHandle.clear(askFiber);
        yield* moved;
        yield* update((s) => ({
          ...s,
          followBusy: false,
          isThinking: false,
          exchanges: [],
          errorText: null,
          cardOpen: false,
          collapsed: false,
          page: 'chat',
          session: null,
          lines: [],
          partialMe: '',
          partialThem: '',
        }));
      });

      // MARK: Listening

      const startListening = Effect.gen(function* () {
        yield* update((s) => ({
          ...s,
          errorText: null,
          isListening: true,
          isPaused: false,
          recordedBefore: 0,
          listenStart: Date.now(),
        }));
        yield* Ref.set(recording, { id: randomUUID(), startedAt: Date.now(), seconds: 0, lines: [] });
        yield* helper.startListening((yield* get).language).pipe(
          Effect.catch((e) =>
            update((s) => ({ ...s, errorText: e.message })).pipe(Effect.andThen(stopListening)),
          ),
          Effect.forkDetach,
        );
      });

      const stopListening: Effect.Effect<void> = Effect.gen(function* () {
        const was = (yield* get).isListening;
        yield* FiberHandle.clear(autoFiber);
        const seconds = Logic.recordedSeconds(yield* get, Date.now());
        const stopped = yield* Ref.getAndSet(recording, null);
        if (stopped) yield* Ref.update(closing, (list) => [...list, { ...stopped, seconds }]);
        if (stopped) yield* Ref.set(lastSeconds, seconds);
        yield* update((s) => ({
          ...s,
          listenStart: null,
          isPaused: false,
          recordedBefore: 0,
          isListening: false,
          partialMe: '',
          partialThem: '',
          ...(was ? { cardOpen: true, collapsed: false } : {}),
        }));
        if (!was) return;
        const navAtStop = yield* Ref.get(nav);
        yield* showPanel('recording ended');
        yield* helper.stopListening.pipe(
          Effect.timeout(STOP_WAIT),
          Effect.tapError(() => Effect.logWarning('listen: the helper is slow to stop; saving what came')),
          Effect.ignore,
          Effect.andThen(Effect.sleep(LAST_WORDS)),
          Effect.andThen(stopped ? saveRecording(stopped.id, navAtStop) : Effect.void),
          Effect.forkDetach,
        );
      });

      /** Names a saved session from its beginning, in the background. Signed out or failing, it stays untitled. */
      const nameSession = (session: Session) =>
        Effect.gen(function* () {
          const m = yield* get;
          const said = session.lines
            .slice(0, TITLE_LINES)
            .map((l) => `${Logic.speakerLabel(l.speaker)}: ${l.text}`)
            .join('\n');
          const reply = yield* chat.ask({
            model: m.model,
            instructions: Strings.sessionTitleInstructions,
            text: `<transcript>\n${said}\n</transcript>`,
            effort: 'low',
            onText: () => Effect.void,
          });
          const title = Logic.cleanTitle(reply);
          if (title === '') return;
          const stored = yield* sessionStore.get(session.id);
          if (Option.isNone(stored)) return;
          const index = yield* sessionStore.save({ ...stored.value, title });
          yield* update((s) => ({
            ...s,
            sessions: index,
            session: s.session?.id === session.id ? { ...s.session, title } : s.session,
          }));
        }).pipe(Effect.catchCause((c) => Effect.logWarning(`sessions: left untitled (${Cause.pretty(c)})`)));

      /** Keeps what was just recorded as a session and opens it, if the user is still where stopping left them.
       * Nothing said, nothing kept. */
      const saveRecording = (id: string, navAtStop: number) =>
        Effect.gen(function* () {
          const r = yield* Ref.modify(closing, (list) => [
            list.find((c) => c.id === id),
            list.filter((c) => c.id !== id),
          ]);
          if (!r) return;
          yield* Effect.logInfo(`listen: stopped, ${r.lines.length} lines`);
          if (r.lines.length === 0) return;
          const session: Session = {
            id: r.id,
            title: '',
            startedAt: r.startedAt,
            seconds: r.seconds,
            lines: r.lines,
          };
          const index = yield* sessionStore.save(session).pipe(
            Effect.tapError((e) => Effect.logError(e.message)),
            Effect.option,
          );
          if (Option.isNone(index)) return;
          const stayed = (yield* Ref.get(nav)) === navAtStop;
          if (stayed) yield* moved;
          yield* update((s) => ({
            ...s,
            sessions: index.value,
            ...(stayed && !s.isListening ? { page: 'session' as const, session } : {}),
          }));
          yield* nameSession(session);
        });

      const openSession = (id: string) =>
        Effect.gen(function* () {
          const found = yield* sessionStore.get(id);
          if (Option.isNone(found)) return yield* Effect.logWarning(`sessions: ${id} is gone`);
          yield* moved;
          yield* update((s) => ({
            ...s,
            page: 'session',
            session: found.value,
            cardOpen: true,
            collapsed: false,
          }));
        });

      const toggleListening = get.pipe(
        Effect.flatMap((m) => (m.isListening ? stopListening : startListening)),
      );

      const togglePause = Effect.gen(function* () {
        const m = yield* get;
        if (!m.isListening) return;
        const now = Date.now();
        const paused = !m.isPaused;
        if (paused) yield* FiberHandle.clear(autoFiber);
        yield* update((s) =>
          paused
            ? {
                ...s,
                isPaused: true,
                recordedBefore: s.recordedBefore + (now - (s.listenStart ?? now)) / 1000,
              }
            : { ...s, isPaused: false, listenStart: now },
        );
        yield* helper.setPaused(paused);
      });

      /** When the other side finishes a question, prepare what to say. */
      const scheduleAutoAnswer = Effect.gen(function* () {
        if (!(yield* get).autoAnswer) return yield* FiberHandle.clear(autoFiber);
        const check = Effect.gen(function* () {
          yield* Effect.sleep(AUTO_ANSWER_DELAY); // multi-sentence questions arrive as several lines
          const m = yield* get;
          if (m.isThinking || m.partialThem !== '') return;
          const recent = m.lines
            .slice(-3)
            .filter((l) => l.speaker === 'them')
            .map((l) => l.text)
            .join(' ');
          if (Logic.looksLikeQuestion(recent)) yield* ask({ preset: 'whatToSay', automatic: true });
        });
        yield* FiberHandle.run(autoFiber, check);
      });

      const onCommit = (speaker: Speaker, text: string) =>
        Effect.gen(function* () {
          const now = Date.now();
          const m = yield* get;
          const live = yield* Ref.get(recording);
          const late = live ? undefined : (yield* Ref.get(closing)).at(-1);
          const line: TranscriptLine = {
            id: randomUUID(),
            speaker,
            text,
            // Words that land after stopping belong at its end, not at 0:00.
            offset: m.isListening
              ? Logic.recordedSeconds(m, now)
              : (late?.seconds ?? (yield* Ref.get(lastSeconds))),
          };
          yield* update((s) => ({ ...s, lines: [...s.lines, line].slice(-MAX_LINES) }));
          if (live) yield* Ref.set(recording, { ...live, lines: [...live.lines, line] });
          else if (late)
            yield* Ref.update(closing, (list) =>
              list.map((c) => (c.id === late.id ? { ...c, lines: [...c.lines, line] } : c)),
            );
          yield* Effect.logInfo(`transcript: +1 line (${Logic.speakerLabel(speaker)})`);
          // When I start talking, don't interrupt with an automatic answer.
          yield* speaker === 'them' ? scheduleAutoAnswer : FiberHandle.clear(autoFiber);
          // Follow answers questions too, mine included, as soon as they're heard.
          if (m.followMode && Logic.looksLikeQuestion(text)) yield* followQuestion;
        });

      const helperEvents = yield* helper.subscribe;
      yield* helperEvents.pipe(
        Stream.runForEach((event) => {
          switch (event.type) {
            case 'partial':
              return update((s) =>
                event.speaker === 'me' ? { ...s, partialMe: event.text } : { ...s, partialThem: event.text },
              );
            case 'commit':
              return onCommit(event.speaker, event.text);
            case 'error':
              return update((s) => ({ ...s, errorText: event.message }));
            case 'exit':
              return get.pipe(
                Effect.flatMap((m) =>
                  m.isListening
                    ? update((s) => ({
                        ...s,
                        errorText: 'Transcription stopped unexpectedly. Start recording again.',
                      })).pipe(Effect.andThen(stopListening))
                    : Effect.void,
                ),
              );
            default:
              return Effect.void;
          }
        }),
        Effect.forkScoped,
      );

      // MARK: Follow

      /** Every few seconds: if the screen changed noticeably or new speech arrived, look for mistakes. */
      const followTick = Effect.gen(function* () {
        const m = yield* get;
        const memory = yield* Ref.get(followMemory);
        if (!m.followMode || m.isThinking || m.followBusy || Date.now() - memory.at < FOLLOW_MIN_GAP_MS)
          return;
        const fingerprint = yield* helper.fingerprint.pipe(Effect.option);
        if (Option.isNone(fingerprint)) return;
        const screenChanged =
          memory.fingerprint.length === 0 ||
          Logic.fingerprintDifference(fingerprint.value, memory.fingerprint) > FOLLOW_SCREEN_CHANGE;
        const newSpeech = Logic.newSpeech(m.lines, memory.lastLine);
        if (!screenChanged && !newSpeech) return;
        yield* Ref.set(followMemory, {
          fingerprint: fingerprint.value,
          at: Date.now(),
          lastLine: m.lines.at(-1)?.id,
        });
        yield* Effect.logInfo(`follow: tick screenChanged=${screenChanged} newSpeech=${newSpeech}`);
        yield* followRun(false);
      });

      const followRun = (thinking: boolean) =>
        startRun({
          label: 'Follow',
          instruction: Strings.followInstruction,
          isPreset: false,
          isFollow: true,
          reveal: false,
          thinking,
        });

      /** A question heard in Follow is taken now, not at the next tick, replacing a quiet check under way. */
      const followQuestion = Effect.gen(function* () {
        const m = yield* get;
        if (!m.followMode || m.isThinking) return;
        yield* Ref.update(followMemory, (f) => ({ ...f, at: Date.now(), lastLine: m.lines.at(-1)?.id }));
        yield* Effect.logInfo('follow: question heard');
        yield* followRun(true);
      });

      const setFollow = (on: boolean): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* FiberHandle.clear(followFiber);
          if (on && (yield* get).loggedIn === false) {
            return yield* update((s) => ({
              ...s,
              followMode: false,
              errorText: 'Sign in with ChatGPT first.',
            }));
          }
          yield* update((s) => ({ ...s, followMode: on }));
          if (!on) return;
          yield* Ref.set(followMemory, { fingerprint: [], at: 0, lastLine: undefined });
          if (!(yield* get).isListening) yield* startListening; // Follow listens to the conversation too
          yield* FiberHandle.run(
            followFiber,
            followTick.pipe(Effect.andThen(Effect.sleep(FOLLOW_EVERY)), Effect.forever),
          );
        });

      // MARK: Bots

      const selectProfile = (id: string) =>
        update((s) => ({ ...s, selectedProfileID: id })).pipe(Effect.andThen(persist({ profileID: id })));

      const editProfiles = (f: (list: ReadonlyArray<Profile>) => ReadonlyArray<Profile>) =>
        SubscriptionRef.modify(state, (s) => {
          const next = f(s.profiles);
          return [next, { ...s, profiles: next }] as const;
        }).pipe(Effect.flatMap(saveProfiles));

      const addProfile = Effect.gen(function* () {
        const id = newProfileID();
        yield* editProfiles((list) => [
          ...list,
          { id, name: 'New bot', instructions: Strings.newBotInstructions, context: '' },
        ]);
        return id;
      });

      const deleteProfile = (id: string) =>
        Effect.gen(function* () {
          const m = yield* get;
          if (m.profiles.length <= 1) return;
          yield* editProfiles((list) => list.filter((p) => p.id !== id));
          const first = (yield* get).profiles[0];
          if (m.selectedProfileID === id && first) yield* selectProfile(first.id);
        });

      const updateProfile = (id: string, fields: ProfileFields) =>
        editProfiles((list) =>
          list.map((p) =>
            p.id === id
              ? {
                  ...p,
                  name: fields.name ?? p.name,
                  instructions: fields.instructions ?? p.instructions,
                  context: fields.context ?? p.context,
                }
              : p,
          ),
        );

      const addContextFiles = (id: string, files: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const results = yield* Effect.forEach(files, (f) =>
            contextFiles.block(f).pipe(Effect.map((block) => ({ file: f, block }))),
          );
          const added = results.flatMap((r) => (Option.isSome(r.block) ? [r] : []));
          const failed = results
            .filter((r) => Option.isNone(r.block))
            .map((r) => r.file.split('/').at(-1) ?? r.file);
          yield* editProfiles((list) =>
            list.map((p) =>
              p.id === id
                ? {
                    ...p,
                    context: added.reduce(
                      (ctx, r) => (Option.isSome(r.block) ? appendBlock(ctx, r.block.value) : ctx),
                      p.context,
                    ),
                  }
                : p,
            ),
          );
          return [
            added.length ? `Added: ${added.map((r) => r.file.split('/').at(-1)).join(', ')}` : null,
            failed.length ? `Couldn't read: ${failed.join(', ')}` : null,
          ]
            .filter((x): x is string => x !== null)
            .join(' · ');
        });

      // MARK: ChatGPT

      const refreshLoggedIn = update((s) => ({
        ...s,
        loggedIn: s.directSignedIn,
        cardOpen: s.directSignedIn ? s.cardOpen : true,
      }));

      const setModel = (slug: string) =>
        update((s) => ({ ...s, model: slug })).pipe(Effect.andThen(persist({ model: slug })));

      const loadModels = Effect.gen(function* () {
        const list = yield* chat.listModels;
        if (list.length === 0) return;
        yield* update((s) => ({ ...s, models: list }));
        const m = yield* get;
        const first = list[0];
        if (first && !list.some((x) => x.slug === m.model)) yield* setModel(first.slug);
      }).pipe(Effect.ignore); // keep the defaults

      const checkLogin = Effect.gen(function* () {
        const signedIn = yield* auth.isSignedIn;
        yield* update((s) => ({ ...s, directSignedIn: signedIn }));
        yield* refreshLoggedIn;
        if (signedIn) yield* Effect.forkDetach(loadModels);
      });

      const login = Effect.gen(function* () {
        if ((yield* get).signingIn) return;
        yield* update((s) => ({ ...s, signingIn: true, errorText: null }));
        yield* showPanel('sign in');
        yield* auth.signIn.pipe(
          Effect.andThen(update((s) => ({ ...s, directSignedIn: true, loggedIn: true }))),
          Effect.andThen(Effect.forkDetach(loadModels)),
          Effect.catch((e) => update((s) => ({ ...s, errorText: e.message }))),
          Effect.ensuring(update((s) => ({ ...s, signingIn: false }))),
        );
      });

      const signOut = auth.signOut.pipe(
        Effect.ignore,
        Effect.andThen(update((s) => ({ ...s, directSignedIn: false }))),
        Effect.andThen(refreshLoggedIn),
      );

      // MARK: Panel

      /** Back: from a recording to the list, from the list to the chat, from the chat to just the bar. */
      const collapseToggle = moved.pipe(
        Effect.andThen(
          update((s): AppModel => {
            if (!Logic.cardVisible(s)) return { ...s, collapsed: false, cardOpen: true, unseenFollow: 0 };
            if (s.page === 'session') return { ...s, page: 'sessions', session: null };
            if (s.page === 'sessions') return { ...s, page: 'chat' };
            return { ...s, collapsed: true };
          }),
        ),
      );

      return {
        model: get,
        changes: SubscriptionRef.changes(state),
        signals: PubSub.subscribe(signals).pipe(Effect.map(Stream.fromSubscription)),
        setQuestion: (question) => update((s) => ({ ...s, question })),
        ask,
        reset,
        openPanel: reveal,
        showError: (message) => update((s) => ({ ...s, errorText: message })).pipe(Effect.andThen(reveal)),
        collapseToggle,
        showSessions: moved.pipe(
          Effect.andThen(
            update((s) => ({ ...s, page: 'sessions', session: null, cardOpen: true, collapsed: false })),
          ),
        ),
        openSession,
        focusInput: update((s) => ({ ...s, collapsed: false, focusInputTick: s.focusInputTick + 1 })),
        setCardSize: (width, height, save) =>
          Effect.gen(function* () {
            const w = Math.max(480, width);
            const h = Math.max(300, height);
            yield* update((s) => ({ ...s, cardWidth: w, cardHeight: h }));
            if (save) yield* persist({ cardWidth: w, cardHeight: h });
          }),
        setCardHeight: (height, save) =>
          Effect.gen(function* () {
            const h = Math.min(1400, Math.max(220, height));
            yield* update((s) => ({ ...s, cardHeight: h }));
            if (save) yield* persist({ cardHeight: h });
          }),
        setGlassOpacity: (value) =>
          update((s) => ({ ...s, glassOpacity: value })).pipe(
            Effect.andThen(persist({ glassOpacity: value })),
          ),
        toggleFollow: get.pipe(Effect.flatMap((m) => setFollow(!m.followMode))),
        toggleListening,
        togglePause,
        setDictationLanguage: (dictationLanguage) =>
          update((s) => ({ ...s, dictationLanguage })).pipe(Effect.andThen(persist({ dictationLanguage }))),
        setLanguage: (language) =>
          Effect.gen(function* () {
            yield* update((s) => ({ ...s, language }));
            yield* persist({ language });
            if ((yield* get).isListening) {
              yield* stopListening;
              yield* startListening;
            }
          }),
        setAutoAnswer: (on) =>
          update((s) => ({ ...s, autoAnswer: on })).pipe(Effect.andThen(persist({ autoAnswer: on }))),
        selectProfile,
        addProfile,
        deleteProfile,
        updateProfile,
        addContextFiles,
        setModel,
        checkLogin,
        login,
        signOut,
      } satisfies AppStateShape;
    }),
  );
}
