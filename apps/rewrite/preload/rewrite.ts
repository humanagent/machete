// Exposes the rewrite panel's bridge as `window.rewrite`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import { exposeGhost } from '../../../core/preload/ghost';
import { listen } from '../../../core/preload/listen';
import type { RewriteBridge, RewriteState } from '../ipc';

const bridge: RewriteBridge = {
  onState: listen<RewriteState>(Channels.rewriteState),
  send: (command) => ipcRenderer.send(Channels.rewriteCommand, command),
};

contextBridge.exposeInMainWorld('rewrite', bridge);
exposeGhost();
