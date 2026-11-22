// The macOS helper (machete-native): screen capture, transcription, dictation and text extraction.
// One long-lived process speaks JSON lines: requests carry an id and get exactly one reply; events have a `type`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  PubSub,
  Queue,
  Ref,
  Schema,
  type Scope,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Language, Speaker } from '../../shared/domain';
import { HelperError } from '../errors';

// MARK: Protocol

export const HelperEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal('partial'), speaker: Speaker, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('commit'), speaker: Speaker, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('error'), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal('stopped') }),
  Schema.Struct({ type: Schema.Literal('log'), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal('dictation.level'), level: Schema.Number }),
  Schema.Struct({ type: Schema.Literal('dictation.error'), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal('rightcmd') }),
  /** Synthetic: the helper process ended. */
  Schema.Struct({ type: Schema.Literal('exit') }),
]);
export type HelperEvent = typeof HelperEvent.Type;

const Reply = Schema.Struct({
  id: Schema.Number,
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
});

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeReply = Schema.decodeUnknownOption(Reply);
const decodeEvent = Schema.decodeUnknownOption(HelperEvent);

export type Incoming =
  | { readonly _tag: 'Reply'; readonly id: number; readonly body: Readonly<Record<string, unknown>> }
  | { readonly _tag: 'Event'; readonly event: HelperEvent };

/** One stdout line of the helper: a reply, an event, or nothing we understand. */
export const parseLine = (line: string): Option.Option<Incoming> =>
  Option.flatMap(decodeLine(line), (json): Option.Option<Incoming> => {
    const reply = decodeReply(json);
    if (Option.isSome(reply)) {
      return Option.some({
        _tag: 'Reply',
        id: reply.value.id,
        body: json as Record<string, unknown>,
      } as const);
    }
    return Option.map(decodeEvent(json), (event) => ({ _tag: 'Event', event }) as const);
  });

const Capture = Schema.Struct({ dataURL: Schema.String });
const Fingerprint = Schema.Struct({ pixels: Schema.Array(Schema.Number) });
const Dictated = Schema.Struct({ text: Schema.String });
const Frontmost = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.String),
});
const Nothing = Schema.Struct({});
const Permissions = Schema.Struct({
  microphone: Schema.Boolean,
  speech: Schema.Boolean,
  screen: Schema.Boolean,
  inputMonitoring: Schema.Boolean,
  accessibility: Schema.Boolean,
});

// MARK: Service

export interface NativeHelperShape {
  readonly available: boolean;
  /** Subscribes now (no event is missed from here on); the stream lasts for the caller's scope. */
  readonly subscribe: Effect.Effect<Stream.Stream<HelperEvent>, never, Scope.Scope>;
  readonly captureDataURL: (maxLongSide?: number) => Effect.Effect<string, HelperError>;
  readonly fingerprint: Effect.Effect<ReadonlyArray<number>, HelperError>;
  readonly startListening: (locale: Language) => Effect.Effect<void, HelperError>;
  readonly setPaused: (paused: boolean) => Effect.Effect<void>;
  readonly stopListening: Effect.Effect<void>;
  readonly dictateStart: (locale: Language) => Effect.Effect<void, HelperError>;
  readonly dictateStop: (cancel: boolean) => Effect.Effect<string, HelperError>;
  readonly frontmost: Effect.Effect<{ readonly name: string; readonly icon: string }, HelperError>;
  readonly paste: (text: string) => Effect.Effect<void, HelperError>;
  readonly watchRightCommand: Effect.Effect<void, HelperError>;
  /** Asks macOS for every permission Machete uses; returns which ones are granted. */
  readonly requestPermissions: Effect.Effect<Readonly<Record<string, boolean>>, HelperError>;
  /** Text of a PDF / Word / RTF / HTML / text file; None when it can't be read. */
  readonly extractText: (file: string) => Effect.Effect<Option.Option<string>>;
}

/** The helper inside the packaged app (Contents/MacOS, same identity as the app), or the development build. */
export const helperBinary = (appRoot: string): Option.Option<string> => {
  if (process.platform !== 'darwin') return Option.none();
  // Set by Electron in packaged apps (Contents/Resources).
  const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
  const candidates = [
    resourcesPath ? join(resourcesPath, '..', 'MacOS', 'machete-native') : '',
    join(appRoot, 'native', 'bin', 'machete-native'),
  ];
  return Option.fromNullishOr(candidates.find((p) => p !== '' && existsSync(p)));
};

const unavailable = new HelperError({
  message: 'Screen capture and transcription need the macOS helper (machete-native).',
});

