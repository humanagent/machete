// Domain model shared by the main process, the preloads and the renderers.
// Every value that crosses a boundary (disk, IPC, the native helper) is described here as a Schema.
import { Schema } from 'effect';

export const Speaker = Schema.Literals(['me', 'them']);
export type Speaker = typeof Speaker.Type;

export const TranscriptLine = Schema.Struct({
  id: Schema.String,
  speaker: Speaker,
  text: Schema.String,
  /** Seconds since the recording started. */
  offset: Schema.Number,
});
export type TranscriptLine = typeof TranscriptLine.Type;

export const Exchange = Schema.Struct({
  id: Schema.String,
  /** What the bubble shows: the typed question, a preset label or "Assist". */
  ask: Schema.String,
  /** The instruction sent to the model. */
  typed: Schema.String,
  isPreset: Schema.Boolean,
  isFollow: Schema.Boolean,
  answer: Schema.NullOr(Schema.String),
  done: Schema.Boolean,
});
export type Exchange = typeof Exchange.Type;

export const Profile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  instructions: Schema.String,
  context: Schema.String,
});
export type Profile = typeof Profile.Type;

export const ProfileFields = Schema.Struct({
  name: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
});
export type ProfileFields = typeof ProfileFields.Type;

export const Model = Schema.Struct({ slug: Schema.String, name: Schema.String });
export type Model = typeof Model.Type;

export const Language = Schema.Literals(['en-US', 'es-ES', 'es-419']);
export type Language = typeof Language.Type;
export const Languages: ReadonlyArray<readonly [Language, string]> = [
  ['en-US', 'English'],
  ['es-419', 'Español (Latinoamérica)'],
  ['es-ES', 'Español (España)'],
];

/** Everything the overlay renders. The renderer is a pure view of this value. */
export const OverlayState = Schema.Struct({
  question: Schema.String,
  exchanges: Schema.Array(Exchange),
  isThinking: Schema.Boolean,
  status: Schema.String,
  errorText: Schema.NullOr(Schema.String),
  isListening: Schema.Boolean,
  isPaused: Schema.Boolean,
  /** Epoch ms when the current (unpaused) recording segment started. */
  listenStart: Schema.NullOr(Schema.Number),
  /** Seconds recorded before the current segment. */
  recordedBefore: Schema.Number,
  showTranscript: Schema.Boolean,
  lines: Schema.Array(TranscriptLine),
  partialMe: Schema.String,
  partialThem: Schema.String,
  cardOpen: Schema.Boolean,
  collapsed: Schema.Boolean,
  cardVisible: Schema.Boolean,
  cardWidth: Schema.Number,
  cardHeight: Schema.Number,
  glassOpacity: Schema.Number,
  loggedIn: Schema.NullOr(Schema.Boolean),
  signingIn: Schema.Boolean,
  directSignedIn: Schema.Boolean,
  visibleInCapture: Schema.Boolean,
  followMode: Schema.Boolean,
  followBusy: Schema.Boolean,
  unseenFollow: Schema.Number,
  currentProfileName: Schema.String,
  focusInputTick: Schema.Number,
});
export type OverlayState = typeof OverlayState.Type;

export const BotsState = Schema.Struct({
  profiles: Schema.Array(Profile),
  selectedProfileID: Schema.String,
});
export type BotsState = typeof BotsState.Type;
