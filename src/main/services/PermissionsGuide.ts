// The port for the permissions guide: services ask for it; the Electron window implements it.
import { Context, type Effect } from 'effect';

export interface PermissionsGuideShape {
  /** Opens the guide. */
  readonly show: Effect.Effect<void>;
  /** Opens the guide only when something is still missing. */
  readonly showIfMissing: Effect.Effect<void>;
}

export class PermissionsGuide extends Context.Service<PermissionsGuide, PermissionsGuideShape>()(
  'machete/PermissionsGuide',
) {}
