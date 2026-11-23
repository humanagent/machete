// IPC contract of the rewrite panel.
import { Schema } from 'effect';

export const RewriteState = Schema.Struct({
  /** The selected text. */
  text: Schema.String,
  /** Bumped on every open. */
  opened: Schema.Number,
});
export type RewriteState = typeof RewriteState.Type;

export const RewriteCommand = Schema.TaggedUnion({
  Apply: { instruction: Schema.String },
  Close: {},
});
export type RewriteCommand = typeof RewriteCommand.Type;

export interface RewriteBridge {
  readonly onState: (listener: (state: RewriteState) => void) => () => void;
  readonly send: (command: RewriteCommand) => void;
}
