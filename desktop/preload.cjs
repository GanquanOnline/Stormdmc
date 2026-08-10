const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('snowstormDesktop', {
  isDesktop: true,
  saveFile: payload => ipcRenderer.invoke('snowstorm:save-file', payload),
  getInfo: () => ipcRenderer.invoke('snowstorm:info')
});
