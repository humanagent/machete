// Exposes the Settings window's bridge as `window.settings`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../channels';
import type { SettingsBridge, SettingsState } from '../settings';
import { listen } from './listen';

const bridge: SettingsBridge = {
  onState: listen<SettingsState>(Channels.settingsState),
  send: (command) => ipcRenderer.send(Channels.settingsCommand, command),
};

contextBridge.exposeInMainWorld('settings', bridge);
