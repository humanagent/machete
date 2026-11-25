// Exposes the screenshot editor's bridge as `window.editor`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import { exposeGhost } from '../../../core/preload/ghost';
import { listen } from '../../../core/preload/listen';
import type { EditorBridge, EditorState } from '../ipc';

const bridge: EditorBridge = {
  onState: listen<EditorState>(Channels.editorState),
  send: (command) => ipcRenderer.send(Channels.editorCommand, command),
};

contextBridge.exposeInMainWorld('editor', bridge);
exposeGhost();
