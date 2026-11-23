// What Snippets does in Machete: its shortcuts and settings.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { snippets } from '../app';
import { Snippets } from '../services/Snippets';
import { SnippetsWindow } from './SnippetsWindow';

export const SnippetsApp = runApp(
  snippets,
  Effect.gen(function* () {
    const window = yield* SnippetsWindow;
    const service = yield* Snippets;
    return {
      shortcuts: { toggle: window.toggle },
      settings: {
        import: {
          get: Effect.map(service.items, ({ length }) => ({
            hint: `${length} ${length === 1 ? 'snippet' : 'snippets'}. Adds the Mac’s own text replacements.`,
          })),
          run: service.importMac.pipe(
            Effect.map((n) => (n === 0 ? 'Nothing new to import' : `Imported ${n}`)),
            Effect.catch((e) => Effect.succeed(`Couldn’t import: ${e.message}`)),
          ),
          changes: service.changes,
        },
      },
    };
  }),
);
