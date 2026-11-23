// Exposes the screenshot previews' bridge as `window.previews`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import { listen } from '../../../core/preload/listen';
import type { PreviewsBridge, PreviewsState } from '../ipc';

const bridge: PreviewsBridge = {
  onState: listen<PreviewsState>(Channels.previewsState),
  send: (command) => ipcRenderer.send(Channels.previewsCommand, command),
};

contextBridge.exposeInMainWorld('previews', bridge);
