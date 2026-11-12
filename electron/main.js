// Electron shell: starts the local server, opens windows, native menus,
// folder pickers and "move to Trash".
import { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.TEXUGO_DATA_DIR = app.getPath('userData');
const { createServer } = await import('../server/index.js');

let server;
let quitting = false; // ⌘Q was asked and is waiting on the windows
const windows = new Set();

const IS_MAC = process.platform === 'darwin';

// macOS: the traffic lights inset in the page's top bar. Windows and
// Linux: the page's top bar is the title bar too, with the system's own
// minimize/maximize/close drawn over its right end.
function titleBar() {
  if (IS_MAC) return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } };
  const dark = nativeTheme.shouldUseDarkColors;
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: dark ? '#1b1e24' : '#efebe3', symbolColor: dark ? '#d6d3cc' : '#3b3a36', height: 44 }, autoHideMenuBar: true };
}

// `welcome`: a new window starts on the start screen. Without it the page
// reopens the most recent project, which is the one already open elsewhere.
function createWindow(openPath, { welcome = false } = {}) {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    title: 'TeXugo',
    ...titleBar(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15171c' : '#f7f4ee',
    icon: path.join(HERE, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  const url = new URL(server.url);
  if (openPath) url.searchParams.set('open', openPath);
  else if (welcome) url.searchParams.set('welcome', '1');
  win.loadURL(url.toString());
  // Links in the PDF or the UI open in the default browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    // Our own PDF windows open in the app; everything else in the browser.
    if (u.startsWith(`http://127.0.0.1:${server.port}/`) && u.includes('pdfwin=')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 1000,
          title: 'TeXugo — PDF',
          ...titleBar(),
          backgroundColor: nativeTheme.shouldUseDarkColors ? '#15171c' : '#f7f4ee',
          webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      };
    }
    if (/^https?:/.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, u) => {
    if (!u.startsWith(`http://127.0.0.1:${server.port}/`)) {
      e.preventDefault();
      if (/^https?:/.test(u)) shell.openExternal(u);
    }
  });
  win.webContents.session.setSpellCheckerLanguages(['pt-BR', 'en-US']);
  // The page cancels the unload while a tab has unsaved edits. Electron shows
  // nothing by itself in that case: ask here, or the window just stays open.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: L('Há alterações não salvas.'),
      detail: L('Se você não salvar, o que foi digitado desde o último salvamento se perde.'),
      buttons: [L('Salvar tudo e fechar'), L('Descartar'), L('Cancelar')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 1) return event.preventDefault(); // in Electron this lets the window close
    if (choice === 0) win.webContents.send('menu', 'saveAllThenClose');
    else quitting = false;
  });
  windows.add(win);
  win.on('closed', () => windows.delete(win));
  return win;
}

function send(action) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('menu', action);
}

// Native menu labels in English; the page translates itself (web/src/i18n.js).
const MENU_EN = {
  'Ajuda': 'Help', 'Atalhos e comandos': 'Shortcuts and commands', 'Licenças': 'Licenses',
  'Sobre o TeXugo': 'About TeXugo', 'Preferências…': 'Settings…', 'Ocultar TeXugo': 'Hide TeXugo', 'Encerrar TeXugo': 'Quit TeXugo', 'Arquivo': 'File',
  'Novo projeto…': 'New project…', 'Abrir pasta…': 'Open folder…', 'Nova janela': 'New window', 'Tela inicial': 'Start screen', 'Abrir arquivo rápido': 'Quick open',
  'Salvar': 'Save', 'Salvar todos': 'Save all', 'Fechar aba': 'Close tab', 'Fechar janela': 'Close window', 'Sair': 'Exit', 'Editar': 'Edit', 'Compilar': 'Build',
  'Compilar documento da aba': 'Compile the tab’s document', 'Compilar tudo que está aberto': 'Compile everything open', 'Mostrar no PDF': 'Show in PDF',
  'Há alterações não salvas.': 'There are unsaved changes.', 'Se você não salvar, o que foi digitado desde o último salvamento se perde.': 'If you do not save, what was typed since the last save is lost.',
  'Salvar tudo e fechar': 'Save all and close', 'Descartar': 'Discard', 'Cancelar': 'Cancel',
  'Abrir': 'Open', 'Comparar': 'Compare', 'Ler anotações': 'Read annotations', 'Adicionar': 'Add', 'Importar': 'Import', 'LaTeX, ZIP ou pasta': 'LaTeX, ZIP or folder',
  'Visualizar': 'View', 'Paleta de comandos': 'Command palette', 'Biblioteca de papers': 'Paper library', 'Painel inferior': 'Bottom panel', 'Ferramentas de desenvolvedor': 'Developer tools', 'Janela': 'Window',
};
let menuLang = 'pt';
try {
  menuLang = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'state.json'), 'utf8')).settings.lang === 'en' ? 'en' : 'pt';
} catch {}
const L = (label) => (menuLang === 'en' && MENU_EN[label]) || label;

