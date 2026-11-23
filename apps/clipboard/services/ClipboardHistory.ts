// Clipboard history: every text you copy, newest first, kept in clipboard.json (text only, 200 entries).
// The helper reports copies (skipping what password managers mark as concealed); picking one pastes it.
import { Context, Effect, FileSystem, Layer, Option, Path, Stream, SubscriptionRef } from 'effect';
import type { HelperError } from '../../../core/errors';
import { readJson, writeJson } from '../../../core/services/JsonFile';
import { AppPaths } from '../../../core/services/AppPaths';
import { NativeHelper } from '../../../core/services/NativeHelper';
import { ClipboardHistoryFile, forget, remember } from '../history';

export interface ClipboardHistoryShape {
  readonly items: Effect.Effect<ReadonlyArray<string>>;
  readonly changes: Stream.Stream<ReadonlyArray<string>>;
  /** Pastes `text` into the app you're in; it also moves to the top. */
  readonly paste: (text: string) => Effect.Effect<void, HelperError>;
  readonly remove: (text: string) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
}

export class ClipboardHistory extends Context.Service<ClipboardHistory, ClipboardHistoryShape>()(
  'machete/ClipboardHistory',
) {
  static readonly layer = Layer.effect(
    ClipboardHistory,
    Effect.gen(function* () {
      const helper = yield* NativeHelper;
      const { clipboardFile } = yield* AppPaths;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stored = yield* readJson(ClipboardHistoryFile, clipboardFile);
      const items = yield* SubscriptionRef.make<ReadonlyArray<string>>(
        Option.match(stored, { onNone: () => [], onSome: (f) => f.items }),
      );
      const save = (next: ReadonlyArray<string>) =>
        writeJson(ClipboardHistoryFile, clipboardFile, { items: next }, { mode: 0o600, pretty: false }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.catch((e) => Effect.logWarning(`clipboard: ${e.message}`)),
        );
      const change = (f: (items: ReadonlyArray<string>) => ReadonlyArray<string>) =>
        SubscriptionRef.updateAndGet(items, f).pipe(Effect.flatMap(save));

      const watch = helper.watchClipboard.pipe(
        Effect.catch((e) => Effect.logWarning(`clipboard: watch failed: ${e.message}`)),
      );
      // Subscribed before the watch starts, so no copy is missed.
      const events = yield* helper.subscribe;
      yield* Stream.runForEach(events, (event) =>
        event.type === 'clipboard'
          ? change((xs) => remember(xs, event.text))
          : event.type === 'ready'
            ? watch
            : Effect.void,
      ).pipe(Effect.forkScoped);
      if (helper.available) yield* watch;

      return {
        items: SubscriptionRef.get(items),
        changes: SubscriptionRef.changes(items),
        paste: (text) => helper.pasteClip(text).pipe(Effect.andThen(change((xs) => remember(xs, text)))),
        remove: (text) => change((xs) => forget(xs, text)),
        clear: change(() => []),
      } satisfies ClipboardHistoryShape;
    }),
  );
}
