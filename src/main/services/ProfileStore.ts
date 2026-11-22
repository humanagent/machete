// Bots in <support>/profiles.json: [{ id: "UPPERCASE-UUID", name, instructions, context }].
import { randomUUID } from 'node:crypto';
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect';
import { Profile } from '../../shared/domain';
import { upgradeProfiles } from '../../shared/logic';
import { Strings } from '../../shared/strings';
import type { StorageError } from '../errors';
import { AppPaths } from './AppPaths';
import { readJson, writeJson } from './JsonFile';

/** Older files may lack fields; read what is there. */
const StoredProfile = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
});
const StoredProfiles = Schema.Array(StoredProfile);
const Profiles = Schema.Array(Profile);

export const newProfileID = (): string => randomUUID().toUpperCase();

export const defaultProfiles = (): ReadonlyArray<Profile> =>
  Strings.defaultProfiles.map((p) => ({
    id: newProfileID(),
    name: p.name,
    instructions: p.instructions,
    context: '',
  }));

export interface ProfileStoreShape {
  readonly load: Effect.Effect<ReadonlyArray<Profile>>;
  readonly save: (profiles: ReadonlyArray<Profile>) => Effect.Effect<void, StorageError>;
}

export class ProfileStore extends Context.Service<ProfileStore, ProfileStoreShape>()('machete/ProfileStore') {
  static readonly layer = Layer.effect(
    ProfileStore,
    Effect.gen(function* () {
      const { profilesFile } = yield* AppPaths;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const provide = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
        eff.pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path));
      return {
        load: provide(readJson(StoredProfiles, profilesFile)).pipe(
          Effect.map((stored) =>
            Option.match(stored, {
              onNone: defaultProfiles,
              onSome: (list) =>
                list.length === 0
                  ? defaultProfiles()
                  : upgradeProfiles(
                      list.map((p) => ({
                        id: p.id,
                        name: p.name ?? '',
                        instructions: p.instructions ?? '',
                        context: p.context ?? '',
                      })),
                    ),
            }),
          ),
        ),
        save: (profiles) => provide(writeJson(Profiles, profilesFile, profiles)),
      } satisfies ProfileStoreShape;
    }),
  );
}
