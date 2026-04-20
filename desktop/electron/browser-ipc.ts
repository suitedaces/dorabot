/**
 * browser-ipc — bridges BrowserController to two worlds:
 *
 * 1) Renderer (React UI) via ipcMain.handle — the user's browser tab component
 *    talks through here to create/destroy/navigate/pause tabs.
 *
 * 2) Gateway (agent process) via handleAgentRpc — when an agent calls the
 *    browser MCP tool, the request arrives on the gateway WS, is routed here
 *    by gateway-bridge, and we dispatch to BrowserController.
 *
 * Channel names are `browser:*` to avoid clashes with existing IPC.
 */
import { ipcMain, type BrowserWindow, type Rectangle } from 'electron';
import type { BrowserController, PageId, TabSummary } from './browser-controller';
import { BrowserTabModel, type PaneId } from './browser-tab-model';

// Same trust check as browser-controller — keep in sync. Only http/https/about
// reach CDP Page.navigate. Everything else is rejected with a clear error so
// agent tool calls with bad URLs fail loudly.
function isSafeUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(String(url).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'about:';
  } catch {
    return false;
  }
}

type IpcSend = (channel: string, payload: unknown) => void;

export function registerBrowserIpc(
  controller: BrowserController,
  getWindow: () => BrowserWindow | null,
): { model: BrowserTabModel } {
  const send: IpcSend = (channel, payload) => {
    const win = getWindow();
    try { win?.webContents.send(channel, payload); } catch {}
  };

  // Source of truth for which native view is visible in which pane. Subscribes
  // to tab-created / tab-closed internally and reconciles on every change.
  const model = new BrowserTabModel(controller);

  // relay controller events to the renderer (model's subscription is separate)
  controller.on('tab-created', (summary: TabSummary) => send('browser:tab-created', summary));
  controller.on('tab-updated', (summary: TabSummary) => send('browser:tab-updated', summary));
  controller.on('tab-closed', (payload) => send('browser:tab-closed', payload));
  controller.on('tab-paused', (payload) => send('browser:tab-paused', payload));
  controller.on('tab-user-activity', (payload) => send('browser:tab-user-activity', payload));
  controller.on('tab-agent-activity', (payload) => send('browser:tab-agent-activity', payload));
  controller.on('tab-crashed', (payload) => send('browser:tab-crashed', payload));
  controller.on('tab-load-failed', (payload) => send('browser:tab-load-failed', payload));

  // renderer → main (tab lifecycle)
  ipcMain.handle('browser:create', async (_e, opts: { url?: string; background?: boolean } = {}) => {
    return await controller.createPage(opts);
  });

  ipcMain.handle('browser:destroy', async (_e, pageId: PageId) => {
    await controller.destroyPage(pageId);
    return true;
  });

  // renderer → main (pane-level visibility, the new way). The renderer pushes
  // per-pane state here. Model handles show/hide/setBounds across all known
  // tabs, so a React cleanup that fails to fire can't produce a ghost view.
  ipcMain.handle(
    'browser:pane-update',
    (_e, paneId: PaneId, patch: { bounds?: Rectangle; activeBrowserPageId?: PageId | null; visible?: boolean }) => {
      model.setPaneState(paneId, patch);
      return true;
    },
  );

  ipcMain.handle('browser:pane-remove', (_e, paneId: PaneId) => {
    model.removePane(paneId);
    return true;
  });

  ipcMain.handle('browser:set-user-focus', (_e, pageId: PageId | null) => {
    controller.setUserFocus(pageId);
    return true;
  });

  ipcMain.handle('browser:navigate', async (_e, pageId: PageId, params: { type: 'url' | 'back' | 'forward' | 'reload'; url?: string }) => {
    return await navigate(controller, pageId, params);
  });

  ipcMain.handle('browser:pause', (_e, pageId: PageId, paused: boolean) => {
    controller.pausePage(pageId, paused);
    return true;
  });

  ipcMain.handle('browser:reload', async (_e, pageId: PageId) => {
    await controller.reloadPage(pageId);
    return true;
  });

  ipcMain.handle('browser:list-pages', () => {
    return controller.listPages();
  });

  return { model };
}

/**
 * Handle an incoming RPC from the agent (via gateway-bridge).
 * Methods are prefixed `browser.*`.
 *
 * This is the backbone the agent's CDP tool sits on.
 */
