// Electron shell: starts the local server, opens windows, native menus,
// folder pickers and "move to Trash".
import { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.TEXUGO_DATA_DIR = app.getPath('userData');
const { createServer } = await import('../server/index.js');

let server;
const windows = new Set();

function createWindow(openPath) {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    title: 'TeXugo',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
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
  win.loadURL(url.toString());
  // Links in the PDF or the UI open in the default browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
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
  windows.add(win);
  win.on('closed', () => windows.delete(win));
  return win;
}

function send(action) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('menu', action);
}

function buildMenu() {
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => send(action) });
  const template = [
    { role: 'appMenu', submenu: [{ role: 'about', label: 'Sobre o TeXugo' }, { type: 'separator' }, item('Preferências…', 'Cmd+,', 'settings'), { type: 'separator' }, { role: 'hide', label: 'Ocultar TeXugo' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: 'Encerrar TeXugo' }] },
    {
      label: 'Arquivo',
      submenu: [
        item('Novo projeto…', 'Cmd+Shift+N', 'newProject'),
        item('Abrir pasta…', 'Cmd+O', 'open'),
        { label: 'Nova janela', accelerator: 'Cmd+Alt+N', click: () => createWindow() },
        item('Tela inicial', null, 'welcome'),
        { type: 'separator' },
        item('Abrir arquivo rápido', 'Cmd+P', 'quickOpen'),
        item('Salvar', 'Cmd+S', 'save'),
        item('Salvar todos', 'Cmd+Alt+S', 'saveAll'),
        item('Fechar aba', 'Cmd+W', 'closeTab'),
        { type: 'separator' },
        { role: 'close', label: 'Fechar janela', accelerator: 'Cmd+Shift+W' },
      ],
    },
    { role: 'editMenu', label: 'Editar' },
    {
      label: 'Compilar',
      submenu: [item('Compilar documento da aba', 'Cmd+Enter', 'compile'), item('Compilar tudo que está aberto', 'Cmd+Shift+Enter', 'compileAll'), { type: 'separator' }, item('Mostrar no PDF', 'Cmd+J', 'syncForward')],
    },
    {
      label: 'Visualizar',
      submenu: [item('Paleta de comandos', 'Cmd+K', 'palette'), item('Painel inferior', 'Cmd+Shift+Y', 'toggleBottom'), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }],
    },
    { role: 'windowMenu', label: 'Janela' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('pick-folder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Abrir' });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('new-window', () => {
  createWindow();
  return true;
});

app.setName('TeXugo');
app.whenReady().then(async () => {
  server = await createServer({
    hooks: {
      trash: (p) => shell.trashItem(p),
      reveal: (p) => shell.showItemInFolder(p),
    },
  });
  buildMenu();
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(HERE, '..', 'build', 'icon.png'));
  const argPath = process.argv.slice(1).find((a) => a.startsWith('/') && !a.includes('electron'));
  createWindow(argPath);
  app.on('activate', () => {
    if (!windows.size) createWindow();
  });
});

// Opening a folder on the Dock icon or with `open -a TeXugo folder`.
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (server) createWindow(p);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => server && server.close());
