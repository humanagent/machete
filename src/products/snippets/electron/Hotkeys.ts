// Snippets' shortcut: ⇧⌘C opens the panel (and closes it). Abbreviations themselves need no shortcut.
import { Effect } from 'effect';
import { hotkeys } from '../../../core/electron/Hotkeys';
import { SnippetsWindow } from './SnippetsWindow';

export const SnippetsHotkeysLive = hotkeys(
  Effect.gen(function* () {
    const window = yield* SnippetsWindow;
    return [['Shift+CommandOrControl+C', window.toggle]] as const;
  }),
);
