// Exposes the dictation pill's bridge as `window.dictation`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type { DictationBridge, DictationEvent } from '../shared/ipc';
import { listen } from './listen';

const bridge: DictationBridge = {
  onEvent: listen<DictationEvent>(Channels.dictationEvent),
  send: (command) => ipcRenderer.send(Channels.dictationCommand, command),
};

contextBridge.exposeInMainWorld('dictation', bridge);
