// Exposes the permissions guide's bridge as `window.permissions`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../channels';
import type { PermissionsBridge, PermissionsState } from '../ipc';
import { listen } from './listen';

const bridge: PermissionsBridge = {
  onState: listen<PermissionsState>(Channels.permissionsState),
  send: (command) => ipcRenderer.send(Channels.permissionsCommand, command),
};

contextBridge.exposeInMainWorld('permissions', bridge);
