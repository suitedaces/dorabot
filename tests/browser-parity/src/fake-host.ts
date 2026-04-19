// fake-host — registers this test process with the in-memory browser host
// registry so that invokeBrowserHost() dispatches to a local BrowserController
// via handleAgentRpc(). skips the real WS transport; we test the CDP code
// path, not the socket plumbing.
import { addBrowserHost, tryResolveResponse } from '../../../src/gateway/browser-host-registry';
import { handleAgentRpc } from '../../../desktop/electron/browser-ipc';
import type { BrowserController } from '../../../desktop/electron/browser-controller';

type RpcMsg = { id?: number; method?: string; params?: Record<string, unknown> };

// minimal shape duck-typed to the subset of ws.WebSocket used by the registry
// (just `.send(str)`). anything else the registry touches would blow up.
type MinimalWs = { send: (msg: string) => void };

export function installFakeBrowserHost(controller: BrowserController): MinimalWs {
  const ws: MinimalWs = {
    send(msg: string) {
      let parsed: RpcMsg;
      try {
        parsed = JSON.parse(msg);
      } catch {
        return;
      }
      const id = parsed.id;
      const method = parsed.method;
      if (typeof id !== 'number' || typeof method !== 'string') return;
      // dispatch async so the caller's promise is set up before we resolve
      void Promise.resolve()
        .then(() => handleAgentRpc(controller, method, parsed.params ?? {}))
        .then(
          (result) => tryResolveResponse({ id, result }),
          (err) => tryResolveResponse({ id, error: err instanceof Error ? err.message : String(err) }),
        );
    },
  };
  addBrowserHost(ws as never);
  return ws;
}
