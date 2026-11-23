// The Responses API with the user's ChatGPT plan: streamed answers and the list of usable models.
import { Context, Effect, Layer, Option, Schema, Stream } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import type { Model } from '../domain';
import { ChatGptError } from '../errors';
import { Auth } from './Auth';
import { fromHttpError } from './Network';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const MODELS = 'https://api.openai.com/v1/models';

/** Turns an API error code / status into the sentence shown in the panel. */
export const describe = (
  code: string | null | undefined,
  message: string | null | undefined,
  status: number,
) => {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return ChatGptError.of("You've hit your ChatGPT plan's usage limit for Machete for now.");
    case 'subscription_sharing_invalid_user':
      return ChatGptError.of('ChatGPT session is no longer valid. Sign in again.', true);
    case 'subscription_sharing_user_not_eligible':
      return ChatGptError.of("This ChatGPT account's plan can't be used in other apps (needs Plus or Pro).");
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return ChatGptError.of('ChatGPT plan usage is temporarily unavailable. Try again in a moment.');
    default: {
      const statusPart = status !== 0 && status !== 200 ? ` ${status}` : '';
      const codePart = code ? ` (${code})` : '';
      return ChatGptError.of(
        `ChatGPT error${statusPart}${codePart}: ${message || 'Request failed'}`,
        status === 401,
      );
    }
  }
};

const ErrorBody = Schema.Struct({
  code: Schema.optional(Schema.NullOr(Schema.String)),
  message: Schema.optional(Schema.NullOr(Schema.String)),
});

const ErrorReply = Schema.Struct({
  error: Schema.optional(ErrorBody),
  detail: Schema.optional(Schema.String),
});

/** Error body of a non-200 reply. */
export const parseErrorReply = (raw: string, status: number): ChatGptError =>
  Option.match(Schema.decodeUnknownOption(Schema.fromJsonString(ErrorReply))(raw), {
    onNone: () => describe(null, raw.slice(0, 300), status),
    onSome: (json) =>
      json.error
        ? describe(json.error.code, json.error.message, status)
        : describe(null, json.detail ?? raw.slice(0, 300), status),
  });

const StreamEvent = Schema.Struct({
  type: Schema.String,
  delta: Schema.optional(Schema.String),
  response: Schema.optional(Schema.Struct({ error: Schema.optional(ErrorBody) })),
  error: Schema.optional(ErrorBody),
  code: Schema.optional(Schema.NullOr(Schema.String)),
  message: Schema.optional(Schema.NullOr(Schema.String)),
});
type StreamEvent = typeof StreamEvent.Type;
const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(StreamEvent));

const isEnd = (ev: StreamEvent) => ev.type === 'response.completed' || ev.type === 'response.incomplete';

/**
 * Reads server-sent event lines into the answer. `onText` receives the full text so far after every delta.
 * Stops at completion; a failure event fails with the matching message.
 */
export const readEvents = <E, R>(
  lines: Stream.Stream<string, E, R>,
  onText: (full: string) => Effect.Effect<void>,
  status = 200,
): Effect.Effect<string, E | ChatGptError, R> =>
  lines.pipe(
    Stream.filter((line) => line.startsWith('data:')),
    Stream.map((line) => line.slice(5).trim()),
    Stream.takeWhile((payload) => payload !== '[DONE]'),
    Stream.map((payload) => decodeEvent(payload)),
    Stream.filter(Option.isSome),
    Stream.map((ev) => ev.value),
    Stream.takeUntil(isEnd),
    Stream.runFoldEffect(
      () => '',
      (full, ev): Effect.Effect<string, ChatGptError> => {
        if (ev.type === 'response.output_text.delta' && ev.delta !== undefined) {
          const next = full + ev.delta;
          return onText(next).pipe(Effect.as(next));
        }
        if (ev.type === 'response.failed' || ev.type === 'error') {
          const err = ev.response?.error ?? ev.error ?? ev;
          return Effect.fail(describe(err.code, err.message, status));
        }
        return Effect.succeed(full);
      },
    ),
  );

