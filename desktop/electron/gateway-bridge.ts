/**
 * Gateway WebSocket bridge - runs in the main process.
 * Connects to the local gateway over a Unix domain socket and relays
 * messages to/from renderer via IPC.
 *
 * Includes HTTP auth fallback: when WebSocket is down, the bridge checks
 * the HTTP auth server to determine if provider auth is still valid.
 * This prevents the "Not authenticated" flicker during brief disconnects.
 */
import WebSocket from 'ws';
import { createConnection } from 'node:net';
import { readFileSync, existsSync, appendFileSync } from 'fs';
import { BrowserWindow } from 'electron';
import { GATEWAY_TOKEN_PATH, GATEWAY_LOG_PATH, GATEWAY_SOCKET_PATH } from './dorabot-paths';
import { httpAuthHealthCheck, httpAuthStatus, isHttpAuthAvailable, type AuthStatusResult } from './http-auth-client';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

/**
 * Connection states:
 * - connecting: WebSocket handshake in progress
 * - connected: WS open, gateway auth in progress
 * - authenticated: WS open + gateway auth complete (fully operational)
 * - degraded: WS down, but HTTP auth server is reachable (auth still works)
 * - disconnected: both WS and HTTP are down
 */
export type BridgeState = 'connecting' | 'connected' | 'authenticated' | 'degraded' | 'disconnected';

