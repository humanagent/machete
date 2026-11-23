import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { defaultSettings, Settings } from '../../core/services/Settings';
import { filesAt, withTempDir } from '../support/fakes';

/** Runs `f` with a Settings service over a temp folder, after `seed` prepared it. */
const run = <A>(
  f: (settings: typeof Settings.Service, dir: string) => Effect.Effect<A, unknown>,
  seed: (dir: string) => Promise<unknown> = async () => {},
) =>
  Effect.runPromise(
    withTempDir((dir) =>
      Effect.promise(() => seed(dir)).pipe(
        Effect.andThen(
          Effect.service(Settings).pipe(
            Effect.flatMap((settings) => f(settings, dir)),
            Effect.provide(Settings.layer),
            Effect.provide(filesAt(dir)),
          ),
        ),
      ),
    ),
  );

describe('Settings', () => {
  test('defaults when there is no file', async () => {
    expect(await run((s) => s.get)).toEqual(defaultSettings);
  });

  test('reads each key on its own: a bad value keeps its default, the rest load', async () => {
    const got = await run(
      (s) => s.get,
      (dir) =>
        writeFile(
          join(dir, 'settings.json'),
          JSON.stringify({ model: 'gpt-x', cardWidth: 'wide', language: 'es-ES' }),
        ),
    );
    expect(got.model).toBe('gpt-x');
    expect(got.language).toBe('es-ES');
    expect(got.cardWidth).toBe(defaultSettings.cardWidth);
  });

  test('update persists to disk', async () => {
    const saved = await run((s, dir) =>
      s
        .update({ autoAnswer: false, profileID: 'ABC' })
        .pipe(Effect.andThen(Effect.promise(() => readFile(join(dir, 'settings.json'), 'utf8')))),
    );
    expect(JSON.parse(saved)).toMatchObject({
      autoAnswer: false,
      profileID: 'ABC',
      model: defaultSettings.model,
    });
  });
});
test('shortcuts and switches are kept, and older files get their defaults', async () => {
  const [before, after] = await run(
    (s) =>
      Effect.gen(function* () {
        const first = yield* s.get;
        yield* s.update({ hotkeys: { 'calculator.toggle': ['Alt+K'] }, off: ['windows'] });
        return [first, yield* s.get] as const;
      }),
    (dir) => writeFile(join(dir, 'settings.json'), JSON.stringify({ model: 'gpt-x' })),
  );
  expect(before).toMatchObject({ hotkeys: {}, off: [], model: 'gpt-x' });
  expect(after).toMatchObject({ hotkeys: { 'calculator.toggle': ['Alt+K'] }, off: ['windows'] });
});
