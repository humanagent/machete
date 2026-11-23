import { expect, test } from 'bun:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { HelperError } from '../../../src/core/errors';
import { ClipboardHistory } from '../../../src/products/clipboard/services/ClipboardHistory';
import { fakeHelper, filesAt, withTempDir } from '../../support/fakes';

const run = <A>(
  f: (
    history: typeof ClipboardHistory.Service,
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
            return yield* f(yield* ClipboardHistory, helper, dir);
          }).pipe(
            Effect.provide(
              ClipboardHistory.layer.pipe(Layer.provide(Layer.mergeAll(helper.layer, filesAt(dir)))),
            ),
          );
        }),
      ),
    ).pipe(Effect.orDie),
  );

const settle = Effect.sleep('20 millis');

test('copies are remembered newest first and saved to clipboard.json', async () => {
  const saved = await run((history, helper, dir) =>
    Effect.gen(function* () {
      expect(helper.log.calls).toContain('clipboard.watch');
      yield* helper.emit({ type: 'clipboard', text: 'uno' });
      yield* helper.emit({ type: 'clipboard', text: 'dos' });
      yield* helper.emit({ type: 'clipboard', text: 'uno' });
      yield* settle;
      expect(yield* history.items).toEqual(['uno', 'dos']);
      return yield* Effect.promise(() => readFile(join(dir, 'clipboard.json'), 'utf8'));
    }),
  );
  expect(JSON.parse(saved)).toEqual({ items: ['uno', 'dos'] });
});

test('pasting an entry moves it to the top; remove and clear forget', async () => {
  await run((history, helper) =>
    Effect.gen(function* () {
      yield* helper.emit({ type: 'clipboard', text: 'a' });
      yield* helper.emit({ type: 'clipboard', text: 'b' });
      yield* settle;
      yield* history.paste('a');
      expect(helper.log.calls).toContain('clipboard.paste:a');
      expect(yield* history.items).toEqual(['a', 'b']);
      yield* history.remove('a');
      expect(yield* history.items).toEqual(['b']);
      yield* history.clear;
      expect(yield* history.items).toEqual([]);
    }),
  );
});

test('the watch is re-armed when the helper restarts', async () => {
  await run((_history, helper) =>
    Effect.gen(function* () {
      yield* helper.emit({ type: 'ready' });
      yield* settle;
      expect(helper.log.calls.filter((c) => c === 'clipboard.watch')).toHaveLength(2);
    }),
  );
});

test('copies still count when the watch or the file fails', async () => {
  await run(
    (history, helper, dir) =>
      Effect.gen(function* () {
        // A folder where the file goes: it can't be written.
        yield* Effect.promise(() => mkdir(join(dir, 'clipboard.json', 'x'), { recursive: true }));
        yield* helper.emit({ type: 'clipboard', text: 'a' });
        yield* settle;
        expect(yield* history.items).toEqual(['a']);
      }),
    { watchClipboard: Effect.fail(new HelperError({ message: 'no helper' })) },
  );
});
