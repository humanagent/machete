// The calculator's sheet (what you typed, kept between opens) and today's currency rates, in calculator.json.
// Rates (units per US dollar) come from open.er-api.com, refreshed at most twice a day; offline, the last ones
// are used.
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { AppPaths } from '../../../core/services/AppPaths';
import { readJson, writeJson } from '../../../core/services/JsonFile';

export const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const STALE_MS = 12 * 60 * 60 * 1000;

const CalculatorFile = Schema.Struct({
  text: Schema.String,
  rates: Schema.Record(Schema.String, Schema.Number),
  /** Epoch ms of the last download. */
  ratesAt: Schema.Number,
});
type CalculatorFile = typeof CalculatorFile.Type;

const RatesReply = Schema.Struct({
  result: Schema.Literal('success'),
  rates: Schema.Record(Schema.String, Schema.Number),
});

export const STARTER = ['# Machete calculator', '$20 in eur - 5%', '20 inches in cm', '15% of 200', ''].join(
  '\n',
);

export interface CalculatorShape {
  readonly get: Effect.Effect<CalculatorFile>;
  readonly setText: (text: string) => Effect.Effect<void>;
  /** Downloads rates when the ones kept are older than 12 hours; returns whether they changed. */
  readonly refreshRates: Effect.Effect<boolean>;
}

export class Calculator extends Context.Service<Calculator, CalculatorShape>()('machete/Calculator') {
  static readonly layer = Layer.effect(
    Calculator,
    Effect.gen(function* () {
      const { calculatorFile } = yield* AppPaths;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const http = yield* HttpClient.HttpClient;
      const stored = yield* readJson(CalculatorFile, calculatorFile);
      const state = yield* Ref.make<CalculatorFile>(
        Option.getOrElse(stored, () => ({ text: STARTER, rates: { USD: 1 }, ratesAt: 0 })),
      );
      const save = Ref.get(state).pipe(
        Effect.flatMap((data) => writeJson(CalculatorFile, calculatorFile, data)),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.catch((e) => Effect.logWarning(`calculator: ${e.message}`)),
      );

      const download = http
        .execute(HttpClientRequest.get(RATES_URL))
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(RatesReply)), Effect.timeout('8 seconds'));

      return {
        get: Ref.get(state),
        setText: (text) => Ref.update(state, (s) => ({ ...s, text })).pipe(Effect.andThen(save)),
        refreshRates: Effect.gen(function* () {
          const { ratesAt } = yield* Ref.get(state);
          if (Date.now() - ratesAt < STALE_MS) return false;
          return yield* download.pipe(
            Effect.flatMap((r) =>
              Ref.update(state, (s) => ({ ...s, rates: r.rates, ratesAt: Date.now() })).pipe(
                Effect.andThen(save),
                Effect.as(true),
              ),
            ),
            Effect.catch((e) => Effect.logWarning(`calculator: rates: ${String(e)}`).pipe(Effect.as(false))),
          );
        }),
      } satisfies CalculatorShape;
    }),
  );
}
