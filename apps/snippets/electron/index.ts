// What Snippets does in Machete: its shortcuts.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { snippets } from '../app';
import { SnippetsWindow } from './SnippetsWindow';

export const SnippetsApp = runApp(
  snippets,
  Effect.gen(function* () {
    const window = yield* SnippetsWindow;
    return {
      shortcuts: { toggle: window.toggle },
      settings: {},
    };
  }),
);
