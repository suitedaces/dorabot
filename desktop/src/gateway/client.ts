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

/**
 * Gateway client that communicates via IPC to the main process bridge.
 * The actual WebSocket runs in the main process (Node.js) which handles
 * TLS natively, avoiding Chromium's self-signed cert issues.
 */
export class GatewayClient {
  private state: GatewayConnectionState = 'disconnected';
  private pendingRpc = new Map<number, PendingRpc>();
  private rpcId = 0;
  private listeners = new Set<(notification: GatewayClientNotification) => void>();
  private connectId: string | undefined;
  private reconnectCount = 0;
  private cleanups: (() => void)[] = [];

  constructor() {
    this.setupIpcListeners();
  }

  private setupIpcListeners(): void {
    const api = (window as any).electronAPI;
    if (!api) return;

    // Bridge state changes (connecting, connected, authenticated, disconnected)
    const unsubState = api.onGatewayState((state: any) => {
      const bridgeState = state.state as string;
      this.connectId = state.connectId;
      this.reconnectCount = state.reconnectCount ?? this.reconnectCount;

      // Map bridge states to client states
      // Bridge uses 'authenticated' for fully connected, we use 'connected'
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

      // If disconnected, reject all pending RPCs
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

  connect(): void {
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
  }

  disconnect(): void {
    // Cleanup IPC listeners
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
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

export function getGatewayClient(): GatewayClient {
  if (!singleton) singleton = new GatewayClient();
  singleton.connect();
  return singleton;
}
