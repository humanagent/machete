// The menu bar item: everything the panel does, plus language, transparency, model and account.
import { app as electronApp, Menu, nativeImage, Tray } from 'electron';
import { Effect, Layer, Stream } from 'effect';
import { Languages } from '../../shared/domain';
import { type AppModel, AppState } from '../services/AppState';
import { Dictation } from '../services/Dictation';
import { PermissionsGuide } from '../services/PermissionsGuide';
import { OverlayWindow } from './OverlayWindow';
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
            Menu.buildFromTemplate(menuTemplate(m, { app, overlay, dictation, permissions, run })),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
