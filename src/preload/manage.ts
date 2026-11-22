// Exposes the Bots window's typed bridge as `window.bots`.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { Channels } from '../shared/channels';
import type { BotsState } from '../shared/domain';
import type { BotsBridge } from '../shared/ipc';
import { listen } from './listen';

const bridge: BotsBridge = {
  request: (request) => ipcRenderer.invoke(Channels.botsRequest, request),
  onState: listen<BotsState>(Channels.botsState),
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('bots', bridge);
