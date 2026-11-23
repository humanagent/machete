// Exposes the copilot's typed bridge as `window.machete`. Nothing else from Node or Electron reaches the page.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import type { CopilotState } from '../domain';
import type { CopilotBridge, CopilotKeys } from '../ipc';
import { listen } from '../../../core/preload/listen';

const bridge: CopilotBridge = {
  onState: listen<CopilotState>(Channels.copilotState),
  onKeys: listen<CopilotKeys>(Channels.copilotKeys),
  send: (command) => ipcRenderer.send(Channels.copilotCommand, command),
};

contextBridge.exposeInMainWorld('machete', bridge);
