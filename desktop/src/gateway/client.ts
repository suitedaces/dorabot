export type GatewayConnectionState = 'connecting' | 'connected' | 'disconnected';

type GatewayEventPayload = {
  event: string;
  data: unknown;
  seq?: number;
};

export type GatewayClientNotification =
  | {
    type: 'connection';
    state: GatewayConnectionState;
    reason?: string;
    reconnectInMs?: number;
    reconnectCount: number;
    connectId?: string;
  }
  | {
    type: 'event';
    payload: GatewayEventPayload;
  };

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: number;
  method: string;
};

type GatewayClientOptions = {
  url?: string;
};

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const DEFAULT_WEB_GATEWAY_URL = 'ws://localhost:18889';

// Token consumed once from preload, cached in module scope.
// If preload didn't have it yet (fresh install race), retry via localStorage.
let cachedToken: string | null = null;

function getToken(): string {
  if (cachedToken) return cachedToken;

  const consumed = (window as any).electronAPI?.consumeGatewayToken?.() || '';
  if (consumed) {
    cachedToken = consumed;
    try { localStorage.setItem('dorabot:gateway-token', consumed); } catch {}
    return consumed;
  }

  const envToken = import.meta.env.VITE_GATEWAY_TOKEN?.trim() || '';
  if (envToken) {
    cachedToken = envToken;
    try { localStorage.setItem('dorabot:gateway-token', envToken); } catch {}
    return envToken;
  }

  const stored = localStorage.getItem('dorabot:gateway-token') || '';
  if (stored) {
    cachedToken = stored;
    return stored;
  }

  return '';
}

function classifyDisconnect(code: number, reason: string): string {
  if (reason) return reason;
  if (code === 1000) return 'normal_close';
  if (code === 1001) return 'going_away';
  if (code === 1006) return 'network_lost';
  if (code === 1011) return 'server_error';
  return `ws_close_${code}`;
}

function defaultGatewayUrl(): string {
  const fromEnv = import.meta.env.VITE_GATEWAY_URL?.trim();
  return fromEnv || DEFAULT_WEB_GATEWAY_URL;
}

/**
 * Hybrid gateway client:
 * - Electron runtime: IPC bridge to main process (main owns gateway socket)
 * - Web runtime: direct WebSocket (used by dev:web)
 */
export class GatewayClient {
  private readonly mode: 'ipc' | 'ws';
  private url: string;

  private ws: WebSocket | null = null;
  private state: GatewayConnectionState = 'disconnected';
  private pendingRpc = new Map<number, PendingRpc>();
  private rpcId = 0;
  private listeners = new Set<(notification: GatewayClientNotification) => void>();
  private connectId: string | undefined;
  private reconnectCount = 0;
  private cleanups: (() => void)[] = [];

  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private heartbeatTimer: number | null = null;
  private manuallyClosed = false;
  private tokenListener: (() => void) | null = null;

  constructor(opts: GatewayClientOptions = {}) {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    this.mode = api?.gatewaySend ? 'ipc' : 'ws';
    this.url = opts.url?.trim() || defaultGatewayUrl();

    if (this.mode === 'ipc') {
      this.setupIpcListeners();
    } else {
      this.setupTokenListener();
    }
  }

  private setupTokenListener(): void {
    const onTokenAvailable = () => {
      if (this.state === 'disconnected' && !this.manuallyClosed) {
        cachedToken = null;
        this.connect();
      }
    };
    window.addEventListener('dorabot:token-available', onTokenAvailable);
    this.tokenListener = () => window.removeEventListener('dorabot:token-available', onTokenAvailable);
  }

