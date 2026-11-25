// Whether screen sharing, screenshots and recordings see each of Machete's panels: the ghost in it changes it.
import { ipcMain } from 'electron';
import { Context, Effect, Layer } from 'effect';
import { Channels } from '../channels';
import { type InvisibilityShape, makeInvisibility } from '../invisibility';

export class Invisibility extends Context.Service<Invisibility, InvisibilityShape>()('machete/Invisibility') {
  static readonly layer = Layer.effect(
    Invisibility,
    Effect.gen(function* () {
      const it = makeInvisibility();
      const onToggle = (event: Electron.IpcMainEvent) => it.toggle(event.sender.id);
      yield* Effect.acquireRelease(
        Effect.sync(() => ipcMain.on(Channels.ghostToggle, onToggle)),
        () => Effect.sync(() => ipcMain.off(Channels.ghostToggle, onToggle)),
      );
      return it;
    }),
  );
}
