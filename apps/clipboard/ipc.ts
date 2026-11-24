// IPC contract of the clipboard picker.
import { Schema } from 'effect';

export const ClipboardState = Schema.Struct({
  items: Schema.Array(Schema.String),
  /** Bumped on every open, so the picker clears its search and selects the first entry. */
  opened: Schema.Number,
});
export type ClipboardState = typeof ClipboardState.Type;

export const ClipboardCommand = Schema.TaggedUnion({
  /** Pastes the entry into the app you're in. */
  Paste: { text: Schema.String },
  /** Makes it the last thing copied, for the next ⌘V. */
  Copy: { text: Schema.String },
  Remove: { text: Schema.String },
  Close: {},
});
export type ClipboardCommand = typeof ClipboardCommand.Type;

export interface ClipboardBridge {
  readonly onState: (listener: (state: ClipboardState) => void) => () => void;
  readonly send: (command: ClipboardCommand) => void;
}
