// Exposes the overlay's typed bridge as `window.machete`. Nothing else from Node or Electron reaches the page.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import type { OverlayState } from '../domain';
import type { OverlayBridge } from '../ipc';
import { listen } from '../../../core/preload/listen';

const bridge: OverlayBridge = {
  onState: listen<OverlayState>(Channels.overlayState),
  send: (command) => ipcRenderer.send(Channels.overlayCommand, command),
};

contextBridge.exposeInMainWorld('machete', bridge);
