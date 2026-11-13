// Narrow bridge between the page and Electron: folder picker, new window and
// menu commands. The page never gets Node access.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('texugo', {
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickVersion: () => ipcRenderer.invoke('pick-version'),
  pickBib: () => ipcRenderer.invoke('pick-bib'),
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),
  pickPdfs: () => ipcRenderer.invoke('pick-pdfs'),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  // The disk path of a file dropped on the page ('' when it has none).
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  newWindow: () => ipcRenderer.invoke('new-window'),
  focus: () => ipcRenderer.invoke('focus-self'),
  closeSaved: () => ipcRenderer.invoke('close-saved'),
  setLang: (l) => ipcRenderer.invoke('set-lang', l),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, action) => fn(action)),
});
