// Clipboard history's shortcut: ⇧⌘V opens the picker (and closes it).
import { Effect } from 'effect';
import { hotkeys } from '../../../core/electron/Hotkeys';
import { ClipboardPicker } from './PickerWindow';

export const ClipboardHotkeysLive = hotkeys(
  Effect.gen(function* () {
    const picker = yield* ClipboardPicker;
    return [['Shift+CommandOrControl+V', picker.toggle]] as const;
  }),
);
