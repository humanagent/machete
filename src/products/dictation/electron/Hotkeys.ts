// Dictation's shortcut (the right ⌥ tap is watched by the native helper).
import { Effect } from 'effect';
import { hotkeys } from '../../../core/electron/Hotkeys';
import { Dictation } from '../services/Dictation';

export const DictationHotkeysLive = hotkeys(
  Effect.gen(function* () {
    const dictation = yield* Dictation;
    return [['Alt+D', dictation.toggle]] as const;
  }),
);
