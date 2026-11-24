// IPC contract of Copilot's panels: its own and the bots'.
import { Schema } from 'effect';
import { BotsState, type CopilotState, ProfileFields, type TranscriptLine } from './domain';

// MARK: Copilot

export const CopilotCommand = Schema.TaggedUnion({
  Layout: { width: Schema.Number, height: Schema.Number },
  /** Press-and-move anywhere on the panel moves it: where the drag started, then how far it went. */
  DragStart: {},
  DragMove: { dx: Schema.Number, dy: Schema.Number },
  SetQuestion: { question: Schema.String },
  Ask: { question: Schema.String },
  Collapse: {},
  ToggleFollow: {},
  ToggleListening: {},
  ToggleTranscript: {},
  Reset: {},
  Login: {},
  SetCardHeight: { height: Schema.Number, persist: Schema.Boolean },
  Copy: { text: Schema.String },
  BotsMenu: { x: Schema.Number, y: Schema.Number },
});
export type CopilotCommand = typeof CopilotCommand.Type;

export interface CopilotKeys {
  readonly ask: string;
  readonly listen: string;
  readonly reset: string;
}

/** A state on its way to the panel: the transcript, by far the largest part, only comes when it changed. */
export type PanelUpdate = Omit<CopilotState, 'lines'> & { readonly lines?: ReadonlyArray<TranscriptLine> };

/** What the copilot preload exposes as `window.machete`. */
export interface CopilotBridge {
  readonly onState: (listener: (state: PanelUpdate) => void) => () => void;
  /** The shortcuts shown on the panel, as signs ("⌥↩"). */
  readonly onKeys: (listener: (keys: CopilotKeys) => void) => () => void;
  readonly send: (command: CopilotCommand) => void;
}

// MARK: Bots

export const BotsRequest = Schema.TaggedUnion({
  Get: {},
  Add: {},
  Remove: { id: Schema.String },
  Select: { id: Schema.String },
  Update: { id: Schema.String, fields: ProfileFields },
  AddFiles: { id: Schema.String, files: Schema.Array(Schema.String) },
  Choose: {},
  Close: {},
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
  Close: Schema.Void,
} as const;
export type BotsReply<T extends BotsRequest['_tag']> = (typeof BotsReply)[T]['Type'];

/** The bots may have changed. */
export interface BotsShown {
  /** Bumped on every open. */
  readonly opened: number;
}

/** What the bots preload exposes as `window.bots`. */
export interface BotsBridge {
  readonly onState: (listener: (state: BotsShown) => void) => () => void;
  readonly request: (request: BotsRequest) => Promise<unknown>;
  readonly pathForFile: (file: File) => string;
}
