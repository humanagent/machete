'use strict';
// Machete (Electron). Mirrors AppDelegate.swift: overlay panel, menu bar item, global hotkeys, login check.
const path = require('path');
const { app, ipcMain, Menu, clipboard, dialog, globalShortcut } = require('electron');
const paths = require('./paths');

// Chromium's own files (cache, local storage) stay out of the folder shared with the native app.
app.setPath('userData', path.join(paths.supportDir, 'electron'));
app.setName('Machete');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const log = require('./log');
const native = require('./native');
const { AppState } = require('./state');
const { Overlay, PAD } = require('./overlay');
const { createTray } = require('./tray');
const { registerHotKeys } = require('./hotkeys');
const { showManageWindow, manageWindow, destroyManageWindow, setQuitting } = require('./manage');
const contextFiles = require('./context-files');

const state = new AppState();
const overlay = new Overlay(state);
let tray = null;

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide(); // LSUIElement: no Dock icon
  log.write(`app: launch electron=${process.versions.electron}`);
  native.start();

  const win = overlay.create();
  state.on('change', () => {
    send(win, 'state', state.snapshot());
    overlay.setUserResizable(state.cardVisible);
  });
  state.on('profiles', () => {
    send(manageWindow(), 'profiles', { profiles: state.profiles, selectedProfileID: state.selectedProfileID });
  });
  win.webContents.once('did-finish-load', () => {
    send(win, 'state', state.snapshot());
    state.cardOpen = true;
    overlay.show();
    state.changed();
  });

  tray = createTray(state, { togglePanel: () => overlay.toggle() });
  registerHotKeys(state, overlay);
  state.checkLogin();
  if (process.argv.includes('--debug-listen')) state.startListening();
});

app.on('before-quit', () => setQuitting());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  native.stop();
  destroyManageWindow();
});
app.on('window-all-closed', (e) => e.preventDefault?.()); // menu bar app: stays alive

// MARK: IPC from the overlay

ipcMain.on('overlay:layout', (_e, { width, height }) => overlay.layout(width, height));
ipcMain.on('overlay:question', (_e, q) => state.setQuestion(q));
ipcMain.on('overlay:ask', (_e, q) => { if (typeof q === 'string') state.setQuestion(q); state.ask(); });
ipcMain.on('overlay:collapse', () => state.collapseToggle());
ipcMain.on('overlay:toggleFollow', () => state.toggleFollow());
ipcMain.on('overlay:toggleCapture', () => state.toggleCaptureVisibility());
ipcMain.on('overlay:toggleListening', () => state.toggleListening());
ipcMain.on('overlay:toggleTranscript', () => state.toggleTranscript());
ipcMain.on('overlay:reset', () => state.reset());
ipcMain.on('overlay:login', () => state.login());
ipcMain.on('overlay:cardHeight', (_e, { height, persist }) => state.setCardHeight(height, persist));
ipcMain.on('overlay:copy', (_e, text) => clipboard.writeText(String(text)));
ipcMain.on('overlay:botsMenu', (e, { x, y }) => {
  const items = state.profiles.map((p) => ({
    label: p.name, type: 'checkbox', checked: p.id === state.selectedProfileID, click: () => state.selectProfile(p.id),
  }));
  items.push({ type: 'separator' }, { label: 'Manage', click: () => showManageWindow() });
  Menu.buildFromTemplate(items).popup({ window: overlay.win, x: Math.round(x), y: Math.round(y) });
});

// MARK: IPC from the Bots window

ipcMain.handle('manage:get', () => ({ profiles: state.profiles, selectedProfileID: state.selectedProfileID }));
ipcMain.handle('manage:add', () => state.addProfile());
ipcMain.handle('manage:delete', (_e, id) => state.deleteProfile(id));
ipcMain.handle('manage:select', (_e, id) => state.selectProfile(id));
ipcMain.handle('manage:update', (_e, id, fields) => state.updateProfile(id, fields));
ipcMain.handle('manage:addFiles', async (_e, id, files) => {
  const p = state.profiles.find((x) => x.id === id);
  if (!p) return '';
  const added = []; const failed = [];
  for (const f of files) {
    const block = await contextFiles.block(f);
    if (block) {
      const current = p.context.trim();
      p.context = current === '' ? block : current + '\n\n' + block;
      added.push(path.basename(f));
    } else {
      failed.push(path.basename(f));
    }
  }
  state.saveProfiles();
  return [added.length ? 'Added: ' + added.join(', ') : null, failed.length ? "Couldn't read: " + failed.join(', ') : null]
    .filter(Boolean).join(' · ');
});
ipcMain.handle('manage:choose', async () => {
  const r = await dialog.showOpenDialog(manageWindow(), {
    message: "Add files to this bot's context",
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents', extensions: contextFiles.EXTENSIONS }, { name: 'All Files', extensions: ['*'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

module.exports = { state, overlay, PAD };
