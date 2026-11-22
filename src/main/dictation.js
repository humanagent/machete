'use strict';
// Dictation, Spokenly-style: speak, and the words are typed into the app you're in. Transcription only, no AI.
// Start/finish with the right ⌘ key (tapped alone) or ⌥D; Esc or the pill's menu cancels.
// The pill never takes focus (so the text lands in your app) and is always hidden from screen sharing.
const path = require('path');
const { BrowserWindow, screen, globalShortcut, Menu, ipcMain } = require('electron');
const native = require('./native');
const log = require('./log');

const W = 380, H = 92;

class Dictation {
  constructor(state) {
    this.state = state;
    this.phase = 'idle'; // idle | recording | finishing
    this.win = null;
  }

  init() {
    globalShortcut.register('Alt+D', () => this.toggle());
    native.on('rightcmd', () => this.toggle());
    native.on('dictation.level', ({ level }) => this.send('level', level));
    native.on('dictation.error', ({ message }) => log.write(`dictation: ${message}`));
    native.watchRightCommand().then(() => log.write('dictation: right ⌘ ready'))
      .catch((e) => log.write(`dictation: right ⌘ unavailable: ${e.message}`));
    ipcMain.on('dictation:menu', () => this.menu());
  }

  toggle() { if (this.phase === 'idle') this.start(); else if (this.phase === 'recording') this.finish(); }

  async start() {
    this.phase = 'recording';
    const front = await native.frontmost().catch(() => ({}));
    this.show({ app: front.name || '', icon: front.icon || '' });
    globalShortcut.register('Escape', () => this.cancel());
    try {
      await native.dictateStart(this.state.language);
      log.write(`dictation: start (into ${front.name || '?'})`);
    } catch (e) {
      log.write(`dictation: start failed: ${e.message}`);
      this.send('error', e.message);
      this.end(2500);
    }
  }

  async finish() {
    if (this.phase !== 'recording') return;
    this.phase = 'finishing';
    this.send('finishing');
    try {
      const text = await native.dictateStop(false);
      this.hide();
      if (text) {
        await native.paste(text);
        log.write(`dictation: typed ${text.length} chars`);
      }
      this.end(0);
    } catch (e) {
      log.write(`dictation: ${e.message}`);
      this.send('error', e.message);
      this.end(2500);
    }
  }

  async cancel() {
    if (this.phase === 'idle') return;
    this.phase = 'finishing';
    await native.dictateStop(true).catch(() => {});
    log.write('dictation: cancelled');
    this.end(0);
  }

  end(delay) {
    globalShortcut.unregister('Escape');
    setTimeout(() => { this.hide(); this.phase = 'idle'; }, delay);
  }

  menu() {
    if (!this.win) return;
    Menu.buildFromTemplate([
      { label: 'Finish recording', click: () => this.finish() },
      { label: 'Cancel recording', click: () => this.cancel() },
    ]).popup({ window: this.win });
  }

  window() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      width: W, height: H, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, hasShadow: true, focusable: false, acceptFirstMouse: true, alwaysOnTop: true,
      type: process.platform === 'darwin' ? 'panel' : undefined, hiddenInMissionControl: true,
      webPreferences: { preload: path.join(__dirname, '..', 'preload', 'dictation.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'status');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setContentProtection(true); // always hidden from screenshots and screen sharing
    win.loadFile(path.join(__dirname, '..', 'renderer', 'dictation', 'index.html'));
    this.win = win;
    return win;
  }

  show(info) {
    const win = this.window();
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = d.workArea;
    win.setBounds({ x: Math.round(wa.x + (wa.width - W) / 2), y: Math.round(wa.y + wa.height - H - 24), width: W, height: H });
    const go = () => { this.send('show', info); win.showInactive(); };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', go); else go();
  }

  hide() { if (this.win && !this.win.isDestroyed()) this.win.hide(); }
  send(ch, v) { if (this.win && !this.win.isDestroyed()) this.win.webContents.send(`dictation:${ch}`, v); }
}

module.exports = { Dictation };
