/**
 * Gateway WebSocket bridge - runs in the main process.
 * Uses Node.js `ws` module which handles self-signed TLS certs natively
 * (no Chromium TLS restrictions). Relays messages to/from renderer via IPC.
 */
import WebSocket from 'ws';
import { readFileSync, existsSync } from 'fs';
import { BrowserWindow } from 'electron';
import { GATEWAY_TOKEN_PATH } from './dorabot-paths';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export type BridgeState = 'connecting' | 'connected' | 'authenticated' | 'disconnected';

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
  private connectId: string | undefined;

  constructor(url = 'wss://127.0.0.1:18789') {
    this.url = url;
  }

  setWindow(win: BrowserWindow | null): void {
    this.window = win;
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

  getState(): { state: BridgeState; reconnectCount: number; connectId?: string } {
    return { state: this.state, reconnectCount: this.reconnectCount, connectId: this.connectId };
  }

  private openSocket(): void {
    this.setState('connecting');

    const ws = new WebSocket(this.url, { rejectUnauthorized: false });
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.setState('connected');
      this.authenticate(ws);
    });

    ws.on('message', (raw: Buffer | string) => {
      if (this.ws !== ws) return;
      const data = raw.toString();

      // Check if this is an auth response (handle internally)
      try {
        const msg = JSON.parse(data);
        if (msg && msg.id != null && this.pendingRpc.has(msg.id)) {
          const pending = this.pendingRpc.get(msg.id)!;
          this.pendingRpc.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.error) pending.reject(new Error(String(msg.error)));
          else pending.resolve(msg.result);
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
      const reasonStr = reason.toString().trim() || `ws_close_${code}`;
      this.setState('disconnected', reasonStr);
      if (!this.manuallyClosed) this.scheduleReconnect(reasonStr);
    });

    ws.on('error', () => {
      try { ws.close(); } catch {}
    });
  }

  private authenticate(ws: WebSocket): void {
    const token = this.readToken();
    if (!token) {
      this.setState('disconnected', 'missing_token');
      this.scheduleReconnect('missing_token');
      try { ws.close(); } catch {}
      return;
    }

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
        this.setState('authenticated');
        this.startHeartbeat();
      },
      reject: (err) => {
        this.setState('disconnected', err.message || 'auth_failed');
        this.scheduleReconnect(err.message || 'auth_failed');
      },
      timer,
    });

    ws.send(JSON.stringify({ method: 'auth', params: { token }, id }));
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
    const base = Math.min(1000 * (2 ** Math.min(this.reconnectAttempt, 3)), 10_000);
    const jitter = Math.floor(Math.random() * 250);
    const delay = base + jitter;
    this.reconnectAttempt += 1;
    this.reconnectCount += 1;
    this.setState('disconnected', reason, delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private setState(state: BridgeState, reason?: string, reconnectInMs?: number): void {
    this.state = state;
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
