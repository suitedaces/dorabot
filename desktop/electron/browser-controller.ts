/**
 * browser-controller — owns WebContentsView instances, attaches the CDP
 * debugger to each, and proxies CDP commands from the agent.
 *
 * Lifecycle:
 *   createPage({url})         -> {pageId}
 *   destroyPage(pageId)
 *   setBounds(pageId, {...})  -> reposition view inside the window
 *   sendCdp(pageId, method, params)
 *   pausePage(pageId, paused) -> block agent CDP calls until unpaused
 *
 * Events (emitter):
 *   'tab-created'  { pageId, url, title }
 *   'tab-updated'  { pageId, url?, title?, favicon?, canGoBack?, canGoForward? }
 *   'tab-closed'   { pageId }
 *   'tab-paused'   { pageId, paused }
 *   'tab-user-activity' { pageId, at }
 *   'tab-agent-activity'{ pageId, at }
 *
 * Console / network buffering:
 *   The controller subscribes to CDP events via the debugger's 'message'
 *   channel and keeps ring buffers per tab. These back the agent's
 *   list_console_messages / list_network_requests actions.
 */
import { BrowserWindow, WebContentsView, session, type Rectangle } from 'electron';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

export type PageId = string; // b_<8hex>

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
  // who created this tab — 'user' from the UI, 'agent' from an agent RPC.
  // the renderer uses this to decide whether to adopt the pageId into a new
  // UI tab (agent) or just attach to an existing one (user).
  origin: 'user' | 'agent';
};

type ConsoleEntry = {
  msgid: number;
  type: string;
  text: string;
  timestamp: string;
  location?: { url: string; lineNumber: number; columnNumber: number };
};

type NetworkEntry = {
  reqid: number;
  requestId: string;           // CDP requestId
  url: string;
  method: string;
  resourceType: string;
  startedAt: string;
  finishedAt?: string;
  status?: number;
  statusText?: string;
  failureText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  mimeType?: string;
  requestBody?: string;        // set when postData exists
  responseBody?: { encoding: 'utf8' | 'base64'; data: string }; // lazy-fetched
};

type PageBuffers = {
  nextConsoleId: number;
  consoleMessages: ConsoleEntry[];
  preservedConsole: ConsoleEntry[][];
  consoleById: Map<number, ConsoleEntry>;

  nextReqId: number;
  networkRecords: NetworkEntry[];
  preservedNetwork: NetworkEntry[][];
  networkByReqId: Map<number, NetworkEntry>;
  networkByCdpId: Map<string, NetworkEntry>;
  latestReqId?: number;
};

type Entry = {
  pageId: PageId;
  view: WebContentsView;
  debuggerAttached: boolean;
  paused: boolean;
  userFocused: boolean;
  lastUserInteractionAt: number;
  lastAgentActionAt: number;
  title: string;
  url: string;
  favicon: string | null;
  buffers: PageBuffers;
  origin: 'user' | 'agent';
};

const SESSION_PARTITION = 'persist:dora-browser';
const MAX_BUFFER = 500;
const MAX_PRESERVED_BATCHES = 3;

function makePageId(): PageId {
  return 'b_' + randomBytes(4).toString('hex');
}

function makeBuffers(): PageBuffers {
  return {
    nextConsoleId: 1,
    consoleMessages: [],
    preservedConsole: [],
    consoleById: new Map(),
    nextReqId: 1,
    networkRecords: [],
    preservedNetwork: [],
    networkByReqId: new Map(),
    networkByCdpId: new Map(),
  };
}

function preserveHistory<T>(history: T[][], current: T[]): void {
  if (current.length === 0) return;
  history.unshift([...current]);
  while (history.length > MAX_PRESERVED_BATCHES) history.pop();
  current.length = 0;
}

function capBuffer<T>(buf: T[]): void {
  while (buf.length > MAX_BUFFER) buf.shift();
}

export class BrowserController extends EventEmitter {
  private entries: Map<PageId, Entry> = new Map();
  private hostWindow: BrowserWindow | null = null;
  private userFocusedPageId: PageId | null = null;

  setHostWindow(win: BrowserWindow | null): void {
    this.hostWindow = win;
  }

  getSession() {
    return session.fromPartition(SESSION_PARTITION);
  }

