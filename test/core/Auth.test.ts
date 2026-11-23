import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import {
  Auth,
  describeTokenError,
  formEncode,
  tokensFromFile,
  tokensToFile,
} from '../../src/core/services/Auth';
import { ExternalBrowser } from '../../src/core/services/ExternalBrowser';
import { Settings } from '../../src/core/services/Settings';
import { BrowserNoop, bodyText, fakeHttp, filesAt, json, runInTempDir } from '../support/fakes';

const REFERENCE_EPOCH = 978_307_200;
const authLayer = (dir: string, http: ReturnType<typeof fakeHttp>, browser = BrowserNoop) =>
  Auth.layer.pipe(
    Layer.provide(Layer.mergeAll(Settings.layer, browser, http)),
    Layer.provideMerge(filesAt(dir)),
  );

const tokenFile = (expiresInSeconds: number) =>
  JSON.stringify({
    clientID: 'client-1',
    accessToken: 'old-access',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() / 1000 + expiresInSeconds - REFERENCE_EPOCH,
    idToken: 'id-1',
  });

test('formEncode leaves only A-Z a-z 0-9 - . _ ~ unescaped', () => {
  expect(formEncode([['a b', 'x/y:z~ñ']])).toBe('a%20b=x%2Fy%3Az~%C3%B1');
});

test('token file keeps seconds since 2001 and round-trips', () => {
  const file = { clientID: 'c', accessToken: 'a', refreshToken: 'r', expiresAt: 700_000_000 };
  const tokens = tokensFromFile(file);
  expect(tokens.expiresAtMs).toBe((700_000_000 + REFERENCE_EPOCH) * 1000);
  expect(tokensToFile(tokens)).toEqual(file);
});

test('describeTokenError asks to sign in again only for dead sessions', () => {
  expect(describeTokenError(400, '{"error":"invalid_grant"}')).toMatchObject({
    message: 'ChatGPT session expired. Sign in again.',
    needsSignIn: true,
  });
  expect(describeTokenError(500, 'oops')).toMatchObject({
    message: 'ChatGPT sign-in error (http_500): oops',
    needsSignIn: false,
  });
});

describe('accessToken', () => {
  test('fails with needsSignIn when signed out', async () => {
    const error = await runInTempDir(
      (dir) =>
        authLayer(
          dir,
          fakeHttp(() => json({})),
        ),
      () =>
        Effect.service(Auth).pipe(
          Effect.flatMap((a) => a.accessToken),
          Effect.flip,
        ),
    );
    expect(error.needsSignIn).toBe(true);
  });

  test('a valid token is used as is', async () => {
    const token = await runInTempDir(
      (dir) =>
        authLayer(
          dir,
          fakeHttp(() => json({}, 500)),
        ),
      () => Effect.service(Auth).pipe(Effect.flatMap((a) => a.accessToken)),
      (dir) => writeFile(join(dir, 'siwc.json'), tokenFile(3600)),
    );
    expect(token).toBe('old-access');
  });

  test('an expiring token is refreshed once, even when asked concurrently, and saved 0600', async () => {
    let refreshes = 0;
    const http = fakeHttp((request) => {
      refreshes++;
      expect(bodyText(request)).toContain('grant_type=refresh_token');
      return json({ access_token: 'new-access', expires_in: 3600 });
    });
    const result = await runInTempDir(
      (dir) => authLayer(dir, http),
      (dir) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
          const tokens = yield* Effect.all([auth.accessToken, auth.accessToken, auth.accessToken], {
            concurrency: 3,
          });
          const saved = JSON.parse(yield* Effect.promise(() => readFile(join(dir, 'siwc.json'), 'utf8')));
          const mode = (yield* Effect.promise(() => stat(join(dir, 'siwc.json')))).mode & 0o777;
          return { tokens, saved, mode };
        }),
      (dir) => writeFile(join(dir, 'siwc.json'), tokenFile(30)),
    );
    expect(result.tokens).toEqual(['new-access', 'new-access', 'new-access']);
    expect(refreshes).toBe(1);
    expect(result.saved).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'refresh-1',
      idToken: 'id-1',
    });
    expect(result.mode).toBe(0o600);
  });

  test('a rejected refresh signs out', async () => {
    const result = await runInTempDir(
      (dir) =>
        authLayer(
          dir,
          fakeHttp(() => json({ error: 'invalid_grant' }, 400)),
        ),
      (dir) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
          const error = yield* Effect.flip(auth.accessToken);
          return { error, signedIn: yield* auth.isSignedIn, file: existsSync(join(dir, 'siwc.json')) };
        }),
      (dir) => writeFile(join(dir, 'siwc.json'), tokenFile(10)),
    );
    expect(result.error.needsSignIn).toBe(true);
    expect(result.signedIn).toBe(false);
    expect(result.file).toBe(false);
  });
});

test('signIn: browser → loopback redirect → code exchange → tokens saved', async () => {
  const seen: Array<string> = [];
  // The "browser" approves at once: it calls the redirect with the state it was given.
  const browser = Layer.succeed(ExternalBrowser, {
    open: (url) =>
      Effect.promise(async () => {
        const params = new URL(url).searchParams;
        seen.push(url);
        const redirect = new URL(params.get('redirect_uri') ?? '');
        redirect.search = new URLSearchParams({
          code: 'code-1',
          state: params.get('state') ?? '',
          client_id: 'client-9',
        }).toString();
        await fetch(redirect);
      }),
  });
  const http = fakeHttp((request) => {
    expect(bodyText(request)).toContain('grant_type=authorization_code');
    expect(bodyText(request)).toContain('code=code-1');
    return json({ access_token: 'acc', refresh_token: 'ref', id_token: 'id', expires_in: 3600 });
  });
  const result = await runInTempDir(
    (dir) =>
      authLayer(dir, http, browser).pipe(
        Layer.provideMerge(Settings.layer.pipe(Layer.provide(filesAt(dir)))),
      ),
    (dir) =>
      Effect.gen(function* () {
        const auth = yield* Auth;
        yield* auth.signIn;
        const settings = yield* Settings;
        return {
          signedIn: yield* auth.isSignedIn,
          token: yield* auth.accessToken,
          clientID: (yield* settings.get).siwcClientID,
          file: JSON.parse(yield* Effect.promise(() => readFile(join(dir, 'siwc.json'), 'utf8'))),
        };
      }),
  );
  expect(result).toMatchObject({
    signedIn: true,
    token: 'acc',
    clientID: 'client-9',
    file: { clientID: 'client-9' },
  });
  const authorize = new URL(seen[0] ?? '');
  expect(authorize.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
});

test('signIn: a mismatched state is rejected', async () => {
  const browser = Layer.succeed(ExternalBrowser, {
    open: (url) =>
      Effect.promise(async () => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri') ?? '');
        redirect.search = 'code=x&state=forged';
        await fetch(redirect);
      }),
  });
  const error = await runInTempDir(
    (dir) =>
      authLayer(
        dir,
        fakeHttp(() => json({})),
        browser,
      ),
    () =>
      Effect.service(Auth).pipe(
        Effect.flatMap((a) => a.signIn),
        Effect.flip,
      ),
  );
  expect(error.message).toBe('Sign-in failed: state mismatch.');
});
