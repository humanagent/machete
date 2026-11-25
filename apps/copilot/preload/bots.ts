// Exposes the bots panel's bridge as `window.bots`.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { Channels } from '../../../core/channels';
import { exposeGhost } from '../../../core/preload/ghost';
import { listen } from '../../../core/preload/listen';
import type { BotsBridge, BotsShown } from '../ipc';

const bridge: BotsBridge = {
  onState: listen<BotsShown>(Channels.botsState),
  request: (request) => ipcRenderer.invoke(Channels.botsRequest, request),
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('bots', bridge);
exposeGhost();
