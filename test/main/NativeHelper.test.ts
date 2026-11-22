import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer, Option, type Scope, Stream } from 'effect';
import {
  helperBinary,
  type HelperEvent,
  NativeHelper,
  parseLine,
} from '../../src/main/services/NativeHelper';
import { withTempDir } from '../support/fakes';

describe('parseLine', () => {
  test('replies carry their id and body', () => {
    expect(parseLine('{"id":3,"ok":true,"text":"hi"}')).toEqual(
      Option.some({ _tag: 'Reply', id: 3, body: { id: 3, ok: true, text: 'hi' } }),
    );
  });
  test('events are validated', () => {
    expect(parseLine('{"type":"commit","speaker":"them","text":"Hi?"}')).toEqual(
      Option.some({ _tag: 'Event', event: { type: 'commit', speaker: 'them', text: 'Hi?' } }),
    );
    expect(parseLine('{"type":"commit","speaker":"robot","text":"x"}')).toEqual(Option.none());
    expect(parseLine('{"type":"rightoption"}')).toEqual(
      Option.some({ _tag: 'Event', event: { type: 'rightoption' } }),
    );
  });
  test('garbage is ignored', () => {
    expect(parseLine('not json')).toEqual(Option.none());
    expect(parseLine('{"what":1}')).toEqual(Option.none());
  });
});

test('without the helper every call explains why', async () => {
  const error = await Effect.runPromise(
    Effect.service(NativeHelper).pipe(
      Effect.flatMap((h) => h.captureDataURL()),
      Effect.flip,
      Effect.provide(NativeHelper.layerFrom(Option.none()).pipe(Layer.provide(NodeServices.layer))),
      Effect.scoped,
    ),
  );
  expect(error.message).toContain('need the macOS helper');
});

const binary = helperBinary(process.cwd());
describe.skipIf(Option.isNone(binary))('the real helper (macOS)', () => {
  const layer = NativeHelper.layerFrom(binary).pipe(Layer.provide(NodeServices.layer));

  test('extracts text from a file', async () => {
    const text = await Effect.runPromise(
      withTempDir((dir) =>
        Effect.promise(() => writeFile(join(dir, 'notes.txt'), 'Prefers PostgreSQL.')).pipe(
          Effect.andThen(Effect.service(NativeHelper)),
          Effect.flatMap((h) => h.extractText(join(dir, 'notes.txt'))),
          Effect.provide(layer),
        ),
      ),
    );
    expect(text).toEqual(Option.some('Prefers PostgreSQL.'));
  });

  test('answers requests over the serve protocol', async () => {
    const frontmost = await Effect.runPromise(
      Effect.service(NativeHelper).pipe(
        Effect.flatMap((h) => h.frontmost),
        Effect.provide(layer),
        Effect.scoped,
      ),
    );
    expect(typeof frontmost.name).toBe('string');
  });
});

