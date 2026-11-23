import { expect, test } from 'bun:test';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { HelperError } from '../../../core/errors';
import { Snippets } from '../../../apps/snippets/services/Snippets';
import { fakeHelper, filesAt, withTempDir } from '../../support/fakes';

const run = <A>(
  f: (
    snippets: typeof Snippets.Service,
    helper: Effect.Success<ReturnType<typeof fakeHelper>>,
    dir: string,
  ) => Effect.Effect<A, unknown>,
  overrides: Parameters<typeof fakeHelper>[0] = {},
) =>
  Effect.runPromise(
    withTempDir((dir) =>
      Effect.scoped(
        Effect.gen(function* () {
          const helper = yield* fakeHelper(overrides);
          return yield* Effect.gen(function* () {
            return yield* f(yield* Snippets, helper, dir);
          }).pipe(
            Effect.provide(Snippets.layer.pipe(Layer.provide(Layer.mergeAll(helper.layer, filesAt(dir))))),
          );
        }),
      ),
    ).pipe(Effect.orDie),
  );

test('every change reaches the helper and snippets.json (private)', async () => {
  const mode = await run((snippets, helper, dir) =>
    Effect.gen(function* () {
      expect(helper.log.calls).toEqual(['snippets.set:']);
      const id = yield* snippets.add;
      yield* snippets.update(id, ';sig', 'Saludos');
      expect(helper.log.calls.at(-1)).toBe('snippets.set:;sig');
      yield* snippets.remove(id);
      expect(helper.log.calls.at(-1)).toBe('snippets.set:');
      return (yield* Effect.promise(() => stat(join(dir, 'snippets.json')))).mode & 0o777;
    }),
  );
  expect(mode).toBe(0o600);
});

test('pasting types the text; importing from macOS skips abbreviations already there', async () => {
  await run((snippets, helper) =>
    Effect.gen(function* () {
      const id = yield* snippets.add;
      yield* snippets.update(id, 'gg', 'hola');
      yield* snippets.paste(id);
      expect(helper.log.typed).toEqual(['hola']);
      expect(yield* snippets.importMac).toBe(1);
      expect(yield* snippets.importMac).toBe(0);
      expect((yield* snippets.items).map((s) => s.abbreviation)).toEqual(['gg', 'omw']);
    }),
  );
});

test('without Input Monitoring it says so; a helper restart sends the snippets again', async () => {
  let sent = 0;
  await run(
    (snippets, helper) =>
      Effect.gen(function* () {
        expect(yield* snippets.needsPermission).toBe(true);
        yield* helper.emit({ type: 'ready' });
        yield* Effect.sleep('20 millis');
        expect(sent).toBe(2);
      }),
    {
      setSnippets: () =>
        Effect.sync(() => void sent++).pipe(
          Effect.andThen(Effect.fail(new HelperError({ message: 'input-monitoring' }))),
        ),
    },
  );
});
