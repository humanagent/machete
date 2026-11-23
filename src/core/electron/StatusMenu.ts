// The menu bar item: everything the panel does, plus language, transparency, model and account.
import { app as electronApp, Menu, nativeImage, Tray } from 'electron';
import { Effect, Layer, Stream } from 'effect';
import { Languages } from '../domain';
import { type AppModel, AppState } from '../../products/copilot/services/AppState';
import { ClipboardPicker } from '../../products/clipboard/electron/PickerWindow';
import { SnippetsWindow } from '../../products/snippets/electron/SnippetsWindow';
import { CalculatorWindow } from '../../products/calculator/electron/CalculatorWindow';
import { ScreenshotPreviews } from '../../products/screenshot/electron/PreviewsWindow';
import { RewritePanel } from '../../products/rewrite/electron/RewritePanel';
import { Rewrite } from '../../products/rewrite/services/Rewrite';
import { Dictation } from '../../products/dictation/services/Dictation';
import { PermissionsGuide } from '../services/PermissionsGuide';
import { OverlayWindow } from '../../products/copilot/electron/OverlayWindow';
import { assetFile } from './paths';
import { makeRunner, type Run } from './Runner';

const TRANSPARENCY: ReadonlyArray<readonly [number, string]> = [
  [0.35, 'More see-through'],
  [0.55, 'Balanced'],
  [0.8, 'Solid'],
];

interface Actions {
  readonly app: typeof AppState.Service;
  readonly overlay: typeof OverlayWindow.Service;
  readonly dictation: typeof Dictation.Service;
  readonly clipboard: typeof ClipboardPicker.Service;
  readonly snippets: typeof SnippetsWindow.Service;
  readonly calculator: typeof CalculatorWindow.Service;
  readonly rewrite: typeof Rewrite.Service;
  readonly rewritePanel: typeof RewritePanel.Service;
  readonly screenshots: typeof ScreenshotPreviews.Service;
  readonly permissions: typeof PermissionsGuide.Service;
  readonly run: Run<never>;
}

export const menuTemplate = (m: AppModel, a: Actions): Array<Electron.MenuItemConstructorOptions> => {
  const check = (label: string, checked: boolean, effect: Effect.Effect<unknown>) =>
    ({ label, type: 'checkbox', checked, click: () => a.run(effect) }) as const;
  return [
    { label: 'Show / Hide  (⌘[)', click: () => a.run(a.overlay.toggle) },
    { label: 'Ask about screen  (⌥↩)', click: () => a.run(a.app.ask()) },
    {
      label: `${m.isListening ? 'Stop' : 'Start'} listening  (⌥M)`,
      click: () => a.run(a.app.toggleListening),
    },
    { label: 'What should I say?  (⌥S)', click: () => a.run(a.app.ask({ preset: 'whatToSay' })) },
    check('Auto-answer questions', m.autoAnswer, a.app.setAutoAnswer(!m.autoAnswer)),
    { label: 'Clear  (⌥R)', click: () => a.run(a.app.reset) },
    { type: 'separator' },
    { label: 'Dictate  (right ⌥ or ⌥D)', click: () => a.run(a.dictation.toggle) },
    { label: 'Fix selected text  (⇧⌘G)', click: () => a.run(a.rewrite.fix) },
    { label: 'Rewrite selected text…  (⌥⇧⌘G)', click: () => a.run(a.rewritePanel.toggle) },
    { label: 'Windows:  ⌃A left · ⌃D right · ⌃W full screen', enabled: false },
    { label: 'Screenshot: full screen  (⇧⌘3)', click: () => a.run(a.screenshots.full) },
    { label: 'Screenshot: area  (⇧⌘4)', click: () => a.run(a.screenshots.area) },
    { label: 'Clipboard history  (⇧⌘V)', click: () => a.run(a.clipboard.toggle) },
    { label: 'Clear clipboard history', click: () => a.run(a.clipboard.clear) },
    { label: 'Snippets  (⇧⌘C)', click: () => a.run(a.snippets.toggle) },
    { label: 'Calculator  (⇧⌘D)', click: () => a.run(a.calculator.toggle) },
    { type: 'separator' },
    {
      label: 'Transcription language',
      submenu: Languages.map(([code, name]) => check(name, m.language === code, a.app.setLanguage(code))),
    },
    {
      label: 'Dictation language',
      submenu: Languages.map(([code, name]) =>
        check(name, m.dictationLanguage === code, a.app.setDictationLanguage(code)),
      ),
    },
    {
      label: 'Transparency',
      submenu: TRANSPARENCY.map(([v, name]) =>
        check(name, Math.abs(m.glassOpacity - v) < 0.01, a.app.setGlassOpacity(v)),
      ),
    },
    {
      label: 'Model',
      submenu: m.models.map((x) => check(x.name, m.model === x.slug, a.app.setModel(x.slug))),
    },
    ...(m.directSignedIn
      ? ([
          { label: 'Signed in with ChatGPT ✓', enabled: false },
          { label: 'Sign out', click: () => a.run(a.app.signOut) },
        ] as const)
      : ([{ label: 'Sign in with ChatGPT…', click: () => a.run(a.app.login) }] as const)),
    { type: 'separator' },
    { label: 'Permissions…', click: () => a.run(a.permissions.show) },
    { label: 'Quit Machete', click: () => electronApp.quit() },
  ];
};

/** The parts of the state the menu shows; it is rebuilt only when one of them changes. */
const menuKey = (m: AppModel) =>
  JSON.stringify([
    m.isListening,
    m.autoAnswer,
    m.language,
    m.dictationLanguage,
    m.glassOpacity,
    m.model,
    m.models,
    m.directSignedIn,
  ]);

export const StatusMenuLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const app = yield* AppState;
    const overlay = yield* OverlayWindow;
    const dictation = yield* Dictation;
    const clipboard = yield* ClipboardPicker;
    const snippets = yield* SnippetsWindow;
    const calculator = yield* CalculatorWindow;
    const rewrite = yield* Rewrite;
    const rewritePanel = yield* RewritePanel;
    const screenshots = yield* ScreenshotPreviews;
    const permissions = yield* PermissionsGuide;
    const run = yield* makeRunner<never>();
    const icon = nativeImage.createFromPath(assetFile('trayTemplate.png'));
    icon.setTemplateImage(true);
    const tray = yield* Effect.acquireRelease(
      Effect.sync(() => new Tray(icon)),
      (t) => Effect.sync(() => t.destroy()),
    );
    tray.setToolTip('Machete');
    yield* app.changes.pipe(
      Stream.changesWith((a, b) => menuKey(a) === menuKey(b)),
      Stream.runForEach((m) =>
        Effect.sync(() =>
          tray.setContextMenu(
            Menu.buildFromTemplate(
              menuTemplate(m, {
                app,
                overlay,
                dictation,
                clipboard,
                snippets,
                calculator,
                rewrite,
                rewritePanel,
                screenshots,
                permissions,
                run,
              }),
            ),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
