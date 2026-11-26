// The copilot's model: transcript, exchanges, bots and what its panel renders.
import { Schema } from 'effect';
import { Speaker } from '../../core/domain';

export const TranscriptLine = Schema.Struct({
  id: Schema.String,
  speaker: Speaker,
  text: Schema.String,
  /** Seconds since the recording started. */
  offset: Schema.Number,
});
export type TranscriptLine = typeof TranscriptLine.Type;

/** A recording as the list shows it. */
export const SessionSummary = Schema.Struct({
  id: Schema.String,
  /** ChatGPT names it once it's saved; until then (or signed out) it is empty. */
  title: Schema.String,
  /** Epoch ms when recording started. */
  startedAt: Schema.Number,
  /** Seconds recorded. */
  seconds: Schema.Number,
});
export type SessionSummary = typeof SessionSummary.Type;

/** A recording with everything said in it. */
export const Session = Schema.Struct({ ...SessionSummary.fields, lines: Schema.Array(TranscriptLine) });
export type Session = typeof Session.Type;

/** What the card shows: the chat, the list of recordings, or one of them. */
export const Page = Schema.Literals(['chat', 'sessions', 'session']);
export type Page = typeof Page.Type;

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

/** Everything the copilot renders. The renderer is a pure view of this value. */
export const CopilotState = Schema.Struct({
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
  page: Page,
  sessions: Schema.Array(SessionSummary),
  /** The recording open on the 'session' page. */
  session: Schema.NullOr(Session),
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
  followMode: Schema.Boolean,
  followBusy: Schema.Boolean,
  unseenFollow: Schema.Number,
  currentProfileName: Schema.String,
  focusInputTick: Schema.Number,
});
export type CopilotState = typeof CopilotState.Type;

export const BotsState = Schema.Struct({
  profiles: Schema.Array(Profile),
  selectedProfileID: Schema.String,
});
export type BotsState = typeof BotsState.Type;
