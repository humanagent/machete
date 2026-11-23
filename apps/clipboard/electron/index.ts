// What Clipboard does in Machete: its shortcuts and settings.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { clipboard } from '../app';
import { HISTORY_SIZE } from '../history';
import { ClipboardHistory } from '../services/ClipboardHistory';
import { ClipboardPicker } from './PickerWindow';

export const ClipboardApp = runApp(
  clipboard,
  Effect.gen(function* () {
    const picker = yield* ClipboardPicker;
    const history = yield* ClipboardHistory;
    return {
      shortcuts: { toggle: picker.toggle },
      settings: {
        history: {
          get: Effect.map(history.items, ({ length }) => ({
            hint: length === 0 ? 'Empty.' : `${length} of ${HISTORY_SIZE} texts, kept on this Mac.`,
          })),
          run: Effect.as(history.clear, 'Clipboard history cleared'),
          changes: history.changes,
        },
      },
    };
  }),
);
