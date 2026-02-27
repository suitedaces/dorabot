import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, Notification as ElectronNotification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { is } from '@electron-toolkit/utils';
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { GatewayManager } from './gateway-manager';
import { GatewayBridge } from './gateway-bridge';
import { GATEWAY_LOG_PATH } from './dorabot-paths';

function readGatewayLogs(): string {
  try {
    if (!existsSync(GATEWAY_LOG_PATH)) return '';
    const content = readFileSync(GATEWAY_LOG_PATH, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(-30).join('\n').trim();
  } catch {
    return '';
  }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let gatewayManager: GatewayManager | null = null;
let gatewayBridge: GatewayBridge | null = null;
let updateCheckInterval: ReturnType<typeof setInterval> | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}

// --- Auto-updater setup ---
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(event: string, data?: any): void {
  mainWindow?.webContents.send('update-status', { event, ...data });
}

function setupAutoUpdater(): void {
  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: ${info.version}`);
    sendUpdateStatus('available', { version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] No updates available');
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: ${info.version}`);
    sendUpdateStatus('downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
    sendUpdateStatus('error', { message: err.message });
  });

  // IPC handlers for renderer
  ipcMain.on('update-check', () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Check failed:', err.message);
    });
  });

  ipcMain.on('update-download', () => {
    autoUpdater.downloadUpdate().catch((err) => {
      console.error('[updater] Download failed:', err.message);
    });
  });

  ipcMain.on('update-install', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
  });

  // Check for updates 10s after launch, then every 4 hours
  if (!is.dev) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
    updateCheckInterval = setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  }
}

function getIconPath(): string {
  return is.dev
    ? path.join(__dirname, '../../public/dorabot.png')
    : path.join(__dirname, '../renderer/dorabot.png');
}

function showAppNotification(title: string, body: string): void {
  try {
    if (!ElectronNotification.isSupported()) return;
    new ElectronNotification({
      title,
      body,
      icon: getIconPath(),
    }).show();
  } catch (err) {
    console.error('[main] Notification failed:', err);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // if renderer fails to load (e.g. after update restart), retry once
  mainWindow.webContents.on('did-fail-load', (_event, _code, _desc, url) => {
    console.error(`[main] Failed to load: ${url}`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[main] Retrying load...');
        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
          mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
        } else {
          mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
        }
      }
    }, 1000);
  });

  // Intercept Cmd+W: prevent window close, tell renderer to close a tab instead
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.meta || input.control) && input.key.toLowerCase() === 'w' && !input.shift) {
      event.preventDefault();
      mainWindow?.webContents.send('close-tab');
    }
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
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
    gatewayBridge?.setWindow(null);
  });

  // Wire up gateway bridge to this window
  gatewayBridge?.setWindow(mainWindow);
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

app.on('ready', async () => {
  if (app.dock) {
    app.dock.setIcon(getIconPath());
  }

  // Create gateway bridge (main process WebSocket to gateway)
  gatewayBridge = new GatewayBridge();

  // IPC: renderer sends messages through the bridge
  ipcMain.on('gateway:send', (_event, data: string) => {
    gatewayBridge?.send(data);
  });

  // IPC: renderer requests current bridge state
  ipcMain.handle('gateway:state', () => {
    return gatewayBridge?.getState() ?? { state: 'disconnected', reconnectCount: 0 };
  });

  // Start gateway server before creating UI
  gatewayManager = new GatewayManager({
    onReady: () => {
      console.log('[main] Gateway ready');
      updateTrayTitle('online');
      // Gateway is listening, now connect the bridge
      gatewayBridge?.connect();
    },
    onError: (error) => {
      console.error('[main] Gateway error:', error);
      updateTrayTitle('offline');
      mainWindow?.webContents.send('gateway-error', { error, logs: readGatewayLogs() });
    },
    onExit: (code) => {
      console.log('[main] Gateway exited:', code);
      if (!isQuitting) {
        updateTrayTitle('offline');
        mainWindow?.webContents.send('gateway-error', { error: `Gateway exited with code ${code}`, logs: readGatewayLogs() });
      }
    },
  });

  updateTrayTitle('starting...');
  createTray();

  // Start gateway (non-blocking - UI will show and connect when ready)
  gatewayManager.start().catch((err) => {
    console.error('[main] Gateway start failed:', err);
    updateTrayTitle('offline');
  });

  createWindow();
  setupAutoUpdater();

  ipcMain.on('dock-bounce', (_event, type: 'critical' | 'informational') => {
    if (app.dock) {
      app.dock.bounce(type);
    }
  });
  ipcMain.on('notify', (_event, payload: { title?: string; body?: string } | undefined) => {
    const title = payload?.title?.trim() || 'dorabot';
    const body = payload?.body?.trim() || '';
    if (!body) return;
    showAppNotification(title, body);
  });
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
  if (updateCheckInterval) clearInterval(updateCheckInterval);
  gatewayBridge?.disconnect();
  gatewayManager?.stop();
});
