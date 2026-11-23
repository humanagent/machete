// User settings in <support>/settings.json. Missing or unknown values fall back to the defaults.
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema } from 'effect';
import { Language } from '../domain';
import { HotkeyChanges } from '../hotkeys';
import type { StorageError } from '../errors';
import { AppPaths } from './AppPaths';
import { readJson, writeJson } from './JsonFile';

export const SettingsData = Schema.Struct({
  glassOpacity: Schema.Number,
  language: Language,
  /** Dictation has its own language: you often dictate in yours while the call is in another. */
  dictationLanguage: Language,
  model: Schema.String,
  cardWidth: Schema.Number,
  cardHeight: Schema.Number,
  autoAnswer: Schema.Boolean,
  profileID: Schema.NullOr(Schema.String),
  siwcHostID: Schema.NullOr(Schema.String),
  siwcClientID: Schema.NullOr(Schema.String),
  /** Apps whose shortcuts are off. */
  off: Schema.Array(Schema.String),
  /** No icon in the Dock. */
  hideDock: Schema.Boolean,
  hotkeys: HotkeyChanges,
});
export type SettingsData = typeof SettingsData.Type;

export const defaultSettings: SettingsData = {
  glassOpacity: 0.55,
  language: 'en-US',
  dictationLanguage: 'es-419',
  model: 'gpt-6.2-sol',
  cardWidth: 640,
  cardHeight: 560,
  autoAnswer: true,
  profileID: null,
  siwcHostID: null,
  siwcClientID: null,
  off: [],
  hideDock: true,
  hotkeys: {},
};

/** Each key is read on its own, so one bad value never resets the others. */
const decodeLenient = (raw: unknown): SettingsData => {
  if (typeof raw !== 'object' || raw === null) return defaultSettings;
  const out: Record<string, unknown> = { ...defaultSettings };
  for (const [key, schema] of Object.entries(SettingsData.fields)) {
    const value = Schema.decodeUnknownOption(schema as Schema.Codec<unknown>)(
      (raw as Record<string, unknown>)[key],
    );
    if (Option.isSome(value)) out[key] = value.value;
  }
  return out as SettingsData;
};

export interface SettingsShape {
  readonly get: Effect.Effect<SettingsData>;
  readonly update: (patch: Partial<SettingsData>) => Effect.Effect<SettingsData, StorageError>;
}

export class Settings extends Context.Service<Settings, SettingsShape>()('machete/Settings') {
  static readonly layer = Layer.effect(
    Settings,
    Effect.gen(function* () {
      const { settingsFile } = yield* AppPaths;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stored = yield* readJson(Schema.Unknown, settingsFile);
      const ref = yield* Ref.make(
        Option.match(stored, { onNone: () => defaultSettings, onSome: decodeLenient }),
      );
      const persist = (data: SettingsData) =>
        writeJson(SettingsData, settingsFile, data).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );
      return {
        get: Ref.get(ref),
        update: (patch) =>
          Ref.updateAndGet(ref, (current) => ({ ...current, ...patch })).pipe(Effect.tap(persist)),
      } satisfies SettingsShape;
    }),
  );
}
