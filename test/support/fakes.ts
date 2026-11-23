// Test doubles and layers shared by the service tests.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer, Option, PubSub, Ref, Stream } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import type { HttpClientRequest } from 'effect/http';
import { AppPaths } from '../../core/services/AppPaths';
import { ExternalBrowser } from '../../core/services/ExternalBrowser';
import { type HelperEvent, NativeHelper, type NativeHelperShape } from '../../core/services/NativeHelper';

/** A fresh support folder per test, deleted afterwards. */
export const withTempDir = <A, E, R>(f: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'machete-test-'))),
    f,
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );

/** Node file system and the app's paths rooted at `dir`. */
export const filesAt = (dir: string) => Layer.mergeAll(NodeServices.layer, AppPaths.layerAt(dir));

export const bodyText = (request: HttpClientRequest.HttpClientRequest): string =>
  request.body._tag === 'Uint8Array' ? new TextDecoder().decode(request.body.body) : '';

/** An HttpClient that answers every request with `respond`, recording what was sent. */
export const fakeHttp = (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response,
  seen: Array<HttpClientRequest.HttpClientRequest> = [],
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        seen.push(request);
        return HttpClientResponse.fromWeb(request, respond(request));
      }),
    ),
  );

export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

export const sse = (events: ReadonlyArray<unknown>) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

export const BrowserNoop = Layer.succeed(ExternalBrowser, { open: () => Effect.void });

export interface HelperCalls {
  readonly calls: Array<string>;
  readonly typed: Array<string>;
}

/** A NativeHelper without the process: canned replies, events pushed by the test. */
export const fakeHelper = (overrides: Partial<NativeHelperShape> = {}) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<HelperEvent>();
    const log: HelperCalls = { calls: [], typed: [] };
    const record = (name: string) => Effect.sync(() => void log.calls.push(name));
    const fingerprint = yield* Ref.make<ReadonlyArray<number>>([0, 0, 0]);
    const service: NativeHelperShape = {
      available: true,
      subscribe: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
      captureDataURL: () => record('capture').pipe(Effect.as('data:image/jpeg;base64,AAAA')),
      fingerprint: Ref.get(fingerprint),
      wallpaper: Effect.succeed('data:image/jpeg;base64,AAAA'),
      startListening: () => record('listen.start'),
      setPaused: (p) => record(`listen.pause:${p}`),
      stopListening: record('listen.stop'),
      dictateStart: () => record('dictate.start'),
      dictateStop: (cancel) => record(`dictate.stop:${cancel}`).pipe(Effect.as(cancel ? '' : 'hola mundo')),
      frontmost: Effect.succeed({ name: 'TextEdit', icon: '' }),
      paste: (text) => Effect.sync(() => void log.typed.push(text)),
      watchModifiers: record('modifiers.watch'),
      snapWindow: (to) => record(`window.snap:${to}`),
      watchClipboard: record('clipboard.watch'),
      setSnippets: (items) => record(`snippets.set:${items.map((s) => s.abbreviation).join(',')}`),
      macTextReplacements: Effect.succeed([{ abbreviation: 'omw', content: 'On my way!' }]),
      readSelection: Effect.succeed({ text: 'hola mudno', pid: 7 }),
      replaceSelection: (text, pid) => record(`selection.replace:${pid}:${text}`).pipe(Effect.as(true)),
      pasteClip: (text) => record(`clipboard.paste:${text}`),
      permissionStatus: Effect.succeed({
        microphone: 'granted',
        screen: 'granted',
        accessibility: 'granted',
        inputMonitoring: 'granted',
      }),
      settingsWindow: Effect.succeedNone,
      extractText: (file) =>
        Effect.promise(() => readFile(file, 'utf8').then(Option.some, () => Option.none<string>())),
      ...overrides,
    };
    return {
      layer: Layer.succeed(NativeHelper, service),
      emit: (event: HelperEvent) => PubSub.publish(events, event),
      setFingerprint: (pixels: ReadonlyArray<number>) => Ref.set(fingerprint, pixels),
      log,
    };
  });

/** Prepares a temp folder with `seed`, then runs `f` with `layer` built over it. */
export const runInTempDir = <A, E, ROut, LE>(
  layer: (dir: string) => Layer.Layer<ROut, LE>,
  f: (dir: string) => Effect.Effect<A, E, ROut>,
  seed: (dir: string) => Promise<unknown> = async () => {},
): Promise<A> =>
  Effect.runPromise(
    withTempDir((dir) =>
      Effect.promise(() => seed(dir)).pipe(Effect.andThen(f(dir).pipe(Effect.provide(layer(dir))))),
    ),
  );
