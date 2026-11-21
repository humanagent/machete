'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bots', {
  get: () => ipcRenderer.invoke('manage:get'),
  onProfiles: (fn) => ipcRenderer.on('profiles', (_e, p) => fn(p)),
  add: () => ipcRenderer.invoke('manage:add'),
  remove: (id) => ipcRenderer.invoke('manage:delete', id),
  select: (id) => ipcRenderer.invoke('manage:select', id),
  update: (id, fields) => ipcRenderer.invoke('manage:update', id, fields),
  addFiles: (id, files) => ipcRenderer.invoke('manage:addFiles', id, files),
  choose: () => ipcRenderer.invoke('manage:choose'),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
