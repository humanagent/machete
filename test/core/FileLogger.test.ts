import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { AppPaths } from '../../core/services/AppPaths';
import { FileLoggerLive, MAX_LOG_BYTES } from '../../core/services/FileLogger';
import { withTempDir } from '../support/fakes';

const logInto = (logFile: string) =>
  Effect.logInfo('hello', { n: 1 }).pipe(
    Effect.provide(FileLoggerLive.pipe(Layer.provide(Layer.succeed(AppPaths, { logFile } as never)))),
  );

test('log lines land in the log file, creating its folder', async () => {
  const text = await Effect.runPromise(
    withTempDir((dir) => {
      const file = join(dir, 'logs', 'machete.log');
      return logInto(file).pipe(Effect.andThen(Effect.promise(() => readFile(file, 'utf8'))));
    }),
  );
  expect(text).toMatch(/^\d\d:\d\d:\d\d\.\d{3} hello {"n":1}\n$/);
});

test('a log that grew too long starts over, keeping the one before', async () => {
  const [now, before] = await Effect.runPromise(
    withTempDir((dir) => {
      const file = join(dir, 'machete.log');
      return Effect.promise(() => writeFile(file, 'x'.repeat(MAX_LOG_BYTES + 1))).pipe(
        Effect.andThen(logInto(file)),
        Effect.andThen(
          Effect.promise(() => Promise.all([file, `${file}.1`].map((f) => readFile(f, 'utf8')))),
        ),
      );
    }),
  );
  expect(now).toMatch(/ hello {"n":1}\n$/);
  expect(now?.length).toBeLessThan(100);
  expect(before?.length).toBe(MAX_LOG_BYTES + 1);
});

test('a log file that cannot be written never breaks the app', async () => {
  await Effect.runPromise(logInto('/dev/null/nope/machete.log'));
});
