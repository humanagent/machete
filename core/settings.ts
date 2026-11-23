// IPC contract of the Settings window. What can be set comes from the apps' manifests.
import { Schema } from 'effect';

export const SettingsState = Schema.Struct({
  /** Permissions macOS hasn't given yet. */
  missing: Schema.Number,
  hideDock: Schema.Boolean,
  /** Apps whose shortcuts are off. */
  off: Schema.Array(Schema.String),
  /** "<app>.<setting>" as it is now. */
  fields: Schema.Record(
    Schema.String,
    Schema.Struct({
      value: Schema.optional(Schema.Union([Schema.String, Schema.Boolean])),
      hint: Schema.optional(Schema.String),
      button: Schema.optional(Schema.String),
      options: Schema.optional(Schema.Array(Schema.Tuple([Schema.String, Schema.String]))),
    }),
  ),
  hotkeys: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      /** "⇧ ⌘ D"; more than one only with the defaults. */
      labels: Schema.Array(Schema.String),
      changed: Schema.Boolean,
      failed: Schema.Boolean,
    }),
  ),
  /** What the last recording ran into, next to its action. */
  problem: Schema.NullOr(Schema.Struct({ id: Schema.String, text: Schema.String })),
  /** One line about the last action ("Imported 3"). */
  note: Schema.String,
});
export type SettingsState = typeof SettingsState.Type;

export const SettingsCommand = Schema.TaggedUnion({
  Set: { field: Schema.String, value: Schema.Union([Schema.String, Schema.Boolean]) },
  Run: { field: Schema.String },
  Permissions: {},
  HideDock: { on: Schema.Boolean },
  /** An app's shortcuts, on or off. */
  Shortcuts: { app: Schema.String, on: Schema.Boolean },
  /** Recording starts or ends: the shortcuts rest meanwhile. */
  Recording: { on: Schema.Boolean },
  SetHotkey: { id: Schema.String, keys: Schema.String },
  ResetHotkey: { id: Schema.String },
  ResetHotkeys: {},
  Close: {},
});
export type SettingsCommand = typeof SettingsCommand.Type;

export interface SettingsBridge {
  readonly onState: (listener: (state: SettingsState) => void) => () => void;
  readonly send: (command: SettingsCommand) => void;
}