export type BrowserRpcHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export class GatewayBridge {
  private ws: WebSocket | null = null;
  private state: BridgeState = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatPending = false;
  private reconnectAttempt = 0;
  private reconnectCount = 0;
  private manuallyClosed = false;
  private rpcId = 0;
  private pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private window: BrowserWindow | null = null;
  private url: string;
  private socketPath: string;
  private connectId: string | undefined;
  private lastReason: string | undefined;
  /** Last known auth status from HTTP fallback (survives WS drops) */
  private lastAuthStatus: AuthStatusResult | null = null;
  /** Handles incoming browser.* RPC requests from the gateway. */
  private browserRpcHandler: BrowserRpcHandler | null = null;

  constructor(url = 'ws://localhost', socketPath = GATEWAY_SOCKET_PATH) {
    this.url = url;
    this.socketPath = socketPath;
  }

  private log(msg: string): void {
    const line = `[bridge] ${new Date().toISOString()} ${msg}\n`;
    console.log(line.trim());
    try { appendFileSync(GATEWAY_LOG_PATH, line); } catch {}
  }

  setWindow(win: BrowserWindow | null): void {
    this.window = win;
  }

  /** Register a handler for browser.* RPC calls coming from the gateway. */
  setBrowserRpcHandler(handler: BrowserRpcHandler | null): void {
    this.browserRpcHandler = handler;
    // If already authenticated, advertise capability now
    if (this.state === 'authenticated') this.advertiseCapabilities();
  }

  private advertiseCapabilities(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const capabilities: string[] = [];
    if (this.browserRpcHandler) capabilities.push('browser');
    if (capabilities.length === 0) return;
    // Fire-and-forget — gateway uses this to route browser.* to us.
    this.ws.send(JSON.stringify({ method: 'client.register', params: { capabilities }, id: ++this.rpcId }));
  }

  connect(): void {
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
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.setState('disconnected', 'manual_disconnect');
    this.rejectAllPending(new Error('Connection closed'));
  }

  /** Forward a raw JSON message from renderer to gateway */
  send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  getState(): { state: BridgeState; reconnectCount: number; connectId?: string; lastReason?: string; lastAuthStatus?: AuthStatusResult | null } {
    return { state: this.state, reconnectCount: this.reconnectCount, connectId: this.connectId, lastReason: this.lastReason, lastAuthStatus: this.lastAuthStatus };
  }

  /** Get cached auth status (available even when WS is down). */
  getLastAuthStatus(): AuthStatusResult | null {
    return this.lastAuthStatus;
  }

  /** Fetch auth status via HTTP fallback (works even when WS is down). */
  async fetchAuthStatusHttp(provider = 'claude'): Promise<AuthStatusResult | null> {
    const result = await httpAuthStatus(provider);
    if (result.ok) {
      this.lastAuthStatus = result.data;
      return result.data;
    }
    return null;
  }

  private openSocket(): void {
    this.setState('connecting');
    this.log(`opening WebSocket to ${this.url} via ${this.socketPath} (attempt ${this.reconnectAttempt})`);

    const ws = new WebSocket(this.url, {
      createConnection: () => createConnection({ path: this.socketPath }),
    });
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.log('WebSocket open, authenticating...');
      this.setState('connected');
      this.authenticate(ws);
    });

    ws.on('message', (raw: Buffer | string) => {
      if (this.ws !== ws) return;
      const data = raw.toString();

      // Check if this is a response to one of our own RPC calls (handle internally)
      try {
        const msg = JSON.parse(data);
        if (msg && msg.id != null && this.pendingRpc.has(msg.id) && !msg.method) {
          const pending = this.pendingRpc.get(msg.id)!;
          this.pendingRpc.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.error) {
            this.log(`RPC ${msg.id} error: ${msg.error}`);
            pending.reject(new Error(String(msg.error)));
          } else {
            pending.resolve(msg.result);
          }
          return;
        }

        // Gateway → us RPC request (browser.*, etc.)
        if (msg && typeof msg.method === 'string' && msg.method.startsWith('browser.')) {
          this.handleIncomingRpc(ws, msg);
          return;
        }
      } catch {}

      // Forward everything else to renderer
      this.sendToRenderer('gateway:message', data);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      const rawReason = reason.toString().trim();
      const reasonStr = rawReason || (code === 1005 || code === 1006 ? 'connection_lost' : `ws_close_${code}`);
      this.log(`WebSocket closed: code=${code} reason=${reasonStr}`);

      // Before marking as disconnected, check HTTP fallback
      this.checkHttpFallback(reasonStr);
    });

    ws.on('error', (err) => {
      this.log(`WebSocket error: ${err.message}`);
      try { ws.close(); } catch {}
    });
  }

  /**
   * When WS drops, check if HTTP auth server is still reachable.
   * If yes, enter DEGRADED state (auth still works) instead of DISCONNECTED.
   */
  private async checkHttpFallback(reason: string): Promise<void> {
    if (this.manuallyClosed) {
      this.setState('disconnected', reason);
      return;
    }

    // Quick HTTP health check (3s timeout)
    if (isHttpAuthAvailable()) {
      try {
        const healthy = await httpAuthHealthCheck();
        if (healthy) {
          // Gateway process is alive, WS just dropped. Enter degraded mode.
          this.log('WS down but HTTP auth server reachable, entering degraded mode');
          this.setState('degraded', reason);

          // Fetch latest auth status via HTTP and cache it locally
          const status = await httpAuthStatus();
          if (status.ok) {
            this.lastAuthStatus = status.data;
          }

          // Still schedule WS reconnect
          this.scheduleReconnect(reason);
          return;
        }
      } catch {
        // HTTP also down, fall through to disconnected
      }
    }

    this.setState('disconnected', reason);
    if (!this.manuallyClosed) this.scheduleReconnect(reason);
  }

  private authenticate(ws: WebSocket): void {
    const token = this.readToken();
    if (!token) {
      this.log(`auth failed: no token at ${GATEWAY_TOKEN_PATH}`);
      this.setState('disconnected', 'missing_token');
      this.scheduleReconnect('missing_token');
      try { ws.close(); } catch {}
      return;
    }
    this.log(`sending auth (token length=${token.length})`);

    const id = ++this.rpcId;
    const timer = setTimeout(() => {
      this.pendingRpc.delete(id);
      try { ws.close(); } catch {}
      this.setState('disconnected', 'auth_timeout');
      this.scheduleReconnect('auth_timeout');
    }, 5000);

    this.pendingRpc.set(id, {
      resolve: (res) => {
        const auth = (res || {}) as { authenticated?: boolean; connectId?: string };
        this.connectId = auth.connectId;
        this.reconnectAttempt = 0;
        this.log(`authenticated, connectId=${auth.connectId}`);
        this.setState('authenticated');
        this.startHeartbeat();
        this.advertiseCapabilities();
      },
      reject: (err) => {
        this.setState('disconnected', err.message || 'auth_failed');
        this.scheduleReconnect(err.message || 'auth_failed');
      },
      timer,
    });

    ws.send(JSON.stringify({ method: 'auth', params: { token }, id }));
  }

  private async handleIncomingRpc(ws: WebSocket, msg: { id?: unknown; method: string; params?: unknown }): Promise<void> {
    const respond = (payload: object) => {
      try { ws.send(JSON.stringify({ id: msg.id, ...payload })); } catch {}
    };
    if (!this.browserRpcHandler) {
      respond({ error: 'no browser handler registered' });
      return;
    }
    try {
      const params = (msg.params || {}) as Record<string, unknown>;
      const result = await this.browserRpcHandler(msg.method, params);
      respond({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond({ error: message });
    }
  }

  private readToken(): string {
    try {
      if (existsSync(GATEWAY_TOKEN_PATH)) {
        return readFileSync(GATEWAY_TOKEN_PATH, 'utf-8').trim();
      }
    } catch {}
    return '';
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'authenticated' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.heartbeatPending) {
        // Previous ping never got a response
        try { this.ws.close(); } catch {}
        return;
      }
      this.heartbeatPending = true;
      const id = ++this.rpcId;
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        this.heartbeatPending = false;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try { this.ws.close(); } catch {}
        }
      }, HEARTBEAT_TIMEOUT_MS);
      this.pendingRpc.set(id, {
        resolve: () => { this.heartbeatPending = false; },
        reject: () => { this.heartbeatPending = false; },
        timer,
      });
      this.ws.send(JSON.stringify({ method: 'ping', id }));
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatPending = false;
  }

  private scheduleReconnect(reason: string): void {
    if (this.manuallyClosed || this.reconnectTimer !== null) return;
    // Stop retrying after 30 attempts (roughly 5 minutes of backoff)
    if (this.reconnectAttempt >= 30) {
      this.setState('disconnected', 'Connection failed after multiple attempts. Restart the app to try again.');
      return;
    }
    const base = Math.min(1000 * (2 ** Math.min(this.reconnectAttempt, 3)), 10_000);
    const jitter = Math.floor(Math.random() * 250);
    const delay = base + jitter;
    this.reconnectAttempt += 1;
    this.reconnectCount += 1;
    // Don't overwrite state if we're in degraded mode (HTTP still works)
    if (this.state !== 'degraded') {
      this.setState('disconnected', reason, delay);
    } else {
      // Still send reconnect timing to renderer without changing state
      this.sendToRenderer('gateway:state', {
        state: 'degraded',
        reason,
        reconnectInMs: delay,
        reconnectCount: this.reconnectCount,
        connectId: this.connectId,
      });
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private setState(state: BridgeState, reason?: string, reconnectInMs?: number): void {
    this.state = state;
    if (reason) this.lastReason = reason;
    this.sendToRenderer('gateway:state', {
      state,
      reason,
      reconnectInMs,
      reconnectCount: this.reconnectCount,
      connectId: this.connectId,
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRpc) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRpc.clear();
  }

  private sendToRenderer(channel: string, data: unknown): void {
    try {
      this.window?.webContents.send(channel, data);
    } catch {}
  }
}
