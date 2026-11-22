'use strict';
// The menu bar item (AppDelegate.setupStatusItem / rebuildMenu), same items and order as the native app.
const path = require('path');
const { Tray, Menu, nativeImage, app } = require('electron');
const { LANGUAGES } = require('./state');

function createTray(state, actions) {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('Machete');

  const build = () => {
    const radio = (label, checked, click) => ({ label, type: 'checkbox', checked, click });
    const template = [
      { label: 'Show / Hide  (⌘[)', click: actions.togglePanel },
      { label: 'Ask about screen  (⌥↩)', click: () => state.ask() },
      { label: state.isListening ? 'Stop listening  (⌥M)' : 'Start listening  (⌥M)', click: () => state.toggleListening() },
      { label: 'What should I say?  (⌥S)', click: () => state.ask('whatToSay') },
      radio('Auto-answer questions', state.autoAnswer, () => state.setAutoAnswer(!state.autoAnswer)),
      { label: 'Clear  (⌥R)', click: () => state.reset() },
      { type: 'separator' },
      { label: 'Transcription language', submenu: LANGUAGES.map(([code, name]) => radio(name, state.language === code, () => state.setLanguage(code))) },
      { label: 'Transparency', submenu: [[0.35, 'More see-through'], [0.55, 'Balanced'], [0.8, 'Solid']]
        .map(([v, name]) => radio(name, Math.abs(state.glassOpacity - v) < 0.01, () => state.setGlassOpacity(v))) },
      { label: 'Model', submenu: state.models.map((m) => radio(m.name, state.model === m.slug, () => state.setModel(m.slug))) },
    ];
    if (state.directSignedIn) {
      template.push({ label: 'Signed in with ChatGPT ✓', enabled: false }, { label: 'Sign out', click: () => state.signOut() });
    } else {
      template.push({ label: 'Sign in with ChatGPT…', click: () => state.login() });
    }
    template.push({ type: 'separator' }, { label: 'Quit Machete', click: () => app.quit() });
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };

  build();
  let queued = false;
  const rebuild = () => { if (queued) return; queued = true; setImmediate(() => { queued = false; build(); }); };
  state.on('menu', rebuild);
  return { tray, rebuild };
}

module.exports = { createTray };
