import { contextBridge, shell, ipcRenderer } from 'electron';

// Listen for gateway errors from main process (gateway failed to start)
ipcRenderer.on('gateway-error', (_event, payload: { error: string; logs: string }) => {
  window.dispatchEvent(new CustomEvent('dorabot:gateway-error', { detail: payload }));
});

const electronAPI = {
  platform: process.platform,
  appVersion: (() => { try { return require('electron').app?.getVersion?.() || process.env.npm_package_version || '0.0.0'; } catch { return '0.0.0'; } })(),
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
  // Gateway bridge IPC (WebSocket runs in main process, renderer talks via IPC)
  gatewaySend: (data: string) => ipcRenderer.send('gateway:send', data),
  gatewayState: (): Promise<{ state: string; reconnectCount: number; connectId?: string }> => ipcRenderer.invoke('gateway:state'),
  onGatewayMessage: (cb: (data: string) => void) => {
    const handler = (_e: any, data: string) => cb(data);
    ipcRenderer.on('gateway:message', handler);
    return () => { ipcRenderer.removeListener('gateway:message', handler); };
  },
  onGatewayState: (cb: (state: { state: string; reason?: string; reconnectInMs?: number; reconnectCount: number; connectId?: string }) => void) => {
    const handler = (_e: any, state: any) => cb(state);
    ipcRenderer.on('gateway:state', handler);
    return () => { ipcRenderer.removeListener('gateway:state', handler); };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
