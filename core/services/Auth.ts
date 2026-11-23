// "Sign in with ChatGPT": OAuth with PKCE on a loopback redirect, tokens in <support>/siwc.json (0600).
// The token file keeps the format the app has always used: expiresAt in seconds since 2001-01-01.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  Context,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Schema,
  Semaphore,
} from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { ChatGptError, type StorageError } from '../errors';
import { AppPaths } from './AppPaths';
import { ExternalBrowser } from './ExternalBrowser';
import { readJson, writeJson } from './JsonFile';
import { fromHttpError } from './Network';
import { Settings } from './Settings';

const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
/** Seconds between 1970-01-01 and 2001-01-01. */
const REFERENCE_EPOCH = 978_307_200;
const REFRESH_MARGIN_MS = 90_000;
const RELOGIN_CODES = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

export const TokenFile = Schema.Struct({
  clientID: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
  idToken: Schema.optional(Schema.String),
});
type TokenFile = typeof TokenFile.Type;

export interface Tokens {
  readonly clientID: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken?: string | undefined;
  readonly expiresAtMs: number;
}

export const tokensFromFile = (t: TokenFile): Tokens => ({
  clientID: t.clientID,
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  idToken: t.idToken,
  expiresAtMs: (t.expiresAt + REFERENCE_EPOCH) * 1000,
});

export const tokensToFile = (t: Tokens): TokenFile => ({
  clientID: t.clientID,
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  expiresAt: t.expiresAtMs / 1000 - REFERENCE_EPOCH,
  ...(t.idToken === undefined ? {} : { idToken: t.idToken }),
});

/** application/x-www-form-urlencoded with only A-Z a-z 0-9 - . _ ~ left as is. */
export const formEncode = (items: ReadonlyArray<readonly [string, string]>): string => {
  const enc = (s: string) =>
    Array.from(Buffer.from(s, 'utf8'))
      .map((b) =>
        b < 128 && /[A-Za-z0-9\-._~]/.test(String.fromCharCode(b))
          ? String.fromCharCode(b)
          : `%${b.toString(16).toUpperCase().padStart(2, '0')}`,
      )
      .join('');
  return items.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
};

const TokenReply = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
});

const OAuthError = Schema.Struct({
  error: Schema.optional(
    Schema.Union([Schema.String, Schema.Struct({ code: Schema.optional(Schema.String) })]),
  ),
  error_description: Schema.optional(Schema.String),
});

/** Maps a token endpoint failure to the message the panel shows. */
export const describeTokenError = (status: number, body: string): ChatGptError => {
  const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(OAuthError))(body);
  const json = Option.getOrElse(parsed, () => ({}) as typeof OAuthError.Type);
  const code = (typeof json.error === 'string' ? json.error : json.error?.code) ?? `http_${status}`;
  const relogin = RELOGIN_CODES.has(code);
  return ChatGptError.of(
    relogin
      ? 'ChatGPT session expired. Sign in again.'
      : `ChatGPT sign-in error (${code}): ${json.error_description ?? body.slice(0, 300)}`,
    relogin,
  );
};

const urlSafe = (bytes: number) => randomBytes(bytes).toString('base64url');

interface Loopback {
  readonly port: number;
  readonly query: Effect.Effect<Readonly<Record<string, string>>>;
}

