'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dictation', {
  on: (ch, fn) => ipcRenderer.on(`dictation:${ch}`, (_e, v) => fn(v)),
  menu: () => ipcRenderer.send('dictation:menu'),
});
