'use strict';
// Global hotkeys (AppDelegate.setupHotKeys). On macOS, Electron registers them through Carbon like the native app,
// so no Accessibility permission is needed. On Windows, Alt plays the role of ⌥ and Ctrl of ⌘.
const { globalShortcut } = require('electron');
const log = require('./log');

function registerHotKeys(state, overlay) {
  const map = [
    ['Alt+Return', () => state.ask()],
    ['Alt+\\', () => overlay.toggle()],
    ['CommandOrControl+[', () => overlay.toggle()],
    ['Alt+M', () => state.toggleListening()],
    ['Alt+S', () => state.ask('whatToSay')],
    ['Alt+R', () => state.reset()],
    ['Alt+Space', () => overlay.focusInput()],
  ];
  for (const [accel, fn] of map) {
    const ok = globalShortcut.register(accel, fn);
    if (!ok) log.write(`hotkeys: failed to register ${accel}`);
  }
}

module.exports = { registerHotKeys };
