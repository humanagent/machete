'use strict';
// "Sign in with ChatGPT" (developers.openai.com/siwc), ported from SIWC.swift: OAuth with PKCE on a
// loopback redirect, tokens in <support>/siwc.json (0600, same JSON the native app writes).
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const { supportDir } = require('./paths');
const settings = require('./settings');
const { fetchChecked } = require('./net');

const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
// Swift's JSONEncoder stores Date as seconds since 2001-01-01 (reference date).
const APPLE_EPOCH = 978307200;

class SIWCError extends Error {
  constructor(message, needsSignIn = false) { super(message); this.needsSignIn = needsSignIn; }
}

const tokenFile = path.join(supportDir, 'siwc.json');

function loadTokens() {
  try {
    const t = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    if (!t.accessToken) return null;
    return { ...t, expiresAtMs: (Number(t.expiresAt) + APPLE_EPOCH) * 1000 };
  } catch { return null; }
}

function storeTokens(t) {
  tokens = t;
  if (!t) { try { fs.unlinkSync(tokenFile); } catch { /* none */ } return; }
  fs.mkdirSync(supportDir, { recursive: true, mode: 0o700 });
  const out = { clientID: t.clientID, accessToken: t.accessToken, refreshToken: t.refreshToken,
    expiresAt: t.expiresAtMs / 1000 - APPLE_EPOCH };
  if (t.idToken) out.idToken = t.idToken;
  fs.writeFileSync(tokenFile, JSON.stringify(out), { mode: 0o600 });
  fs.chmodSync(tokenFile, 0o600);
}

let tokens = loadTokens();
let refreshing = null;

const isSignedIn = () => tokens != null;

function hostID() {
  let id = settings.get('siwcHostID');
  if (!id) { id = `urn:uuid:${crypto.randomUUID().toLowerCase()}`; settings.set('siwcHostID', id); }
  return id;
}

function formEncode(items) {
  const enc = (s) => Array.from(Buffer.from(String(s), 'utf8'))
    .map((b) => (/[A-Za-z0-9\-._~]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0')))
    .join('');
  return items.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}

const randomURLSafe = (n) => crypto.randomBytes(n).toString('base64url');

/** Loopback HTTP server for the OAuth redirect (prefers port 1455, like the native app). */
function startLoopback() {
  return new Promise((resolve, reject) => {
    let deliver;
    const result = new Promise((res) => { deliver = res; });
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/auth/callback') { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }); res.end('Not found'); return; }
      const q = Object.fromEntries(u.searchParams.entries());
      const ok = q.error == null;
      const body = ok
        ? "<h2 style='font-family:-apple-system'>Machete is connected to ChatGPT.</h2><p style='font-family:-apple-system'>You can close this tab.</p>"
        : "<h2 style='font-family:-apple-system'>Sign-in was not completed.</h2>";
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      res.end(body);
      deliver(q);
    });
    const listen = (port, fallback) => {
      server.once('error', (e) => (fallback ? listen(0, false) : reject(e)));
      server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, result, close: () => server.close() }));
    };
    listen(1455, true);
  });
}

async function signIn() {
  const verifier = randomURLSafe(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = randomURLSafe(24);
  const nonce = randomURLSafe(24);

  const server = await startLoopback();
  try {
    const redirect = `http://127.0.0.1:${server.port}/auth/callback`;
    const existing = settings.get('siwcClientID');
    const items = [['client_id', existing || 'dynamic_agent_client']];
    if (!existing) items.push(['agent_name_hint', 'Machete']);
    items.push(['ext_agent_host_id', hostID()], ['response_type', 'code'], ['redirect_uri', redirect], ['scope', SCOPE],
      ['resource', RESOURCE], ['state', state], ['nonce', nonce], ['code_challenge_method', 'S256'], ['code_challenge', challenge]);
    if (tokens?.idToken) items.push(['id_token_hint', tokens.idToken]);

    await shell.openExternal(`${AUTHORIZE_URL}?${formEncode(items)}`);

    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new SIWCError('Sign-in timed out.')), 300_000); });
    const query = await Promise.race([server.result, timeout]).finally(() => clearTimeout(timer));

    if (query.state !== state) throw new SIWCError('Sign-in failed: state mismatch.');
    if (query.error) {
      throw new SIWCError(query.error === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed: ${query.error_description || query.error}`);
    }
    if (!query.code) throw new SIWCError('Sign-in failed: no authorization code.');
    const returned = query.client_id;
    if (existing && returned && returned !== existing) throw new SIWCError('Sign-in failed: unexpected client id.');
    const clientID = returned || existing;
    if (!clientID) throw new SIWCError('Sign-in failed: ChatGPT did not complete app registration.');
    settings.set('siwcClientID', clientID);

    const json = await postForm([['grant_type', 'authorization_code'], ['client_id', clientID], ['code', query.code],
      ['code_verifier', verifier], ['redirect_uri', redirect], ['resource', RESOURCE]]);
    storeTokens(tokensFrom(json, clientID, null));
  } finally {
    server.close();
  }
}

function signOut() { storeTokens(null); }

async function accessToken() {
  if (!tokens) throw new SIWCError('Not signed in with ChatGPT.', true);
  if (tokens.expiresAtMs - Date.now() > 90_000) return tokens.accessToken;
  if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function refresh() {
  const t = tokens;
  if (!t) throw new SIWCError('Not signed in with ChatGPT.', true);
  try {
    const json = await postForm([['grant_type', 'refresh_token'], ['client_id', t.clientID], ['refresh_token', t.refreshToken], ['resource', RESOURCE]]);
    const nt = tokensFrom(json, t.clientID, t);
    storeTokens(nt);
    return nt.accessToken;
  } catch (e) {
    if (e.needsSignIn) storeTokens(null);
    throw e;
  }
}

function tokensFrom(json, clientID, previous) {
  if (typeof json.access_token !== 'string') throw new SIWCError('Sign-in failed: no access token returned.');
  const expires = Number(json.expires_in ?? 3600) || 3600;
  return {
    clientID,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? previous?.refreshToken ?? '',
    idToken: json.id_token ?? previous?.idToken,
    expiresAtMs: Date.now() + expires * 1000,
  };
}

async function postForm(items) {
  const resp = await fetchChecked(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formEncode(items),
  });
  const raw = await resp.text();
  let json = {};
  try { json = JSON.parse(raw); } catch { /* not json */ }
  if (resp.status !== 200) {
    const code = (typeof json.error === 'string' ? json.error : json.error?.code) || `http_${resp.status}`;
    const relogin = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
      'refresh_token_invalidated', 'refresh_token_reused'].includes(code);
    const desc = json.error_description || raw.slice(0, 300);
    throw new SIWCError(relogin ? 'ChatGPT session expired. Sign in again.' : `ChatGPT sign-in error (${code}): ${desc}`, relogin);
  }
  return json;
}

module.exports = { signIn, signOut, accessToken, isSignedIn, SIWCError, formEncode, RESOURCE, _tokenFile: tokenFile };