/** HTTP server on 127.0.0.1 that receives the OAuth redirect. Prefers port 1455; closes with the scope. */
const loopback = Effect.gen(function* () {
  const received = yield* Deferred.make<Readonly<Record<string, string>>>();
  const listen = (port: number) =>
    Effect.callback<Server, Error>((resume) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/auth/callback') {
          res
            .writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
            .end('Not found');
          return;
        }
        const query = Object.fromEntries(url.searchParams.entries());
        const ok = query.error == null;
        res
          .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
          .end(
            ok
              ? "<h2 style='font-family:-apple-system'>Machete is connected to ChatGPT.</h2><p style='font-family:-apple-system'>You can close this tab.</p>"
              : "<h2 style='font-family:-apple-system'>Sign-in was not completed.</h2>",
          );
        Deferred.doneUnsafe(received, Effect.succeed(query));
      });
      server.once('error', (e) => resume(Effect.fail(e)));
      server.listen(port, '127.0.0.1', () => resume(Effect.succeed(server)));
    });
  const server = yield* Effect.acquireRelease(listen(1455).pipe(Effect.catch(() => listen(0))), (s) =>
    Effect.sync(() => s.close()),
  ).pipe(
    Effect.mapError(() => ChatGptError.of('Sign-in failed: could not open a local port for the redirect.')),
  );
  const address = server.address();
  return {
    port: typeof address === 'object' && address !== null ? address.port : 1455,
    query: Deferred.await(received),
  } satisfies Loopback;
});

export interface AuthShape {
  readonly isSignedIn: Effect.Effect<boolean>;
  readonly signIn: Effect.Effect<void, ChatGptError | StorageError>;
  readonly signOut: Effect.Effect<void, StorageError>;
  /** A valid access token, refreshed when it is about to expire. */
  readonly accessToken: Effect.Effect<string, ChatGptError>;
}

