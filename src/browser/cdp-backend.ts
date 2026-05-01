/**
 * cdp-backend — the agent-side interface to the embedded browser.
 *
 * Replaces src/browser/manager.ts. No Playwright, no external Chrome.
 * The agent's MCP browser tool calls into here; we forward each call to the
 * browser host (Electron desktop or headless Electron) via the gateway
 * browser-host-registry.
 */
import { invokeBrowserHost, hasBrowserHost } from '../gateway/browser-host-registry.js';

export type PageId = string;

export type TabSummary = {
  pageId: PageId;
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

export async function ensureHost(): Promise<void> {
  if (hasBrowserHost()) return;
  // A gateway-side auto-spawn of packages/browser-host lands next. For now,
  // surface a clear error so the user knows to open the desktop app or run
  // `npm run browser-host:start` in a terminal.
  throw new Error(
    'no browser host connected. open the dorabot desktop app, or run `npm run browser-host:start` to launch the headless host.',
  );
}

export async function sendCdp<T = unknown>(
  pageId: PageId | undefined,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  await ensureHost();
  return await invokeBrowserHost<T>('browser.cdp', {
    pageId,
    cdpMethod: method,
    cdpParams: params,
  });
}

// Page.printToPDF isn't exposed via Electron's debugger. Route through the
// host and use webContents.printToPDF() instead. Returns PDF bytes.
export async function printPdfViaHost(pageId: PageId | undefined): Promise<Buffer> {
  await ensureHost();
  const { data } = await invokeBrowserHost<{ data: string }>('browser.print_pdf', { pageId });
  return Buffer.from(data, 'base64');
}

export async function listPages(): Promise<TabSummary[]> {
  await ensureHost();
  return await invokeBrowserHost<TabSummary[]>('browser.list_pages');
}

export async function createPage(opts: { url?: string; background?: boolean } = {}): Promise<PageId> {
  await ensureHost();
  const { pageId } = await invokeBrowserHost<{ pageId: PageId }>('browser.create_page', opts);
  return pageId;
}

export async function destroyPage(pageId: PageId): Promise<void> {
  await ensureHost();
  await invokeBrowserHost('browser.destroy_page', { pageId });
}

export async function navigatePage(
  pageId: PageId | undefined,
  type: 'url' | 'back' | 'forward' | 'reload',
  url?: string,
): Promise<void> {
  await ensureHost();
  await invokeBrowserHost('browser.navigate', { pageId, type, url });
}

export async function resolveDefaultPageId(): Promise<PageId | null> {
  await ensureHost();
  const { pageId } = await invokeBrowserHost<{ pageId: PageId | null }>('browser.resolve_default_page');
  return pageId;
}

/**
 * Resolve an optional pageId to a concrete one. If undefined, use the
 * browser host's default (user's focused tab, then most recent). If no
 * tabs exist, throw — callers can catch and create one.
 */
export async function requirePageId(pageId?: PageId): Promise<PageId> {
  if (pageId) return pageId;
  const resolved = await resolveDefaultPageId();
  if (!resolved) throw new Error('no browser tabs open — call new_page first');
  return resolved;
}

/** Compat shim for legacy code that calls closeBrowser() to shut down. */
export async function closeBrowser(): Promise<void> {
  // No-op. Tabs are owned by the host process; we don't force-close from
  // the agent side. Agents close individual tabs via destroyPage.
}
