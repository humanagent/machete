// Machete's main process: Electron's lifecycle on the outside, one Effect program inside.
// Every service is a Layer; the program runs from app-ready until quit, and quitting interrupts it so every
// finalizer runs (shortcuts unregistered, the helper finishes transcribing and exits, windows closed).
import { app } from 'electron';
import { Effect, Exit, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { NodeServices } from '@effect/platform-node';
import { DictationMenuLive, DictationPillLive } from './products/dictation/electron/PillWindow';
import { CopilotHotkeysLive } from './products/copilot/electron/Hotkeys';
import { DictationHotkeysLive } from './products/dictation/electron/Hotkeys';
import { WindowsHotkeysLive } from './products/windows/electron/Hotkeys';
import { RewriteHotkeysLive } from './products/rewrite/electron/Hotkeys';
import { RewritePanel } from './products/rewrite/electron/RewritePanel';
import { Rewrite } from './products/rewrite/services/Rewrite';
import { ScreenshotHotkeysLive } from './products/screenshot/electron/Hotkeys';
import { ScreenshotEditor } from './products/screenshot/electron/EditorWindow';
import { ScreenshotPreviews } from './products/screenshot/electron/PreviewsWindow';
import { Screenshots } from './products/screenshot/services/Screenshots';
import { CalculatorHotkeysLive } from './products/calculator/electron/Hotkeys';
import { CalculatorWindow } from './products/calculator/electron/CalculatorWindow';
import { Calculator } from './products/calculator/services/Calculator';
import { SnippetsHotkeysLive } from './products/snippets/electron/Hotkeys';
import { SnippetsWindow } from './products/snippets/electron/SnippetsWindow';
import { Snippets } from './products/snippets/services/Snippets';
import { ClipboardHotkeysLive } from './products/clipboard/electron/Hotkeys';
import { ClipboardPicker } from './products/clipboard/electron/PickerWindow';
import { ClipboardHistory } from './products/clipboard/services/ClipboardHistory';
import { ManageWindow } from './products/copilot/electron/ManageWindow';
import { OverlayWindow } from './products/copilot/electron/OverlayWindow';
import { PermissionsWindowLive } from './core/electron/PermissionsWindow';
import { Clipboard, ExternalBrowserLive } from './core/electron/Platform';
import { appRoot } from './core/electron/paths';
import { StatusMenuLive } from './core/electron/StatusMenu';
import { AppPaths } from './core/services/AppPaths';
import { AppState } from './products/copilot/services/AppState';
import { Auth } from './core/services/Auth';
import { ChatGpt } from './core/services/ChatGpt';
import { ContextFiles } from './products/copilot/services/ContextFiles';
import { Dictation } from './products/dictation/services/Dictation';
import { FileLoggerLive } from './core/services/FileLogger';
import { NativeHelper } from './core/services/NativeHelper';
import { PermissionsGuide } from './core/services/PermissionsGuide';
import { ProfileStore } from './products/copilot/services/ProfileStore';
import { Settings } from './core/services/Settings';

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
const Ui = Layer.mergeAll(
  CopilotHotkeysLive,
  DictationHotkeysLive,
  WindowsHotkeysLive,
  ClipboardHotkeysLive,
  SnippetsHotkeysLive,
  CalculatorHotkeysLive,
  RewriteHotkeysLive,
  ScreenshotHotkeysLive,
  StatusMenuLive,
  DictationMenuLive,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      OverlayWindow.layer,
      ClipboardPicker.layer,
      SnippetsWindow.layer,
      CalculatorWindow.layer,
      RewritePanel.layer,
      ScreenshotPreviews.layer,
    ),
  ),
  Layer.provideMerge(ScreenshotEditor.layer),
  Layer.provideMerge(Screenshots.layer),
  Layer.provideMerge(Rewrite.layer),
  Layer.provideMerge(Dictation.layer),
  Layer.provideMerge(
    Layer.mergeAll(ManageWindow.layer, DictationPillLive, Clipboard.layer, PermissionsWindowLive),
  ),
);

/** Opens the panel, checks the ChatGPT session and, if macOS still blocks something, the permissions guide. */
const Startup = Layer.effectDiscard(
  Effect.gen(function* () {
    const state = yield* AppState;
    const overlay = yield* OverlayWindow;
    yield* Effect.logInfo(`app: launch electron=${process.versions.electron}`);
    yield* overlay.show;
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
    if (process.platform === 'darwin') app.dock?.hide();
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
