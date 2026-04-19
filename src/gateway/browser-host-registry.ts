/**
 * browser-host-registry — module-level singleton that tracks which connected
 * gateway clients can host a browser. The agent's CDP backend (cdp-backend.ts)
 * runs in the same process as the gateway, and invokes browser RPCs via this
 * registry instead of opening a second WS.
 *
 * A "browser host" is a gateway client (the Electron desktop, or a headless
 * browser-host Electron process) that has called `client.register` with
 * `capabilities: ['browser']`.
 */
import type { WebSocket } from 'ws';

type PendingRpc = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const hosts = new Set<WebSocket>();
const pending = new Map<number, PendingRpc>();
let rpcId = 1_000_000; // start high to avoid collision with client-originated ids

const DEFAULT_TIMEOUT_MS = 30_000;

export function addBrowserHost(ws: WebSocket): void {
  hosts.add(ws);
}

export function removeBrowserHost(ws: WebSocket): void {
  hosts.delete(ws);
  // reject any pending rpcs that were routed to this socket — cheap heuristic:
  // we don't track per-socket mapping, so reject all on the assumption that
  // the caller will retry. In practice, there is usually exactly one host.
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error('browser host disconnected'));
    pending.delete(id);
  }
}

export function hasBrowserHost(): boolean {
  return hosts.size > 0;
}

/**
 * Invoke a `browser.*` method on a connected host and wait for the response.
 * Throws if no host is connected, or on timeout.
 */
export function invokeBrowserHost<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const ws = firstHost();
  if (!ws) return Promise.reject(new Error('no browser host connected'));

  return new Promise<T>((resolve, reject) => {
    const id = ++rpcId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`browser RPC ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
      timer,
    });

    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Called by the gateway when a message arrives from a browser host that
 * looks like an RPC response (has an `id` matching our pending map).
 * Returns true if it was handled.
 */
export function tryResolveResponse(msg: { id?: unknown; result?: unknown; error?: unknown }): boolean {
  if (typeof msg.id !== 'number') return false;
  const p = pending.get(msg.id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(msg.id);
  if (msg.error !== undefined && msg.error !== null) {
    p.reject(new Error(typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error)));
  } else {
    p.resolve(msg.result);
  }
  return true;
}

function firstHost(): WebSocket | null {
  for (const ws of hosts) return ws;
  return null;
}
