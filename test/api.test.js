'use strict';
// Responses streaming / error mapping and the SIWC token file format, without Electron or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// auth.js imports `shell` from electron; stub it so the modules load under plain Node.
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { shell: { openExternal: async () => {} } };
  return realLoad.call(this, req, ...rest);
};
const R = require('../src/main/responses');
const auth = require('../src/main/auth');

async function* chunks(parts) { for (const p of parts) yield Buffer.from(p); }

test('readStream accumulates deltas and stops at completed', async () => {
  const seen = [];
  const text = await R.readStream(chunks([
    'data: {"type":"response.output_text.delta","delta":"Hel"}\n',
    'data: {"type":"response.output_text.delta","del', 'ta":"lo"}\n\n',
    'data: {"type":"response.completed"}\n',
    'data: {"type":"response.output_text.delta","delta":"IGNORED"}\n',
  ]), (t) => seen.push(t));
  assert.equal(text, 'Hello');
  assert.deepEqual(seen, ['Hel', 'Hello']);
});

test('readStream surfaces failures with the native messages', async () => {
  await assert.rejects(
    R.readStream(chunks(['data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n']), () => {}),
    /usage limit for Machete/);
});

test('describe maps codes and statuses', () => {
  assert.equal(R.describe('subscription_sharing_invalid_user', null, 401).needsSignIn, true);
  assert.equal(R.describe(null, 'boom', 500).message, 'ChatGPT error 500: boom');
  assert.equal(R.describe('x', 'boom', 200).message, 'ChatGPT error (x): boom');
  assert.equal(R.describe(null, 'nope', 401).needsSignIn, true);
});

test('formEncode matches Swift (alphanumerics plus -._~ unescaped)', () => {
  assert.equal(auth.formEncode([['a b', 'x/y:z~ñ']]), 'a%20b=x%2Fy%3Az~%C3%B1');
});
