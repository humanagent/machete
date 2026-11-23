// Exposes the clipboard picker's bridge as `window.clipboard`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import { listen } from '../../../core/preload/listen';
import type { ClipboardBridge, ClipboardState } from '../ipc';

const bridge: ClipboardBridge = {
  onState: listen<ClipboardState>(Channels.clipboardState),
  send: (command) => ipcRenderer.send(Channels.clipboardCommand, command),
};

contextBridge.exposeInMainWorld('clipboardHistory', bridge);
