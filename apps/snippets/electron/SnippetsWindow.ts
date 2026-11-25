// The snippets panel (⇧⌘C): search your snippets and copy one, or add and edit them.
import { ipcMain } from 'electron';
import { Context, Effect, Layer, Option, Ref, Schema, Stream } from 'effect';
import { Channels } from '../../../core/channels';
import { Invisibility } from '../../../core/electron/Invisibility';
import { Clipboard } from '../../../core/electron/Platform';
import { makePanel } from '../../../core/electron/Panel';
import { makeRunner } from '../../../core/electron/Runner';
import { PermissionsGuide } from '../../../core/services/PermissionsGuide';
import { SnippetsCommand, type SnippetsState } from '../ipc';
import { Snippets } from '../services/Snippets';

export class SnippetsWindow extends Context.Service<
  SnippetsWindow,
  { readonly toggle: Effect.Effect<void> }
>()('machete/SnippetsWindow') {
  static readonly layer = Layer.effect(
    SnippetsWindow,
    Effect.gen(function* () {
      const snippets = yield* Snippets;
      const clipboard = yield* Clipboard;
      const invisibility = yield* Invisibility;
      const guide = yield* PermissionsGuide;
      const run = yield* makeRunner<never>();
      const panel = yield* makePanel('snippets', { width: 800, height: 520 });
      const opened = yield* Ref.make(0);

      const send = (w: Electron.BrowserWindow, created: string | null = null) =>
        Effect.gen(function* () {
          const state: SnippetsState = {
            items: yield* snippets.items,
            opened: yield* Ref.get(opened),
            created,
            needsPermission: yield* snippets.needsPermission,
          };
          if (!w.isDestroyed()) w.webContents.send(Channels.snippetsState, state);
        });
      const sendIfOpen = (created: string | null = null) =>
        panel.visible.pipe(
          Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (w) => send(w, created) })),
        );

      // Nothing is typed anywhere: the panel goes, and ⌘V pastes it where you want.
      const copy = (id: string) =>
        snippets.items.pipe(
          Effect.map((xs) => xs.find((s) => s.id === id)?.content ?? ''),
          Effect.flatMap((text) =>
            text === '' ? Effect.void : clipboard.write(text).pipe(Effect.andThen(panel.hide)),
          ),
        );

      const decode = Schema.decodeUnknownOption(SnippetsCommand);
      const onCommand = (_event: Electron.IpcMainEvent, raw: unknown) =>
        Option.map(decode(raw), (command) =>
          run(
            SnippetsCommand.match(command, {
              Copy: ({ id }) => copy(id),
              Add: () => snippets.add.pipe(Effect.flatMap((id) => sendIfOpen(id))),
              Update: ({ id, abbreviation, content }) => snippets.update(id, abbreviation, content),
              Remove: ({ id }) => snippets.remove(id),
              Permissions: () => panel.hide.pipe(Effect.andThen(guide.show)),
              Close: () => panel.hide,
            }),
          ),
        );
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.snippetsCommand, onCommand)),
        () => Effect.sync(() => ipcMain.off(Channels.snippetsCommand, onCommand)),
      );

      yield* snippets.changes.pipe(
        Stream.runForEach(() => sendIfOpen()),
        Effect.forkScoped,
      );

      return {
        toggle: panel.visible.pipe(
          Effect.flatMap(
            Option.match({
              onSome: () => panel.hide,
              onNone: () =>
                panel.open((w) =>
                  Ref.update(opened, (n) => n + 1).pipe(
                    Effect.tap(() => Effect.sync(() => invisibility.follow(w, 'snippets'))),
                    Effect.andThen(send(w)),
                  ),
                ),
            }),
          ),
        ),
      };
    }),
  );
}
