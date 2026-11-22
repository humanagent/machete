import { describe, expect, test } from 'bun:test';
import { Effect, Layer, Stream } from 'effect';
import { ChatGptError } from '../../src/main/errors';
import { Auth } from '../../src/main/services/Auth';
import {
  ChatGpt,
  describe as describeError,
  parseErrorReply,
  parseModels,
  readEvents,
} from '../../src/main/services/ChatGpt';
import { bodyText, fakeHttp, json, sse } from '../support/fakes';

const lines = (...l: ReadonlyArray<string>) => Stream.make(...l);

describe('readEvents', () => {
  test('accumulates deltas, reports progress and stops at completion', async () => {
    const seen: Array<string> = [];
    const text = await Effect.runPromise(
      readEvents(
        lines(
          'data: {"type":"response.output_text.delta","delta":"Hel"}',
          ': keep-alive',
          'data: {"type":"response.output_text.delta","delta":"lo"}',
          'data: {"type":"response.completed"}',
          'data: {"type":"response.output_text.delta","delta":"IGNORED"}',
        ),
        (t) => Effect.sync(() => void seen.push(t)),
      ),
    );
    expect(text).toBe('Hello');
    expect(seen).toEqual(['Hel', 'Hello']);
  });

  test('a failure event fails with the matching message', async () => {
    const error = await Effect.runPromise(
      readEvents(
        lines(
          'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}',
        ),
        () => Effect.void,
      ).pipe(Effect.flip),
    );
    expect(error.message).toContain('usage limit for Machete');
  });

  test('[DONE] ends the stream', async () => {
    const text = await Effect.runPromise(
      readEvents(
        lines(
          'data: {"type":"response.output_text.delta","delta":"A"}',
          'data: [DONE]',
          'data: {"type":"x"}',
        ),
        () => Effect.void,
      ),
    );
    expect(text).toBe('A');
  });
});

test('describe maps codes and statuses', () => {
  expect(describeError('subscription_sharing_invalid_user', null, 401).needsSignIn).toBe(true);
  expect(describeError(null, 'boom', 500).message).toBe('ChatGPT error 500: boom');
  expect(describeError('x', 'boom', 200).message).toBe('ChatGPT error (x): boom');
  expect(describeError(null, 'nope', 401).needsSignIn).toBe(true);
});

test('parseErrorReply reads error objects, details and plain text', () => {
  expect(parseErrorReply('{"error":{"code":"c","message":"m"}}', 400).message).toBe(
    'ChatGPT error 400 (c): m',
  );
  expect(parseErrorReply('{"detail":"Unauthorized"}', 401).message).toBe('ChatGPT error 401: Unauthorized');
  expect(parseErrorReply('Bad gateway', 502).message).toBe('ChatGPT error 502: Bad gateway');
});

test('parseModels keeps listable models', () => {
  expect(
    parseModels({
      data: [
        { slug: 'a', display_name: 'A', visibility: 'list' },
        { id: 'b' },
        { slug: 'hidden', visibility: 'hide' },
        { nothing: true },
      ],
    }),
  ).toEqual([
    { slug: 'a', name: 'A' },
    { slug: 'b', name: 'b' },
  ]);
});

describe('ChatGpt service', () => {
  const AuthFake = Layer.succeed(Auth, {
    isSignedIn: Effect.succeed(true),
    signIn: Effect.void,
    signOut: Effect.void,
    accessToken: Effect.succeed('tok'),
  });

  test('asks with the screenshot and streams the answer', async () => {
    const seen: Parameters<Parameters<typeof fakeHttp>[0]>[0][] = [];
    const layer = ChatGpt.layer.pipe(
      Layer.provide(AuthFake),
      Layer.provide(
        fakeHttp(
          () =>
            sse([
              { type: 'response.output_text.delta', delta: 'OK ' },
              { type: 'response.output_text.delta', delta: 'MACHETE' },
              { type: 'response.completed' },
            ]),
          seen,
        ),
      ),
    );
    const answer = await Effect.runPromise(
      Effect.service(ChatGpt).pipe(
        Effect.flatMap((c) =>
          c.ask({
            model: 'm',
            instructions: 'sys',
            text: 'hi',
            imageDataURL: 'data:x',
            effort: 'low',
            onText: () => Effect.void,
          }),
        ),
        Effect.provide(layer),
      ),
    );
    expect(answer).toBe('OK MACHETE');
    const request = seen[0];
    expect(request?.headers.authorization).toBe('Bearer tok');
    const body = JSON.parse(bodyText(request ?? ({} as never)));
    expect(body).toMatchObject({
      model: 'm',
      instructions: 'sys',
      stream: true,
      store: false,
      reasoning: { effort: 'low' },
    });
    expect(body.input[0].content).toEqual([
      { type: 'input_text', text: 'hi' },
      { type: 'input_image', image_url: 'data:x' },
    ]);
  });

  test('retries without reasoning when the model rejects it', async () => {
    let calls = 0;
    const layer = ChatGpt.layer.pipe(
      Layer.provide(AuthFake),
      Layer.provide(
        fakeHttp(() =>
          ++calls === 1
            ? json({ error: { code: 'unsupported', message: 'reasoning is not supported' } }, 400)
            : sse([{ type: 'response.output_text.delta', delta: 'fine' }, { type: 'response.completed' }]),
        ),
      ),
    );
    const answer = await Effect.runPromise(
      Effect.service(ChatGpt).pipe(
        Effect.flatMap((c) =>
          c.ask({ model: 'm', instructions: '', text: '', effort: 'low', onText: () => Effect.void }),
        ),
        Effect.provide(layer),
      ),
    );
    expect(answer).toBe('fine');
    expect(calls).toBe(2);
  });

  test('a 401 asks to sign in again', async () => {
    const layer = ChatGpt.layer.pipe(
      Layer.provide(AuthFake),
      Layer.provide(fakeHttp(() => json({ detail: 'expired' }, 401))),
    );
    const error = await Effect.runPromise(
      Effect.service(ChatGpt).pipe(
        Effect.flatMap((c) => c.ask({ model: 'm', instructions: '', text: '', onText: () => Effect.void })),
        Effect.flip,
        Effect.provide(layer),
      ),
    );
    expect(error).toBeInstanceOf(ChatGptError);
    expect(error.needsSignIn).toBe(true);
  });
});