export interface AskRequest {
  readonly model: string;
  readonly instructions: string;
  readonly text: string;
  readonly imageDataURL?: string | undefined;
  readonly effort?: 'low' | 'medium' | 'high' | undefined;
  readonly onText: (full: string) => Effect.Effect<void>;
}

const ModelList = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Unknown)),
  models: Schema.optional(Schema.Array(Schema.Unknown)),
});
const ModelEntry = Schema.Struct({
  slug: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  display_name: Schema.optional(Schema.String),
  visibility: Schema.optional(Schema.String),
});

/** Models the user's plan can pick (`visibility == "list"`). */
export const parseModels = (raw: unknown): ReadonlyArray<Model> => {
  const list = Option.getOrUndefined(Schema.decodeUnknownOption(ModelList)(raw));
  return (list?.data ?? list?.models ?? []).flatMap((m) => {
    const entry = Option.getOrUndefined(Schema.decodeUnknownOption(ModelEntry)(m));
    if (!entry || (entry.visibility !== undefined && entry.visibility !== 'list')) return [];
    const slug = entry.slug ?? entry.id;
    return slug ? [{ slug, name: entry.display_name ?? slug }] : [];
  });
};

export interface ChatGptShape {
  readonly ask: (request: AskRequest) => Effect.Effect<string, ChatGptError>;
  readonly listModels: Effect.Effect<ReadonlyArray<Model>, ChatGptError>;
}

export class ChatGpt extends Context.Service<ChatGpt, ChatGptShape>()('machete/ChatGpt') {
  static readonly layer = Layer.effect(
    ChatGpt,
    Effect.gen(function* () {
      const auth = yield* Auth;
      const http = yield* HttpClient.HttpClient;

      const send = (token: string, req: AskRequest, effort: AskRequest['effort']) =>
        Effect.gen(function* () {
          const content: Array<Record<string, string>> = [{ type: 'input_text', text: req.text }];
          if (req.imageDataURL) content.push({ type: 'input_image', image_url: req.imageDataURL });
          const body = {
            model: req.model,
            instructions: req.instructions,
            input: [{ role: 'user', content }],
            store: false,
            stream: true,
            ...(effort ? { reasoning: { effort } } : {}),
          };
          const request = yield* HttpClientRequest.post(ENDPOINT).pipe(
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.setHeader('Accept', 'text/event-stream'),
            HttpClientRequest.bodyJson(body),
            Effect.mapError(() => ChatGptError.of('Could not encode the request.')),
          );
          const response = yield* http.execute(request).pipe(Effect.mapError(fromHttpError));
          if (response.status !== 200) {
            const raw = yield* response.text.pipe(Effect.mapError(fromHttpError));
            return yield* parseErrorReply(raw.slice(0, 8000), response.status);
          }
          const lines = response.stream.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.mapError(fromHttpError),
          );
          return yield* readEvents(lines, req.onText, response.status);
        });

      return {
        ask: (req) =>
          Effect.gen(function* () {
            const token = yield* auth.accessToken;
            return yield* send(token, req, req.effort).pipe(
              // Some models don't take a reasoning setting: retry once without it.
              Effect.catchIf(
                (e) => req.effort !== undefined && e.message.includes('reasoning'),
                () => send(token, req, undefined),
              ),
            );
          }),
        listModels: Effect.gen(function* () {
          const token = yield* auth.accessToken;
          const response = yield* http
            .execute(HttpClientRequest.get(MODELS).pipe(HttpClientRequest.bearerToken(token)))
            .pipe(Effect.mapError(fromHttpError));
          const json = yield* response.json.pipe(Effect.mapError(fromHttpError));
          return parseModels(json);
        }),
      } satisfies ChatGptShape;
    }),
  );
}
