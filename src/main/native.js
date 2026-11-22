'use strict';
// Bridge to the macOS helper (machete-native): screen capture, transcription and text extraction
// with the same Apple frameworks the native app uses. Windows will get its own implementation.
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const log = require('./log');

function helperPath() {
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'machete-native') : null;
  if (packaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, '..', '..', 'native', 'bin', 'machete-native');
  return fs.existsSync(dev) ? dev : null;
}

class NativeHelper extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.nextID = 1;
    this.pending = new Map();
    this.buf = '';
  }

  get available() { return process.platform === 'darwin' && helperPath() != null; }

  start() {
    if (this.proc || !this.available) return;
    const exe = helperPath();
    const p = spawn(exe, ['serve', '--exclude-pid', String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    p.stdout.on('data', (d) => this.onData(d));
    p.stderr.on('data', (d) => log.write(`native stderr: ${String(d).trim()}`));
    p.on('exit', (code, signal) => {
      log.write(`native: helper exited code=${code} signal=${signal}`);
      this.proc = null;
      for (const { reject } of this.pending.values()) reject(new Error('Native helper stopped.'));
      this.pending.clear();
      this.emit('exit');
    });
  }

  stop() {
    if (!this.proc) return;
    try { this.proc.stdin.end(); } catch { /* gone */ }
    const p = this.proc;
    setTimeout(() => { if (p.exitCode == null) p.kill('SIGTERM'); }, 3000).unref();
  }

  onData(d) {
    this.buf += d.toString();
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.ok ? resolve(msg) : reject(new Error(msg.error || 'Native helper error'));
      } else if (msg.type === 'log') {
        log.write(msg.message);
      } else if (msg.type) {
        this.emit(msg.type, msg);
      }
    }
  }

  request(cmd, fields = {}, timeoutMs = 20_000) {
    this.start();
    if (!this.proc) return Promise.reject(new Error('Screen capture and transcription need the macOS helper (machete-native).'));
    const id = this.nextID++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...fields }) + '\n');
    });
  }

  send(cmd, fields = {}) {
    if (this.proc) this.proc.stdin.write(JSON.stringify({ cmd, ...fields }) + '\n');
  }

  // Screen
  async captureDataURL(max = 1440) { return (await this.request('capture', { max })).dataURL; }
  async fingerprint() { return (await this.request('fingerprint')).pixels; }
  async permissions() { return this.request('permissions'); }

  // Transcription
  startListening(locale) { return this.request('listen.start', { locale }, 120_000); }
  setPaused(paused) { this.send('listen.pause', { paused }); }
  stopListening() { return this.request('listen.stop', {}, 60_000).catch(() => {}); }

  // Dictation (mic only, no AI): typed into the focused app.
  dictateStart(locale) { return this.request('dictate.start', { locale }, 60_000); }
  async dictateStop(cancel = false) { return (await this.request('dictate.stop', { cancel }, 60_000)).text || ''; }
  frontmost() { return this.request('frontmost'); }
  paste(text) { return this.request('paste', { text }, 10_000); }
  watchRightCommand() { return this.request('rightcmd.watch'); }

  /** Text of a PDF / Word / RTF / HTML / text file (PDFKit and AppKit, like the native app). */
  extractText(file) {
    const exe = helperPath();
    if (!exe) return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile(exe, ['extract', file], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
    });
  }
}

module.exports = new NativeHelper();
