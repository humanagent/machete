// Exposes the permissions guide's bridge as `window.permissions`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels';
import type { PermissionsBridge, PermissionsState } from '../shared/ipc';
import { listen } from './listen';

const bridge: PermissionsBridge = {
  onState: listen<PermissionsState>(Channels.permissionsState),
  send: (command) => ipcRenderer.send(Channels.permissionsCommand, command),
};

contextBridge.exposeInMainWorld('permissions', bridge);
