// The copilot's shortcuts.
import { Effect } from 'effect';
import { hotkeys } from '../../../core/electron/Hotkeys';
import { AppState } from '../services/AppState';
import { OverlayWindow } from './OverlayWindow';

export const CopilotHotkeysLive = hotkeys(
  Effect.gen(function* () {
    const app = yield* AppState;
    const overlay = yield* OverlayWindow;
    return [
      ['Alt+Return', app.ask()],
      ['Alt+\\', overlay.toggle],
      ['CommandOrControl+[', overlay.toggle],
      ['Alt+M', app.toggleListening],
      ['Alt+S', app.ask({ preset: 'whatToSay' })],
      ['Alt+R', app.reset],
      ['Alt+Space', overlay.focusInput],
    ] as const;
  }),
);
