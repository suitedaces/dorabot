import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, shell, Notification as ElectronNotification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { is } from '@electron-toolkit/utils';
import * as path from 'path';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { GatewayManager } from './gateway-manager';
import { GatewayBridge } from './gateway-bridge';
import { BrowserController } from './browser-controller';
import { registerBrowserIpc, handleAgentRpc } from './browser-ipc';
import { GATEWAY_LOG_PATH, DORABOT_LOGS_DIR } from './dorabot-paths';
import { migrateBrowserProfile } from '../../scripts/migrate-browser-profile';

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
let browserController: BrowserController | null = null;
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
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const UPDATER_LOG_PATH = path.join(DORABOT_LOGS_DIR, 'updater.log');

function ulog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(`[updater] ${msg}`);
  try {
    mkdirSync(DORABOT_LOGS_DIR, { recursive: true });
    appendFileSync(UPDATER_LOG_PATH, line + '\n');
  } catch {}
}

function sendUpdateStatus(event: string, data?: any): void {
  mainWindow?.webContents.send('update-status', { event, ...data });
}

function setupAutoUpdater(): void {
  ulog(`App version: ${app.getVersion()}`);

  autoUpdater.on('checking-for-update', () => {
    ulog('Checking for updates...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    ulog(`Update available: ${info.version}`);
    sendUpdateStatus('available', { version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on('update-not-available', (info) => {
    ulog(`Up to date (${info.version})`);
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    if (Math.round(progress.percent) % 25 === 0) ulog(`Download: ${Math.round(progress.percent)}%`);
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    ulog(`Update downloaded: ${info.version}`);
    sendUpdateStatus('downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    ulog(`Error: ${err.message}\n${err.stack ?? ''}`);
    sendUpdateStatus('error', { message: err.message });
  });

  // IPC handlers for renderer
  ipcMain.on('update-check', () => {
    ulog('Manual check requested');
    autoUpdater.checkForUpdates().catch((err) => {
      ulog(`Check failed: ${err.message}`);
    });
  });

  ipcMain.on('update-download', () => {
    ulog('Manual download requested');
    autoUpdater.downloadUpdate().catch((err) => {
      ulog(`Download failed: ${err.message}`);
    });
  });

  ipcMain.on('update-install', () => {
    ulog('Install requested, calling quitAndInstall...');
    isQuitting = true;
    autoUpdater.quitAndInstall();
    // Safety net: if quitAndInstall didn't trigger quit within 5s
    // (e.g. Squirrel deadlock), force restart the app
    setTimeout(() => {
      ulog('quitAndInstall did not quit within 5s, forcing restart');
      app.relaunch();
      app.exit(0);
    }, 5000);
  });

  // Check for updates 10s after launch, then every 30 minutes
  if (!is.dev) {
    setTimeout(() => autoUpdater.checkForUpdates().catch((e) => ulog(`Initial check failed: ${e.message}`)), 10_000);
    updateCheckInterval = setInterval(() => autoUpdater.checkForUpdates().catch((e) => ulog(`Periodic check failed: ${e.message}`)), 30 * 60 * 1000);
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

  // Electron #42059: WebContentsView suspends rendering while the owning
  // window is inactive. On reopen from dock / unminimize / app activate, the
  // view can be blank for a second until Chromium decides to paint again.
  // Forcing an invalidate on each show/focus/restore side-steps that pause.
  const repaintBrowserViews = () => {
    try { browserController?.invalidateAllViews(); } catch {}
  };
  mainWindow.on('show', repaintBrowserViews);
  mainWindow.on('focus', repaintBrowserViews);
  mainWindow.on('restore', repaintBrowserViews);

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

  // Open external links in the system browser instead of navigating the Electron window
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appOrigin = mainWindow?.webContents.getURL();
    if (appOrigin && new URL(url).origin !== new URL(appOrigin).origin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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
    gatewayBridge?.setWindow(null);
    browserController?.setHostWindow(null);
  });

  // Wire up gateway bridge to this window
  gatewayBridge?.setWindow(mainWindow);
  browserController?.setHostWindow(mainWindow);
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

  // Create browser controller (owns WebContentsView tabs)
  browserController = new BrowserController();
  registerBrowserIpc(browserController, () => mainWindow);

  // one-time cookie migration from legacy playwright profile. fire-and-forget;
  // sentinel at ~/.dorabot/browser-migrated ensures we only run once.
  migrateBrowserProfile(browserController.getSession()).catch((err) => {
    console.error('[main] browser profile migration threw:', err);
  });

  // Create gateway bridge (main process WebSocket to gateway)
  gatewayBridge = new GatewayBridge();
  gatewayBridge.setBrowserRpcHandler(async (method, params) => {
    if (!browserController) throw new Error('browser not initialised');
    return await handleAgentRpc(browserController, method, params);
  });

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
  browserController?.shutdown();
  gatewayBridge?.disconnect();
  gatewayManager?.stop();
});
