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
  // Embedded browser IPC (main process owns WebContentsView + CDP debugger)
  browser: {
    create: (opts: { url?: string; background?: boolean } = {}): Promise<string> =>
      ipcRenderer.invoke('browser:create', opts),
    destroy: (pageId: string): Promise<true> =>
      ipcRenderer.invoke('browser:destroy', pageId),
    setBounds: (pageId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<true> =>
      ipcRenderer.invoke('browser:set-bounds', pageId, bounds),
    hide: (pageId: string): Promise<true> =>
      ipcRenderer.invoke('browser:hide', pageId),
    setUserFocus: (pageId: string | null): Promise<true> =>
      ipcRenderer.invoke('browser:set-user-focus', pageId),
    navigate: (pageId: string, params: { type: 'url' | 'back' | 'forward' | 'reload'; url?: string }): Promise<{ ok: true }> =>
      ipcRenderer.invoke('browser:navigate', pageId, params),
    pause: (pageId: string, paused: boolean): Promise<true> =>
      ipcRenderer.invoke('browser:pause', pageId, paused),
    listPages: (): Promise<BrowserTabSummary[]> =>
      ipcRenderer.invoke('browser:list-pages'),
    onTabCreated: (cb: (summary: BrowserTabSummary) => void) => {
      const handler = (_e: any, payload: BrowserTabSummary) => cb(payload);
      ipcRenderer.on('browser:tab-created', handler);
      return () => { ipcRenderer.removeListener('browser:tab-created', handler); };
    },
    onTabUpdated: (cb: (summary: BrowserTabSummary) => void) => {
      const handler = (_e: any, payload: BrowserTabSummary) => cb(payload);
      ipcRenderer.on('browser:tab-updated', handler);
      return () => { ipcRenderer.removeListener('browser:tab-updated', handler); };
    },
    onTabClosed: (cb: (payload: { pageId: string }) => void) => {
      const handler = (_e: any, payload: { pageId: string }) => cb(payload);
      ipcRenderer.on('browser:tab-closed', handler);
      return () => { ipcRenderer.removeListener('browser:tab-closed', handler); };
    },
    onTabPaused: (cb: (payload: { pageId: string; paused: boolean }) => void) => {
      const handler = (_e: any, payload: any) => cb(payload);
      ipcRenderer.on('browser:tab-paused', handler);
      return () => { ipcRenderer.removeListener('browser:tab-paused', handler); };
    },
    onTabUserActivity: (cb: (payload: { pageId: string; at: number }) => void) => {
      const handler = (_e: any, payload: any) => cb(payload);
      ipcRenderer.on('browser:tab-user-activity', handler);
      return () => { ipcRenderer.removeListener('browser:tab-user-activity', handler); };
    },
    onTabAgentActivity: (cb: (payload: { pageId: string; at: number }) => void) => {
      const handler = (_e: any, payload: any) => cb(payload);
      ipcRenderer.on('browser:tab-agent-activity', handler);
      return () => { ipcRenderer.removeListener('browser:tab-agent-activity', handler); };
    },
  },
};

export type BrowserTabSummary = {
  pageId: string;
  url: string;
  title: string;
  favicon: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  paused: boolean;
  userFocused: boolean;
  lastUserInteractionAt: number;
  lastAgentActionAt: number;
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
