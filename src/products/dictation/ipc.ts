// IPC contract of the dictation pill.
import { Schema } from 'effect';

// MARK: Dictation pill

export const DictationEvent = Schema.TaggedUnion({
  Show: { app: Schema.String, icon: Schema.String },
  Level: { level: Schema.Number },
  Finishing: {},
  /** Another product using the pill (Rewrite) says what it is doing. */
  Working: { text: Schema.String },
  Failed: { message: Schema.String },
});
export type DictationEvent = typeof DictationEvent.Type;

export const DictationCommand = Schema.TaggedUnion({ OpenMenu: {} });
export type DictationCommand = typeof DictationCommand.Type;

export interface DictationBridge {
  readonly onEvent: (listener: (event: DictationEvent) => void) => () => void;
  readonly send: (command: DictationCommand) => void;
}
