// The calculator's shortcut: ⇧⌘D opens the panel (and closes it).
import { Effect } from 'effect';
import { hotkeys } from '../../../core/electron/Hotkeys';
import { CalculatorWindow } from './CalculatorWindow';

export const CalculatorHotkeysLive = hotkeys(
  Effect.gen(function* () {
    const window = yield* CalculatorWindow;
    return [['Shift+CommandOrControl+D', window.toggle]] as const;
  }),
);
