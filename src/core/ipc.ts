// The IPC contract between the main process and each window. Every message is a Schema-validated value:
// the main process decodes what renderers send before acting on it.
import { Schema } from 'effect';
import { PermissionKey, PermissionsSnapshot } from './permissions';

export { Channels } from './channels';

// MARK: Permissions guide

export const PermissionsState = Schema.Struct({
  status: PermissionsSnapshot,
  /** The permission whose System Settings pane is open, waiting for the drag. */
  guiding: Schema.NullOr(PermissionKey),
  /** Screen Recording takes effect only after a relaunch. */
  needsRestart: Schema.Boolean,
  /** The app's icon as a data URL, for the drag tile. */
  icon: Schema.String,
});
export type PermissionsState = typeof PermissionsState.Type;

export const PermissionsCommand = Schema.TaggedUnion({
  Allow: { key: PermissionKey },
  Drag: {},
  Restart: {},
  Close: {},
});
export type PermissionsCommand = typeof PermissionsCommand.Type;

export interface PermissionsBridge {
  readonly onState: (listener: (state: PermissionsState) => void) => () => void;
  readonly send: (command: PermissionsCommand) => void;
}
