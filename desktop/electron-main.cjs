const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

let mainWindow = null;
let isQuitting = false;

app.setName('统票票');

function waitForServer(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error('本地服务启动超时'));
        else setTimeout(probe, 180);
      });
    };
    probe();
  });
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  const appRoot = path.join(__dirname, 'app');
  const workRoot = path.join(app.getPath('userData'), 'jobs');
  const outputRoot = app.getPath('desktop');
  const poppler = app.isPackaged
    ? path.join(process.resourcesPath, 'poppler', 'Library', 'bin', 'pdftoppm.exe')
    : path.join(__dirname, 'resources', 'poppler', 'Library', 'bin', 'pdftoppm.exe');
  fs.mkdirSync(workRoot, { recursive: true });
  process.env.BALLOT_APP_ROOT = appRoot;
  process.env.BALLOT_WORK_DIR = workRoot;
  process.env.BALLOT_OUTPUT_DIR = outputRoot;
  process.env.BALLOT_OFFLINE = '1';
  process.env.PDFTOPPM = poppler;
  process.env.PDFINFO = path.join(path.dirname(poppler), 'pdfinfo.exe');
  process.env.PORT = '4173';
  await import(pathToFileURL(path.join(appRoot, 'server.mjs')).href);
  await waitForServer(4173);
  mainWindow = new BrowserWindow({
    title: '统票票·智能选票统计系统',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    width: 1280,
    height: 850,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL('http://127.0.0.1:4173');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(createWindow).catch(err => { dialog.showErrorBox('统票票启动失败', err.stack || err.message); app.quit(); });
  app.on('window-all-closed', () => { isQuitting = true; app.quit(); });
  app.on('before-quit', () => { isQuitting = true; });
}
