// Machete's main process: Electron's lifecycle on the outside, one Effect program inside.
// Every service is a Layer; the program runs from app-ready until quit, and quitting interrupts it so every
// finalizer runs (shortcuts unregistered, the helper finishes transcribing and exits, windows closed).
import { app } from 'electron';
import { Effect, Exit, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { NodeServices } from '@effect/platform-node';
import { DictationMenuLive, DictationPillLive } from '../apps/dictation/electron/PillWindow';
import { RewritePanel } from '../apps/rewrite/electron/RewritePanel';
import { Rewrite } from '../apps/rewrite/services/Rewrite';
import { ScreenshotEditor } from '../apps/screenshot/electron/EditorWindow';
import { ScreenshotPreviews } from '../apps/screenshot/electron/PreviewsWindow';
import { Screenshots } from '../apps/screenshot/services/Screenshots';
import { CalculatorWindow } from '../apps/calculator/electron/CalculatorWindow';
import { Calculator } from '../apps/calculator/services/Calculator';
import { SnippetsWindow } from '../apps/snippets/electron/SnippetsWindow';
import { Snippets } from '../apps/snippets/services/Snippets';
import { ClipboardPicker } from '../apps/clipboard/electron/PickerWindow';
import { ClipboardHistory } from '../apps/clipboard/services/ClipboardHistory';
import { BotsWindow } from '../apps/copilot/electron/BotsWindow';
import { CopilotWindow } from '../apps/copilot/electron/CopilotWindow';
import { PermissionsWindowLive } from './electron/PermissionsWindow';
import { Clipboard, ExternalBrowserLive } from './electron/Platform';
import { appRoot } from './electron/paths';
import { AppsLive } from '../apps/main';
import { Apps } from './electron/Apps';
import { Dock } from './electron/Dock';
import { Hotkeys } from './electron/Hotkeys';
import { SettingsWindow } from './electron/SettingsWindow';
import { StatusMenuLive } from './electron/StatusMenu';
import { AppPaths } from './services/AppPaths';
import { AppState } from '../apps/copilot/services/AppState';
import { Auth } from './services/Auth';
import { ChatGpt } from './services/ChatGpt';
import { ContextFiles } from '../apps/copilot/services/ContextFiles';
import { Dictation } from '../apps/dictation/services/Dictation';
import { FileLoggerLive } from './services/FileLogger';
import { ModifierTaps } from './services/ModifierTaps';
import { NativeHelper } from './services/NativeHelper';
import { PermissionsGuide } from './services/PermissionsGuide';
import { ProfileStore } from '../apps/copilot/services/ProfileStore';
import { Settings } from './services/Settings';

const paths = AppPaths.system();
const PathsLive = Layer.succeed(AppPaths, paths);

const Platform = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, PathsLive);

const Storage = Layer.mergeAll(Settings.layer, ProfileStore.layer);

const Core = AppState.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      ChatGpt.layer,
      ContextFiles.layer,
      ClipboardHistory.layer,
      Snippets.layer,
      Calculator.layer,
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(Auth.layer, NativeHelper.layer(appRoot()))),
  Layer.provideMerge(Layer.mergeAll(Storage, ExternalBrowserLive)),
);

/** What the user sees and presses: the menu bar item and each product's windows and shortcuts. */
const Ui = Layer.mergeAll(AppsLive, StatusMenuLive, DictationMenuLive).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      CopilotWindow.layer,
      ClipboardPicker.layer,
      SnippetsWindow.layer,
      CalculatorWindow.layer,
      RewritePanel.layer,
      ScreenshotPreviews.layer,
    ),
  ),
  Layer.provideMerge(BotsWindow.layer),
  Layer.provideMerge(ScreenshotEditor.layer),
  Layer.provideMerge(Screenshots.layer),
  Layer.provideMerge(Rewrite.layer),
  Layer.provideMerge(Dictation.layer),
  Layer.provideMerge(SettingsWindow.layer),
  Layer.provideMerge(Dock.layer),
  Layer.provideMerge(Apps.layer),
  Layer.provideMerge(Hotkeys.layer),
  Layer.provideMerge(ModifierTaps.layer),
  Layer.provideMerge(Layer.mergeAll(DictationPillLive, Clipboard.layer, PermissionsWindowLive)),
);

/** Checks the ChatGPT session and, if macOS still blocks something, opens the permissions guide. Every panel waits
 * for its shortcut. */
const Startup = Layer.effectDiscard(
  Effect.gen(function* () {
    const state = yield* AppState;
    yield* Effect.logInfo(`app: launch electron=${process.versions.electron}`);
    yield* state.checkLogin;
    const permissions = yield* PermissionsGuide;
    // MACHETE_SETUP=1 always opens the guide (to try it on a Mac that already allows everything).
    yield* process.env['MACHETE_SETUP'] === '1' ? permissions.show : permissions.showIfMissing;
  }),
);

export const MainLive = Startup.pipe(
  Layer.provideMerge(Ui),
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
    const program = Effect.runFork(Layer.launch(MainLive));
    let stopping = false;
    app.on('will-quit', (event) => {
      if (stopping) return;
      stopping = true;
      event.preventDefault();
      // Finalizers get a few seconds (the helper finishes transcribing); quitting must never hang on one.
      void Effect.runPromise(
        Fiber.interrupt(program).pipe(
          Effect.timeoutOrElse({
            duration: '3 seconds',
            orElse: () => Effect.sync(() => process.stderr.write('Machete: shutdown timed out\n')),
          }),
        ),
      ).finally(() => app.exit(0));
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