export class Auth extends Context.Service<Auth, AuthShape>()('machete/Auth') {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const { tokenFile } = yield* AppPaths;
      const settings = yield* Settings;
      const browser = yield* ExternalBrowser;
      const http = yield* HttpClient.HttpClient;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const withFs = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
        eff.pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path));

      const tokens = yield* Ref.make(
        Option.map(yield* withFs(readJson(TokenFile, tokenFile)), tokensFromFile),
      );
      const refreshLock = yield* Semaphore.make(1);

      const store = (next: Option.Option<Tokens>) =>
        Ref.set(tokens, next).pipe(
          Effect.andThen(
            Option.match(next, {
              onNone: () => fs.remove(tokenFile).pipe(Effect.ignore),
              onSome: (t) =>
                withFs(writeJson(TokenFile, tokenFile, tokensToFile(t), { mode: 0o600, pretty: false })),
            }),
          ),
        );

      const hostID = Effect.gen(function* () {
        const current = (yield* settings.get).siwcHostID;
        if (current) return current;
        const id = `urn:uuid:${randomUUID().toLowerCase()}`;
        yield* settings.update({ siwcHostID: id }).pipe(Effect.ignore);
        return id;
      });

      const postForm = (items: ReadonlyArray<readonly [string, string]>) =>
        Effect.gen(function* () {
          const response = yield* http
            .execute(
              HttpClientRequest.post(TOKEN_URL).pipe(
                HttpClientRequest.setHeader('Accept', 'application/json'),
                HttpClientRequest.bodyText(formEncode(items), 'application/x-www-form-urlencoded'),
              ),
            )
            .pipe(Effect.mapError(fromHttpError));
          const body = yield* response.text.pipe(Effect.mapError(fromHttpError));
          if (response.status !== 200) return yield* describeTokenError(response.status, body);
          return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(TokenReply))(body).pipe(
            Effect.mapError(() => ChatGptError.of('Sign-in failed: no access token returned.')),
          );
        });

      const fromReply = (
        reply: typeof TokenReply.Type,
        clientID: string,
        previous: Option.Option<Tokens>,
      ): Tokens => ({
        clientID,
        accessToken: reply.access_token,
        refreshToken: reply.refresh_token ?? Option.getOrUndefined(previous)?.refreshToken ?? '',
        idToken: reply.id_token ?? Option.getOrUndefined(previous)?.idToken,
        expiresAtMs: Date.now() + (reply.expires_in ?? 3600) * 1000,
      });

      const signIn = Effect.scoped(
        Effect.gen(function* () {
          const verifier = urlSafe(48);
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          const state = urlSafe(24);
          const server = yield* loopback;
          const redirect = `http://127.0.0.1:${server.port}/auth/callback`;
          const existing = (yield* settings.get).siwcClientID;
          const previous = yield* Ref.get(tokens);
          const items: Array<readonly [string, string]> = [['client_id', existing ?? 'dynamic_agent_client']];
          if (!existing) items.push(['agent_name_hint', 'Machete']);
          items.push(
            ['ext_agent_host_id', yield* hostID],
            ['response_type', 'code'],
            ['redirect_uri', redirect],
            ['scope', SCOPE],
            ['resource', RESOURCE],
            ['state', state],
            ['nonce', urlSafe(24)],
            ['code_challenge_method', 'S256'],
            ['code_challenge', challenge],
          );
          const idToken = Option.getOrUndefined(previous)?.idToken;
          if (idToken) items.push(['id_token_hint', idToken]);

          yield* browser.open(`${AUTHORIZE_URL}?${formEncode(items)}`);
          const query = yield* server.query.pipe(
            Effect.timeoutOrElse({
              duration: Duration.minutes(5),
              orElse: () => Effect.fail(ChatGptError.of('Sign-in timed out.')),
            }),
          );

          if (query.state !== state) return yield* ChatGptError.of('Sign-in failed: state mismatch.');
          if (query.error) {
            return yield* ChatGptError.of(
              query.error === 'access_denied'
                ? 'Sign-in was cancelled.'
                : `Sign-in failed: ${query.error_description ?? query.error}`,
            );
          }
          if (!query.code) return yield* ChatGptError.of('Sign-in failed: no authorization code.');
          const returned = query.client_id;
          if (existing && returned && returned !== existing) {
            return yield* ChatGptError.of('Sign-in failed: unexpected client id.');
          }
          const clientID = returned ?? existing;
          if (!clientID)
            return yield* ChatGptError.of('Sign-in failed: ChatGPT did not complete app registration.');
          yield* settings.update({ siwcClientID: clientID });

          const reply = yield* postForm([
            ['grant_type', 'authorization_code'],
            ['client_id', clientID],
            ['code', query.code],
            ['code_verifier', verifier],
            ['redirect_uri', redirect],
            ['resource', RESOURCE],
          ]);
          yield* store(Option.some(fromReply(reply, clientID, previous)));
          yield* Effect.logInfo('auth: signed in');
        }),
      );

      const refresh = (current: Tokens) =>
        postForm([
          ['grant_type', 'refresh_token'],
          ['client_id', current.clientID],
          ['refresh_token', current.refreshToken],
          ['resource', RESOURCE],
        ]).pipe(
          Effect.map((reply) => fromReply(reply, current.clientID, Option.some(current))),
          Effect.tap((next) => store(Option.some(next)).pipe(Effect.ignore)),
          Effect.tapError((e) => (e.needsSignIn ? store(Option.none()).pipe(Effect.ignore) : Effect.void)),
          Effect.map((next) => next.accessToken),
        );

      const notSignedIn = ChatGptError.of('Not signed in with ChatGPT.', true);
      const valid = (t: Tokens) => t.expiresAtMs - Date.now() > REFRESH_MARGIN_MS;

      const accessToken = Effect.gen(function* () {
        const current = yield* Ref.get(tokens);
        if (Option.isNone(current)) return yield* notSignedIn;
        if (valid(current.value)) return current.value.accessToken;
        // One refresh at a time; whoever waited reuses the fresh token.
        return yield* refreshLock.withPermits(1)(
          Effect.gen(function* () {
            const latest = yield* Ref.get(tokens);
            if (Option.isNone(latest)) return yield* notSignedIn;
            return valid(latest.value) ? latest.value.accessToken : yield* refresh(latest.value);
          }),
        );
      });

      return {
        isSignedIn: Ref.get(tokens).pipe(Effect.map(Option.isSome)),
        signIn,
        signOut: store(Option.none()),
        accessToken,
      } satisfies AuthShape;
    }),
  );
}
