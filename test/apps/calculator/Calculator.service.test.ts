import { expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { Calculator, STARTER } from '../../../apps/calculator/services/Calculator';
import { fakeHttp, filesAt, json, withTempDir } from '../../support/fakes';

const run = <A>(
  respond: () => Response,
  f: (c: typeof Calculator.Service) => Effect.Effect<A, unknown>,
  seen = { n: 0 },
) =>
  Effect.runPromise(
    withTempDir((dir) =>
      Effect.scoped(
        Effect.gen(function* () {
          return yield* f(yield* Calculator);
        }).pipe(
          Effect.provide(
            Calculator.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  filesAt(dir),
                  fakeHttp(() => {
                    seen.n++;
                    return respond();
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    ).pipe(Effect.orDie),
  );

test('starts with an example sheet and keeps what you type', async () => {
  await run(
    () => json({}),
    (c) =>
      Effect.gen(function* () {
        expect((yield* c.get).text).toBe(STARTER);
        yield* c.setText('2 + 2');
        expect((yield* c.get).text).toBe('2 + 2');
      }),
  );
});

test('rates are downloaded once, then reused until they get old', async () => {
  const seen = { n: 0 };
  await run(
    () => json({ result: 'success', rates: { USD: 1, ARS: 1500 } }),
    (c) =>
      Effect.gen(function* () {
        expect(yield* c.refreshRates).toBe(true);
        expect((yield* c.get).rates['ARS']).toBe(1500);
        expect(yield* c.refreshRates).toBe(false);
      }),
    seen,
  );
  expect(seen.n).toBe(1);
});

test('offline, the rates kept are used', async () => {
  await run(
    () => new Response('nope', { status: 500 }),
    (c) =>
      Effect.gen(function* () {
        expect(yield* c.refreshRates).toBe(false);
        expect((yield* c.get).rates).toEqual({ USD: 1 });
      }),
  );
});