describe('the serve protocol, against a stand-in helper', () => {
  const fake = Option.some(join(import.meta.dir, '../support/fake-native.ts'));
  const withHelper = <A, E>(
    mode: string,
    f: (h: typeof NativeHelper.Service) => Effect.Effect<A, E, Scope.Scope>,
  ) => {
    process.env['FAKE_NATIVE'] = mode;
    return Effect.runPromise(
      Effect.service(NativeHelper).pipe(
        Effect.flatMap(f),
        Effect.provide(NativeHelper.layerFrom(fake).pipe(Layer.provide(NodeServices.layer))),
        Effect.scoped,
      ),
    );
  };

  test('every request gets its typed reply', async () => {
    const result = await withHelper('ok', (h) =>
      Effect.all({
        capture: h.captureDataURL(),
        pixels: h.fingerprint,
        start: h.dictateStart('es-ES'),
        text: h.dictateStop(false),
        front: h.frontmost,
        paste: h.paste('hola'),
        watch: h.watchRightOption,
        listen: h.startListening('en-US'),
        pause: h.setPaused(true),
        stop: h.stopListening,
      }),
    );
    expect(result.capture).toBe('data:image/jpeg;base64,AAAA');
    expect(result.pixels).toEqual([1, 2, 3]);
    expect(result.text).toBe('hola');
    expect(result.front).toEqual({ name: 'Notes', icon: '' });
  });

  test('events reach subscribers; logs and garbage do not', async () => {
    const events = await withHelper('ok', (h) =>
      Effect.gen(function* () {
        const stream = yield* h.subscribe;
        yield* h.startListening('en-US');
        return yield* stream.pipe(Stream.take(1), Stream.runCollect);
      }),
    );
    expect(events as ReadonlyArray<HelperEvent>).toEqual([{ type: 'commit', speaker: 'them', text: 'Hi?' }]);
  });

  test('a failed reply carries the helper message, or a generic one', async () => {
    expect((await withHelper('fail', (h) => Effect.flip(h.captureDataURL()))).message).toBe('it broke');
    expect((await withHelper('bare', (h) => Effect.flip(h.fingerprint))).message).toBe('Native helper error');
  });

  test('permissions and the System Settings window come from one-shot runs', async () => {
    const got = await withHelper('ok', (h) => Effect.all([h.permissionStatus, h.settingsWindow]));
    expect(got).toEqual([
      {
        microphone: 'granted',
        screen: 'denied',
        accessibility: 'granted',
        inputMonitoring: 'not-determined',
      },
      Option.some({ x: 10, y: 20, width: 700, height: 600 }),
    ]);
    expect(await withHelper('fail', (h) => h.settingsWindow)).toEqual(Option.none());
  });

  test('without the helper, permissions explain why', async () => {
    const error = await Effect.runPromise(
      Effect.service(NativeHelper).pipe(
        Effect.flatMap((h) => Effect.flip(h.permissionStatus)),
        Effect.provide(NativeHelper.layerFrom(Option.none()).pipe(Layer.provide(NodeServices.layer))),
        Effect.scoped,
      ),
    );
    expect(error.message).toContain('need the macOS helper');
  });

  test('a helper that dies is restarted, and says so with a ready event', async () => {
    process.env['FAKE_NATIVE_CRASH'] = '1';
    try {
      const result = await withHelper('ok', (h) =>
        Effect.gen(function* () {
          const events = yield* h.subscribe;
          const first = yield* h.frontmost;
          const seen = yield* events.pipe(
            Stream.filter((e) => e.type === 'exit' || e.type === 'ready'),
            Stream.take(2),
            Stream.runCollect,
          );
          const second = yield* h.frontmost;
          return { first, seen, second };
        }),
      );
      expect(result.first.name).toBe('Notes');
      expect(result.seen as ReadonlyArray<HelperEvent>).toEqual([{ type: 'exit' }, { type: 'ready' }]);
      expect(result.second.name).toBe('Notes');
    } finally {
      delete process.env['FAKE_NATIVE_CRASH'];
    }
  }, 15_000);

  test('a reply of the wrong shape is an error, not a crash', async () => {
    expect((await withHelper('garbled', (h) => Effect.flip(h.fingerprint))).message).toBe(
      'fingerprint: unexpected reply',
    );
  });
});

// Real speech models: slow and they download on first use, so only on a developer Mac.
describe.skipIf(Option.isNone(binary) || process.env['CI'] !== undefined)(
  'real transcription (macOS 26)',
  () => {
    test('Latin American Spanish comes out word for word, punctuated', async () => {
      const text = await Effect.runPromise(
        withTempDir((dir) =>
          Effect.promise(async () => {
            const audio = join(dir, 'es.aiff');
            await Bun.$`say -v Paulina -o ${audio} ${'Necesito que revises el contrato antes del viernes.'}`.quiet();
            const exe = Option.getOrThrow(binary);
            return (await Bun.$`${exe} transcribe ${audio} es-419`.quiet().text())
              .split('\n')
              .filter((l) => l !== '' && !l.startsWith('{'))
              .join(' ');
          }),
        ),
      );
      expect(text).toBe('Necesito que revises el contrato antes del viernes.');
    }, 60_000);
  },
);
