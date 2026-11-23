// What Windows does in Machete: its shortcuts and settings.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { NativeHelper } from '../../../core/services/NativeHelper';
import { PermissionsGuide } from '../../../core/services/PermissionsGuide';
import { windows } from '../app';
import type { WindowSnap } from '../domain';

export const WindowsApp = runApp(
  windows,
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
    return { shortcuts: { left: snap('left'), right: snap('right'), full: snap('maximize') } };
  }),
);
