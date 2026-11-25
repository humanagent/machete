// Snippets: abbreviations that become text as you type, in any app, kept in snippets.json (private: it may hold
// passwords). Every change is sent to the helper, which watches the keyboard and does the expanding.
import { randomUUID } from 'node:crypto';
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Stream, SubscriptionRef } from 'effect';
import { AppPaths } from '../../../core/services/AppPaths';
import { readJson, writeJson } from '../../../core/services/JsonFile';
import { NativeHelper } from '../../../core/services/NativeHelper';
import { expansions, type Snippet, SnippetsFile } from '../snippets';

export interface SnippetsShape {
  readonly items: Effect.Effect<ReadonlyArray<Snippet>>;
  readonly changes: Stream.Stream<ReadonlyArray<Snippet>>;
  /** True when macOS doesn't let the helper see the keyboard (Input Monitoring). */
  readonly needsPermission: Effect.Effect<boolean>;
  /** A new, empty snippet; returns its id. */
  readonly add: Effect.Effect<string>;
  readonly update: (id: string, abbreviation: string, content: string) => Effect.Effect<void>;
  readonly remove: (id: string) => Effect.Effect<void>;
}

export class Snippets extends Context.Service<Snippets, SnippetsShape>()('machete/Snippets') {
  static readonly layer = Layer.effect(
    Snippets,
    Effect.gen(function* () {
      const helper = yield* NativeHelper;
      const { snippetsFile } = yield* AppPaths;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stored = yield* readJson(SnippetsFile, snippetsFile);
      const items = yield* SubscriptionRef.make<ReadonlyArray<Snippet>>(
        Option.match(stored, { onNone: () => [], onSome: (f) => f.items }),
      );
      const blocked = yield* Ref.make(false);

      const save = (next: ReadonlyArray<Snippet>) =>
        writeJson(SnippetsFile, snippetsFile, { items: next }, { mode: 0o600 }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.catch((e) => Effect.logWarning(`snippets: ${e.message}`)),
        );
      const sync = (next: ReadonlyArray<Snippet>) =>
        helper.setSnippets(expansions(next)).pipe(
          Effect.andThen(Ref.set(blocked, false)),
          Effect.catch((e) =>
            Ref.set(blocked, e.message === 'input-monitoring').pipe(
              Effect.andThen(Effect.logWarning(`snippets: ${e.message}`)),
            ),
          ),
        );
      const change = (f: (xs: ReadonlyArray<Snippet>) => ReadonlyArray<Snippet>) =>
        SubscriptionRef.updateAndGet(items, f).pipe(Effect.tap(save), Effect.flatMap(sync));

      // The helper forgets the abbreviations when it restarts.
      const events = yield* helper.subscribe;
      yield* Stream.runForEach(events, (event) =>
        event.type === 'ready' ? SubscriptionRef.get(items).pipe(Effect.flatMap(sync)) : Effect.void,
      ).pipe(Effect.forkScoped);
      if (helper.available) yield* SubscriptionRef.get(items).pipe(Effect.flatMap(sync));

      return {
        items: SubscriptionRef.get(items),
        changes: SubscriptionRef.changes(items),
        needsPermission: Ref.get(blocked),
        add: Effect.gen(function* () {
          const id = randomUUID();
          yield* change((xs) => [{ id, abbreviation: '', content: '' }, ...xs]);
          return id;
        }),
        update: (id, abbreviation, content) =>
          change((xs) => xs.map((s) => (s.id === id ? { id, abbreviation, content } : s))),
        remove: (id) => change((xs) => xs.filter((s) => s.id !== id)),
      } satisfies SnippetsShape;
    }),
  );
}
