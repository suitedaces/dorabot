/**
 * browser-host — headless Electron process that hosts the embedded browser
 * when no desktop app is connected to the gateway.
 *
 * Boot sequence:
 *   1. app.whenReady() — Electron initialised
 *   2. Create hidden BrowserWindow (host for WebContentsView overlays)
 *   3. Instantiate BrowserController, attach to the hidden window
 *   4. Open HostBridge, connect to gateway WS, register 'browser' capability
 *   5. Route incoming browser.* RPCs through handleAgentRpc
 *
 * The window is never shown — WebContentsView tabs live inside its
 * contentView but no visible frame is rendered. Agent-driven only.
 *
 * Exit: on app quit, detach debuggers and close the WS bridge cleanly.
 */
import { app, BrowserWindow } from 'electron';
import { BrowserController } from '../../../desktop/electron/browser-controller';
import { handleAgentRpc } from '../../../desktop/electron/browser-ipc';
import { HostBridge } from './host-bridge';

// Enable fully offscreen / headless. Disable dock on macOS.
app.commandLine.appendSwitch('disable-gpu-compositing');

let hostWindow: BrowserWindow | null = null;
let controller: BrowserController | null = null;
let bridge: HostBridge | null = null;

function createHostWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: false,
    },
  });
  // Prevent accidental show via focus / shortcuts
  win.setMenu(null);
  return win;
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  hostWindow = createHostWindow();

  controller = new BrowserController();
  controller.setHostWindow(hostWindow);

  bridge = new HostBridge(async (method, params) => {
    if (!controller) throw new Error('browser controller not initialised');
    return await handleAgentRpc(controller, method, params);
  });
  bridge.connect();

  console.log('[browser-host] ready');
});

app.on('window-all-closed', () => {
  // registering this listener is enough to suppress electron's default
  // auto-quit on non-darwin when the hidden window closes. we never want
  // the headless host to die while the gateway is still up.
});

app.on('before-quit', () => {
  try { bridge?.disconnect(); } catch {}
  try { controller?.shutdown(); } catch {}
});

// Graceful shutdown on SIGINT / SIGTERM
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[browser-host] got ${sig}, shutting down`);
    try { bridge?.disconnect(); } catch {}
    try { controller?.shutdown(); } catch {}
    app.quit();
  });
}
