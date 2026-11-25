// Exposes the dictation pill's bridge as `window.dictation`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import type { DictationBridge, DictationEvent } from '../ipc';
import { exposeGhost } from '../../../core/preload/ghost';
import { listen } from '../../../core/preload/listen';

const bridge: DictationBridge = {
  onEvent: listen<DictationEvent>(Channels.dictationEvent),
  send: (command) => ipcRenderer.send(Channels.dictationCommand, command),
};

contextBridge.exposeInMainWorld('dictation', bridge);
exposeGhost();
