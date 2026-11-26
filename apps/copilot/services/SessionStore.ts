// Recordings in <support>/sessions: one `<id>.json` per session with its transcript, and `index.json` listing them
// (newest first) so the list opens without reading every transcript.
import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Semaphore } from 'effect';
import { Session, SessionSummary } from '../domain';
import type { StorageError } from '../../../core/errors';
import { AppPaths } from '../../../core/services/AppPaths';
import { readJson, writeJson } from '../../../core/services/JsonFile';

const Index = Schema.Array(SessionSummary);

export const summaryOf = ({ id, title, startedAt, seconds }: Session): SessionSummary => ({
  id,
  title,
  startedAt,
  seconds,
});

export interface SessionStoreShape {
  readonly list: Effect.Effect<ReadonlyArray<SessionSummary>>;
  readonly get: (id: string) => Effect.Effect<Option.Option<Session>>;
  /** Writes the session: first in the index if new, in its place if not. Returns the new index. */
  readonly save: (session: Session) => Effect.Effect<ReadonlyArray<SessionSummary>, StorageError>;
}

export class SessionStore extends Context.Service<SessionStore, SessionStoreShape>()('machete/SessionStore') {
  static readonly layer = Layer.effect(
    SessionStore,
    Effect.gen(function* () {
      const { sessionsDir } = yield* AppPaths;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const provide = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
        eff.pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path));
      const indexFile = path.join(sessionsDir, 'index.json');
      // Ids are ours (UUIDs), but a file name never comes from anything else.
      const fileOf = (id: string) => path.join(sessionsDir, `${id.replace(/[^\w-]/g, '')}.json`);
      /** The sessions from their own files, newest first: for when the index is missing or unreadable, so one bad
       * index never hides the recordings it listed. */
      const rebuild = provide(
        Effect.gen(function* () {
          const names = yield* fs.readDirectory(sessionsDir).pipe(Effect.orElseSucceed(() => []));
          const found: Array<SessionSummary> = [];
          for (const name of names) {
            if (!name.endsWith('.json') || name === 'index.json') continue;
            const s = yield* readJson(Session, path.join(sessionsDir, name));
            if (Option.isSome(s)) found.push(summaryOf(s.value));
          }
          return found.sort((a, b) => b.startedAt - a.startedAt);
        }),
      );
      const list = provide(readJson(Index, indexFile)).pipe(
        Effect.flatMap(Option.match({ onNone: () => rebuild, onSome: Effect.succeed })),
      );
      // Saving reads the index and writes it back: two at once (a recording saved while the last one is named)
      // would lose one.
      const oneAtATime = (yield* Semaphore.make(1)).withPermits(1);
      return {
        list,
        get: (id) => provide(readJson(Session, fileOf(id))),
        save: (session) =>
          Effect.gen(function* () {
            yield* provide(writeJson(Session, fileOf(session.id), session, { pretty: false }));
            const before = yield* list;
            const summary = summaryOf(session);
            // A new one goes first; one saved again (named) keeps its place.
            const index = before.some((s) => s.id === session.id)
              ? before.map((s) => (s.id === session.id ? summary : s))
              : [summary, ...before];
            yield* provide(writeJson(Index, indexFile, index));
            return index;
          }).pipe(oneAtATime),
      } satisfies SessionStoreShape;
    }),
  );
}
