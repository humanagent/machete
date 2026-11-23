import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { writeJson } from '../../core/services/JsonFile';
import { filesAt, withTempDir } from '../support/fakes';

test('many writes at once: none fails, and the last one is what stays', async () => {
  const text = await Effect.runPromise(
    withTempDir((dir) => {
      const file = join(dir, 'x.json');
      return Effect.forEach(
        Array.from({ length: 40 }, (_, n) => n),
        (n) => writeJson(Schema.Struct({ n: Schema.Number }), file, { n }),
        { concurrency: 'unbounded' },
      ).pipe(Effect.andThen(Effect.promise(() => readFile(file, 'utf8'))), Effect.provide(filesAt(dir)));
    }),
  );
  expect(JSON.parse(text)).toEqual({ n: 39 });
});
