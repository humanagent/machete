// Schema-checked JSON files, written atomically (temp file + rename).
import { Effect, FileSystem, Option, Path, Schema } from 'effect';
import { StorageError } from '../errors';

/** The decoded file, or None when it doesn't exist or doesn't match the schema. */
export const readJson = <S extends Schema.Top>(schema: S, file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(file).pipe(Effect.option);
    if (Option.isNone(text)) return Option.none<S['Type']>();
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text.value).pipe(Effect.option);
  });

export const writeJson = <S extends Schema.Top>(
  schema: S,
  file: string,
  value: S['Type'],
  options: { readonly mode?: number; readonly pretty?: boolean } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const encoded = yield* Schema.encodeEffect(schema)(value);
    const text = options.pretty === false ? JSON.stringify(encoded) : JSON.stringify(encoded, null, 2);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    yield* fs.writeFileString(tmp, text, options.mode === undefined ? {} : { mode: options.mode });
    if (options.mode !== undefined) yield* fs.chmod(tmp, options.mode);
    yield* fs.rename(tmp, file);
  }).pipe(Effect.mapError((e) => new StorageError({ message: `Could not save ${file}: ${String(e)}` })));
