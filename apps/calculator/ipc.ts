// IPC contract of the calculator panel.
import { Schema } from 'effect';

export const CalculatorState = Schema.Struct({
  text: Schema.String,
  rates: Schema.Record(Schema.String, Schema.Number),
  /** Bumped on every open, so the panel focuses the end of the sheet. */
  opened: Schema.Number,
  /** Shows up in screen sharing and recordings. Off by default, like the rest of Machete. */
  shared: Schema.Boolean,
});
export type CalculatorState = typeof CalculatorState.Type;

export const CalculatorCommand = Schema.TaggedUnion({
  SetText: { text: Schema.String },
  Copy: { text: Schema.String },
  SetShared: { shared: Schema.Boolean },
  Close: {},
});
export type CalculatorCommand = typeof CalculatorCommand.Type;

export interface CalculatorBridge {
  readonly onState: (listener: (state: CalculatorState) => void) => () => void;
  readonly send: (command: CalculatorCommand) => void;
}
