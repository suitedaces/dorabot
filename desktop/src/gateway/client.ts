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
  url: string;
};

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

// Token consumed once from preload, cached in module scope.
// If preload didn't have it yet (fresh install race), we retry from localStorage
// and listen for a push from main process via IPC.
let cachedToken: string | null = null;

function getToken(): string {
  if (cachedToken) return cachedToken;

  // Try preload's one-shot delivery first
  const consumed = (window as any).electronAPI?.consumeGatewayToken?.() || '';
  if (consumed) {
    cachedToken = consumed;
    try { localStorage.setItem('dorabot:gateway-token', consumed); } catch {}
    return consumed;
  }

  // Browser/web mode fallback: inject via Vite env.
  // Keep this before localStorage so stale cached tokens cannot break auth.
  const envToken = import.meta.env.VITE_GATEWAY_TOKEN?.trim() || '';
  if (envToken) {
    cachedToken = envToken;
    try { localStorage.setItem('dorabot:gateway-token', envToken); } catch {}
    return envToken;
  }

  // Fall back to localStorage (may have been pushed by main process after gateway ready)
  const stored = localStorage.getItem('dorabot:gateway-token') || '';
  if (stored) {
    cachedToken = stored;
    return stored;
  }

  // No token yet, return empty (will trigger reconnect later)
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

export class GatewayClient {
  private url: string;

  private ws: WebSocket | null = null;

  private state: GatewayConnectionState = 'disconnected';

  private pendingRpc = new Map<number, PendingRpc>();

  private rpcId = 0;

  private listeners = new Set<(notification: GatewayClientNotification) => void>();

  private reconnectTimer: number | null = null;

  private reconnectAttempt = 0;

  private reconnectCount = 0;

  private heartbeatTimer: number | null = null;

  private manuallyClosed = false;

  private connectId: string | undefined;

  private tokenListener: (() => void) | null = null;

  constructor(opts: GatewayClientOptions) {
    this.url = opts.url;
    // Listen for delayed token delivery (fresh install: main pushes token after gateway ready)
    const onTokenAvailable = () => {
      if (this.state === 'disconnected' && !this.manuallyClosed) {
        cachedToken = null; // clear so getToken() re-reads from localStorage
        this.connect();
      }
    };
    window.addEventListener('dorabot:token-available', onTokenAvailable);
    this.tokenListener = () => window.removeEventListener('dorabot:token-available', onTokenAvailable);
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
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setConnectionState('disconnected', 'manual_disconnect');
    this.rejectAllPending(new Error('Connection closed'));
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
        try {
          ws.close(4102, 'missing_token');
        } catch {
          // ignore
        }
        return;
      }

      const authId = ++this.rpcId;
      const timeout = window.setTimeout(() => {
        if (!this.pendingRpc.has(authId)) return;
        this.pendingRpc.delete(authId);
        try {
          ws.close(4103, 'auth_timeout');
        } catch {
          // ignore
        }
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
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }

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
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.state !== 'connected') return;
      this.rpc('ping', undefined, HEARTBEAT_TIMEOUT_MS).catch(() => {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.close(4104, 'ping_timeout');
        } catch {
          // ignore
        }
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

export function getGatewayClient(url = 'wss://localhost:18789'): GatewayClient {
  if (!singleton) singleton = new GatewayClient({ url });
  singleton.connect(url);
  return singleton;
}
