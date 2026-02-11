import { app, BrowserWindow, Tray, Menu, nativeImage, session } from 'electron';
import { is } from '@electron-toolkit/utils';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function getIconPath(): string {
  return is.dev
    ? path.join(__dirname, '../../public/dorabot.png')
    : path.join(__dirname, '../renderer/dorabot.png');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // minimize to tray on close
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 18, height: 18 });

  tray = new Tray(icon);
  tray.setToolTip('dorabot');
  updateTrayTitle('idle');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open dorabot', click: showWindow },
    { type: 'separator' },
    { label: 'Status: idle', enabled: false, id: 'status' },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', showWindow);
}

function showWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function updateTrayTitle(status: string): void {
  if (tray) {
    tray.setTitle(` ${status}`);
  }
}

// Trust the self-signed gateway TLS cert for localhost connections
app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.on('ready', () => {
  // Accept self-signed gateway cert for localhost WebSocket connections
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === 'localhost' || request.hostname === '127.0.0.1') {
      callback(0); // trust
    } else {
      callback(-3); // use default verification
    }
  });

  if (app.dock) {
    app.dock.setIcon(getIconPath());
  }
  createTray();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});
