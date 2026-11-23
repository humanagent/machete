// Exposes the Bots window's typed bridge as `window.bots`.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { Channels } from '../../../core/channels';
import type { BotsState } from '../domain';
import type { BotsBridge } from '../ipc';
import { listen } from '../../../core/preload/listen';

const bridge: BotsBridge = {
  request: (request) => ipcRenderer.invoke(Channels.botsRequest, request),
  onState: listen<BotsState>(Channels.botsState),
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('bots', bridge);
