// Rewrite's shortcuts: ⇧⌘G fixes the selected text, ⌥⇧⌘G opens the panel with everything else.
import { Effect } from 'effect';
import { hotkeys } from '../../../core/electron/Hotkeys';
import { Rewrite } from '../services/Rewrite';
import { RewritePanel } from './RewritePanel';

export const RewriteHotkeysLive = hotkeys(
  Effect.gen(function* () {
    const rewrite = yield* Rewrite;
    const panel = yield* RewritePanel;
    return [
      ['Shift+CommandOrControl+G', rewrite.fix],
      ['Alt+Shift+CommandOrControl+G', panel.toggle],
    ] as const;
  }),
);
