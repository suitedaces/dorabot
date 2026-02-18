import { contextBridge, shell, ipcRenderer } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { GATEWAY_TOKEN_PATH } from './dorabot-paths';

// Read token once at preload time — not exposed as a re-callable function.
// This prevents malicious scripts from repeatedly extracting the token.
const tokenPath = GATEWAY_TOKEN_PATH;
const gatewayToken = existsSync(tokenPath)
  ? readFileSync(tokenPath, 'utf-8').trim()
  : null;

let tokenDelivered = false;

// Listen for token push from main process (handles fresh install race condition)
ipcRenderer.on('gateway-token', (_event, token: string) => {
  if (token) {
    try { localStorage.setItem('dorabot:gateway-token', token); } catch {}
    // Dispatch a custom event so the gateway client can retry connection
    window.dispatchEvent(new CustomEvent('dorabot:token-available'));
  }
});

const electronAPI = {
  platform: process.platform,
  appVersion: (() => { try { return require('electron').app?.getVersion?.() || process.env.npm_package_version || '0.0.0'; } catch { return '0.0.0'; } })(),
  consumeGatewayToken: (): string | null => {
    if (tokenDelivered) return null;
    tokenDelivered = true;
    return gatewayToken;
  },
  openExternal: (url: string) => shell.openExternal(url),
  dockBounce: (type: 'critical' | 'informational') => ipcRenderer.send('dock-bounce', type),
  notify: (title: string, body: string) => ipcRenderer.send('notify', { title, body }),
  onCloseTab: (cb: () => void) => {
    ipcRenderer.on('close-tab', cb);
    return () => { ipcRenderer.removeListener('close-tab', cb); };
  },
  // Auto-update IPC
  checkForUpdate: () => ipcRenderer.send('update-check'),
  downloadUpdate: () => ipcRenderer.send('update-download'),
  installUpdate: () => ipcRenderer.send('update-install'),
  onUpdateStatus: (cb: (status: { event: string; version?: string; percent?: number; message?: string; releaseNotes?: string }) => void) => {
    const handler = (_e: any, status: any) => cb(status);
    ipcRenderer.on('update-status', handler);
    return () => { ipcRenderer.removeListener('update-status', handler); };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
