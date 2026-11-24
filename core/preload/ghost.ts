import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../channels';
import type { GhostBridge } from '../invisibility';
import { listen } from './listen';

/** Exposes the ghost's bridge as `window.ghost`. */
export const exposeGhost = () => {
  const bridge: GhostBridge = {
    onState: listen<boolean>(Channels.ghostState),
    toggle: () => ipcRenderer.send(Channels.ghostToggle),
  };
  contextBridge.exposeInMainWorld('ghost', bridge);
};