  private setupIpcListeners(): void {
    const api = (window as any).electronAPI;
    if (!api) return;

    // Bridge state changes (connecting, connected, authenticated, disconnected)
    const unsubState = api.onGatewayState((state: any) => {
      const bridgeState = state.state as string;
      this.connectId = state.connectId;
      this.reconnectCount = state.reconnectCount ?? this.reconnectCount;

      // Bridge uses 'authenticated' for fully connected, map to 'connected'
      let clientState: GatewayConnectionState;
      if (bridgeState === 'authenticated') {
        clientState = 'connected';
      } else if (bridgeState === 'connected' || bridgeState === 'connecting') {
        clientState = 'connecting';
      } else {
        clientState = 'disconnected';
      }

      this.state = clientState;
      this.emit({
        type: 'connection',
        state: clientState,
        reason: state.reason,
        reconnectInMs: state.reconnectInMs,
        reconnectCount: this.reconnectCount,
        connectId: this.connectId,
      });

      if (clientState === 'disconnected') {
        this.rejectAllPending(new Error(state.reason || 'Connection closed'));
      }
    });
    this.cleanups.push(unsubState);

    // Messages from gateway (forwarded by bridge)
    const unsubMsg = api.onGatewayMessage((data: string) => {
      let msg: any;
      try { msg = JSON.parse(data); } catch { return; }

      // RPC response
      if (msg && msg.id != null) {
        const pending = this.pendingRpc.get(msg.id as number);
        if (!pending) return;
        this.pendingRpc.delete(msg.id as number);
        clearTimeout(pending.timeout);
        if (msg.error) pending.reject(new Error(String(msg.error)));
        else pending.resolve(msg.result);
        return;
      }

      // Event
      if (msg && typeof msg.event === 'string') {
        this.emit({ type: 'event', payload: msg as GatewayEventPayload });
      }
    });
    this.cleanups.push(unsubMsg);
  }

  get connectionState(): GatewayConnectionState {
    return this.state;
  }

  get socket(): WebSocket | null {
    return this.ws;
  }

  connect(url?: string): void {
    if (url && url !== this.url) this.url = url;
    this.manuallyClosed = false;

    if (this.mode === 'ipc') {
      // Connection is managed by main process bridge.
      // Request initial state to sync.
      const api = (window as any).electronAPI;
      api?.gatewayState?.().then((state: any) => {
        if (!state) return;
        this.connectId = state.connectId;
        this.reconnectCount = state.reconnectCount ?? 0;

        let clientState: GatewayConnectionState;
        if (state.state === 'authenticated') clientState = 'connected';
        else if (state.state === 'connected' || state.state === 'connecting') clientState = 'connecting';
        else clientState = 'disconnected';

        if (clientState !== this.state) {
          this.state = clientState;
          this.emit({
            type: 'connection',
            state: clientState,
            reconnectCount: this.reconnectCount,
            connectId: this.connectId,
          });
        }
      }).catch(() => {});
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.openSocket();
  }

  disconnect(): void {
    this.manuallyClosed = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();

    if (this.mode === 'ipc') {
      for (const cleanup of this.cleanups) cleanup();
      this.cleanups = [];
    } else {
      if (this.ws) {
        this.ws.onclose = null;
        try { this.ws.close(); } catch {}
        this.ws = null;
      }
      if (this.tokenListener) {
        this.tokenListener();
        this.tokenListener = null;
      }
    }

    this.rejectAllPending(new Error('Connection closed'));
    this.state = 'disconnected';
  }

  subscribe(listener: (notification: GatewayClientNotification) => void): () => void {
    this.listeners.add(listener);
    listener({
      type: 'connection',
      state: this.state,
      reconnectCount: this.reconnectCount,
      connectId: this.connectId,
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  async rpc(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    if (this.mode === 'ipc') {
      if (this.state !== 'connected') {
        throw new Error('Not connected to gateway');
      }

      const api = (window as any).electronAPI;
      if (!api?.gatewaySend) throw new Error('IPC not available');

      const id = ++this.rpcId;
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          if (!this.pendingRpc.has(id)) return;
          this.pendingRpc.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }, timeoutMs);
        this.pendingRpc.set(id, { resolve, reject, timeout, method });
        api.gatewaySend(JSON.stringify({ method, params, id }));
      });
    }

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.state !== 'connected') {
      throw new Error('Not connected to gateway');
    }

