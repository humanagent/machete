// IPC contracts of the floating previews and the editor.
import { Schema } from 'effect';
import { Frame } from './frame';

export const PreviewsState = Schema.Struct({
  shots: Schema.Array(Schema.Struct({ id: Schema.String, thumb: Schema.String })),
});
export type PreviewsState = typeof PreviewsState.Type;

const Id = { id: Schema.String };
export const PreviewsCommand = Schema.TaggedUnion({
  Edit: Id,
  Copy: Id,
  Save: Id,
  /** Another one just like it, to drag it more than once. */
  Duplicate: Id,
  /** Drags the file out, into another app. */
  Drag: Id,
  Close: Id,
});
export type PreviewsCommand = typeof PreviewsCommand.Type;

export interface PreviewsBridge {
  readonly onState: (listener: (state: PreviewsState) => void) => () => void;
  readonly send: (command: PreviewsCommand) => void;
}

export const EditorState = Schema.Struct({
  /** Bumped on every open. */
  opened: Schema.Number,
  /** The screenshot, a PNG data URL. */
  image: Schema.String,
  /** The desktop picture behind the frame; empty when macOS doesn't give one. */
  wallpaper: Schema.String,
  frame: Frame,
});
export type EditorState = typeof EditorState.Type;

export const EditorCommand = Schema.TaggedUnion({
  SetFrame: { frame: Frame },
  /** `png`: the finished picture, a PNG data URL. */
  Copy: { png: Schema.String },
  Save: { png: Schema.String },
  Close: {},
});
export type EditorCommand = typeof EditorCommand.Type;

export interface EditorBridge {
  readonly onState: (listener: (state: EditorState) => void) => () => void;
  readonly send: (command: EditorCommand) => void;
}
