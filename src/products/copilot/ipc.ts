// IPC contract of the copilot's windows: the overlay and the Bots window.
import { Schema } from 'effect';
import { BotsState, OverlayState, ProfileFields } from './domain';

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
