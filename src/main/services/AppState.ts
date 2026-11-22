// The app's state machine. Owns everything the overlay shows (a SubscriptionRef the windows render),
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
import type {
  BotsState,
  Exchange,
  Language,
  Model,
  OverlayState,
  Profile,
  ProfileFields,
  Speaker,
  TranscriptLine,
} from '../../shared/domain';
import * as Logic from '../../shared/logic';
import { type PresetKey, Strings } from '../../shared/strings';
import { ChatGptError, HelperError, TimeoutError } from '../errors';
import { Auth } from './Auth';
import { ChatGpt } from './ChatGpt';
import { appendBlock, ContextFiles } from './ContextFiles';
import { NativeHelper } from './NativeHelper';
import { newProfileID, ProfileStore } from './ProfileStore';
import { Settings } from './Settings';

const CAPTURE_TIMEOUT =
  'Screen capture timed out. Grant Screen Recording to Machete in System Settings ▸ Privacy & Security, then reopen the app.';
const ANSWER_TIMEOUT = 'ChatGPT took too long to answer. Try again.';
const MAX_LINES = 400;
const FOLLOW_EVERY = Duration.seconds(3);
const FOLLOW_MIN_GAP_MS = 20_000;
const FOLLOW_SCREEN_CHANGE = 12;
const AUTO_ANSWER_DELAY = Duration.millis(1200);

/** The whole app state. `OverlayState` and `BotsState` are views of it. */
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
  readonly showTranscript: boolean;
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
  /** Always starts hidden from screen sharing; the eye shows it for this session only. */
  readonly visibleInCapture: boolean;
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

export const overlayState = (m: AppModel): OverlayState => ({
  question: m.question,
  exchanges: m.exchanges,
  isThinking: m.isThinking,
  status: m.status,
  errorText: m.errorText,
  isListening: m.isListening,
  isPaused: m.isPaused,
  listenStart: m.listenStart,
  recordedBefore: m.recordedBefore,
  showTranscript: m.showTranscript,
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
  visibleInCapture: m.visibleInCapture,
  followMode: m.followMode,
  followBusy: m.followBusy,
  unseenFollow: m.unseenFollow,
  currentProfileName: currentProfile(m)?.name ?? '',
  focusInputTick: m.focusInputTick,
});

export const botsState = (m: AppModel): BotsState => ({
  profiles: m.profiles,
  selectedProfileID: m.selectedProfileID,
});

/** Things the windows must do, beyond re-rendering the state. */
export type UiSignal = { readonly _tag: 'ShowPanel' };

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
  readonly toggleTranscript: Effect.Effect<void>;
  readonly focusInput: Effect.Effect<void>;
  readonly toggleCaptureVisibility: Effect.Effect<void>;
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
      const auth = yield* Auth;
      const chat = yield* ChatGpt;
      const helper = yield* NativeHelper;
      const contextFiles = yield* ContextFiles;

      const saved = yield* settings.get;
      const profiles = yield* store.load;
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
        showTranscript: false,
        lines: [],
        partialMe: '',
        partialThem: '',
        cardOpen: false,
        collapsed: false,
        cardWidth: saved.cardWidth,
        cardHeight: saved.cardHeight,
        glassOpacity: saved.glassOpacity,
        loggedIn: null,
        signingIn: false,
        directSignedIn: false,
        visibleInCapture: false,
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
      const followMemory = yield* Ref.make({ fingerprint: [] as ReadonlyArray<number>, at: 0, lineCount: 0 });

      const update = (f: (m: AppModel) => AppModel) => SubscriptionRef.update(state, f);
      const get = SubscriptionRef.get(state);
      const showPanel = PubSub.publish(signals, { _tag: 'ShowPanel' } as const).pipe(Effect.asVoid);
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
      const reveal = update((m) => ({ ...m, cardOpen: true, collapsed: false })).pipe(
        Effect.andThen(showPanel),
      );

      // MARK: Ask

      interface Run {
        readonly label: string;
        readonly instruction: string;
        readonly isPreset: boolean;
        readonly isFollow: boolean;
        readonly reveal: boolean;
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
            isThinking: !r.isFollow,
            followBusy: r.isFollow,
            status: 'Capturing screen…',
            exchanges: [...s.exchanges, exchange],
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
                onText: (partial) =>
                  r.isFollow ? Effect.void : patchExchange(exchange.id, (e) => ({ ...e, answer: partial })),
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
              yield* update((s) => ({ ...s, exchanges: s.exchanges.filter((e) => e.id !== exchange.id) }));
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
        yield* update((s) => ({
          ...s,
          followBusy: false,
          isThinking: false,
          exchanges: [],
          errorText: null,
          cardOpen: false,
          collapsed: false,
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
          showTranscript: false,
        }));
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
        yield* update((s) => ({
          ...s,
          listenStart: null,
          isPaused: false,
          recordedBefore: 0,
          isListening: false,
          partialMe: '',
          partialThem: '',
          // Show the full transcript once recording stops.
          ...(was ? { showTranscript: true, cardOpen: true, collapsed: false } : {}),
        }));
        if (!was) return;
        yield* showPanel;
        yield* helper.stopListening.pipe(
          Effect.andThen(get),
          Effect.flatMap((s) => Effect.logInfo(`listen: stopped, ${s.lines.length} lines total`)),
          Effect.forkDetach,
        );
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
          yield* update((s) => {
            const line: TranscriptLine = {
              id: randomUUID(),
              speaker,
              text,
              offset: Logic.recordedSeconds(s, now),
            };
            return { ...s, lines: [...s.lines, line].slice(-MAX_LINES) };
          });
          yield* Effect.logInfo(`transcript: +1 line (${Logic.speakerLabel(speaker)})`);
          // When I start talking, don't interrupt with an automatic answer.
          yield* speaker === 'them' ? scheduleAutoAnswer : FiberHandle.clear(autoFiber);
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
                        errorText: 'Transcription stopped unexpectedly. Start recording again (⌥M).',
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
        const newSpeech = m.lines.length > memory.lineCount;
        if (!screenChanged && !newSpeech) return;
        yield* Ref.set(followMemory, {
          fingerprint: fingerprint.value,
          at: Date.now(),
          lineCount: m.lines.length,
        });
        yield* Effect.logInfo(`follow: tick screenChanged=${screenChanged} newSpeech=${newSpeech}`);
        yield* startRun({
          label: 'Follow',
          instruction: Strings.followInstruction,
          isPreset: false,
          isFollow: true,
          reveal: false,
        });
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
          yield* Ref.set(followMemory, { fingerprint: [], at: 0, lineCount: 0 });
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
        yield* showPanel;
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

      const collapseToggle = update((s) =>
        Logic.cardVisible(s)
          ? { ...s, collapsed: true, showTranscript: false }
          : { ...s, collapsed: false, cardOpen: true, unseenFollow: 0 },
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
        toggleTranscript: update((s) => ({ ...s, showTranscript: !s.showTranscript })),
        focusInput: update((s) => ({ ...s, collapsed: false, focusInputTick: s.focusInputTick + 1 })),
        toggleCaptureVisibility: update((s) => ({ ...s, visibleInCapture: !s.visibleInCapture })),
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
