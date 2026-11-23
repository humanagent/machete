// The bots panel: Copilot's bots, one to a row, and the one that's open beside them.
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { Context, Effect, Layer, Option, Ref, Schema, Stream } from 'effect';
import { Channels } from '../../../core/channels';
import { makePanel } from '../../../core/electron/Panel';
import type { BotsState } from '../domain';
import { type BotsReply, BotsRequest, type BotsShown } from '../ipc';
import { AppState, botsState } from '../services/AppState';
import { EXTENSIONS } from '../services/ContextFiles';

const choose = Effect.promise(() => {
  const options: Electron.OpenDialogOptions = {
    message: "Add files to this bot's context",
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents', extensions: [...EXTENSIONS] },
      { name: 'All Files', extensions: ['*'] },
    ],
  };
  const parent = BrowserWindow.getFocusedWindow();
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}).pipe(Effect.map((r) => (r.canceled ? [] : r.filePaths)));

export class BotsWindow extends Context.Service<BotsWindow, { readonly toggle: Effect.Effect<void> }>()(
  'machete/BotsWindow',
) {
  static readonly layer = Layer.effect(
    BotsWindow,
    Effect.gen(function* () {
      const app = yield* AppState;
      const panel = yield* makePanel('bots', { width: 800, height: 520 });
      // It stays while you go get a file or some text for it.
      yield* panel.keepOpen(true);
      const opened = yield* Ref.make(0);

      const send = (w: Electron.BrowserWindow) =>
        Effect.gen(function* () {
          const shown: BotsShown = { opened: yield* Ref.get(opened) };
          if (!w.isDestroyed()) w.webContents.send(Channels.botsState, shown);
        });

      const reply = <T extends BotsRequest['_tag']>(_tag: T, value: Effect.Effect<BotsReply<T>>) => value;
      const handle = (request: BotsRequest): Effect.Effect<unknown> =>
        BotsRequest.match(request, {
          Get: () => reply('Get', app.model.pipe(Effect.map(botsState))),
          Add: () => reply('Add', app.addProfile),
          Remove: ({ id }) => reply('Remove', app.deleteProfile(id)),
          Select: ({ id }) => reply('Select', app.selectProfile(id)),
          Update: ({ id, fields }) => reply('Update', app.updateProfile(id, fields)),
          AddFiles: ({ id, files }) => reply('AddFiles', app.addContextFiles(id, files)),
          Choose: () => reply('Choose', choose),
          Close: () => reply('Close', panel.hide),
        });
      const decode = Schema.decodeUnknownEffect(BotsRequest);
      const context = yield* Effect.context<never>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          ipcMain.handle(Channels.botsRequest, (_event, raw: unknown) =>
            Effect.runPromiseWith(context)(decode(raw).pipe(Effect.flatMap(handle))),
          ),
        ),
        () => Effect.sync(() => ipcMain.removeHandler(Channels.botsRequest)),
      );

      // Another bot chosen from Copilot's menu shows here too. (Answers change the rest of the model all the time.)
      const last = yield* Ref.make<BotsState | null>(null);
      yield* app.changes.pipe(
        Stream.map(botsState),
        Stream.runForEach((now) =>
          Effect.gen(function* () {
            const before = yield* Ref.getAndSet(last, now);
            if (before?.profiles === now.profiles && before.selectedProfileID === now.selectedProfileID)
              return;
            yield* panel.visible.pipe(
              Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: send })),
            );
          }),
        ),
        Effect.forkScoped,
      );

      return {
        toggle: panel.visible.pipe(
          Effect.flatMap(
            Option.match({
              onSome: () => panel.hide,
              onNone: () => panel.open((w) => Ref.update(opened, (n) => n + 1).pipe(Effect.andThen(send(w)))),
            }),
          ),
        ),
      };
    }),
  );
}
