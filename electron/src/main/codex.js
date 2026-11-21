'use strict';
// Talks to ChatGPT through the Codex CLI (fallback when not signed in directly), ported from CodexRunner.swift.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

class CodexError extends Error {}

const SEARCH_PATH = process.platform === 'win32'
  ? (process.env.PATH || '').split(path.delimiter)
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
    path.join(os.homedir(), '.npm-global/bin'), path.join(os.homedir(), '.local/bin')];

function resolveCodex() {
  const names = process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex'];
  for (const dir of SEARCH_PATH) {
    for (const n of names) {
      const p = path.join(dir, n);
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
    }
  }
  return null;
}

let current = null;

function cancel() {
  const p = current;
  current = null;
  if (p && p.exitCode == null) p.kill('SIGTERM');
}

function launch(exe, args, { cwd, track = true } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: SEARCH_PATH.join(path.delimiter) + path.delimiter + (process.env.PATH || ''), NO_COLOR: '1' };
    const p = spawn(exe, args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] });
    if (track) current = p;
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code, signal) => {
      if (current === p) current = null;
      resolve({ status: code ?? (signal === 'SIGTERM' ? 15 : signal === 'SIGKILL' ? 9 : 1), stderr });
    });
  });
}

async function run(prompt, imagePath) {
  const codex = resolveCodex();
  if (!codex) throw new CodexError('Codex CLI not found. Install it with `npm install -g @openai/codex`.');
  const workDir = path.join(os.tmpdir(), 'Machete');
  fs.mkdirSync(workDir, { recursive: true });
  const outFile = path.join(workDir, `answer-${crypto.randomUUID().toUpperCase()}.md`);

  const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never',
    '-c', 'model_reasoning_effort="low"', '-C', workDir, '-o', outFile];
  if (imagePath) args.push('-i', imagePath);
  args.push('--', prompt);

  const { status, stderr } = await launch(codex, args, { cwd: workDir });
  let text = '';
  try { text = fs.readFileSync(outFile, 'utf8'); } catch { /* none */ }
  try { fs.unlinkSync(outFile); } catch { /* none */ }
  if (text.trim()) return text.trim();
  if (status === 15 || status === 9) { const e = new Error('cancelled'); e.cancelled = true; throw e; }
  const tail = stderr.split('\n').filter(Boolean).slice(-4).join('\n');
  if (/login|auth/i.test(tail)) throw new CodexError(`ChatGPT sign-in needed. Menu bar ✨ ▸ Sign in with ChatGPT…\n${tail}`);
  throw new CodexError(`Codex failed (exit ${status}).\n${tail}`);
}

async function isLoggedIn() {
  const codex = resolveCodex();
  if (!codex) return false;
  try { return (await launch(codex, ['login', 'status'], { track: false })).status === 0; } catch { return false; }
}

module.exports = { run, cancel, isLoggedIn, CodexError };
