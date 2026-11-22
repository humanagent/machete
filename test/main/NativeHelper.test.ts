import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer, Option } from 'effect';
import { helperBinary, NativeHelper, parseLine } from '../../src/main/services/NativeHelper';
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
    expect(parseLine('{"type":"rightcmd"}')).toEqual(
      Option.some({ _tag: 'Event', event: { type: 'rightcmd' } }),
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
