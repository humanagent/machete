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
import type { WindowSnap } from '../../apps/windows/domain';
import { Language, Speaker } from '../domain';
import { PermissionsSnapshot, type Rect } from '../permissions';
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
  Schema.Struct({ type: Schema.Literal('modifier'), key: Schema.String }),
  Schema.Struct({ type: Schema.Literal('clipboard'), text: Schema.String }),
  /** Synthetic: the helper process ended (it is restarted a moment later). */
  Schema.Struct({ type: Schema.Literal('exit') }),
  /** Synthetic: the helper is back after a restart; anything armed in it (the modifier keys) must be re-armed. */
  Schema.Struct({ type: Schema.Literal('ready') }),
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
const Selected = Schema.Struct({ text: Schema.String, pid: Schema.Number });
export type Selected = typeof Selected.Type;
const Replaced = Schema.Struct({ pasted: Schema.Boolean });
const Nothing = Schema.Struct({});
const SettingsBounds = Schema.Struct({
  X: Schema.Number,
  Y: Schema.Number,
  Width: Schema.Number,
  Height: Schema.Number,
});

// MARK: Service

export interface NativeHelperShape {
  readonly available: boolean;
  /** Subscribes now (no event is missed from here on); the stream lasts for the caller's scope. */
  readonly subscribe: Effect.Effect<Stream.Stream<HelperEvent>, never, Scope.Scope>;
  readonly captureDataURL: (maxLongSide?: number) => Effect.Effect<string, HelperError>;
  readonly fingerprint: Effect.Effect<ReadonlyArray<number>, HelperError>;
  /** The desktop picture of the screen under the pointer (JPEG data URL). */
  readonly wallpaper: Effect.Effect<string, HelperError>;
  readonly startListening: (locale: Language) => Effect.Effect<void, HelperError>;
  readonly setPaused: (paused: boolean) => Effect.Effect<void>;
  readonly stopListening: Effect.Effect<void>;
  readonly dictateStart: (locale: Language) => Effect.Effect<void, HelperError>;
  readonly dictateStop: (cancel: boolean) => Effect.Effect<string, HelperError>;
  readonly frontmost: Effect.Effect<{ readonly name: string; readonly icon: string }, HelperError>;
  readonly paste: (text: string) => Effect.Effect<void, HelperError>;
  /** Starts the `modifier` events; fails with "input-monitoring". */
  readonly watchModifiers: Effect.Effect<void, HelperError>;
  /** Moves the frontmost app's focused window; fails with "accessibility" or "no-window". */
  readonly snapWindow: (to: WindowSnap) => Effect.Effect<void, HelperError>;
  /** Starts the `clipboard` events (one per new text copy); re-armed after a helper restart. */
  readonly watchClipboard: Effect.Effect<void, HelperError>;
  /** The abbreviations the helper expands as you type; fails with "input-monitoring". */
  readonly setSnippets: (
    items: ReadonlyArray<{ readonly abbreviation: string; readonly content: string }>,
  ) => Effect.Effect<void, HelperError>;
  /** The text selected in the frontmost app; fails with "accessibility", "secure" or "no-selection". */
  readonly readSelection: Effect.Effect<Selected, HelperError>;
  /** Pastes over that selection. False: the app isn't in front anymore (or is a terminal), so it was only copied. */
  readonly replaceSelection: (text: string, pid: number) => Effect.Effect<boolean, HelperError>;
  /** What macOS allows right now (a fresh process each time: the long-lived helper caches these). */
  readonly permissionStatus: Effect.Effect<PermissionsSnapshot, HelperError>;
  /** The frontmost System Settings window, if one is open. */
  readonly settingsWindow: Effect.Effect<Option.Option<Rect>>;
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
        /** stdin of the current helper process; each run gets its own queue. */
        const inbox = yield* Ref.make(yield* Queue.unbounded<string>());
        const offer = (line: string) => Ref.get(inbox).pipe(Effect.flatMap((q) => Queue.offer(q, line)));
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
          const exe = binary.value;
          const started = yield* Deferred.make<void>();
          const runs = yield* Ref.make(0);
          /** One helper process, from spawn until its stdout ends. */
          const runOnce = Effect.gen(function* () {
            const queue = yield* Queue.unbounded<string>();
            yield* Ref.set(inbox, queue);
            // Closing stdin lets the helper stop cleanly (finish transcribing, then exit).
            yield* Effect.addFinalizer(() => Queue.shutdown(queue));
            const handle = yield* spawner.spawn(
              ChildProcess.make(exe, ['serve', '--exclude-pid', String(process.pid)], {
                stdin: {
                  stream: Stream.fromQueue(queue).pipe(
                    Stream.map((l) => `${l}\n`),
                    Stream.encodeText,
                  ),
                },
              }),
            );
            yield* Ref.set(running, true);
            yield* Deferred.succeed(started, undefined);
            if ((yield* Ref.getAndUpdate(runs, (n) => n + 1)) > 0) {
              yield* Effect.logInfo('native: helper restarted');
              yield* PubSub.publish(events, { type: 'ready' });
            }
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
            );
          }).pipe(
            Effect.scoped,
            Effect.ignore,
            Effect.ensuring(
              Effect.gen(function* () {
                yield* Ref.set(running, false);
                yield* Effect.logWarning('native: helper exited');
                yield* failPending('Native helper stopped.');
                yield* PubSub.publish(events, { type: 'exit' });
              }),
            ),
          );
          // Supervised: if the helper dies, it comes back a second later; if it keeps dying, less and less often.
          let wait = 1;
          yield* Effect.suspend(() => {
            const at = Date.now();
            return runOnce.pipe(
              Effect.andThen(
                Effect.suspend(() => {
                  const lasted = Date.now() - at > 30_000;
                  if (lasted) wait = 1;
                  const now = wait;
                  wait = Math.min(60, wait * 2);
                  return Effect.sleep(Duration.seconds(now));
                }),
              ),
            );
          }).pipe(Effect.forever, Effect.forkScoped);
          yield* Deferred.await(started).pipe(Effect.timeout(Duration.seconds(10)), Effect.ignore);
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
            yield* offer(JSON.stringify({ id, cmd, ...fields }));
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
          offer(JSON.stringify({ cmd, ...fields })).pipe(Effect.asVoid);

        const extractText = (file: string) =>
          Option.match(binary, {
            onNone: () => Effect.succeed(Option.none<string>()),
            onSome: (exe) =>
              spawner.string(ChildProcess.make(exe, ['extract', file])).pipe(
                Effect.map(Option.some),
                Effect.catch(() => Effect.succeed(Option.none<string>())),
              ),
          });

        /** Runs a one-shot command of the helper and decodes its JSON output. */
        const oneShot = <S extends Schema.Top>(
          args: ReadonlyArray<string>,
          schema: S,
        ): Effect.Effect<S['Type'], HelperError> =>
          Option.match(binary, {
            onNone: () => Effect.fail(unavailable),
            onSome: (exe) =>
              spawner.string(ChildProcess.make(exe, [...args])).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))),
                Effect.mapError(() => new HelperError({ message: `${args[0]}: no answer from the helper` })),
              ) as Effect.Effect<S['Type'], HelperError>,
          });

        return {
          available: Option.isSome(binary),
          subscribe: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
          captureDataURL: (max = 1440) =>
            request('capture', { max }, Capture).pipe(Effect.map((r) => r.dataURL)),
          wallpaper: request('wallpaper', {}, Capture, Duration.seconds(5)).pipe(
            Effect.map((r) => r.dataURL),
          ),
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
          watchModifiers: request('modifiers.watch', {}, Nothing).pipe(Effect.asVoid),
          setSnippets: (items) => request('snippets.set', { items }, Nothing).pipe(Effect.asVoid),
          readSelection: request('selection.read', {}, Selected, Duration.seconds(5)),
          replaceSelection: (text, pid) =>
            request('selection.replace', { text, pid }, Replaced, Duration.seconds(10)).pipe(
              Effect.map((r) => r.pasted),
            ),
          watchClipboard: request('clipboard.watch', {}, Nothing).pipe(Effect.asVoid),
          snapWindow: (to) =>
            request('window.snap', { to }, Nothing, Duration.seconds(5)).pipe(Effect.asVoid),
          permissionStatus: oneShot(['permissions'], PermissionsSnapshot),
          settingsWindow: oneShot(['settings-window'], SettingsBounds).pipe(
            Effect.map((b) => ({ x: b.X, y: b.Y, width: b.Width, height: b.Height })),
            Effect.option,
          ),
          extractText,
        } satisfies NativeHelperShape;
      }),
    );

  static readonly layer = (appRoot: string) =>
    Layer.unwrap(Effect.sync(() => NativeHelper.layerFrom(helperBinary(appRoot))));
}
