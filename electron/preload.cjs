// Narrow bridge between the page and Electron: folder picker, new window and
// menu commands. The page never gets Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('texugo', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickVersion: () => ipcRenderer.invoke('pick-version'),
  pickBib: () => ipcRenderer.invoke('pick-bib'),
  newWindow: () => ipcRenderer.invoke('new-window'),
  focus: () => ipcRenderer.invoke('focus-self'),
  setLang: (l) => ipcRenderer.invoke('set-lang', l),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, action) => fn(action)),
});
