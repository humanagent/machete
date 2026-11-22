// Dictation: speak and the words are typed into the app you're in. Transcription only, no AI.
// Started and finished with the right ⌘ key (tapped alone) or ⌥D; Esc or the pill's menu cancels.
import { Context, Duration, Effect, FiberHandle, Layer, Ref, Schedule, Stream } from 'effect';
import type { DictationEvent } from '../../shared/ipc';
import { AppState } from './AppState';
import { NativeHelper } from './NativeHelper';
import { PermissionsGuide } from './PermissionsGuide';

/** The floating pill that shows where the words will go. Implemented by the Electron layer. */
export class DictationPill extends Context.Service<
  DictationPill,
  {
    readonly show: (app: string, icon: string) => Effect.Effect<void>;
    readonly send: (event: DictationEvent) => Effect.Effect<void>;
    readonly hide: Effect.Effect<void>;
    /** Esc cancels only while recording. */
    readonly captureEscape: (onEscape: Effect.Effect<void>) => Effect.Effect<void>;
    readonly releaseEscape: Effect.Effect<void>;
  }
>()('machete/DictationPill') {}

export type DictationPhase = 'idle' | 'recording' | 'finishing';

export interface DictationShape {
  readonly phase: Effect.Effect<DictationPhase>;
  readonly toggle: Effect.Effect<void>;
  readonly finish: Effect.Effect<void>;
  readonly cancel: Effect.Effect<void>;
}

export class Dictation extends Context.Service<Dictation, DictationShape>()('machete/Dictation') {
  static readonly layer = Layer.effect(
    Dictation,
    Effect.gen(function* () {
      const helper = yield* NativeHelper;
      const pill = yield* DictationPill;
      const app = yield* AppState;
      const guide = yield* PermissionsGuide;
      const phase = yield* Ref.make<DictationPhase>('idle');

      const end = (delay: Duration.Input) =>
        Effect.gen(function* () {
          yield* pill.releaseEscape;
          yield* Effect.sleep(delay);
          yield* pill.hide;
          yield* Ref.set(phase, 'idle');
        });

      const failed = (message: string) =>
        Effect.logWarning(`dictation: ${message}`).pipe(
          Effect.andThen(pill.send({ _tag: 'Failed', message })),
          Effect.andThen(end(Duration.millis(2500))),
        );

      const cancel: Effect.Effect<void> = Effect.gen(function* () {
        if ((yield* Ref.get(phase)) === 'idle') return;
        yield* Ref.set(phase, 'finishing');
        yield* helper.dictateStop(true).pipe(Effect.ignore);
        yield* Effect.logInfo('dictation: cancelled');
        yield* end(Duration.zero);
      });

      const start = Effect.gen(function* () {
        yield* Ref.set(phase, 'recording');
        const front = yield* helper.frontmost.pipe(Effect.orElseSucceed(() => ({ name: '', icon: '' })));
        yield* pill.show(front.name, front.icon);
        yield* pill.captureEscape(cancel);
        const { dictationLanguage } = yield* app.model;
        yield* helper.dictateStart(dictationLanguage).pipe(
          Effect.tap(() => Effect.logInfo(`dictation: start (into ${front.name || '?'})`)),
          Effect.catch((e) => failed(e.message)),
        );
      });

      const finish = Effect.gen(function* () {
        if ((yield* Ref.get(phase)) !== 'recording') return;
        yield* Ref.set(phase, 'finishing');
        yield* pill.send({ _tag: 'Finishing' });
        yield* Effect.gen(function* () {
          const text = yield* helper.dictateStop(false);
          // Hide first: the text must land in the app that had focus, not in the pill.
          yield* pill.hide;
          if (text !== '') {
            yield* helper.paste(text);
            yield* Effect.logInfo(`dictation: typed ${text.length} chars`);
          }
          yield* end(Duration.zero);
        }).pipe(Effect.catch((e) => failed(e.message)));
      });

      // The right ⌘ key needs Input Monitoring. Without it: open the permissions guide once, and keep
      // trying, so it starts working as soon as the permission is granted (⌥D works meanwhile).
      const explained = yield* Ref.make(false);
      const explain = Ref.getAndSet(explained, true).pipe(
        Effect.flatMap((done) => (done ? Effect.void : guide.show)),
      );
      const arm = helper.watchRightCommand.pipe(
        Effect.tapError((e) => (e.message === 'input-monitoring' ? explain : Effect.void)),
        Effect.retry(Schedule.spaced(Duration.seconds(5))),
        Effect.tap(() => Effect.logInfo('dictation: right ⌘ ready')),
        Effect.ignore,
      );
      const watching = yield* FiberHandle.make<void, never>();

      // The helper reports the right ⌘ taps and the voice level; after a restart the watch is armed again.
      const helperEvents = yield* helper.subscribe;
      yield* helperEvents.pipe(
        Stream.runForEach((event) => {
          switch (event.type) {
            case 'rightcmd':
              return Ref.get(phase).pipe(
                Effect.flatMap((p) => (p === 'idle' ? start : p === 'recording' ? finish : Effect.void)),
              );
            case 'dictation.level':
              return pill.send({ _tag: 'Level', level: event.level });
            case 'dictation.error':
              return Effect.logWarning(`dictation: ${event.message}`);
            case 'exit':
              // A recording in progress died with the helper.
              return Ref.get(phase).pipe(
                Effect.flatMap((p) =>
                  p === 'idle' ? Effect.void : failed('Dictation stopped unexpectedly.'),
                ),
              );
            case 'ready':
              return FiberHandle.run(watching, arm).pipe(Effect.asVoid);
            default:
              return Effect.void;
          }
        }),
        Effect.forkScoped,
      );
      if (helper.available) yield* FiberHandle.run(watching, arm);

      return {
        phase: Ref.get(phase),
        toggle: Ref.get(phase).pipe(
          Effect.flatMap((p) => (p === 'idle' ? start : p === 'recording' ? finish : Effect.void)),
        ),
        finish,
        cancel,
      } satisfies DictationShape;
    }),
  );
}
