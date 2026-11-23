// What Copilot does in Machete: its shortcuts and settings.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { Languages } from '../../../core/domain';
import { copilot } from '../app';
import { AppState, currentProfile } from '../services/AppState';
import { CopilotWindow } from './CopilotWindow';
import { BotsWindow } from './BotsWindow';

const PANEL = ['0.35', '0.55', '0.8'] as const;

export const CopilotApp = runApp(
  copilot,
  Effect.gen(function* () {
    const app = yield* AppState;
    const window = yield* CopilotWindow;
    const bots = yield* BotsWindow;
    const { changes } = app;
    return {
      shortcuts: {
        toggle: window.toggle,
        ask: app.ask(),
        say: app.ask({ preset: 'whatToSay' }),
        type: window.focusInput,
        listen: app.toggleListening,
        new: app.reset,
      },
      settings: {
        account: {
          get: Effect.map(app.model, (m) => ({
            hint: m.directSignedIn
              ? 'Signed in. Answers use your plan.'
              : 'Copilot, Rewrite and Dictation’s cleanup use your plan.',
            button: m.directSignedIn ? 'Sign out' : m.signingIn ? 'Finish in your browser…' : 'Sign in',
          })),
          run: app.model.pipe(Effect.flatMap((m) => (m.directSignedIn ? app.signOut : app.login))),
          changes,
        },
        model: {
          get: Effect.map(app.model, (m) => ({
            value: m.model,
            options: m.models.map((x) => [x.slug, x.name] as const),
          })),
          set: (slug) => app.setModel(String(slug)),
          changes,
        },
        autoAnswer: {
          get: Effect.map(app.model, (m) => ({ value: m.autoAnswer })),
          set: (on) => app.setAutoAnswer(on === true),
          changes,
        },
        language: {
          get: Effect.map(app.model, (m) => ({ value: m.language })),
          set: (value) => {
            const language = Languages.find(([id]) => id === value)?.[0];
            return language ? app.setLanguage(language) : Effect.void;
          },
          changes,
        },
        panel: {
          get: Effect.map(app.model, (m) => ({
            value: PANEL.find((v) => Math.abs(Number(v) - m.glassOpacity) < 0.01) ?? '0.55',
          })),
          set: (value) => {
            const opacity = PANEL.find((v) => v === value);
            return opacity ? app.setGlassOpacity(Number(opacity)) : Effect.void;
          },
          changes,
        },
        bots: {
          get: Effect.map(app.model, (m) => ({ hint: `In use: ${currentProfile(m)?.name ?? 'none'}.` })),
          run: bots.toggle,
          changes,
        },
      },
    };
  }),
);
