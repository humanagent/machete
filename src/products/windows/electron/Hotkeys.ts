// Windows: ⌃A / ⌃D / ⌃W put the focused window on the left half, the right half or the whole screen.
// They take these keys from every app. Without Accessibility the permissions guide opens.
import { Effect } from 'effect';
import { hotkeys } from '../../../core/electron/Hotkeys';
import { NativeHelper } from '../../../core/services/NativeHelper';
import { PermissionsGuide } from '../../../core/services/PermissionsGuide';
import type { WindowSnap } from '../domain';

export const WindowsHotkeysLive = hotkeys(
  Effect.gen(function* () {
    const helper = yield* NativeHelper;
    const guide = yield* PermissionsGuide;
    const snap = (to: WindowSnap) =>
      helper
        .snapWindow(to)
        .pipe(
          Effect.catch((e) =>
            e.message === 'accessibility' ? guide.show : Effect.logInfo(`windows: snap ${to}: ${e.message}`),
          ),
        );
    return [
      ['Control+A', snap('left')],
      ['Control+D', snap('right')],
      ['Control+W', snap('maximize')],
    ] as const;
  }),
);
