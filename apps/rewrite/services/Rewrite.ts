// Rewrite: select text in any app, press the shortcut, and ChatGPT's version replaces it. Text leaves the Mac
// only when you ask. The dictation pill shows the progress; the app's own ⌘Z brings the original back.
import { Context, Duration, Effect, Layer, Option, Ref } from 'effect';
import { AppState } from '../../copilot/services/AppState';
import { Dictation, DictationPill, polishModel } from '../../dictation/services/Dictation';
import { ChatGpt } from '../../../core/services/ChatGpt';
import { NativeHelper, type Selected } from '../../../core/services/NativeHelper';
import { PermissionsGuide } from '../../../core/services/PermissionsGuide';
import { fit, fixInstruction, instructions } from '../presets';

export const MAX_LENGTH = 20_000;
export const TIMEOUT = Duration.seconds(30);
const NOTE = Duration.millis(2000);

const SAYS: Readonly<Record<string, string>> = {
  'no-selection': 'Select some text first',
  secure: "Password fields can't be read",
};

export interface RewriteShape {
  /** The selected text, if there is some; otherwise the pill says why not. */
  readonly select: Effect.Effect<Option.Option<Selected>>;
  readonly apply: (selected: Selected, instruction: string) => Effect.Effect<void>;
  /** Fixes the selected text right away. */
  readonly fix: Effect.Effect<void>;
}

export class Rewrite extends Context.Service<Rewrite, RewriteShape>()('machete/Rewrite') {
  static readonly layer = Layer.effect(
    Rewrite,
    Effect.gen(function* () {
      const helper = yield* NativeHelper;
      const app = yield* AppState;
      const chat = yield* ChatGpt;
      const guide = yield* PermissionsGuide;
      const dictation = yield* Dictation;
      const pill = yield* DictationPill;
      const busy = yield* Ref.make(false);

      /** The pill is dictation's: while it records, Rewrite leaves it alone. */
      const onPill = (effect: Effect.Effect<void>) =>
        dictation.phase.pipe(Effect.flatMap((p) => (p === 'idle' ? effect : Effect.void)));
      const show = onPill(
        helper.frontmost.pipe(
          Effect.orElseSucceed(() => ({ name: '', icon: '' })),
          Effect.flatMap((front) => pill.show(front.name, front.icon)),
        ),
      );
      const say = (text: string) => onPill(pill.send({ _tag: 'Working', text }));
      const hide = onPill(pill.hide);
      const problem = (message: string) =>
        Effect.logInfo(`rewrite: ${message}`).pipe(
          Effect.andThen(
            message === 'accessibility'
              ? guide.show
              : show.pipe(
                  Effect.andThen(onPill(pill.send({ _tag: 'Failed', message: SAYS[message] ?? message }))),
                  Effect.andThen(Effect.sleep(NOTE)),
                  Effect.andThen(hide),
                ),
          ),
        );

      /** One at a time: a second press while working does nothing. */
      const alone = <A>(effect: Effect.Effect<A>, otherwise: A) =>
        Ref.getAndSet(busy, true).pipe(
          Effect.flatMap((was) =>
            was ? Effect.succeed(otherwise) : effect.pipe(Effect.ensuring(Ref.set(busy, false))),
          ),
        );

      const read: Effect.Effect<Option.Option<Selected>> = helper.readSelection.pipe(
        Effect.map(Option.some),
        Effect.catch((e) => problem(e.message).pipe(Effect.as(Option.none<Selected>()))),
      );

      const write = (selected: Selected, instruction: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const m = yield* app.model;
          if (!m.directSignedIn) return yield* problem('Sign in with ChatGPT first');
          if (selected.text.length > MAX_LENGTH) return yield* problem('Too long: select less text');
          yield* show;
          yield* say('Rewriting');
          const reply = yield* chat
            .ask({
              model: polishModel(m),
              instructions: instructions(instruction),
              text: selected.text,
              effort: 'low',
              onText: () => Effect.void,
            })
            .pipe(
              Effect.timeoutOrElse({
                duration: TIMEOUT,
                orElse: () => Effect.fail(new Error('ChatGPT took too long')),
              }),
            );
          if (reply.trim() === '') return yield* problem('ChatGPT sent nothing back');
          const text = fit(selected.text, reply);
          if (text === selected.text) {
            yield* say('Nothing to change');
            yield* Effect.sleep(NOTE);
            return yield* hide;
          }
          const pasted = yield* helper.replaceSelection(text, selected.pid);
          // Lengths only: the text itself never reaches the log.
          yield* Effect.logInfo(
            `rewrite: ${selected.text.length} -> ${text.length} chars (pasted: ${pasted})`,
          );
          if (!pasted) {
            yield* say('Copied: paste it with ⌘V');
            yield* Effect.sleep(NOTE);
          }
          yield* hide;
        }).pipe(Effect.catch((e) => problem(e.message)));

      return {
        select: alone(read, Option.none()),
        apply: (selected, instruction) => alone(write(selected, instruction), undefined),
        fix: alone(
          read.pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (selected) => write(selected, fixInstruction),
              }),
            ),
          ),
          undefined,
        ),
      } satisfies RewriteShape;
    }),
  );
}
