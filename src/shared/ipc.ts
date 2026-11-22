// The IPC contract between the main process and each window. Every message is a Schema-validated value:
// the main process decodes what renderers send before acting on it.
import { Schema } from 'effect';
import { BotsState, OverlayState, ProfileFields } from './domain';
import { PermissionKey, PermissionsSnapshot } from './permissions';

export { Channels } from './channels';

// MARK: Overlay

export const OverlayCommand = Schema.TaggedUnion({
  Layout: { width: Schema.Number, height: Schema.Number },
  /** Press-and-move anywhere on the panel moves it: where the drag started, then how far it went. */
  DragStart: {},
  DragMove: { dx: Schema.Number, dy: Schema.Number },
  SetQuestion: { question: Schema.String },
  Ask: { question: Schema.String },
  Collapse: {},
  ToggleFollow: {},
  ToggleCapture: {},
  ToggleListening: {},
  ToggleTranscript: {},
  Reset: {},
  Login: {},
  SetCardHeight: { height: Schema.Number, persist: Schema.Boolean },
  Copy: { text: Schema.String },
  BotsMenu: { x: Schema.Number, y: Schema.Number },
});
export type OverlayCommand = typeof OverlayCommand.Type;

/** What the overlay preload exposes as `window.machete`. */
export interface OverlayBridge {
  readonly onState: (listener: (state: OverlayState) => void) => () => void;
  readonly send: (command: OverlayCommand) => void;
}

// MARK: Bots window

export const BotsRequest = Schema.TaggedUnion({
  Get: {},
  Add: {},
  Remove: { id: Schema.String },
  Select: { id: Schema.String },
  Update: { id: Schema.String, fields: ProfileFields },
  AddFiles: { id: Schema.String, files: Schema.Array(Schema.String) },
  Choose: {},
});
export type BotsRequest = typeof BotsRequest.Type;

/** Replies, by request tag. */
export const BotsReply = {
  Get: BotsState,
  Add: Schema.String,
  Remove: Schema.Void,
  Select: Schema.Void,
  Update: Schema.Void,
  AddFiles: Schema.String,
  Choose: Schema.Array(Schema.String),
} as const;
export type BotsReply<T extends BotsRequest['_tag']> = (typeof BotsReply)[T]['Type'];

/** What the Bots preload exposes as `window.bots`. */
export interface BotsBridge {
  readonly request: <R extends BotsRequest>(request: R) => Promise<BotsReply<R['_tag']>>;
  readonly onState: (listener: (state: BotsState) => void) => () => void;
  readonly pathForFile: (file: File) => string;
}

// MARK: Dictation pill

export const DictationEvent = Schema.TaggedUnion({
  Show: { app: Schema.String, icon: Schema.String },
  Level: { level: Schema.Number },
  Finishing: {},
  Failed: { message: Schema.String },
});
export type DictationEvent = typeof DictationEvent.Type;

export const DictationCommand = Schema.TaggedUnion({ OpenMenu: {} });
export type DictationCommand = typeof DictationCommand.Type;

export interface DictationBridge {
  readonly onEvent: (listener: (event: DictationEvent) => void) => () => void;
  readonly send: (command: DictationCommand) => void;
}

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
