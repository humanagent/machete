// Failures the app knows how to explain. Each carries the exact message shown in the panel.
import { Schema } from 'effect';

/** ChatGPT (sign-in, Responses API, models). `needsSignIn` means the session is gone and sign-in must start over. */
export class ChatGptError extends Schema.TaggedError<ChatGptError>()('ChatGptError', {
  message: Schema.String,
  needsSignIn: Schema.Boolean,
}) {
  static readonly of = (message: string, needsSignIn = false) => new ChatGptError({ message, needsSignIn });
}

/** The macOS helper (capture, transcription, typing, file extraction). */
export class HelperError extends Schema.TaggedError<HelperError>()('HelperError', {
  message: Schema.String,
}) {}

/** Reading or writing the app's own files. */
export class StorageError extends Schema.TaggedError<StorageError>()('StorageError', {
  message: Schema.String,
}) {}

/** An operation that took longer than allowed. */
export class TimeoutError extends Schema.TaggedError<TimeoutError>()('TimeoutError', {
  message: Schema.String,
}) {}

export type AppError = ChatGptError | HelperError | StorageError | TimeoutError;
