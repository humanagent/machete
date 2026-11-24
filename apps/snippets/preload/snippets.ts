// Exposes the snippets panel's bridge as `window.snippets`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import { exposeGhost } from '../../../core/preload/ghost';
import { listen } from '../../../core/preload/listen';
import type { SnippetsBridge, SnippetsState } from '../ipc';

const bridge: SnippetsBridge = {
  onState: listen<SnippetsState>(Channels.snippetsState),
  send: (command) => ipcRenderer.send(Channels.snippetsCommand, command),
};

contextBridge.exposeInMainWorld('snippets', bridge);
exposeGhost();
