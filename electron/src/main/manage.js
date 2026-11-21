'use strict';
// "Machete · Bots" window (ManageWindowController + ManageView).
const path = require('path');
const { BrowserWindow, app } = require('electron');

let win = null;

function showManageWindow() {
  if (!win) {
    win = new BrowserWindow({
      width: 820, height: 560,
      title: 'Machete · Bots',
      show: false,
      minimizable: true,
      resizable: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'manage.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'manage', 'index.html'));
    win.once('ready-to-show', () => { win.center(); win.show(); });
    win.on('close', (e) => { e.preventDefault(); win.hide(); }); // isReleasedWhenClosed = false
  } else {
    win.show();
  }
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
}

function manageWindow() { return win; }
function destroyManageWindow() { if (win) { win.removeAllListeners('close'); win.destroy(); win = null; } }

module.exports = { showManageWindow, manageWindow, destroyManageWindow };
