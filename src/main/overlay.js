'use strict';
// OverlayPanel.swift + the panel parts of AppDelegate.swift: a floating, non-activating panel that never shows
// in screenshots or screen sharing, pinned top-center on the built-in display, top edge fixed as content grows.
const path = require('path');
const { BrowserWindow, screen, shell } = require('electron');

const PAD = 8; // SwiftUI .padding(8) around the panel
const log = require('./log');
const DEBUG = process.env.MACHETE_DEBUG === '1';

class Overlay {
  constructor(state) {
    this.state = state;
    this.win = null;
    this.placedOnce = false;
    this.anchorTop = null;
    this.anchorMidX = null;
    this.programmatic = false;
    this.userResizing = false;
  }

  create() {
    const win = new BrowserWindow({
      width: 660, height: 60,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: true,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      type: process.platform === 'darwin' ? 'panel' : undefined, // NSPanel, non-activating
      acceptFirstMouse: true,      // clicks land even while another app is active
      hiddenInMissionControl: true, // .stationary / .ignoresCycle
      minWidth: 480 + PAD * 2,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.win = win;
    win.setAlwaysOnTop(true, 'status');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setContentProtection(!this.state.visibleInCapture);
    win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'index.html'));
    // Links in answers open in the browser, never inside the panel.
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); });

    win.on('moved', () => {
      const b = win.getBounds();
      this.anchorTop = b.y;
      this.anchorMidX = b.x + b.width / 2;
    });
    // User drag-resizing: feed the new size back into the card (like didResize / didEndLiveResize).
    win.on('will-resize', (_e, nb) => {
      this.userResizing = true;
      this.state.setCardSize(nb.width - PAD * 2, nb.height - PAD * 2, false);
    });
    win.on('resized', () => {
      if (!this.userResizing) return;
      this.userResizing = false;
      const b = win.getBounds();
      this.anchorTop = b.y;
      this.anchorMidX = b.x + b.width / 2;
      this.state.setCardSize(b.width - PAD * 2, b.height - PAD * 2, true);
    });

    this.state.on('captureVisibility', (visible) => win.setContentProtection(!visible));
    this.state.on('showPanel', () => this.show());
    return win;
  }

  /** Content-driven size from the renderer. Keeps the top edge and horizontal center fixed. */
  layout(width, height) {
    const win = this.win;
    if (!win || this.userResizing) return;
    width = Math.round(width); height = Math.round(height);
    const b = win.getBounds();
    if (b.width === width && b.height === height) return;
    const top = this.anchorTop ?? b.y;
    const mid = this.anchorMidX ?? (b.x + b.width / 2);
    this.programmatic = true;
    win.setBounds({ x: Math.round(mid - width / 2), y: top, width, height });
    this.programmatic = false;
    if (DEBUG) log.write(`overlay: layout ${width}x${height} -> ${JSON.stringify(win.getBounds())}`);
    if (!this.placedOnce && win.isVisible()) this.positionTopCenter();
  }

  /** Only resizable when the expanded card shows (not the bar alone). */
  setUserResizable(on) { if (this.win && this.win.isResizable() !== on) this.win.setResizable(on); }

  /** Always the built-in display; fall back to the primary one if it's closed or absent. */
  positionTopCenter() {
    const d = screen.getAllDisplays().find((x) => x.internal) || screen.getPrimaryDisplay();
    const vf = d.workArea;
    const b = this.win.getBounds();
    this.anchorTop = vf.y + 6;
    this.anchorMidX = vf.x + vf.width / 2;
    this.win.setBounds({ x: Math.round(this.anchorMidX - b.width / 2), y: this.anchorTop, width: b.width, height: b.height });
  }

  show() {
    const win = this.win;
    if (!win || win.isVisible()) return;
    win.showInactive();
    // Top-center only the first time; after that, hiding and showing keeps wherever it was moved.
    if (this.placedOnce) return;
    this.placedOnce = true;
    this.positionTopCenter();
  }

  toggle() {
    if (!this.win) return;
    if (this.win.isVisible()) this.win.hide(); else this.show();
  }

  /** ⌥Space: show, make key and focus the question field. */
  focusInput() {
    this.show();
    this.win.focus();
    this.state.focusInput();
  }
}

module.exports = { Overlay, PAD };