export async function handleAgentRpc(
  controller: BrowserController,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'browser.list_pages':
      return controller.listPages();

    case 'browser.get_page': {
      const { pageId } = params as { pageId: PageId };
      return controller.getPage(pageId);
    }

    case 'browser.create_page': {
      const { url, background } = params as { url?: string; background?: boolean };
      const pageId = await controller.createPage({ url, background, origin: 'agent' });
      return { pageId };
    }

    case 'browser.destroy_page': {
      const { pageId } = params as { pageId: PageId };
      await controller.destroyPage(pageId);
      return { ok: true };
    }

    case 'browser.navigate': {
      const { pageId, type, url } = params as { pageId: PageId; type: 'url' | 'back' | 'forward' | 'reload'; url?: string };
      const resolved = resolvePageId(controller, pageId);
      return await navigate(controller, resolved, { type, url });
    }

    case 'browser.cdp': {
      const { pageId, cdpMethod, cdpParams } = params as { pageId?: PageId; cdpMethod: string; cdpParams?: Record<string, unknown> };
      const resolved = resolvePageId(controller, pageId);
      return await controller.sendCdp(resolved, cdpMethod, cdpParams || {});
    }

    case 'browser.print_pdf': {
      const { pageId } = params as { pageId?: PageId };
      const resolved = resolvePageId(controller, pageId);
      const buf = await controller.printPdf(resolved);
      return { data: buf.toString('base64') };
    }

    case 'browser.resolve_default_page': {
      return { pageId: controller.resolveDefaultPage() };
    }

    case 'browser.console_buffer': {
      const { pageId, includePreserved } = params as { pageId: PageId; includePreserved?: boolean };
      const resolved = resolvePageId(controller, pageId);
      return controller.getConsoleBuffer(resolved, !!includePreserved);
    }

    case 'browser.console_get': {
      const { pageId, msgid } = params as { pageId: PageId; msgid: number };
      const resolved = resolvePageId(controller, pageId);
      return controller.getConsoleMessage(resolved, msgid);
    }

    case 'browser.network_buffer': {
      const { pageId, includePreserved } = params as { pageId: PageId; includePreserved?: boolean };
      const resolved = resolvePageId(controller, pageId);
      return controller.getNetworkBuffer(resolved, !!includePreserved);
    }

    case 'browser.network_get': {
      const { pageId, reqid } = params as { pageId: PageId; reqid?: number };
      const resolved = resolvePageId(controller, pageId);
      return await controller.getNetworkRequest(resolved, reqid);
    }

    default:
      throw new Error(`unknown browser method: ${method}`);
  }
}

function resolvePageId(controller: BrowserController, pageId: PageId | undefined): PageId {
  if (pageId) return pageId;
  const resolved = controller.resolveDefaultPage();
  if (!resolved) throw new Error('no browser tab open — call browser.create_page first');
  return resolved;
}

async function navigate(
  controller: BrowserController,
  pageId: PageId,
  params: { type: 'url' | 'back' | 'forward' | 'reload'; url?: string },
): Promise<{ ok: true }> {
  const summary = controller.getPage(pageId);
  if (!summary) throw new Error(`tab not found: ${pageId}`);

  // Navigation uses webContents methods directly rather than CDP —
  // CDP's Page.navigate doesn't handle history properly.
  switch (params.type) {
    case 'url': {
      if (!params.url) throw new Error('url required for type=url');
      if (!isSafeUrl(params.url)) {
        throw new Error(`unsafe url scheme: ${params.url.slice(0, 80)}`);
      }
      await controller.sendCdp(pageId, 'Page.navigate', { url: params.url });
      break;
    }
    case 'reload':
      await controller.sendCdp(pageId, 'Page.reload', {});
      break;
    case 'back':
      await controller.sendCdp(pageId, 'Page.goBack', {}).catch(async () => {
        // fallback for older CDP
        await controller.sendCdp(pageId, 'Runtime.evaluate', { expression: 'history.back()' });
      });
      break;
    case 'forward':
      await controller.sendCdp(pageId, 'Page.goForward', {}).catch(async () => {
        await controller.sendCdp(pageId, 'Runtime.evaluate', { expression: 'history.forward()' });
      });
      break;
  }
  return { ok: true };
}
