#!/usr/bin/env bun
// A stand-in for machete-native: speaks the same JSON-lines `serve` protocol, so the real NativeHelper layer
// can be tested on any machine. FAKE_NATIVE=fail|bare|garbled makes every reply an error, an error without
// a message, or a reply of the wrong shape; `listen.start` also emits events.
import { createInterface } from 'node:readline';

const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const replies: Record<string, Record<string, unknown>> = {
  capture: { dataURL: 'data:image/jpeg;base64,AAAA' },
  fingerprint: { pixels: [1, 2, 3] },
  'dictate.stop': { text: 'hola' },
  frontmost: { name: 'Notes' },
};
const mode = process.env['FAKE_NATIVE'] ?? 'ok';

const command = process.argv[2];
if (command === 'permissions') {
  out({
    microphone: 'granted',
    screen: 'denied',
    accessibility: 'granted',
    inputMonitoring: 'not-determined',
  });
  process.exit(0);
}
if (command === 'settings-window') {
  if (mode === 'ok') out({ X: 10, Y: 20, Width: 700, Height: 600 });
  process.exit(mode === 'ok' ? 0 : 2);
}

process.stderr.write('fake helper up\n');
for await (const line of createInterface({ input: process.stdin })) {
  const { id, cmd } = JSON.parse(line) as { id?: number; cmd: string };
  if (cmd === 'listen.start') {
    out({ type: 'log', message: 'listening' });
    out({ type: 'commit', speaker: 'them', text: 'Hi?' });
    out('not an object');
  }
  if (id === undefined) continue;
  if (mode === 'fail') out({ id, ok: false, error: 'it broke' });
  else if (mode === 'bare') out({ id, ok: false });
  else if (mode === 'garbled') out({ id, ok: true, dataURL: 7, pixels: 'nope', text: 1 });
  else out({ id, ok: true, ...(replies[cmd] ?? {}) });
  // FAKE_NATIVE_CRASH=1: dies after its first reply, to test that Machete restarts it.
  if (process.env['FAKE_NATIVE_CRASH'] === '1') process.exit(3);
}
