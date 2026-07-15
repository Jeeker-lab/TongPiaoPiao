const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('desktopApp', { offline: true, platform: process.platform });
