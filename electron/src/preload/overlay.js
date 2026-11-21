'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('machete', {
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  layout: (width, height) => ipcRenderer.send('overlay:layout', { width, height }),
  setQuestion: (q) => ipcRenderer.send('overlay:question', q),
  ask: (q) => ipcRenderer.send('overlay:ask', q),
  collapse: () => ipcRenderer.send('overlay:collapse'),
  toggleFollow: () => ipcRenderer.send('overlay:toggleFollow'),
  toggleCapture: () => ipcRenderer.send('overlay:toggleCapture'),
  toggleListening: () => ipcRenderer.send('overlay:toggleListening'),
  toggleTranscript: () => ipcRenderer.send('overlay:toggleTranscript'),
  reset: () => ipcRenderer.send('overlay:reset'),
  login: () => ipcRenderer.send('overlay:login'),
  setCardHeight: (height, persist) => ipcRenderer.send('overlay:cardHeight', { height, persist }),
  copy: (text) => ipcRenderer.send('overlay:copy', text),
  botsMenu: (x, y) => ipcRenderer.send('overlay:botsMenu', { x, y }),
  platform: process.platform,
});
