/**
 * host-bridge — headless gateway WS client for the browser-host process.
 *
 * Simpler than the desktop's GatewayBridge: there's no renderer to relay
 * messages to. We only need to:
 *   1. Connect to the gateway over its Unix socket
 *   2. Authenticate with the token file
 *   3. Register the 'browser' capability
 *   4. Route incoming browser.* RPC calls to an injected handler
 *   5. Reconnect with backoff when the socket drops
 */
import WebSocket from 'ws';
import { createConnection } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import {
  GATEWAY_TOKEN_PATH,
  GATEWAY_SOCKET_PATH,
} from '../../../desktop/electron/dorabot-paths';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export type BrowserRpcHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class HostBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatPending = false;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private rpcId = 0;
  private pending = new Map<number, Pending>();
  private handler: BrowserRpcHandler;

  constructor(handler: BrowserRpcHandler) {
    this.handler = handler;
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
    this.rejectAllPending(new Error('connection closed'));
  }

  private openSocket(): void {
    this.log(`opening WebSocket to gateway (attempt ${this.reconnectAttempt})`);
    const ws = new WebSocket('ws://localhost', {
      createConnection: () => createConnection({ path: GATEWAY_SOCKET_PATH }),
    });
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.authenticate(ws);
    });

    ws.on('message', (raw: Buffer | string) => {
      if (this.ws !== ws) return;
      let msg: { id?: unknown; method?: string; params?: unknown; result?: unknown; error?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // response to our own RPC
      if (typeof msg.id === 'number' && this.pending.has(msg.id) && !msg.method) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error !== undefined && msg.error !== null) {
          p.reject(new Error(typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error)));
        } else {
          p.resolve(msg.result);
        }
        return;
      }

      // incoming browser.* RPC from gateway
      if (typeof msg.method === 'string' && msg.method.startsWith('browser.')) {
        this.handleIncomingRpc(ws, msg as { id?: unknown; method: string; params?: unknown });
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      const reasonStr = reason.toString().trim() || `close_${code}`;
      this.log(`WebSocket closed: ${reasonStr}`);
      if (!this.manuallyClosed) this.scheduleReconnect();
    });

    ws.on('error', (err: Error) => {
      this.log(`WebSocket error: ${err.message}`);
      try { ws.close(); } catch {}
    });
  }

  private authenticate(ws: WebSocket): void {
    const token = this.readToken();
    if (!token) {
      this.log(`no token at ${GATEWAY_TOKEN_PATH}`);
      try { ws.close(); } catch {}
      this.scheduleReconnect();
      return;
    }

    const id = ++this.rpcId;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      try { ws.close(); } catch {}
    }, 5000);

    this.pending.set(id, {
      resolve: () => {
        this.reconnectAttempt = 0;
        this.log('authenticated');
        this.register(ws);
        this.startHeartbeat();
      },
      reject: (err) => {
        this.log(`auth failed: ${err.message}`);
      },
      timer,
    });

    ws.send(JSON.stringify({ method: 'auth', params: { token }, id }));
  }

  private register(ws: WebSocket): void {
    const id = ++this.rpcId;
    ws.send(JSON.stringify({ method: 'client.register', params: { capabilities: ['browser'] }, id }));
  }

  private async handleIncomingRpc(
    ws: WebSocket,
    msg: { id?: unknown; method: string; params?: unknown },
  ): Promise<void> {
    const respond = (payload: object) => {
      try { ws.send(JSON.stringify({ id: msg.id, ...payload })); } catch {}
    };
    try {
      const params = (msg.params || {}) as Record<string, unknown>;
      const result = await this.handler(msg.method, params);
      respond({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond({ error: message });
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.heartbeatPending) {
        try { this.ws.close(); } catch {}
        return;
      }
      this.heartbeatPending = true;
      const id = ++this.rpcId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.heartbeatPending = false;
        try { this.ws?.close(); } catch {}
      }, HEARTBEAT_TIMEOUT_MS);
      this.pending.set(id, {
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

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer !== null) return;
    if (this.reconnectAttempt >= 30) {
      this.log('giving up after 30 reconnect attempts');
      return;
    }
    const base = Math.min(1000 * (2 ** Math.min(this.reconnectAttempt, 3)), 10_000);
    const jitter = Math.floor(Math.random() * 250);
    const delay = base + jitter;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private rejectAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private readToken(): string {
    try {
      if (existsSync(GATEWAY_TOKEN_PATH)) {
        return readFileSync(GATEWAY_TOKEN_PATH, 'utf-8').trim();
      }
    } catch {}
    return '';
  }

  private log(msg: string): void {
    console.log(`[browser-host] ${new Date().toISOString()} ${msg}`);
  }
}