  async createPage(opts: { url?: string; background?: boolean; origin?: 'user' | 'agent' } = {}): Promise<PageId> {
    const pageId = makePageId();
    const view = new WebContentsView({
      webPreferences: {
        partition: SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    const entry: Entry = {
      pageId,
      view,
      debuggerAttached: false,
      paused: false,
      userFocused: false,
      lastUserInteractionAt: 0,
      lastAgentActionAt: 0,
      title: '',
      url: opts.url || 'about:blank',
      favicon: null,
      buffers: makeBuffers(),
      origin: opts.origin || 'user',
    };
    this.entries.set(pageId, entry);

    this.wireViewEvents(entry);
    this.attachDebugger(entry);

    if (this.hostWindow) {
      this.hostWindow.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }

    try {
      await view.webContents.loadURL(opts.url || 'about:blank');
    } catch (err) {
      console.error(`[browser-controller] loadURL failed for ${pageId}:`, err);
    }

    this.emit('tab-created', this.toSummary(entry));
    return pageId;
  }

  async destroyPage(pageId: PageId): Promise<void> {
    const entry = this.entries.get(pageId);
    if (!entry) return;

    if (entry.debuggerAttached) {
      try { entry.view.webContents.debugger.detach(); } catch {}
    }
    if (this.hostWindow) {
      try { this.hostWindow.contentView.removeChildView(entry.view); } catch {}
    }
    try { (entry.view.webContents as any).close?.(); } catch {}

    this.entries.delete(pageId);
    if (this.userFocusedPageId === pageId) this.userFocusedPageId = null;
    this.emit('tab-closed', { pageId });
  }

  setBounds(pageId: PageId, bounds: Rectangle): void {
    const entry = this.entries.get(pageId);
    if (!entry) return;
    entry.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }

  hide(pageId: PageId): void {
    const entry = this.entries.get(pageId);
    if (!entry) return;
    entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  setUserFocus(pageId: PageId | null): void {
    if (this.userFocusedPageId && this.entries.has(this.userFocusedPageId)) {
      const prev = this.entries.get(this.userFocusedPageId)!;
      prev.userFocused = false;
      this.emit('tab-updated', this.toSummary(prev));
    }
    this.userFocusedPageId = pageId;
    if (pageId) {
      const entry = this.entries.get(pageId);
      if (entry) {
        entry.userFocused = true;
        this.emit('tab-updated', this.toSummary(entry));
      }
    }
  }

  pausePage(pageId: PageId, paused: boolean): void {
    const entry = this.entries.get(pageId);
    if (!entry) return;
    entry.paused = paused;
    this.emit('tab-paused', { pageId, paused });
    this.emit('tab-updated', this.toSummary(entry));
  }

  async sendCdp(pageId: PageId, method: string, params: unknown = {}): Promise<unknown> {
    const entry = this.entries.get(pageId);
    if (!entry) throw new Error(`tab not found: ${pageId}`);
    if (entry.paused) throw new Error(`tab paused by user: ${pageId}`);
    if (!entry.debuggerAttached) this.attachDebugger(entry);

    entry.lastAgentActionAt = Date.now();
    this.emit('tab-agent-activity', { pageId, at: entry.lastAgentActionAt });

    return await entry.view.webContents.debugger.sendCommand(method, params as object);
  }

  // Page.printToPDF is not exposed through Electron's debugger — use the
  // native webContents.printToPDF() instead.
  async printPdf(pageId: PageId): Promise<Buffer> {
    const entry = this.entries.get(pageId);
    if (!entry) throw new Error(`tab not found: ${pageId}`);
    if (entry.paused) throw new Error(`tab paused by user: ${pageId}`);

    entry.lastAgentActionAt = Date.now();
    this.emit('tab-agent-activity', { pageId, at: entry.lastAgentActionAt });

    return await entry.view.webContents.printToPDF({});
  }

  listPages(): TabSummary[] {
    return Array.from(this.entries.values()).map((e) => this.toSummary(e));
  }

  getPage(pageId: PageId): TabSummary | null {
    const entry = this.entries.get(pageId);
    return entry ? this.toSummary(entry) : null;
  }

  resolveDefaultPage(): PageId | null {
    if (this.userFocusedPageId && this.entries.has(this.userFocusedPageId)) {
      return this.userFocusedPageId;
    }
    const last = Array.from(this.entries.keys()).pop();
    return last ?? null;
  }

  // ─── Buffer accessors (called over IPC by the agent) ────────────────

  getConsoleBuffer(pageId: PageId, includePreserved = false): ConsoleEntry[] {
    const entry = this.entries.get(pageId);
    if (!entry) return [];
    if (!includePreserved) return [...entry.buffers.consoleMessages];
    const preserved = [...entry.buffers.preservedConsole].reverse().flat();
    return [...preserved, ...entry.buffers.consoleMessages];
  }

  getConsoleMessage(pageId: PageId, msgid: number): ConsoleEntry | null {
    const entry = this.entries.get(pageId);
    return entry?.buffers.consoleById.get(msgid) ?? null;
  }

  getNetworkBuffer(pageId: PageId, includePreserved = false): { requests: Record<string, unknown>[]; latestReqId: number | null } {
    const entry = this.entries.get(pageId);
    if (!entry) return { requests: [], latestReqId: null };
    const current = entry.buffers.networkRecords;
    let records = current;
    if (includePreserved) {
      const preserved = [...entry.buffers.preservedNetwork].reverse().flat();
      records = [...preserved, ...current];
    }
    return {
      requests: records.map(publicNetworkEntry),
      latestReqId: entry.buffers.latestReqId ?? null,
    };
  }

  async getNetworkRequest(pageId: PageId, reqid?: number): Promise<{
    entry: Record<string, unknown>;
    requestBody: string | null;
    responseBody: { encoding: string; data: string } | null;
  } | null> {
    const entry = this.entries.get(pageId);
    if (!entry) return null;
    const target = reqid ?? entry.buffers.latestReqId;
    if (!target) return null;
    const rec = entry.buffers.networkByReqId.get(target);
    if (!rec) return null;

    // lazy-fetch response body if we haven't already
    if (!rec.responseBody && rec.status != null && entry.debuggerAttached && !entry.paused) {
      try {
        const body = await entry.view.webContents.debugger.sendCommand(
          'Network.getResponseBody',
          { requestId: rec.requestId },
        ) as { body: string; base64Encoded: boolean };
        rec.responseBody = {
          encoding: body.base64Encoded ? 'base64' : 'utf8',
          data: body.body,
        };
      } catch {
        // ignore - some responses (e.g. no-content) don't have retrievable bodies
      }
    }

    return {
      entry: publicNetworkEntry(rec),
      requestBody: rec.requestBody ?? null,
      responseBody: rec.responseBody ?? null,
    };
  }

  // ─── internals ──────────────────────────────────────────────────────

  private attachDebugger(entry: Entry): void {
    if (entry.debuggerAttached) return;
    try {
      entry.view.webContents.debugger.attach('1.3');
      entry.debuggerAttached = true;
    } catch (err) {
      console.error(`[browser-controller] debugger.attach failed for ${entry.pageId}:`, err);
      return;
    }
    const enables = [
      'Page.enable',
      'DOM.enable',
      'Runtime.enable',
      'Network.enable',
      'Accessibility.enable',
      'Log.enable',
    ];
    for (const m of enables) {
      entry.view.webContents.debugger.sendCommand(m).catch(() => {});
    }

    // subscribe to CDP events for console + network buffering
    entry.view.webContents.debugger.on('message', (_event, method, params) => {
      try { this.handleCdpEvent(entry, method, params); } catch {}
    });

    entry.view.webContents.debugger.on('detach', (_event, reason) => {
      console.error(`[browser-controller] debugger detached from ${entry.pageId}: ${reason}`);
      entry.debuggerAttached = false;
    });
  }

  private handleCdpEvent(entry: Entry, method: string, params: any): void {
    const buf = entry.buffers;
    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const args: Array<{ value?: unknown; description?: string }> = params.args || [];
        const text = args.map((a) => a.value !== undefined ? String(a.value) : a.description || '').join(' ');
        const e: ConsoleEntry = {
          msgid: buf.nextConsoleId++,
          type: params.type || 'log',
          text,
          timestamp: new Date().toISOString(),
          location: params.stackTrace?.callFrames?.[0]
            ? {
                url: params.stackTrace.callFrames[0].url,
                lineNumber: params.stackTrace.callFrames[0].lineNumber,
                columnNumber: params.stackTrace.callFrames[0].columnNumber,
              }
            : undefined,
        };
        buf.consoleMessages.push(e);
        buf.consoleById.set(e.msgid, e);
        capBuffer(buf.consoleMessages);
        break;
      }
      case 'Runtime.exceptionThrown': {
        const ex = params.exceptionDetails;
        const e: ConsoleEntry = {
          msgid: buf.nextConsoleId++,
          type: 'error',
          text: ex?.exception?.description || ex?.text || 'Exception',
          timestamp: new Date().toISOString(),
          location: { url: ex?.url || '', lineNumber: ex?.lineNumber || 0, columnNumber: ex?.columnNumber || 0 },
        };
        buf.consoleMessages.push(e);
        buf.consoleById.set(e.msgid, e);
        capBuffer(buf.consoleMessages);
        break;
      }
      case 'Log.entryAdded': {
        const le = params.entry;
        const e: ConsoleEntry = {
          msgid: buf.nextConsoleId++,
          type: le.level || 'log',
          text: le.text || '',
          timestamp: new Date(le.timestamp || Date.now()).toISOString(),
          location: le.url ? { url: le.url, lineNumber: le.lineNumber || 0, columnNumber: 0 } : undefined,
        };
        buf.consoleMessages.push(e);
        buf.consoleById.set(e.msgid, e);
        capBuffer(buf.consoleMessages);
        break;
      }
      case 'Network.requestWillBeSent': {
        const { requestId, request, type } = params;
        const reqid = buf.nextReqId++;
        const e: NetworkEntry = {
          reqid,
          requestId,
          url: request.url,
          method: request.method,
          resourceType: type || 'Other',
          startedAt: new Date().toISOString(),
          requestHeaders: request.headers,
          requestBody: request.postData,
        };
        buf.networkRecords.push(e);
        buf.networkByReqId.set(reqid, e);
        buf.networkByCdpId.set(requestId, e);
        buf.latestReqId = reqid;
        capBuffer(buf.networkRecords);
        break;
      }
      case 'Network.responseReceived': {
        const { requestId, response } = params;
        const rec = buf.networkByCdpId.get(requestId);
        if (!rec) return;
        rec.status = response.status;
        rec.statusText = response.statusText;
        rec.responseHeaders = response.headers;
        rec.mimeType = response.mimeType;
        break;
      }
      case 'Network.loadingFinished': {
        const { requestId } = params;
        const rec = buf.networkByCdpId.get(requestId);
        if (!rec) return;
        rec.finishedAt = new Date().toISOString();
        break;
      }
      case 'Network.loadingFailed': {
        const { requestId, errorText } = params;
        const rec = buf.networkByCdpId.get(requestId);
        if (!rec) return;
        rec.failureText = errorText || 'request failed';
        rec.finishedAt = new Date().toISOString();
        break;
      }
      case 'Page.frameNavigated': {
        const frame = params.frame;
        // main-frame navigation only — preserve history and clear buffers
        if (frame && !frame.parentId) {
          preserveHistory(buf.preservedConsole, buf.consoleMessages);
          preserveHistory(buf.preservedNetwork, buf.networkRecords);
          buf.consoleById.clear();
          buf.networkByReqId.clear();
          buf.networkByCdpId.clear();
          buf.latestReqId = undefined;
        }
        break;
      }
      default:
        // ignore - many events we don't need to buffer
        break;
    }
  }

  private wireViewEvents(entry: Entry): void {
    const wc = entry.view.webContents;

    wc.on('page-title-updated', (_event, title) => {
      entry.title = title;
      this.emit('tab-updated', this.toSummary(entry));
    });

    wc.on('page-favicon-updated', (_event, favicons) => {
      entry.favicon = favicons[0] || null;
      this.emit('tab-updated', this.toSummary(entry));
    });

    wc.on('did-navigate', (_event, url) => {
      entry.url = url;
      this.emit('tab-updated', this.toSummary(entry));
    });

    wc.on('did-navigate-in-page', (_event, url) => {
      entry.url = url;
      this.emit('tab-updated', this.toSummary(entry));
    });

    wc.on('did-start-loading', () => {
      this.emit('tab-updated', this.toSummary(entry));
    });

    wc.on('did-stop-loading', () => {
      this.emit('tab-updated', this.toSummary(entry));
    });

    wc.on('input-event', (_event, input) => {
      if (input.type === 'mouseDown' || input.type === 'keyDown' || input.type === 'mouseWheel') {
        entry.lastUserInteractionAt = Date.now();
        this.emit('tab-user-activity', { pageId: entry.pageId, at: entry.lastUserInteractionAt });
      }
    });

    wc.setWindowOpenHandler(({ url }) => {
      // popups inherit origin from their opener so agent-driven window.open()
      // still surfaces as an agent tab in the UI.
      this.createPage({ url, background: true, origin: entry.origin }).catch((e) => {
        console.error('[browser-controller] popup createPage failed:', e);
      });
      return { action: 'deny' };
    });
  }

  private toSummary(entry: Entry): TabSummary {
    return {
      pageId: entry.pageId,
      url: entry.url,
      title: entry.title,
      favicon: entry.favicon,
      canGoBack: entry.view.webContents.navigationHistory.canGoBack(),
      canGoForward: entry.view.webContents.navigationHistory.canGoForward(),
      paused: entry.paused,
      userFocused: entry.userFocused,
      lastUserInteractionAt: entry.lastUserInteractionAt,
      lastAgentActionAt: entry.lastAgentActionAt,
      origin: entry.origin,
    };
  }

  shutdown(): void {
    for (const pageId of Array.from(this.entries.keys())) {
      this.destroyPage(pageId).catch(() => {});
    }
  }
}

// ─── Public network entry (safe to serialize over IPC) ────────────────

function publicNetworkEntry(rec: NetworkEntry): Record<string, unknown> {
  return {
    reqid: rec.reqid,
    url: rec.url,
    method: rec.method,
    resourceType: rec.resourceType,
    status: rec.status ?? null,
    statusText: rec.statusText ?? null,
    mimeType: rec.mimeType ?? null,
    failureText: rec.failureText ?? null,
    startedAt: rec.startedAt,
    finishedAt: rec.finishedAt ?? null,
    requestHeaders: rec.requestHeaders || {},
    responseHeaders: rec.responseHeaders || {},
  };
}
