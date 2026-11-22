// Machete's main process: Electron's lifecycle on the outside, one Effect program inside.
// Every service is a Layer; the program runs from app-ready until quit, and quitting interrupts it so every
// finalizer runs (shortcuts unregistered, the helper finishes transcribing and exits, windows closed).
import { app } from 'electron';
import { Effect, Exit, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { NodeServices } from '@effect/platform-node';
import { DictationMenuLive, DictationPillLive } from './electron/DictationPillWindow';
import { HotkeysLive } from './electron/Hotkeys';
import { ManageWindow } from './electron/ManageWindow';
import { OverlayWindow } from './electron/OverlayWindow';
import { Clipboard, ExternalBrowserLive } from './electron/Platform';
import { appRoot } from './electron/paths';
import { StatusMenuLive } from './electron/StatusMenu';
import { AppPaths } from './services/AppPaths';
import { AppState } from './services/AppState';
import { Auth } from './services/Auth';
import { ChatGpt } from './services/ChatGpt';
import { ContextFiles } from './services/ContextFiles';
import { Dictation } from './services/Dictation';
import { FileLoggerLive } from './services/FileLogger';
import { NativeHelper } from './services/NativeHelper';
import { ProfileStore } from './services/ProfileStore';
import { Settings } from './services/Settings';

const paths = AppPaths.system();
const PathsLive = Layer.succeed(AppPaths, paths);

const Platform = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, PathsLive);

const Storage = Layer.mergeAll(Settings.layer, ProfileStore.layer);

const Core = AppState.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(ChatGpt.layer, ContextFiles.layer)),
  Layer.provideMerge(Layer.mergeAll(Auth.layer, NativeHelper.layer(appRoot()))),
  Layer.provideMerge(Layer.mergeAll(Storage, ExternalBrowserLive)),
);

const Windows = Layer.mergeAll(HotkeysLive, StatusMenuLive, DictationMenuLive).pipe(
  Layer.provideMerge(OverlayWindow.layer),
  Layer.provideMerge(Dictation.layer),
  Layer.provideMerge(Layer.mergeAll(ManageWindow.layer, DictationPillLive, Clipboard.layer)),
);

/** Opens the panel and checks the ChatGPT session once everything is up. */
const Startup = Layer.effectDiscard(
  Effect.gen(function* () {
    const state = yield* AppState;
    const overlay = yield* OverlayWindow;
    yield* Effect.logInfo(`app: launch electron=${process.versions.electron}`);
    yield* state.openPanel;
    yield* overlay.show;
    yield* state.checkLogin;
    // Ask for every permission up front, so Machete is listed in each Privacy & Security pane.
    const helper = yield* NativeHelper;
    yield* helper.requestPermissions.pipe(
      Effect.tap((granted) => Effect.logInfo(`permissions: ${JSON.stringify(granted)}`)),
      Effect.ignore,
      Effect.forkDetach,
    );
  }),
);

export const MainLive = Startup.pipe(
  Layer.provideMerge(Windows),
  Layer.provideMerge(Core),
  Layer.provide(FileLoggerLive),
  Layer.provideMerge(Platform),
);

// Chromium's cache and storage stay out of the app's data folder.
app.setPath('userData', paths.chromiumDir);
app.setName('Machete');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => {
    // A menu bar app keeps running with no windows.
  });
  void app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide();
    const program = Effect.runFork(Layer.launch(MainLive));
    let stopping = false;
    app.on('will-quit', (event) => {
      if (stopping) return;
      stopping = true;
      event.preventDefault();
      void Effect.runPromise(Fiber.interrupt(program)).finally(() => app.exit(0));
    });
    program.addObserver((exit) => {
      if (Exit.isFailure(exit) && !stopping) {
        // A layer failed to start: nothing useful can run.
        process.stderr.write(`Machete failed to start\n`);
        app.exit(1);
      }
    });
  });
}
