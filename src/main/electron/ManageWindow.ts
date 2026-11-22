// "Machete · Bots": pick a bot, edit its prompt and context, add files to the context.
import { app as electronApp, BrowserWindow, dialog, ipcMain } from 'electron';
import { Context, Effect, Layer, Option, Ref, Schema, Stream } from 'effect';
import { BotsRequest, type BotsReply, Channels } from '../../shared/ipc';
import { AppState, botsState } from '../services/AppState';
import { EXTENSIONS } from '../services/ContextFiles';
import { preloadFile, rendererFile } from './paths';

export interface ManageWindowShape {
  readonly show: Effect.Effect<void>;
}

export class ManageWindow extends Context.Service<ManageWindow, ManageWindowShape>()('machete/ManageWindow') {
  static readonly layer = Layer.effect(
    ManageWindow,
    Effect.gen(function* () {
      const app = yield* AppState;
      const current = yield* Ref.make<Option.Option<BrowserWindow>>(Option.none());
      const quitting = yield* Ref.make(false);

      const create = Effect.gen(function* () {
        const win = new BrowserWindow({
          width: 820,
          height: 560,
          title: 'Machete · Bots',
          show: false,
          minimizable: true,
          resizable: true,
          webPreferences: {
            preload: preloadFile('manage'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        void win.loadFile(rendererFile('manage'));
        win.once('ready-to-show', () => {
          win.center();
          win.show();
        });
        // Closing hides it, so edits in progress and the selection survive.
        win.on('close', (event) => {
          if (!Effect.runSync(Ref.get(quitting))) {
            event.preventDefault();
            win.hide();
          }
        });
        yield* Ref.set(current, Option.some(win));
        return win;
      });

      const show = Effect.gen(function* () {
        const existing = yield* Ref.get(current);
        const win = Option.isSome(existing) && !existing.value.isDestroyed() ? existing.value : yield* create;
        if (Option.isSome(existing)) win.show();
        if (process.platform === 'darwin') electronApp.focus({ steal: true });
        win.focus();
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
          Choose: () =>
            reply(
              'Choose',
              Effect.gen(function* () {
                const parent = Option.getOrUndefined(yield* Ref.get(current));
                const options: Electron.OpenDialogOptions = {
                  message: "Add files to this bot's context",
                  properties: ['openFile', 'multiSelections'],
                  filters: [
                    { name: 'Documents', extensions: [...EXTENSIONS] },
                    { name: 'All Files', extensions: ['*'] },
                  ],
                };
                const result = yield* Effect.promise(() =>
                  parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options),
                );
                return result.canceled ? [] : result.filePaths;
              }),
            ),
        });

      const decode = Schema.decodeUnknownEffect(BotsRequest);
      const context = yield* Effect.context<never>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          ipcMain.handle(Channels.botsRequest, (event, raw: unknown) => {
            const win = Option.getOrUndefined(Effect.runSync(Ref.get(current)));
            if (!win || event.sender !== win.webContents) return Promise.reject(new Error('unknown sender'));
            return Effect.runPromiseWith(context)(decode(raw).pipe(Effect.flatMap(handle)));
          }),
        ),
        () => Effect.sync(() => ipcMain.removeHandler(Channels.botsRequest)),
      );

      // Keep the window in sync with bot changes made anywhere (menu, other windows).
      yield* app.changes.pipe(
        Stream.map(botsState),
        Stream.changesWith(
          (a, b) => a.profiles === b.profiles && a.selectedProfileID === b.selectedProfileID,
        ),
        Stream.runForEach((s) =>
          Ref.get(current).pipe(
            Effect.map((w) => {
              if (Option.isSome(w) && !w.value.isDestroyed()) w.value.webContents.send(Channels.botsState, s);
            }),
          ),
        ),
        Effect.forkScoped,
      );

      // On quit the window must really close, or it would block quitting.
      const onBeforeQuit = () => Effect.runSync(Ref.set(quitting, true));
      yield* Effect.acquireRelease(
        Effect.sync(() => electronApp.on('before-quit', onBeforeQuit)),
        () => Effect.sync(() => electronApp.off('before-quit', onBeforeQuit)),
      );

      yield* Effect.addFinalizer(() =>
        Ref.get(current).pipe(
          Effect.map((w) => {
            if (Option.isSome(w) && !w.value.isDestroyed()) {
              w.value.removeAllListeners('close');
              w.value.destroy();
            }
          }),
        ),
      );

      return { show } satisfies ManageWindowShape;
    }),
  );
}