function buildMenu() {
  const item = (label, accelerator, action) => ({ label: L(label), accelerator, click: () => send(action) });
  const template = [
    !IS_MAC ? null : { role: 'appMenu', submenu: [{ role: 'about', label: L('Sobre o TeXugo') }, { type: 'separator' }, item('Preferências…', 'CmdOrCtrl+,', 'settings'), { type: 'separator' }, { role: 'hide', label: L('Ocultar TeXugo') }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: L('Encerrar TeXugo') }] },
    {
      label: L('Arquivo'),
      submenu: [
        item('Novo projeto…', 'CmdOrCtrl+Shift+N', 'newProject'),
        ...(IS_MAC ? [] : [item('Preferências…', 'CmdOrCtrl+,', 'settings')]),
        item('Abrir pasta…', 'CmdOrCtrl+O', 'open'),
        { label: L('Nova janela'), accelerator: 'CmdOrCtrl+Alt+N', click: () => createWindow(null, { welcome: true }) },
        item('Tela inicial', null, 'welcome'),
        { type: 'separator' },
        item('Abrir arquivo rápido', 'CmdOrCtrl+P', 'quickOpen'),
        item('Salvar', 'CmdOrCtrl+S', 'save'),
        item('Salvar todos', 'CmdOrCtrl+Alt+S', 'saveAll'),
        item('Fechar aba', 'CmdOrCtrl+W', 'closeTab'),
        { type: 'separator' },
        { role: 'close', label: L('Fechar janela'), accelerator: 'CmdOrCtrl+Shift+W' },
        ...(IS_MAC ? [] : [{ type: 'separator' }, { role: 'quit', label: L('Sair') }]),
      ],
    },
    { role: 'editMenu', label: L('Editar') },
    {
      label: L('Compilar'),
      submenu: [item('Compilar documento da aba', 'CmdOrCtrl+Enter', 'compile'), item('Compilar tudo que está aberto', 'CmdOrCtrl+Shift+Enter', 'compileAll'), { type: 'separator' }, item('Mostrar no PDF', 'CmdOrCtrl+J', 'syncForward')],
    },
    {
      label: L('Visualizar'),
      submenu: [item('Paleta de comandos', 'CmdOrCtrl+K', 'palette'), item('Biblioteca de papers', 'CmdOrCtrl+Alt+B', 'library'), item('Painel inferior', 'CmdOrCtrl+Shift+Y', 'toggleBottom'), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools', label: L('Ferramentas de desenvolvedor') }],
    },
    { role: 'windowMenu', label: L('Janela') },
    { role: 'help', label: L('Ajuda'), submenu: [item('Atalhos e comandos', 'CmdOrCtrl+Shift+/', 'shortcuts'), { type: 'separator' }, { label: L('Licenças'), click: () => shell.openPath(path.join(app.getAppPath(), 'THIRD-PARTY-NOTICES.txt')) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template.filter(Boolean)));
}

ipcMain.handle('pick-folder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: L('Abrir') });
  return r.canceled ? null : r.filePaths[0];
});
// A received version: a .tex, a .zip or a folder.
ipcMain.handle('pick-version', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'openDirectory'], filters: [{ name: L('LaTeX, ZIP ou pasta'), extensions: ['tex', 'zip'] }], buttonLabel: L('Comparar') });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-pdf', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }], buttonLabel: L('Ler anotações') });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-pdfs', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }], buttonLabel: L('Adicionar') });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('pick-bib', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'BibTeX', extensions: ['bib'] }], buttonLabel: L('Importar') });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('focus-self', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  return true;
});
ipcMain.handle('set-lang', (_e, l) => {
  menuLang = l === 'en' ? 'en' : 'pt';
  buildMenu();
  return true;
});
// The page saved everything after "Salvar tudo e fechar": finish what was asked.
ipcMain.handle('close-saved', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (quitting) app.quit();
  else if (win) win.close();
  return true;
});
ipcMain.handle('new-window', () => {
  createWindow(null, { welcome: true });
  return true;
});

// A folder handed to the app on the command line (Windows, Linux, `electron
// . folder`): any existing directory except the app's own.
const ownDirs = [app.getAppPath(), path.dirname(process.execPath)].map((d) => path.resolve(d));
function folderArg(argv) {
  return argv.slice(1).find((a) => {
    if (!path.isAbsolute(a) || ownDirs.includes(path.resolve(a))) return false;
    try {
      return fs.statSync(a).isDirectory();
    } catch {
      return false;
    }
  });
}

// One TeXugo at a time: a second launch (common on Windows and Linux) would
// start a second server writing the same state.json. It hands its folder to
// this one, which opens a window, and quits.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', (_e, argv) => {
  if (!server) return;
  const p = folderArg(argv);
  const win = createWindow(p || null, { welcome: !p });
  if (win && win.focus) win.focus();
});

// open-file can arrive before the server is up (double-click on a folder
// that launches the app): keep it and open it once ready.
const pendingOpen = [];

app.setName('TeXugo');
app.whenReady().then(async () => {
  if (!primary) return;
  server = await createServer({
    hooks: {
      trash: (p) => shell.trashItem(p),
      reveal: (p) => shell.showItemInFolder(p),
      openPath: async (p) => {
        const err = await shell.openPath(p);
        if (err) throw new Error(err);
      },
      openUrl: (u) => shell.openExternal(u),
    },
  });
  buildMenu();
  if (IS_MAC && app.dock) app.dock.setIcon(path.join(HERE, '..', 'build', 'icon.png'));
  const argPath = folderArg(process.argv);
  if (pendingOpen.length) for (const p of pendingOpen.splice(0)) createWindow(p);
  else createWindow(argPath);
  app.on('activate', () => {
    if (!windows.size) createWindow();
  });
});

// Opening a folder on the Dock icon or with `open -a TeXugo folder`.
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (server) createWindow(p);
  else pendingOpen.push(p);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// The server must outlive a cancelled quit: with unsaved edits the windows
// may stay open, and saving needs it. will-quit fires only once they closed.
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => server && server.close());
