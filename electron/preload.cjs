// Narrow bridge between the page and Electron: folder picker, new window and
// menu commands. The page never gets Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('texugo', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  newWindow: () => ipcRenderer.invoke('new-window'),
  focus: () => ipcRenderer.invoke('focus-self'),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, action) => fn(action)),
});
