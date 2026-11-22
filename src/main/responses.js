'use strict';
// Responses API client (streaming), ported from ResponsesClient in SIWC.swift.
const auth = require('./auth');
const { fetchChecked, networkError } = require('./net');
const { SIWCError } = auth;

const ENDPOINT = 'https://api.openai.com/v1/responses';

function describe(code, message, status) {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return new SIWCError("You've hit your ChatGPT plan's usage limit for Machete for now.");
    case 'subscription_sharing_invalid_user':
      return new SIWCError('ChatGPT session is no longer valid. Sign in again.', true);
    case 'subscription_sharing_user_not_eligible':
      return new SIWCError("This ChatGPT account's plan can't be used in other apps (needs Plus or Pro).");
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return new SIWCError('ChatGPT plan usage is temporarily unavailable. Try again in a moment.');
    default: {
      const m = message || 'Request failed';
      return new SIWCError(`ChatGPT error${status !== 0 && status !== 200 ? ` ${status}` : ''}${code ? ` (${code})` : ''}: ${m}`, status === 401);
    }
  }
}

function parseError(raw, status) {
  let json = {};
  try { json = JSON.parse(raw); } catch { /* not json */ }
  if (json.error && typeof json.error === 'object') return describe(json.error.code, json.error.message, status);
  return describe(null, typeof json.detail === 'string' ? json.detail : raw.slice(0, 300), status);
}

/** Server-sent events → `data:` payloads, one per line, as the native client reads them. */
async function* sseData(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

/** Consumes a Responses event stream; `onText` receives the full text so far. Exported for tests. */
async function readStream(body, onText, status = 200) {
  let full = '';
  for await (const payload of sseData(body)) {
    if (payload === '[DONE]') break;
    let ev;
    try { ev = JSON.parse(payload); } catch { continue; }
    switch (ev.type) {
      case 'response.output_text.delta':
        if (typeof ev.delta === 'string') { full += ev.delta; onText(full); }
        break;
      case 'response.completed':
      case 'response.incomplete':
        return full;
      case 'response.failed':
      case 'error': {
        const err = ev.response?.error || ev.error || ev;
        throw describe(err.code, err.message, status);
      }
      default:
        break;
    }
  }
  return full;
}

async function send({ token, model, instructions, text, image, effort, onText, signal }) {
  const content = [{ type: 'input_text', text }];
  if (image) content.push({ type: 'input_image', image_url: image });
  const body = { model, instructions, input: [{ role: 'user', content }], store: false, stream: true };
  if (effort) body.reasoning = { effort };

  const resp = await fetchChecked(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (resp.status !== 200) throw parseError((await resp.text()).slice(0, 8000), resp.status);
  try { return await readStream(resp.body, onText, resp.status); } catch (e) { throw networkError(e); }
}

async function ask({ model, instructions, text, imageDataURL, effort, onText, signal }) {
  const token = await auth.accessToken();
  try {
    return await send({ token, model, instructions, text, image: imageDataURL, effort, onText, signal });
  } catch (e) {
    // Model doesn't accept a reasoning setting: retry without it.
    if (effort && e instanceof SIWCError && e.message.includes('reasoning')) {
      return send({ token, model, instructions, text, image: imageDataURL, effort: null, onText, signal });
    }
    throw e;
  }
}

/** Models the user's plan can use (`visibility == "list"`). */
async function listModels() {
  const token = await auth.accessToken();
  const resp = await fetchChecked('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${token}` } });
  let json = {};
  try { json = await resp.json(); } catch { /* ignore */ }
  const arr = json.data || json.models || [];
  return arr.flatMap((m) => {
    if (typeof m.visibility === 'string' && m.visibility !== 'list') return [];
    const slug = m.slug || m.id;
    return slug ? [{ slug, name: m.display_name || slug }] : [];
  });
}

module.exports = { ask, listModels, readStream, describe };
