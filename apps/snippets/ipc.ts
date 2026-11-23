// IPC contract of the snippets window.
import { Schema } from 'effect';
import { Snippet } from './snippets';

export const SnippetsState = Schema.Struct({
  items: Schema.Array(Snippet),
  /** Bumped on every open, so the window clears its search and selects the first snippet. */
  opened: Schema.Number,
  /** The snippet just created, to select and edit. */
  created: Schema.NullOr(Schema.String),
  /** Typing in other apps needs Input Monitoring; shown as a hint when it's missing. */
  needsPermission: Schema.Boolean,
});
export type SnippetsState = typeof SnippetsState.Type;

export const SnippetsCommand = Schema.TaggedUnion({
  Paste: { id: Schema.String },
  Add: {},
  Update: { id: Schema.String, abbreviation: Schema.String, content: Schema.String },
  Remove: { id: Schema.String },
  ImportMac: {},
  Permissions: {},
  Close: {},
});
export type SnippetsCommand = typeof SnippetsCommand.Type;

export interface SnippetsBridge {
  readonly onState: (listener: (state: SnippetsState) => void) => () => void;
  readonly send: (command: SnippetsCommand) => void;
}
