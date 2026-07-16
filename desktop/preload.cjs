const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopApp', {
  offline: true,
  platform: process.platform,
  openHistoryFile: (filename) => ipcRenderer.invoke('history:open', filename),
  revealHistoryFile: (filename) => ipcRenderer.invoke('history:reveal', filename),
});