export class NativeHelper extends Context.Service<NativeHelper, NativeHelperShape>()('machete/NativeHelper') {
  /** Runs the helper at `binary` for the lifetime of the layer. */
  static readonly layerFrom = (binary: Option.Option<string>) =>
    Layer.effect(
      NativeHelper,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const events = yield* PubSub.unbounded<HelperEvent>();
        const pending = yield* Ref.make(
          new Map<number, Deferred.Deferred<Readonly<Record<string, unknown>>, HelperError>>(),
        );
        const nextID = yield* Ref.make(1);
        const inbox = yield* Queue.unbounded<string>();
        const running = yield* Ref.make(false);

        const failPending = (message: string) =>
          Ref.getAndSet(pending, new Map()).pipe(
            Effect.flatMap((map) =>
              Effect.forEach(map.values(), (d) => Deferred.fail(d, new HelperError({ message })), {
                discard: true,
              }),
            ),
          );

        const dispatch = (line: string) =>
          Option.match(parseLine(line), {
            onNone: () => Effect.void,
            onSome: (msg) =>
              msg._tag === 'Reply'
                ? Ref.modify(pending, (map) => {
                    const d = map.get(msg.id);
                    const next = new Map(map);
                    next.delete(msg.id);
                    return [d, next] as const;
                  }).pipe(
                    Effect.flatMap((d) => {
                      if (!d) return Effect.void;
                      const error = msg.body.error;
                      return msg.body.ok === true
                        ? Deferred.succeed(d, msg.body)
                        : Deferred.fail(
                            d,
                            new HelperError({
                              message: typeof error === 'string' ? error : 'Native helper error',
                            }),
                          );
                    }),
                  )
                : msg.event.type === 'log'
                  ? Effect.logInfo(msg.event.message)
                  : PubSub.publish(events, msg.event),
          });

        if (Option.isSome(binary)) {
          const command = ChildProcess.make(binary.value, ['serve', '--exclude-pid', String(process.pid)], {
            stdin: {
              stream: Stream.fromQueue(inbox).pipe(
                Stream.map((l) => `${l}\n`),
                Stream.encodeText,
              ),
            },
          });
          const handle = yield* spawner.spawn(command);
          yield* Ref.set(running, true);
          yield* handle.stderr.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((l) => Effect.logWarning(`native stderr: ${l}`)),
            Effect.ignore,
            Effect.forkScoped,
          );
          yield* handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach(dispatch),
            Effect.ignore,
            Effect.ensuring(
              Effect.gen(function* () {
                yield* Ref.set(running, false);
                yield* Effect.logWarning('native: helper exited');
                yield* failPending('Native helper stopped.');
                yield* PubSub.publish(events, { type: 'exit' });
              }),
            ),
            Effect.forkScoped,
          );
          // Closing stdin lets the helper stop cleanly (finish transcribing, then exit).
          yield* Effect.addFinalizer(() => Queue.shutdown(inbox));
        }

        const request = <S extends Schema.Top>(
          cmd: string,
          fields: Readonly<Record<string, unknown>>,
          schema: S,
          timeout: Duration.Input = Duration.seconds(20),
        ): Effect.Effect<S['Type'], HelperError> =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(running))) return yield* unavailable;
            const id = yield* Ref.getAndUpdate(nextID, (n) => n + 1);
            const reply = yield* Deferred.make<Readonly<Record<string, unknown>>, HelperError>();
            yield* Ref.update(pending, (map) => new Map(map).set(id, reply));
            yield* Queue.offer(inbox, JSON.stringify({ id, cmd, ...fields }));
            const body = yield* Deferred.await(reply).pipe(
              Effect.timeoutOrElse({
                duration: timeout,
                orElse: () => Effect.fail(new HelperError({ message: `${cmd} timed out` })),
              }),
              Effect.ensuring(
                Ref.update(pending, (map) => {
                  const next = new Map(map);
                  next.delete(id);
                  return next;
                }),
              ),
            );
            return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
              Effect.mapError(() => new HelperError({ message: `${cmd}: unexpected reply` })),
            ) as Effect.Effect<S['Type'], HelperError>;
          });

        const send = (cmd: string, fields: Readonly<Record<string, unknown>> = {}) =>
          Queue.offer(inbox, JSON.stringify({ cmd, ...fields })).pipe(Effect.asVoid);

        const extractText = (file: string) =>
          Option.match(binary, {
            onNone: () => Effect.succeed(Option.none<string>()),
            onSome: (exe) =>
              spawner.string(ChildProcess.make(exe, ['extract', file])).pipe(
                Effect.map(Option.some),
                Effect.catch(() => Effect.succeed(Option.none<string>())),
              ),
          });

        return {
          available: Option.isSome(binary),
          subscribe: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
          captureDataURL: (max = 1440) =>
            request('capture', { max }, Capture).pipe(Effect.map((r) => r.dataURL)),
          fingerprint: request('fingerprint', {}, Fingerprint).pipe(Effect.map((r) => r.pixels)),
          startListening: (locale) =>
            request('listen.start', { locale }, Nothing, Duration.minutes(2)).pipe(Effect.asVoid),
          setPaused: (paused) => send('listen.pause', { paused }),
          stopListening: request('listen.stop', {}, Nothing, Duration.minutes(1)).pipe(Effect.ignore),
          dictateStart: (locale) =>
            request('dictate.start', { locale }, Nothing, Duration.minutes(1)).pipe(Effect.asVoid),
          dictateStop: (cancel) =>
            request('dictate.stop', { cancel }, Dictated, Duration.minutes(1)).pipe(
              Effect.map((r) => r.text),
            ),
          frontmost: request('frontmost', {}, Frontmost).pipe(
            Effect.map((r) => ({ name: r.name ?? '', icon: r.icon ?? '' })),
          ),
          paste: (text) => request('paste', { text }, Nothing, Duration.seconds(10)).pipe(Effect.asVoid),
          watchRightCommand: request('rightcmd.watch', {}, Nothing).pipe(Effect.asVoid),
          requestPermissions: request('permissions.request', {}, Permissions, Duration.minutes(5)).pipe(
            Effect.map(({ microphone, speech, screen, inputMonitoring, accessibility }) => ({
              microphone,
              speech,
              screen,
              inputMonitoring,
              accessibility,
            })),
          ),
          extractText,
        } satisfies NativeHelperShape;
      }),
    );

  static readonly layer = (appRoot: string) =>
    Layer.unwrap(Effect.sync(() => NativeHelper.layerFrom(helperBinary(appRoot))));
}
