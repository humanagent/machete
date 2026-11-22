// Exposes the overlay's typed bridge as `window.machete`. Nothing else from Node or Electron reaches the page.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type { OverlayState } from '../shared/domain';
import type { OverlayBridge } from '../shared/ipc';
import { listen } from './listen';

const bridge: OverlayBridge = {
  onState: listen<OverlayState>(Channels.overlayState),
  send: (command) => ipcRenderer.send(Channels.overlayCommand, command),
};

contextBridge.exposeInMainWorld('machete', bridge);
