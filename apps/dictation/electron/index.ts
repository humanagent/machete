// What Dictation does in Machete: its shortcuts and settings.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { AppState } from '../../copilot/services/AppState';
import { Languages } from '../../../core/domain';
import { dictation } from '../app';
import { Dictation } from '../services/Dictation';

export const DictationApp = runApp(
  dictation,
  Effect.gen(function* () {
    const app = yield* AppState;
    const service = yield* Dictation;
    return {
      shortcuts: { toggle: service.toggle },
      settings: {
        language: {
          get: Effect.map(app.model, (m) => ({ value: m.dictationLanguage })),
          set: (value) => {
            const language = Languages.find(([id]) => id === value)?.[0];
            return language ? app.setDictationLanguage(language) : Effect.void;
          },
          changes: app.changes,
        },
      },
    };
  }),
);