    const id = ++this.rpcId;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (!this.pendingRpc.has(id)) return;
        this.pendingRpc.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      this.pendingRpc.set(id, { resolve, reject, timeout, method });
      ws.send(JSON.stringify({ method, params, id }));
    });
  }

  private openSocket(): void {
    this.setConnectionState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      const token = getToken();
      if (!token) {
        try { ws.close(4102, 'missing_token'); } catch {}
        return;
      }

      const authId = ++this.rpcId;
      const timeout = window.setTimeout(() => {
        if (!this.pendingRpc.has(authId)) return;
        this.pendingRpc.delete(authId);
        try { ws.close(4103, 'auth_timeout'); } catch {}
      }, 5000);

      this.pendingRpc.set(authId, {
        timeout,
        method: 'auth',
        resolve: (res) => {
          const auth = (res || {}) as { authenticated?: boolean; connectId?: string };
          this.connectId = auth.connectId;
          this.reconnectAttempt = 0;
          this.setConnectionState('connected');
          this.startHeartbeat();
        },
        reject: (err) => {
          this.setConnectionState('disconnected', err.message || 'auth_failed');
          this.scheduleReconnect(err.message || 'auth_failed');
        },
      });

      ws.send(JSON.stringify({ method: 'auth', params: { token }, id: authId }));
    };

    ws.onmessage = (evt) => {
      if (this.ws !== ws) return;
      let msg: any;
      try { msg = JSON.parse(evt.data as string); } catch { return; }

      if (msg && msg.id != null) {
        const pending = this.pendingRpc.get(msg.id as number);
        if (!pending) return;
        this.pendingRpc.delete(msg.id as number);
        clearTimeout(pending.timeout);
        if (msg.error) pending.reject(new Error(String(msg.error)));
        else pending.resolve(msg.result);
        return;
      }

      if (msg && typeof msg.event === 'string') {
        this.emit({ type: 'event', payload: msg as GatewayEventPayload });
      }
    };

    ws.onclose = (evt) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      this.rejectAllPending(new Error('Connection closed'));
      const reason = classifyDisconnect(evt.code, (evt.reason || '').trim());
      this.setConnectionState('disconnected', reason);
      if (!this.manuallyClosed) this.scheduleReconnect(reason);
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.state !== 'connected') return;
      this.rpc('ping', undefined, HEARTBEAT_TIMEOUT_MS).catch(() => {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try { ws.close(4104, 'ping_timeout'); } catch {}
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(reason: string): void {
    if (this.manuallyClosed || this.reconnectTimer !== null) return;

    const base = Math.min(1000 * (2 ** Math.min(this.reconnectAttempt, 3)), 10_000);
    const jitter = Math.floor(Math.random() * 250);
    const delay = base + jitter;

    this.reconnectAttempt += 1;
    this.reconnectCount += 1;

    this.emit({
      type: 'event',
      payload: {
        event: 'gateway.telemetry',
        data: {
          disconnect_reason: reason,
          reconnect_count: this.reconnectCount,
          timestamp: Date.now(),
        },
      },
    });

    this.setConnectionState('disconnected', reason, delay);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private setConnectionState(state: GatewayConnectionState, reason?: string, reconnectInMs?: number): void {
    this.state = state;
    this.emit({
      type: 'connection',
      state,
      reason,
      reconnectInMs,
      reconnectCount: this.reconnectCount,
      connectId: this.connectId,
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRpc) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRpc.clear();
  }

  private emit(notification: GatewayClientNotification): void {
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
        // ignore listener errors
      }
    }
  }
}

let singleton: GatewayClient | null = null;

export function getGatewayClient(url?: string): GatewayClient {
  if (!singleton) singleton = new GatewayClient({ url });
  singleton.connect(url);
  return singleton;
}
