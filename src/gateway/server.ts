import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, chmodSync, unlinkSync, realpathSync, cpSync, createWriteStream, watch, type FSWatcher } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import * as nodePty from 'node-pty';
import { resolve as pathResolve, join, dirname, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';

const resolve = (p: string) => pathResolve(p.startsWith('~') ? p.replace('~', homedir()) : p);
import type { Config } from '../config.js';
import { isPathAllowed, saveConfig, ALWAYS_DENIED, type SecurityConfig, type ToolPolicyConfig } from '../config.js';
import type { WsMessage, WsResponse, WsEvent, GatewayContext } from './types.js';
import { SessionRegistry } from './session-registry.js';
import { ChannelManager } from './channel-manager.js';
import { SessionManager } from '../session/manager.js';
import { streamAgent, type AgentResult } from '../agent.js';
import type { RunHandle } from '../providers/types.js';
import { startScheduler, loadCalendarItems, migrateCronToCalendar, type SchedulerRunner } from '../calendar/scheduler.js';
import { checkSkillEligibility, loadAllSkills, findSkillByName } from '../skills/loader.js';
import { builtInAgents, getAllAgents } from '../agents/definitions.js';
import { getWorktreeStats, removeWorktree } from '../worktree/manager.js';
import type { InboundMessage } from '../channels/types.js';
import { getAllChannelStatuses } from '../channels/index.js';
import { loginWhatsApp, logoutWhatsApp, isWhatsAppLinked } from '../channels/whatsapp/login.js';
import { getDefaultAuthDir } from '../channels/whatsapp/session.js';
import { validateTelegramToken } from '../channels/telegram/bot.js';
import { getDb } from '../db.js';
import { insertEvent, queryEventsBySessionCursor, deleteEventsUpToSeq, cleanupOldEvents } from './event-log.js';
import { getChannelHandler } from '../tools/messaging.js';
import { closeBrowser } from '../browser/manager.js';
import { setScheduler, setBrowserConfig } from '../tools/index.js';
import { loadProjects, saveProjects, type Project } from '../tools/projects.js';
import {
  loadTasks,
  saveTasks,
  type Task,
  appendTaskLog,
  readTaskLogs,
} from '../tools/tasks.js';
import { loadResearch, saveResearch, readResearchContent, writeResearchFile, nextId as nextResearchId, type ResearchItem } from '../tools/research.js';
import { getProvider, getProviderByName, disposeAllProviders } from '../providers/index.js';
import { isClaudeInstalled, hasOAuthTokens, getApiKey as getClaudeApiKey, onClaudeAuthRequired } from '../providers/claude.js';
import { isCodexInstalled, hasCodexAuth, onCodexAuthRequired } from '../providers/codex.js';
import type { ProviderName } from '../config.js';
import { buildProviderAuthGate, classifyAuthRecovery, type ProviderAuthGate } from './auth-state.js';
import { startHttpAuthServer, type HttpAuthServer } from './http-auth-server.js';
import { setCachedAuth, flushAuthCache } from '../providers/auth-cache.js';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { classifyToolCall, cleanToolName, isToolAllowed, type Tier } from './tool-policy.js';
import { AUTONOMOUS_SCHEDULE_ID, buildAutonomousCalendarItem, PULSE_INTERVALS, DEFAULT_PULSE_INTERVAL, pulseIntervalToRrule, rruleToPulseInterval } from '../autonomous.js';
import {
  DORABOT_DIR,
  GATEWAY_SOCKET_PATH,
  GATEWAY_TOKEN_PATH,
  OWNER_CHAT_IDS_PATH,
  SKILLS_DIR,
  TELEGRAM_DIR,
  TELEGRAM_TOKEN_PATH,
  ensureWorkspace,
} from '../workspace.js';

// Notifications are handled by the desktop app via WebSocket broadcast events.
// The old osascript approach triggered macOS TCC prompts on every call.
function macNotify(_title: string, _body: string) {
  // no-op: desktop picks up broadcast events and shows toasts/native notifications
}

// ── Tool status display maps ──────────────────────────────────────────
// Used to build the live status message shown on Telegram/WhatsApp while the agent works.
// Output is markdown that gets converted to HTML by markdownToTelegramHtml().

const TOOL_EMOJI: Record<string, string> = {
  Read: '📄', Write: '📝', Edit: '✏️',
  Glob: '📂', Grep: '🔍', Bash: '⚡',
  WebFetch: '🌐', WebSearch: '🔎', Task: '🤖',
  AskUserQuestion: '💬', TodoWrite: '📋',
  NotebookEdit: '📓', message: '💬',
  screenshot: '📸', browser: '🌐',
  schedule: '⏰', list_schedule: '⏰',
  update_schedule: '⏰', cancel_schedule: '⏰',
  projects_view: '📋', projects_add: '📋', projects_update: '📋', projects_delete: '📋',
  tasks_view: '✅', tasks_add: '✅', tasks_update: '✅', tasks_done: '✅', tasks_delete: '✅',
};

const TOOL_LABEL: Record<string, string> = {
  Read: 'Read', Write: 'Wrote', Edit: 'Edited',
  Glob: 'Searched files', Grep: 'Searched', Bash: 'Ran',
  WebFetch: 'Fetched', WebSearch: 'Searched web', Task: 'Ran task',
  AskUserQuestion: 'Asked a question', TodoWrite: 'Updated tasks',
  NotebookEdit: 'Edited notebook', message: 'Replied',
  screenshot: 'Took screenshot', browser: 'Browsed',
  schedule: 'Scheduled', list_schedule: 'Listed schedule',
  update_schedule: 'Updated schedule', cancel_schedule: 'Cancelled schedule',
  projects_view: 'Checked projects', projects_add: 'Added project', projects_update: 'Updated project', projects_delete: 'Deleted project',
  tasks_view: 'Checked tasks', tasks_add: 'Added task', tasks_update: 'Updated task', tasks_done: 'Completed task', tasks_delete: 'Deleted task',
};

const TOOL_ACTIVE_LABEL: Record<string, string> = {
  Read: 'Reading', Write: 'Writing', Edit: 'Editing',
  Glob: 'Searching files', Grep: 'Searching', Bash: 'Running',
  WebFetch: 'Fetching', WebSearch: 'Searching web', Task: 'Running task',
  AskUserQuestion: 'Asking', TodoWrite: 'Updating tasks',
  NotebookEdit: 'Editing notebook', message: 'Replying',
  screenshot: 'Taking screenshot', browser: 'Browsing',
  schedule: 'Scheduling', list_schedule: 'Listing schedule',
  update_schedule: 'Updating schedule', cancel_schedule: 'Cancelling schedule',
  projects_view: 'Checking projects', projects_add: 'Adding project', projects_update: 'Updating project', projects_delete: 'Deleting project',
  tasks_view: 'Checking tasks', tasks_add: 'Adding task', tasks_update: 'Updating task', tasks_done: 'Completing task', tasks_delete: 'Deleting task',
};

// Plural labels when multiple consecutive same-tool calls are grouped
const TOOL_PLURAL: Record<string, (n: number) => string> = {
  Read: (n) => `Read ${n} files`,
  Write: (n) => `Wrote ${n} files`,
  Edit: (n) => `Edited ${n} files`,
  Grep: (n) => `Ran ${n} searches`,
  Bash: (n) => `Ran ${n} commands`,
  Task: (n) => `Ran ${n} sub-tasks`,
  WebFetch: (n) => `Fetched ${n} pages`,
  WebSearch: (n) => `Ran ${n} web searches`,
  browser: (n) => `Performed ${n} browser actions`,
};

function shortPath(p: string): string {
  if (!p) return '';
  const parts = p.replace(/^\/+/, '').split('/');
  return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/');
}

function extractToolDetail(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return shortPath(String(input.file_path || ''));
    case 'Write': return shortPath(String(input.file_path || ''));
    case 'Edit': return shortPath(String(input.file_path || ''));
    case 'Glob': return String(input.pattern || '').slice(0, 40);
    case 'Grep': {
      const pat = String(input.pattern || '').slice(0, 25);
      const p = input.path ? shortPath(String(input.path)) : '';
      return p ? `"${pat}" in ${p}` : `"${pat}"`;
    }
    case 'Bash': return String(input.command || '').split('\n')[0].slice(0, 50);
    case 'WebFetch': {
      try { return new URL(String(input.url || '')).hostname; } catch { return ''; }
    }
    case 'WebSearch': return String(input.query || '').slice(0, 40);
    case 'Task':
    case 'Agent': return String(input.description || '').slice(0, 40);
    case 'message': return '';
    case 'browser': return String(input.action || '');
    case 'screenshot': return '';
    default: return '';
  }
}

type ToolEntry = { name: string; detail: string };
type ToolGroup = { name: string; entries: ToolEntry[] };

/** Group consecutive tools with the same name */
function groupConsecutiveTools(entries: ToolEntry[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.name === entry.name) {
      last.entries.push(entry);
    } else {
      groups.push({ name: entry.name, entries: [entry] });
    }
  }
  return groups;
}

/** Wrap detail text in backticks for inline code rendering, stripping any existing backticks */
function fmtDetail(detail: string): string {
  if (!detail) return '';
  const clean = detail.replace(/`/g, "'");
  return ` \`${clean}\``;
}

/** Format a group of completed tool calls into a single status line */
function formatCompletedGroup(g: ToolGroup): string {
  const emoji = TOOL_EMOJI[g.name] || '✓';

  if (g.name === 'message') return `✓ 💬 Replied`;

  if (g.entries.length === 1) {
    const label = TOOL_LABEL[g.name] || g.name;
    return `✓ ${emoji} ${label}${fmtDetail(g.entries[0].detail)}`;
  }

  // Multiple consecutive calls — use plural summary
  const count = g.entries.length;
  const pluralFn = TOOL_PLURAL[g.name];
  const text = pluralFn ? pluralFn(count) : `${TOOL_LABEL[g.name] || g.name} ×${count}`;
  return `✓ ${emoji} ${text}`;
}

/**
 * Build a user-friendly status message shown on channels while the agent works.
 *
 * Features:
 * - Groups consecutive same-tool calls (e.g. "Read 3 files" instead of 3 lines)
 * - Collapses older steps when there are many ("...5 earlier steps")
 * - Uses markdown formatting: `code` for file paths/commands, _italic_ for collapsed hint
 * - Separates completed steps from the active step visually
 */
function buildToolStatusText(completed: ToolEntry[], current: ToolEntry | null): string {
  const lines: string[] = [];

  const groups = groupConsecutiveTools(completed);

  // Collapse older groups if there are many — keep last 4 visible
  const MAX_VISIBLE = 4;
  let visibleGroups = groups;
  let hiddenSteps = 0;

  if (groups.length > MAX_VISIBLE) {
    const hidden = groups.slice(0, groups.length - MAX_VISIBLE);
    hiddenSteps = hidden.reduce((sum, g) => sum + g.entries.length, 0);
    visibleGroups = groups.slice(groups.length - MAX_VISIBLE);
  }

  if (hiddenSteps > 0) {
    lines.push(`_...${hiddenSteps} earlier step${hiddenSteps === 1 ? '' : 's'}_`);
  }

  for (const g of visibleGroups) {
    lines.push(formatCompletedGroup(g));
  }

  if (current) {
    // Visual separator between completed and active
    if (lines.length > 0) lines.push('');

    if (current.name === 'message') {
      lines.push(`⏳ 💬 Replying...`);
    } else {
      const emoji = TOOL_EMOJI[current.name] || '⏳';
      const label = TOOL_ACTIVE_LABEL[current.name] || current.name;
      lines.push(`⏳ ${emoji} ${label}${fmtDetail(current.detail)}...`);
    }
  }

  return lines.join('\n');
}

export type GatewayOptions = {
  config: Config;
  socketPath?: string;
  // Deprecated: retained for compatibility with older scripts/config.
  port?: number;
  // Deprecated: retained for compatibility with older scripts/config.
  host?: string;
};

export type Gateway = {
  close: () => Promise<void>;
  broadcast: (event: WsEvent) => void;
  sessionRegistry: SessionRegistry;
  channelManager: ChannelManager;
  scheduler: SchedulerRunner | null;
  context: GatewayContext;
  /** HTTP auth fallback server port (0 if not started) */
  httpAuthPort: number;
};

export async function startGateway(opts: GatewayOptions): Promise<Gateway> {
  const { config } = opts;
  const socketPath = opts.socketPath || GATEWAY_SOCKET_PATH;
  const startedAt = Date.now();
  setBrowserConfig(config.browser || {});
  ensureWorkspace();
  mkdirSync(dirname(socketPath), { recursive: true });

  // stable gateway auth token — reuse existing, only generate on first run
  const tokenPath = GATEWAY_TOKEN_PATH;
  mkdirSync(DORABOT_DIR, { recursive: true });
  let gatewayToken: string;
  if (existsSync(tokenPath)) {
    gatewayToken = readFileSync(tokenPath, 'utf-8').trim();
    console.log(`[gateway] reusing auth token from ${tokenPath}`);
  } else {
    gatewayToken = randomBytes(32).toString('hex');
    writeFileSync(tokenPath, gatewayToken, { mode: 0o600 });
    console.log(`[gateway] auth token created at ${tokenPath}`);
  }

  const streamV2Enabled = config.gateway?.streamV2 !== false;
  const STREAM_BACKPRESSURE_CLOSE_BYTES = 2 * 1024 * 1024;
  const CLIENT_HEARTBEAT_TIMEOUT_MS = 30_000;
  const CLIENT_HEARTBEAT_SWEEP_MS = 5_000;
  const REPLAY_BATCH_DEFAULT_LIMIT = 2000;
  const REPLAY_BATCH_MAX_LIMIT = 10_000;

  type ClientState = {
    authenticated: boolean;
    subscriptions: Set<string>;
    lastSeen: number;
    connectId: string;
    bufferedAmountMax: number;
    disconnectReason: string | null;
  };
  const clients = new Map<WebSocket, ClientState>();
  let connectCounter = 0;

  // live session snapshots for instant hydration on subscribe
  const sessionSnapshots = new Map<string, import('./types.js').SessionSnapshot>();

  // stream event batching: accumulate agent.stream per client, flush every 16ms
  const streamBatches = new Map<WebSocket, { events: string[]; timer: ReturnType<typeof setTimeout> | null }>();

  function flushStreamBatch(ws: WebSocket): void {
    const batch = streamBatches.get(ws);
    if (!batch || batch.events.length === 0) return;
    if (batch.timer) { clearTimeout(batch.timer); batch.timer = null; }
    if (ws.readyState !== WebSocket.OPEN) { batch.events = []; return; }
    if (batch.events.length === 1) ws.send(batch.events[0]);
    else ws.send(JSON.stringify({ event: 'agent.stream_batch', data: batch.events.map(e => JSON.parse(e)) }));
    batch.events = [];
  }

  function queueStreamEvent(ws: WebSocket, serialized: string): void {
    let batch = streamBatches.get(ws);
    if (!batch) {
      batch = { events: [], timer: null };
      streamBatches.set(ws, batch);
    }
    batch.events.push(serialized);

    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          batch!.events = [];
          batch!.timer = null;
          return;
        }
        if (batch!.events.length === 1) ws.send(batch!.events[0]);
        else ws.send(JSON.stringify({ event: 'agent.stream_batch', data: batch!.events.map(e => JSON.parse(e)) }));
        batch!.events = [];
        batch!.timer = null;
      }, 16);
    }
  }

  const closeClient = (ws: WebSocket, reason: string): void => {
    const state = clients.get(ws);
    if (state) state.disconnectReason = reason;
    try {
      ws.close(4101, reason.slice(0, 123));
    } catch {
      // ignore
    }
  };

  const heartbeatSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [ws, state] of clients) {
      if (!state.authenticated) continue;
      if (now - state.lastSeen <= CLIENT_HEARTBEAT_TIMEOUT_MS) continue;
      closeClient(ws, 'heartbeat_timeout');
    }
  }, CLIENT_HEARTBEAT_SWEEP_MS);
  heartbeatSweepTimer.unref?.();

  const broadcast = (event: WsEvent): void => {
    const sk = (event.data as any)?.sessionKey as string | undefined;

    // persist agent events to SQLite for cursor-based replay on reconnect
    if (
      sk
      && typeof event.event === 'string'
      && event.event.startsWith('agent.')
      && event.event !== 'agent.user_message'
    ) {
      event.seq = insertEvent(sk, event.event, JSON.stringify(event.data));
    }

    const data = JSON.stringify(event);
    for (const [ws, state] of clients) {
      if (ws.readyState !== WebSocket.OPEN || !state.authenticated) continue;
      // session-scoped events only go to subscribers; global events go to all
      if (sk && !state.subscriptions.has(sk)) continue;
      // streamV2 never drops stream deltas; slow clients are disconnected and must replay.
      if (streamV2Enabled && ws.bufferedAmount >= STREAM_BACKPRESSURE_CLOSE_BYTES) {
        closeClient(ws, 'backpressure');
        continue;
      }
      state.bufferedAmountMax = Math.max(state.bufferedAmountMax, ws.bufferedAmount);
      // batch agent.stream events, send everything else immediately
      if (event.event === 'agent.stream') {
        queueStreamEvent(ws, data);
      } else {
        // flush pending stream batch before tool_result/done so client has all deltas
        if (event.event === 'agent.tool_result' || event.event === 'agent.done' || event.event === 'agent.result') flushStreamBatch(ws);
        ws.send(data);
      }
    }
  };

  function broadcastStatus(sessionKey: string, status: string, toolName?: string, toolDetail?: string) {
    broadcast({
      event: 'agent.status',
      data: { sessionKey, status, toolName, toolDetail, timestamp: Date.now() },
    });
  }

  const authBroadcastCooldowns = new Map<string, number>();
  const AUTH_BROADCAST_COOLDOWN_MS = 60_000;
  function broadcastAuthRequired(provider: string, reason: string) {
    const now = Date.now();
    const last = authBroadcastCooldowns.get(provider) || 0;
    if (now - last < AUTH_BROADCAST_COOLDOWN_MS) return;
    authBroadcastCooldowns.set(provider, now);
    broadcast({
      event: 'provider.auth_required',
      data: { provider, reason, timestamp: now },
    });
  }

  const unsubscribeClaudeAuthRequired = onClaudeAuthRequired((reason) => {
    broadcastAuthRequired('claude', reason);
  });
  const unsubscribeCodexAuthRequired = onCodexAuthRequired((reason) => {
    broadcastAuthRequired('codex', reason);
  });

  // file system watcher manager
  type FileWatchEntry = {
    watcher: FSWatcher;
    refCount: number;
    debounceTimer?: ReturnType<typeof setTimeout>;
    pendingEvent?: { eventType: string; filename: string | null };
  };
  const fileWatchers = new Map<string, FileWatchEntry>();
  const watchedPathsByClient = new Map<WebSocket, Set<string>>();
  const shellProcesses = new Map<string, nodePty.IPty>();
  const shellsByClient = new Map<WebSocket, Set<string>>();
  const orphanedShells = new Map<string, ReturnType<typeof setTimeout>>();
  const SHELL_ORPHAN_GRACE_MS = 60_000;

  // --- Terminal scrollback ring buffer ---
  const SHELL_SCROLLBACK_MAX = 256 * 1024; // 256 KB per shell
  const SCROLLBACK_DIR = join(DORABOT_DIR, 'shells');
  try { mkdirSync(SCROLLBACK_DIR, { recursive: true }); } catch {}

  class ScrollbackBuffer {
    private buf: Buffer;
    private pos = 0;
    private full = false;
    constructor(private maxSize = SHELL_SCROLLBACK_MAX) { this.buf = Buffer.alloc(maxSize); }
    write(data: string): void {
      const bytes = Buffer.from(data, 'binary');
      if (bytes.length >= this.maxSize) {
        bytes.copy(this.buf, 0, bytes.length - this.maxSize);
        this.pos = 0; this.full = true; return;
      }
      const space = this.maxSize - this.pos;
      if (bytes.length <= space) {
        bytes.copy(this.buf, this.pos);
        this.pos += bytes.length;
        if (this.pos === this.maxSize) { this.pos = 0; this.full = true; }
      } else {
        bytes.copy(this.buf, this.pos, 0, space);
        bytes.copy(this.buf, 0, space);
        this.pos = bytes.length - space;
        this.full = true;
      }
    }
    read(): Buffer {
      if (!this.full) return Buffer.from(this.buf.subarray(0, this.pos));
      return Buffer.concat([this.buf.subarray(this.pos), this.buf.subarray(0, this.pos)]);
    }
    toBase64(): string { return this.read().toString('base64'); }
    get size(): number { return this.full ? this.maxSize : this.pos; }
  }

  const shellScrollbacks = new Map<string, ScrollbackBuffer>();
  // map shellId -> sessionKey for tying terminals to sessions
  const shellSessionKeys = new Map<string, string>();

  // prevent path traversal via shellId (must be alphanumeric/dash/underscore only)
  function isValidShellId(shellId: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(shellId);
  }

  function saveScrollbackToDisk(shellId: string): void {
    if (!isValidShellId(shellId)) return;
    const sb = shellScrollbacks.get(shellId);
    if (!sb || sb.size === 0) return;
    try {
      writeFileSync(join(SCROLLBACK_DIR, `${shellId}.scrollback`), sb.read());
      // save metadata (sessionKey association)
      const sk = shellSessionKeys.get(shellId);
      if (sk) writeFileSync(join(SCROLLBACK_DIR, `${shellId}.meta`), JSON.stringify({ sessionKey: sk, savedAt: Date.now() }));
    } catch (err) {
      console.error(`[gateway] failed to save scrollback for ${shellId}:`, err);
    }
  }

  function loadScrollbackFromDisk(shellId: string): string | null {
    if (!isValidShellId(shellId)) return null;
    try {
      const p = join(SCROLLBACK_DIR, `${shellId}.scrollback`);
      if (existsSync(p)) return readFileSync(p).toString('base64');
    } catch (err) {
      console.error(`[gateway] failed to load scrollback for ${shellId}:`, err);
    }
    return null;
  }

  // prune old scrollback files (> 30 days)
  try {
    const now = Date.now();
    const files = readdirSync(SCROLLBACK_DIR).filter(f => f.endsWith('.scrollback'));
    for (const f of files) {
      const fp = join(SCROLLBACK_DIR, f);
      try {
        const st = statSync(fp);
        if (now - st.mtimeMs > 30 * 24 * 60 * 60 * 1000) {
          unlinkSync(fp);
          try { unlinkSync(fp.replace('.scrollback', '.meta')); } catch {}
        }
      } catch {}
    }
  } catch {}

  // --- Session checkpoints (for fast cold-start recovery) ---
  const checkpointDb = getDb(); // table created in db.ts init
  const upsertCheckpointStmt = checkpointDb.prepare(
    'INSERT INTO session_checkpoints (session_key, seq, created_at) VALUES (?, ?, unixepoch()) ON CONFLICT(session_key) DO UPDATE SET seq = ?, created_at = unixepoch()'
  );
  const getCheckpointStmt = checkpointDb.prepare('SELECT seq FROM session_checkpoints WHERE session_key = ?');
  const getCheckpointsStmt = checkpointDb.prepare('SELECT session_key, seq FROM session_checkpoints WHERE session_key IN (SELECT value FROM json_each(?))');

  function saveCheckpoint(sessionKey: string, seq: number): void {
    try { upsertCheckpointStmt.run(sessionKey, seq, seq); } catch (err) {
      console.error('[gateway] failed to save checkpoint:', err);
    }
  }

  function getCheckpointSeq(sessionKey: string): number | null {
    const row = getCheckpointStmt.get(sessionKey) as { seq: number } | undefined;
    return row ? row.seq : null;
  }

  function getCheckpointSeqs(sessionKeys: string[]): Map<string, number> {
    const map = new Map<string, number>();
    if (sessionKeys.length === 0) return map;
    try {
      const rows = getCheckpointsStmt.all(JSON.stringify(sessionKeys)) as { session_key: string; seq: number }[];
      for (const row of rows) map.set(row.session_key, row.seq);
    } catch {}
    return map;
  }
  const FS_WATCH_DEBOUNCE_MS = 250;
  const DEBUG_FS_WATCH = process.env.DORABOT_DEBUG_FS_WATCH === '1';

  const emitFsWatchEvent = (resolved: string) => {
    const entry = fileWatchers.get(resolved);
    if (!entry) return;
    entry.debounceTimer = undefined;
    const pending = entry.pendingEvent;
    entry.pendingEvent = undefined;
    if (!pending) return;
    broadcast({
      event: 'fs.change',
      data: { path: resolved, eventType: pending.eventType, filename: pending.filename, timestamp: Date.now() },
    });
  };

  const startWatching = (path: string) => {
    const resolved = resolve(path);
    const existing = fileWatchers.get(resolved);

    if (existing) {
      existing.refCount++;
      return;
    }

    try {
      const watcher = watch(resolved, { recursive: false }, (eventType, filename) => {
        const entry = fileWatchers.get(resolved);
        if (!entry) return;
        const filenameStr = filename ? String(filename) : null;
        if (DEBUG_FS_WATCH) {
          console.log(`[gateway] fs.watch: ${eventType} in ${resolved}${filenameStr ? '/' + filenameStr : ''}`);
        }
        entry.pendingEvent = { eventType, filename: filenameStr };
        if (entry.debounceTimer) return;
        entry.debounceTimer = setTimeout(() => emitFsWatchEvent(resolved), FS_WATCH_DEBOUNCE_MS);
        entry.debounceTimer.unref?.();
      });

      fileWatchers.set(resolved, { watcher, refCount: 1 });
      console.log(`[gateway] started watching: ${resolved}`);
    } catch (err) {
      console.error(`[gateway] failed to watch ${resolved}:`, err);
    }
  };

  const stopWatching = (path: string) => {
    const resolved = resolve(path);
    const existing = fileWatchers.get(resolved);

    if (!existing) return;

    existing.refCount--;

    if (existing.refCount <= 0) {
      if (existing.debounceTimer) clearTimeout(existing.debounceTimer);
      existing.watcher.close();
      fileWatchers.delete(resolved);
      console.log(`[gateway] stopped watching: ${resolved}`);
    }
  };

  const sessionRegistry = new SessionRegistry();
  sessionRegistry.loadFromDisk();
  const fileSessionManager = new SessionManager(config);

  const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4h
  // status messages sent to channels while agent is working
  const statusMessages = new Map<string, { channel: string; chatId: string; messageId: string }>();
  // remember the owner's chat ID per channel so the agent can reach them cross-channel
  const ownerChatIdsFile = OWNER_CHAT_IDS_PATH;
  const ownerChatIds = new Map<string, string>();

  // load persisted owner chat IDs from disk
  try {
    if (existsSync(ownerChatIdsFile)) {
      const saved = JSON.parse(readFileSync(ownerChatIdsFile, 'utf-8'));
      for (const [ch, id] of Object.entries(saved)) {
        if (typeof id === 'string') ownerChatIds.set(ch, id);
      }
    }
  } catch {}

  // seed from config allowFrom[0] for channels that aren't already known
  if (config.channels?.whatsapp?.enabled && config.channels.whatsapp.allowFrom?.[0] && !ownerChatIds.has('whatsapp')) {
    ownerChatIds.set('whatsapp', config.channels.whatsapp.allowFrom[0] + '@s.whatsapp.net');
  }
  if (config.channels?.telegram?.enabled && config.channels.telegram.allowFrom?.[0] && !ownerChatIds.has('telegram')) {
    ownerChatIds.set('telegram', config.channels.telegram.allowFrom[0]);
  }

  let ownerChatIdsDirty = false;
  function persistOwnerChatIds() {
    if (ownerChatIdsDirty) return;
    ownerChatIdsDirty = true;
    setTimeout(() => {
      ownerChatIdsDirty = false;
      const obj = Object.fromEntries(ownerChatIds);
      writeFile(ownerChatIdsFile, JSON.stringify(obj, null, 2)).catch(() => {});
    }, 1000);
  }

  async function sendTelegramOwnerStatus(message: string): Promise<void> {
    const chatId = ownerChatIds.get('telegram');
    if (!chatId) return;
    const telegram = getAllChannelStatuses().find(s => s.channel === 'telegram');
    if (!telegram?.connected) return;
    const handler = getChannelHandler('telegram');
    if (!handler) return;
    try {
      await handler.send(chatId, message);
    } catch (err) {
      console.error('[gateway] failed to send telegram status:', err);
    }
  }

  // queued messages for sessions with active runs
  const pendingMessages = new Map<string, InboundMessage[]>();
  // accumulated tool log per active run
  const toolLogs = new Map<string, { completed: ToolEntry[]; current: { name: string; inputJson: string; detail: string } | null; lastEditAt: number }>();
  // active RunHandles for message injection into running agent sessions
  const runHandles = new Map<string, RunHandle>();
  type RunReplyRef = {
    sessionId: string;
    source: string;
    sentAt: number;
    messagePreview: string;
  };
  type ChannelQuestionRef = {
    sessionId?: string;
    sessionKey?: string;
    source?: string;
    channel: string;
    chatId: string;
    chatType: string;
    question: string;
    createdAt: number;
  };
  const runReplyRefs = new Map<string, RunReplyRef>();
  const MAX_RUN_REPLY_REFS = 2000;
  const channelQuestionRefs = new Map<string, ChannelQuestionRef>();
  const MAX_CHANNEL_QUESTION_REFS = 2000;
  const QUESTION_LINK_WINDOW_MS = 45 * 60 * 1000;
  const activeTaskRuns = new Map<string, { sessionKey: string; startedAt: number }>();
  const taskRunBySession = new Map<string, string>();
  const runEventPruneTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const RUN_EVENT_PRUNE_GRACE_MS = 10 * 60 * 1000;
  // keep replay data for an extended window across crashes; normal pruning is run-end based.
  cleanupOldEvents(7 * 24 * 60 * 60);

  // kill orphaned Chrome processes from previous runs (dorabot browser profile)
  try {
    const { execSync: execSyncLocal } = await import('node:child_process');
    const pgrep = execSyncLocal('pgrep -f "user-data-dir.*\\.dorabot/browser/profile"', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (pgrep) {
      const pids = pgrep.split('\n').filter(Boolean);
      for (const pid of pids) {
        try { process.kill(parseInt(pid, 10), 'SIGTERM'); } catch {}
      }
      console.log(`[gateway] killed ${pids.length} orphaned browser process(es)`);
    }
  } catch {
    // no matching processes, or pgrep failed — fine
  }

  function scheduleRunEventPrune(sessionKey: string, maxSeqInclusive: number): void {
    if (!streamV2Enabled) return;
    const existing = runEventPruneTimers.get(sessionKey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      try {
        deleteEventsUpToSeq(sessionKey, maxSeqInclusive);
      } catch (err) {
        console.error('[gateway] failed pruning replay events:', err);
      } finally {
        runEventPruneTimers.delete(sessionKey);
      }
    }, RUN_EVENT_PRUNE_GRACE_MS);
    timer.unref?.();
    runEventPruneTimers.set(sessionKey, timer);
  }

  // per-session channel context so the stream loop can manage status messages
  type ChannelRunContext = {
    channel: string;
    chatId: string;
    statusMsgId?: string;
    typingInterval?: ReturnType<typeof setInterval>;
  };
  const channelRunContexts = new Map<string, ChannelRunContext>();

  // background runs state
  type BackgroundRun = {
    id: string; sessionKey: string; prompt: string;
    startedAt: number; status: 'running' | 'completed' | 'error';
    result?: string; error?: string;
  };
  const backgroundRuns = new Map<string, BackgroundRun>();

  // guard against overlapping WhatsApp login attempts
  let whatsappLoginInProgress = false;

  // pending OAuth re-auth: when a 401 hits mid-run, we send the OAuth URL to the
  // user's channel and wait for them to paste the code back
  type PendingReauth = {
    provider: ProviderName;
    prompt: string;
    sessionKey: string;
    source: string;
    channel: string;
    chatId: string;
    loginId?: string;
    messageMetadata?: import('../session/manager.js').MessageMetadata;
  };
  const pendingReauths = new Map<string, PendingReauth>(); // keyed by chatId

  function runRefKey(channel: string, chatId: string, messageId: string): string {
    return `${channel}:${chatId}:${messageId}`;
  }

  function clampPreview(text: string, max = 500): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function isMarkedRunSource(source: string): boolean {
    return source === `calendar/${AUTONOMOUS_SCHEDULE_ID}` || source.startsWith('plans/') || source.startsWith('tasks/');
  }

  function extractTaskIdFromSource(source: string): string | null {
    const m = source.match(/^tasks\/([^/]+)$/);
    return m ? m[1] : null;
  }

  function buildTaskExecutionPrompt(task: Task, project?: Project, mode: 'plan' | 'execute' = 'execute'): string {
    const projectLine = project ? `Project:\n#${project.id} [${project.status}] ${project.title}\n${project.description || ''}` : '';
    const reasonLine = task.reason ? `Reason:\n${task.reason}` : '';

    if (mode === 'plan') {
      return [
        `Plan task #${task.id}: ${task.title}`,
        '',
        projectLine,
        reasonLine,
        '',
        'Research and write a detailed execution plan for this task.',
        'Store the plan as a research doc using research_add.',
        'Include: objective, steps, risks, validation criteria.',
        'Do NOT execute the task, only plan.',
      ].filter(Boolean).join('\n');
    }

    return [
      `Execute task #${task.id}: ${task.title}`,
      '',
      projectLine,
      reasonLine,
      '',
      'Do concrete work, not status narration.',
      'Keep task state current with tasks_update as you work.',
      'If blocked, set status=blocked and include a clear reason.',
      'Mark done only when the task objective is met.',
    ].filter(Boolean).join('\n');
  }

  function markTaskRunStarted(taskId: string, sessionKey: string): void {
    activeTaskRuns.set(taskId, { sessionKey, startedAt: Date.now() });
    taskRunBySession.set(sessionKey, taskId);
    broadcast({
      event: 'tasks.run',
      data: { taskId, sessionKey, status: 'started', timestamp: Date.now() },
    });
  }

  function finishTaskRun(sessionKey: string, status: 'completed' | 'error', error?: string): void {
    const taskId = taskRunBySession.get(sessionKey);
    if (!taskId) return;
    const current = activeTaskRuns.get(taskId);
    if (current?.sessionKey === sessionKey) activeTaskRuns.delete(taskId);
    taskRunBySession.delete(sessionKey);

    const tasks = loadTasks();
    const task = tasks.tasks.find(t => t.id === taskId);
    if (task) {
      task.updatedAt = new Date().toISOString();
      if (status === 'completed') {
        task.status = 'done';
        task.completedAt = task.updatedAt;
        task.reason = undefined;
      } else {
        task.status = 'blocked';
        task.reason = error || 'Task run failed';
      }
      saveTasks(tasks);
      appendTaskLog(task.id, status === 'completed' ? 'run_completed' : 'run_error', status === 'completed' ? 'Task run completed' : (error || 'Task run failed'));
      broadcast({ event: 'projects.update', data: { taskId: task.id, task } });
      broadcast({
        event: 'tasks.log',
        data: {
          taskId: task.id,
          eventType: status === 'completed' ? 'run_completed' : 'run_error',
          message: status === 'completed' ? 'Task run completed' : (error || 'Task run failed'),
          timestamp: Date.now(),
        },
      });
      if (status === 'completed') {
        void sendTelegramOwnerStatus(`✅ Task #${task.id} completed: ${task.title}`);
      } else {
        void sendTelegramOwnerStatus(`⚠️ Task #${task.id} failed: ${task.title}\nReason: ${task.reason || error || 'unknown error'}`);
      }
    }

    broadcast({
      event: 'tasks.run',
      data: { taskId, sessionKey, status, timestamp: Date.now(), ...(error ? { error } : {}) },
    });
  }

  function maybeMarkTaskRunFromSource(source: string, sessionKey: string): void {
    const taskId = extractTaskIdFromSource(source);
    if (!taskId) return;
    if (taskRunBySession.get(sessionKey) === taskId) return;
    markTaskRunStarted(taskId, sessionKey);
  }

  function extractRunSessionId(text?: string): string | undefined {
    if (!text) return undefined;
    return text.match(/\brun_session_id:\s*([A-Za-z0-9._:-]+)/i)?.[1]
      || text.match(/\bpulse_session_id:\s*([A-Za-z0-9._:-]+)/i)?.[1];
  }

  function ensureSessionKeyForSessionId(sessionId: string): string | undefined {
    const existing = sessionRegistry.list().find(s => s.sessionId === sessionId);
    if (existing) return existing.key;

    const meta = fileSessionManager.getMetadata(sessionId);
    if (!meta?.channel || !meta?.chatId) return undefined;

    const chatType = meta.chatType || 'dm';
    const key = sessionRegistry.makeKey({
      channel: meta.channel,
      chatType,
      chatId: meta.chatId,
    });

    sessionRegistry.getOrCreate({
      channel: meta.channel,
      chatType,
      chatId: meta.chatId,
      sessionId,
    });
    if (meta.sdkSessionId) sessionRegistry.setSdkSessionId(key, meta.sdkSessionId);
    return key;
  }

  function appendRunSessionMarker(
    text: string,
    source: string,
    sessionKey: string,
    channel?: string,
  ): string {
    if (!text.trim()) return text;
    if (!isMarkedRunSource(source)) return text;
    if (channel && channel !== 'telegram' && channel !== 'whatsapp') return text;
    const sessionId = sessionRegistry.get(sessionKey)?.sessionId;
    if (!sessionId) return text;
    let out = text;
    if (!/run_session_id:\s+/i.test(out)) {
      out = `${out}\n\nrun_session_id: ${sessionId}`;
    }
    // Backward-compat for existing pulse parsing.
    if (source === `calendar/${AUTONOMOUS_SCHEDULE_ID}` && !/pulse_session_id:\s+/i.test(out)) {
      out = `${out}\npulse_session_id: ${sessionId}`;
    }
    return out;
  }

  function registerRunReplyRef(
    source: string,
    sessionKey: string,
    channel: string,
    chatId: string,
    messageId: string,
    messageText: string,
  ): void {
    if (!isMarkedRunSource(source)) return;
    const sessionId = sessionRegistry.get(sessionKey)?.sessionId;
    if (!sessionId) return;

    const key = runRefKey(channel, chatId, messageId);
    runReplyRefs.set(key, {
      sessionId,
      source,
      sentAt: Date.now(),
      messagePreview: clampPreview(messageText),
    });

    if (runReplyRefs.size <= MAX_RUN_REPLY_REFS) return;
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [k, v] of runReplyRefs) {
      if (v.sentAt < oldestTs) {
        oldestTs = v.sentAt;
        oldestKey = k;
      }
    }
    if (oldestKey) runReplyRefs.delete(oldestKey);
  }

  function registerChannelQuestionRef(requestId: string, ref: ChannelQuestionRef): void {
    channelQuestionRefs.set(requestId, ref);
    if (channelQuestionRefs.size <= MAX_CHANNEL_QUESTION_REFS) return;

    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [k, v] of channelQuestionRefs) {
      if (v.createdAt < oldestTs) {
        oldestTs = v.createdAt;
        oldestKey = k;
      }
    }
    if (oldestKey) channelQuestionRefs.delete(oldestKey);
  }

  function findRecentQuestionRef(msg: InboundMessage): ChannelQuestionRef | null {
    const now = Date.now();
    let best: ChannelQuestionRef | null = null;
    for (const ref of channelQuestionRefs.values()) {
      if (ref.channel !== msg.channel || ref.chatId !== msg.chatId) continue;
      if (now - ref.createdAt > QUESTION_LINK_WINDOW_MS) continue;
      if (ref.source && !isMarkedRunSource(ref.source)) continue;
      if (!best || ref.createdAt > best.createdAt) best = ref;
    }
    return best;
  }

  function resolveLinkedRunSession(msg: InboundMessage): { sessionId: string; sessionKey: string; source?: string; context: string } | null {
    const inlineSessionId = extractRunSessionId(msg.body) || extractRunSessionId(msg.replyToBody);
    if (inlineSessionId) {
      const sessionKey = ensureSessionKeyForSessionId(inlineSessionId);
      if (!sessionKey) return null;
      const source = activeRunSources.get(sessionKey);
      return {
        sessionId: inlineSessionId,
        sessionKey,
        source,
        context: [
          'User referenced a prior marked run.',
          `Run session_id: ${inlineSessionId}`,
          ...(source ? [`Run source: ${source}`] : []),
          'Continue this conversation in the same session.',
        ].join('\n'),
      };
    }

    if (msg.replyToId) {
      const ref = runReplyRefs.get(runRefKey(msg.channel, msg.chatId, msg.replyToId));
      if (ref) {
        const sessionKey = ensureSessionKeyForSessionId(ref.sessionId);
        if (sessionKey) {
          return {
            sessionId: ref.sessionId,
            sessionKey,
            source: ref.source,
            context: [
              'User replied to a prior marked run message.',
              `Run source: ${ref.source}`,
              `Run session_id: ${ref.sessionId}`,
              `Sent at: ${new Date(ref.sentAt).toISOString()}`,
              `Run message preview: ${ref.messagePreview || '(no preview)'}`,
              'Continue this conversation in the same session.',
            ].join('\n'),
          };
        }
      }
    }

    const recentQuestion = findRecentQuestionRef(msg);
    if (recentQuestion) {
      const sessionKey = (recentQuestion.sessionKey && sessionRegistry.get(recentQuestion.sessionKey))
        ? recentQuestion.sessionKey
        : (recentQuestion.sessionId ? ensureSessionKeyForSessionId(recentQuestion.sessionId) : undefined);
      if (sessionKey) {
        const sessionId = recentQuestion.sessionId || sessionRegistry.get(sessionKey)?.sessionId;
        if (sessionId) {
          return {
            sessionId,
            sessionKey,
            source: recentQuestion.source,
            context: [
              'User sent a follow-up after a recent AskUserQuestion from a marked run.',
              `Run source: ${recentQuestion.source || '(unknown)'}`,
              `Run session_id: ${sessionId}`,
              `Original question: ${recentQuestion.question}`,
              `Question sent at: ${new Date(recentQuestion.createdAt).toISOString()}`,
              'Continue this conversation in the same session.',
            ].join('\n'),
          };
        }
      }
    }

    return null;
  }

  function buildIncomingChannelPrompt(msg: InboundMessage, bodyText: string, replyContext?: string): string {
    const safeSender = (msg.senderName || msg.senderId).replace(/[<>"'&\n\r]/g, '_').slice(0, 50);
    const safeBody = bodyText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const mediaAttr = msg.mediaType ? ` media_type="${msg.mediaType}" media_path="${msg.mediaPath || ''}"` : '';

    return [
      `<incoming_message channel="${msg.channel}" sender="${safeSender}" chat="${msg.chatId}"${mediaAttr}>`,
      safeBody || (msg.mediaPath ? `[Attached: ${msg.mediaType || 'file'} at ${msg.mediaPath}]` : ''),
      `</incoming_message>`,
      ...(replyContext ? [
        '',
        '<run_reply_context>',
        replyContext.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        '</run_reply_context>',
      ] : []),
    ].join('\n');
  }

  // broadcast session.update so sidebar can show new/updated sessions + running state
  function broadcastSessionUpdate(sessionKey: string) {
    const reg = sessionRegistry.get(sessionKey);
    if (!reg) return;
    const meta = fileSessionManager.getMetadata(reg.sessionId);
    broadcast({
      event: 'session.update',
      data: {
        id: reg.sessionId,
        channel: reg.channel,
        chatId: reg.chatId,
        chatType: reg.chatType,
        senderName: meta?.senderName,
        messageCount: reg.messageCount,
        activeRun: reg.activeRun,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  // set up channel status message + typing for a session key
  function setupChannelStatus(sessionKey: string, channel: string, chatId: string) {
    const handler = getChannelHandler(channel);
    if (!handler) return;

    const ctx: ChannelRunContext = { channel, chatId };
    channelRunContexts.set(sessionKey, ctx);

    (async () => {
      try {
        if (handler.typing) handler.typing(chatId).catch(() => {});
        const sent = await handler.send(chatId, 'thinking...');
        // check if ctx was already cleaned up while we were awaiting
        if (!channelRunContexts.has(sessionKey)) return;
        ctx.statusMsgId = sent.id;
        statusMessages.set(sessionKey, { channel, chatId, messageId: sent.id });
      } catch {}
      // bail if cleaned up during await
      if (!channelRunContexts.has(sessionKey)) return;
      if (handler.typing) {
        ctx.typingInterval = setInterval(() => {
          handler.typing!(chatId).catch(() => {});
        }, 4500);
      }
    })();
  }

  function isAuthError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /authentication_error|401|OAuth token has expired|Invalid bearer token/i.test(msg);
  }

  // OAuth codes are long base64/hex strings, optionally with #state suffix
  function looksLikeOAuthCode(text: string): boolean {
    return /^[A-Za-z0-9_\-+=/.]{20,}(#[A-Za-z0-9_\-+=/.]+)?$/.test(text.trim());
  }

  async function startReauthFlow(params: {
    prompt: string; sessionKey: string; source: string;
    channel?: string; chatId?: string;
    messageMetadata?: import('../session/manager.js').MessageMetadata;
  }): Promise<boolean> {
    const providerName = (config.provider?.name || 'claude') as ProviderName;
    const provider = await getProviderByName(providerName);
    if (!provider.loginWithOAuth) return false;

    const { authUrl, loginId } = await provider.loginWithOAuth();

    // broadcast to desktop regardless — it can show an inline re-auth UI
    broadcast({ event: 'auth.reauth_required', data: {
      provider: providerName,
      channel: params.channel,
      chatId: params.chatId,
      authUrl,
      loginId,
    } });

    // if this came from a channel, send the link there and save context for replay
    const channel = params.channel;
    const chatId = params.chatId || params.messageMetadata?.chatId;
    if (channel && chatId) {
      const handler = getChannelHandler(channel);
      if (handler) {
        pendingReauths.set(chatId, {
          provider: providerName,
          prompt: params.prompt,
          sessionKey: params.sessionKey,
          source: params.source,
          channel,
          chatId,
          loginId,
          messageMetadata: params.messageMetadata,
        });
        await handler.send(chatId, providerName === 'codex'
          ? [
            'Auth token expired. Please re-authenticate on the computer running dorabot:',
            '',
            authUrl,
            '',
            'Open that link on the same computer, finish the browser flow, then send /done here. Send /cancel to skip.',
          ].join('\n')
          : [
            'Auth token expired. Please re-authenticate:',
            '',
            authUrl,
            '',
            'Open the link, click Authorize, then paste the code here. Send /cancel to skip.',
          ].join('\n'));
      }
    }
    return true;
  }

  function clearTypingInterval(ctx: ChannelRunContext) {
    if (ctx.typingInterval) {
      clearInterval(ctx.typingInterval);
      ctx.typingInterval = undefined;
    }
  }

  // process a channel message (or batched messages) through the agent
  async function processChannelMessage(
    msg: InboundMessage,
    batchedBodies?: string[],
    runReplyContext?: string,
    opts?: { sessionKey?: string; source?: string; preserveSessionMetadata?: boolean },
  ) {
    ownerChatIds.set(msg.channel, msg.chatId);
    persistOwnerChatIds();

    // intercept OAuth re-auth code if we're waiting for one
    const pendingReauth = pendingReauths.get(msg.chatId);
    if (pendingReauth) {
      const code = (msg.body || '').trim();
      const lowerCode = code.toLowerCase();
      const handler = getChannelHandler(msg.channel);
      if (lowerCode === '/cancel') {
        pendingReauths.delete(msg.chatId);
        if (handler) await handler.send(msg.chatId, 'Re-auth cancelled.');
        return;
      }
      if (pendingReauth.provider === 'codex' && lowerCode === '/done') {
        try {
          const provider = await getProviderByName(pendingReauth.provider);
          if (!provider.completeOAuthLogin || !pendingReauth.loginId) throw new Error('provider missing completeOAuthLogin');
          const status = await provider.completeOAuthLogin(pendingReauth.loginId);
          if (!status.authenticated) {
            if (handler) await handler.send(msg.chatId, `re-auth failed: ${status.error || 'unknown'}. finish the browser flow and send /done again, or send /cancel to skip.`);
            return;
          }
          pendingReauths.delete(msg.chatId);
          broadcast({ event: 'provider.auth_complete', data: { provider: pendingReauth.provider, status } });
          if (handler) await handler.send(msg.chatId, 'authenticated, retrying your message...');
          await processChannelMessage({
            ...msg,
            body: pendingReauth.messageMetadata?.body || pendingReauth.prompt,
            channel: pendingReauth.channel,
            chatId: pendingReauth.chatId,
          });
        } catch (err) {
          console.error('[gateway] re-auth completion failed:', err);
          if (handler) await handler.send(msg.chatId, `re-auth failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      // if it doesn't look like an OAuth code, treat as a normal message
      // (user might be chatting while re-auth is pending)
      if (pendingReauth.provider !== 'codex' && code && looksLikeOAuthCode(code)) {
        try {
          const provider = await getProviderByName(pendingReauth.provider);
          if (!provider.completeOAuthLogin) throw new Error('provider missing completeOAuthLogin');
          const status = await provider.completeOAuthLogin(code);
          if (!status.authenticated) {
            // keep pendingReauth so user can retry
            if (handler) await handler.send(msg.chatId, `re-auth failed: ${status.error || 'unknown'}. paste the code again or send /cancel to skip.`);
            return;
          }
          pendingReauths.delete(msg.chatId);
          broadcast({ event: 'provider.auth_complete', data: { provider: pendingReauth.provider, status } });
          if (handler) await handler.send(msg.chatId, 'authenticated, retrying your message...');
          await processChannelMessage({
            ...msg,
            body: pendingReauth.messageMetadata?.body || pendingReauth.prompt,
            channel: pendingReauth.channel,
            chatId: pendingReauth.chatId,
          });
        } catch (err) {
          console.error('[gateway] re-auth completion failed:', err);
          if (handler) await handler.send(msg.chatId, `re-auth failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      // otherwise fall through to normal message processing
    }
    let session = opts?.sessionKey ? sessionRegistry.get(opts.sessionKey) : undefined;
    if (!session) {
      session = sessionRegistry.getOrCreate({
        channel: msg.channel,
        chatType: msg.chatType,
        chatId: msg.chatId,
      });
    }

    if (!opts?.preserveSessionMetadata) {
      // update metadata index
      fileSessionManager.setMetadata(session.sessionId, {
        channel: msg.channel,
        chatId: msg.chatId,
        chatType: msg.chatType,
        senderName: msg.senderName,
      });
    }

    // send status message to channel + start typing indicator (stored in channelRunContexts)
    setupChannelStatus(session.key, msg.channel, msg.chatId);

    // init tool log for this run
    toolLogs.set(session.key, { completed: [], current: null, lastEditAt: 0 });

    const body = batchedBodies
      ? `Multiple messages:\n${batchedBodies.map((b, i) => `${i + 1}. ${b}`).join('\n')}`
      : msg.body;

    const replyContext = runReplyContext || resolveLinkedRunSession(msg)?.context;
    const channelPrompt = buildIncomingChannelPrompt(msg, body, replyContext);

    // handleAgentRun may never return for persistent sessions (Claude async generator).
    // Per-turn result handling is done inside the stream loop via channelRunContexts.
    // For non-persistent providers (Codex), this returns normally and cleanup below runs as safety net.
    const source = opts?.source || `${msg.channel}/${msg.chatId}`;
    const result = await handleAgentRun({
      prompt: channelPrompt,
      sessionKey: session.key,
      source,
      channel: msg.channel,
      extraContext: replyContext,
      messageMetadata: {
        channel: msg.channel,
        chatId: msg.chatId,
        chatType: msg.chatType,
        senderName: msg.senderName,
        body: body,
        replyToId: msg.replyToId,
        mediaType: msg.mediaType,
        mediaPath: msg.mediaPath,
      },
    });

    // safety net cleanup for non-persistent providers (stream loop already handles this for persistent)
    const ctx = channelRunContexts.get(session.key);
    if (ctx) {
      clearTypingInterval(ctx);
      channelRunContexts.delete(session.key);
    }
    toolLogs.delete(session.key);
    statusMessages.delete(session.key);

    // process any queued messages (only relevant for non-persistent providers)
    const queued = pendingMessages.get(session.key);
    if (queued && queued.length > 0) {
      const bodies = queued.map(m => m.body);
      pendingMessages.delete(session.key);
      const lastMsg = queued[queued.length - 1];
      await processChannelMessage(lastMsg, bodies, undefined, {
        sessionKey: session.key,
        source,
        preserveSessionMetadata: opts?.preserveSessionMetadata,
      });
    }
  }

  // channel manager handles incoming messages from whatsapp/telegram
  const channelManager = new ChannelManager({
    config,
    onMessage: async (msg: InboundMessage) => {
      broadcast({ event: 'channel.message', data: msg });
      const linkedRun = resolveLinkedRunSession(msg);
      const runReplyContext = linkedRun?.context;
      const runSource = linkedRun?.source || `${msg.channel}/${msg.chatId}`;

      if (msg.channel === 'desktop') {
        // desktop handled via chat.send RPC, not here
        return;
      }

      let session = linkedRun ? sessionRegistry.get(linkedRun.sessionKey) : undefined;
      if (!session) {
        session = sessionRegistry.getOrCreate({
          channel: msg.channel,
          chatType: msg.chatType,
          chatId: msg.chatId,
        });
      }

      // idle timeout: reset session if too long since last message
      const gap = Date.now() - session.lastMessageAt;
      if (!linkedRun && session.messageCount > 0 && gap > IDLE_TIMEOUT_MS) {
        console.log(`[gateway] idle timeout for ${session.key} (${Math.floor(gap / 3600000)}h), starting new session`);
        fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: undefined });
        sessionRegistry.remove(session.key);
        session = sessionRegistry.getOrCreate({
          channel: msg.channel,
          chatType: msg.chatType,
          chatId: msg.chatId,
        });
      }

      sessionRegistry.incrementMessages(session.key);
      broadcastSessionUpdate(session.key);

      // try injection into active persistent session (even if idle between turns)
      const handle = runHandles.get(session.key);
      console.log(`[onMessage] key=${session.key} activeRun=${session.activeRun} handleExists=${!!handle} handleActive=${handle?.active} runQueueHas=${runQueues.has(session.key)}`);
      if (handle?.active) {
        const channelPrompt = buildIncomingChannelPrompt(msg, msg.body, runReplyContext);
        console.log(`[onMessage] INJECTING into ${session.key}`);
        handle.inject(channelPrompt);
        fileSessionManager.append(session.sessionId, {
          type: 'user',
          timestamp: new Date().toISOString(),
          content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: channelPrompt }] } },
          metadata: { channel: msg.channel, chatId: msg.chatId, body: msg.body, senderName: msg.senderName },
        });
        broadcast({ event: 'agent.user_message', data: {
          source: runSource, sessionKey: session.key,
          prompt: msg.body, injected: true, timestamp: Date.now(),
        }});
        // re-activate if idle between turns
        if (!session.activeRun) {
          sessionRegistry.setActiveRun(session.key, true);
          broadcast({ event: 'status.update', data: { activeRun: true, source: runSource, sessionKey: session.key } });
        }
        // ensure channel context exists for status message creation in stream loop
        if (!channelRunContexts.has(session.key)) {
          channelRunContexts.set(session.key, { channel: msg.channel, chatId: msg.chatId });
        }
        const h = getChannelHandler(msg.channel);
        if (h?.typing) h.typing(msg.chatId).catch(() => {});
        toolLogs.set(session.key, { completed: [], current: null, lastEditAt: 0 });
        return;
      }

      // agent running but no injectable handle — queue
      console.log(`[onMessage] handle not active, checking activeRun=${session.activeRun}`);
      if (session.activeRun) {
        const queue = pendingMessages.get(session.key) || [];
        queue.push(msg);
        pendingMessages.set(session.key, queue);

        const handler = getChannelHandler(msg.channel);
        if (handler) {
          try { await handler.send(msg.chatId, 'got it, I\'ll get to this after I\'m done'); } catch {}
        }
        return;
      }

      console.log(`[onMessage] falling through to processChannelMessage for ${session.key}`);
      if (linkedRun) {
        await processChannelMessage(msg, undefined, runReplyContext, {
          sessionKey: session.key,
          source: runSource,
          preserveSessionMetadata: true,
        });
      } else {
        await processChannelMessage(msg, undefined, runReplyContext);
      }
    },
    onCommand: async (channel, cmd, chatId) => {
      const chatType = 'dm';
      const key = sessionRegistry.makeKey({ channel, chatType, chatId });

      if (cmd === 'new') {
        const old = sessionRegistry.get(key);
        if (old) fileSessionManager.setMetadata(old.sessionId, { sdkSessionId: undefined });
        sessionRegistry.remove(key);
        return `session reset. ${old ? `old: ${old.messageCount} messages.` : ''} new session started.`;
      }

      if (cmd === 'status') {
        const session = sessionRegistry.get(key);
        if (!session) return 'no active session for this chat.';
        const age = Date.now() - session.lastMessageAt;
        const ageMin = Math.floor(age / 60000);
        return [
          `session: ${session.sessionId.slice(0, 30)}`,
          `messages: ${session.messageCount}`,
          `last activity: ${ageMin}m ago`,
          `active: ${session.activeRun ? 'yes' : 'no'}`,
        ].join('\n');
      }
    },
    onApprovalResponse: (requestId, approved, reason) => {
      const pending = pendingApprovals.get(requestId);
      if (!pending) return;
      pendingApprovals.delete(requestId);
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.resolve({ approved, reason });
    },
    onQuestionResponse: async (requestId, selectedIndex, label) => {
      console.log(`[canUseTool] question response: requestId=${requestId} index=${selectedIndex} label=${label}`);
      const pending = pendingChannelQuestions.get(requestId);
      if (pending) {
        pendingChannelQuestions.delete(requestId);
        channelQuestionRefs.delete(requestId);
        pending.resolve({ label, timedOut: false });
        return;
      }

      const ref = channelQuestionRefs.get(requestId);
      if (!ref) {
        console.log(`[canUseTool] no pending question for ${requestId} (map size: ${pendingChannelQuestions.size})`);
        return;
      }
      channelQuestionRefs.delete(requestId);

      const linkedSessionKey = (ref.sessionKey && sessionRegistry.get(ref.sessionKey))
        ? ref.sessionKey
        : (ref.sessionId ? ensureSessionKeyForSessionId(ref.sessionId) : undefined);
      updateQuestionState(requestId, 'answered', linkedSessionKey);
      const source = ref.source
        || (linkedSessionKey ? activeRunSources.get(linkedSessionKey) : undefined)
        || `${ref.channel}/${ref.chatId}`;

      const lateInbound: InboundMessage = {
        id: `late-q-${requestId}-${Date.now().toString(36)}`,
        channel: ref.channel,
        accountId: '',
        chatId: ref.chatId,
        chatType: ref.chatType === 'group' ? 'group' : 'dm',
        senderId: ref.chatId,
        senderName: 'Owner',
        body: label,
        timestamp: Date.now(),
        raw: {
          type: 'late_question_response',
          requestId,
          selectedIndex,
          label,
          question: ref.question,
        },
      };
      const replyContext = [
        'User answered a previous AskUserQuestion after the original wait window.',
        `Request ID: ${requestId}`,
        `Original question: ${ref.question}`,
        `Selected option: ${label}`,
        'Continue in the same run session.',
      ].join('\n');

      try {
        if (linkedSessionKey) {
          await processChannelMessage(lateInbound, undefined, replyContext, {
            sessionKey: linkedSessionKey,
            source,
            preserveSessionMetadata: true,
          });
        } else {
          await processChannelMessage(lateInbound, undefined, replyContext);
        }
      } catch (err) {
        console.error('[canUseTool] failed to route late question response:', err);
      }
    },
    onStatus: (status) => {
      broadcast({ event: 'channel.status', data: status });
    },
  });

  // backfill FTS search index for memory_search tool (runs once, skips if already done)
  try {
    const { backfillFtsIndex } = await import('../db.js');
    backfillFtsIndex();
  } catch (err) {
    console.error('[gateway] FTS backfill failed:', err);
  }

  // calendar scheduler
  let scheduler: SchedulerRunner | null = null;
  if (config.calendar?.enabled !== false && config.cron?.enabled !== false) {
    migrateCronToCalendar();
    scheduler = startScheduler({
      config,
      getContext: () => ({
        connectedChannels: getAllChannelStatuses()
          .filter(s => s.connected && ownerChatIds.has(s.channel))
          .map(s => ({ channel: s.channel, chatId: ownerChatIds.get(s.channel)! })),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      onItemStart: (item) => {
        if (item.id === AUTONOMOUS_SCHEDULE_ID) {
          macNotify('Dora', 'Checking in... 👀');
          broadcast({ event: 'pulse:started', data: { timestamp: Date.now() } });
        } else {
          broadcast({ event: 'schedule:started', data: { summary: item.summary, timestamp: Date.now() } });
        }
      },
      onItemRun: (item, result) => {
        if (item.id === AUTONOMOUS_SCHEDULE_ID) {
          if (result.messaged) {
            macNotify('Dora', 'Sent you a message 👀');
          } else {
            macNotify('Dora', result.status === 'ran' ? 'All caught up ✓' : 'Something went wrong, check logs');
          }
        } else {
          macNotify('Dora', result.status === 'ran' ? `Done with "${item.summary}" ✓` : `"${item.summary}" failed`);
        }
        broadcast({ event: 'calendar.result', data: { item: item.id, summary: item.summary, ...result, timestamp: Date.now() } });
        if (item.id === AUTONOMOUS_SCHEDULE_ID) {
          broadcast({ event: 'pulse:completed', data: { timestamp: Date.now(), ...result } });
        }
      },
      runItem: async (item, _cfg, ctx) => {
        const connectedOwners = ctx.connectedChannels || [];
        const preferredOwner = connectedOwners.find(c => c.channel === 'telegram')
          || connectedOwners.find(c => c.channel === 'whatsapp')
          || connectedOwners[0];

        const useOwnerChannel = item.session !== 'isolated' && !!preferredOwner;
        const runChannel = useOwnerChannel ? preferredOwner!.channel : undefined;
        const runChatId = useOwnerChannel ? preferredOwner!.chatId : undefined;
        const runSessionChatId = `${item.id}-${Date.now().toString(36)}`;

        const session = sessionRegistry.getOrCreate({
          channel: 'calendar',
          chatId: runSessionChatId,
          chatType: 'dm',
        });
        fileSessionManager.setMetadata(session.sessionId, {
          channel: 'calendar',
          chatId: runSessionChatId,
          chatType: 'dm',
          senderName: item.summary,
        });
        sessionRegistry.incrementMessages(session.key);
        broadcastSessionUpdate(session.key);

        const result = await handleAgentRun({
          prompt: item.message,
          sessionKey: session.key,
          source: `calendar/${item.id}`,
          channel: runChannel,
          messageMetadata: runChannel && runChatId ? {
            channel: runChannel,
            chatId: runChatId,
            chatType: 'dm',
            senderName: item.summary,
            body: item.message,
          } : undefined,
          extraContext: ctx.timezone ? `User timezone: ${ctx.timezone}` : undefined,
        });
        return result || { sessionId: '', result: '', messages: [], usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 }, durationMs: 0, usedMessageTool: false };
      },
    });
    setScheduler(scheduler);

    // auto-create autonomous schedule if mode is autonomous
    if (config.autonomy === 'autonomous') {
      const existing = scheduler.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const desired = buildAutonomousCalendarItem(tz);
      if (!existing) {
        scheduler.addItem({ ...desired, id: AUTONOMOUS_SCHEDULE_ID });
        console.log('[gateway] created autonomy pulse schedule on startup');
      } else {
        const needsRefresh =
          existing.summary !== desired.summary ||
          existing.description !== desired.description ||
          existing.message !== desired.message ||
          existing.timezone !== desired.timezone ||
          existing.enabled === false;
        if (needsRefresh) {
          scheduler.updateItem(AUTONOMOUS_SCHEDULE_ID, {
            summary: desired.summary,
            description: desired.description,
            message: desired.message,
            timezone: desired.timezone,
            enabled: true,
          });
          console.log('[gateway] refreshed autonomy pulse schedule on startup');
        }
      }
    }
  }

  const context: GatewayContext = {
    config,
    sessionRegistry,
    channelManager,
    scheduler,
    broadcast,
  };

  // pending AskUserQuestion requests waiting for desktop answers
  const pendingQuestions = new Map<string, {
    resolve: (answers: Record<string, string>) => void;
    reject: (err: Error) => void;
    sessionKey?: string;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  const questionStates = new Map<string, {
    sessionKey?: string;
    status: 'pending' | 'answered' | 'timeout' | 'cancelled';
    timestamp: number;
    answers?: Record<string, string>;
  }>();
  const MAX_QUESTION_STATES = 4000;

  function pruneQuestionStates(): void {
    if (questionStates.size <= MAX_QUESTION_STATES) return;
    let oldestId: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [id, q] of questionStates) {
      if (q.timestamp < oldestTs) {
        oldestTs = q.timestamp;
        oldestId = id;
      }
    }
    if (oldestId) questionStates.delete(oldestId);
  }

  function updateQuestionState(
    requestId: string,
    status: 'pending' | 'answered' | 'timeout' | 'cancelled',
    sessionKey?: string,
    answers?: Record<string, string>,
  ): void {
    const timestamp = Date.now();
    const existing = questionStates.get(requestId);
    const finalSessionKey = sessionKey || existing?.sessionKey;
    questionStates.set(requestId, {
      sessionKey: finalSessionKey,
      status,
      timestamp,
      answers: answers ?? existing?.answers,
    });
    pruneQuestionStates();

    if (finalSessionKey) {
      const snap = sessionSnapshots.get(finalSessionKey);
      if (snap) {
        snap.pendingQuestionStatus = status;
        snap.pendingQuestionUpdatedAt = timestamp;
        if (status !== 'pending') snap.pendingQuestion = null;
        snap.updatedAt = timestamp;
      }
    }

    broadcast({
      event: 'agent.question_state',
      data: { requestId, sessionKey: finalSessionKey, status, timestamp },
    });

    if (status !== 'pending' && finalSessionKey) {
      broadcast({
        event: 'agent.question_dismissed',
        data: { requestId, sessionKey: finalSessionKey, reason: status },
      });
    }
  }

  function cancelPendingQuestionsForSession(sessionKey: string, status: 'cancelled' | 'timeout' = 'cancelled'): void {
    const toCancel: Array<{ requestId: string; reject: (err: Error) => void; timeout: ReturnType<typeof setTimeout> }> = [];
    for (const [requestId, pending] of pendingQuestions) {
      if (pending.sessionKey !== sessionKey) continue;
      toCancel.push({ requestId, reject: pending.reject, timeout: pending.timeout });
      pendingQuestions.delete(requestId);
    }
    for (const pending of toCancel) {
      clearTimeout(pending.timeout);
      updateQuestionState(pending.requestId, status, sessionKey);
      pending.reject(new Error(`Question ${status}`));
    }
  }

  // pending AskUserQuestion requests waiting for channel responses (telegram inline keyboard / whatsapp text reply)
  const pendingChannelQuestions = new Map<string, {
    resolve: (payload: { label: string; timedOut: boolean }) => void;
    options: { label: string }[];
  }>();

  // pending tool approval requests waiting for user decision
  const pendingApprovals = new Map<string, {
    resolve: (decision: { approved: boolean; reason?: string; modifiedInput?: Record<string, unknown> }) => void;
    toolName: string;
    input: Record<string, unknown>;
    timeout: NodeJS.Timeout | null;
  }>();

  async function waitForApproval(requestId: string, toolName: string, input: Record<string, unknown>, timeoutMs?: number, sessionKey?: string): Promise<{ approved: boolean; reason?: string; modifiedInput?: Record<string, unknown> }> {
    // persist to snapshot
    if (sessionKey) {
      const snap = sessionSnapshots.get(sessionKey);
      if (snap) { snap.pendingApproval = { requestId, toolName, input, timestamp: Date.now() }; snap.updatedAt = Date.now(); }
    }
    return new Promise((resolve) => {
      const timer = timeoutMs ? setTimeout(() => {
        pendingApprovals.delete(requestId);
        if (sessionKey) { const snap = sessionSnapshots.get(sessionKey); if (snap) snap.pendingApproval = null; }
        resolve({ approved: false, reason: 'approval timeout' });
      }, timeoutMs) : null;

      pendingApprovals.set(requestId, { resolve, toolName, input, timeout: timer });
    }).then((decision) => {
      if (sessionKey) { const snap = sessionSnapshots.get(sessionKey); if (snap) snap.pendingApproval = null; }
      return decision;
    }) as Promise<{ approved: boolean; reason?: string; modifiedInput?: Record<string, unknown> }>;
  }

  async function startTaskExecution(taskId: string, mode: 'plan' | 'execute' = 'execute'): Promise<{
    started: boolean;
    taskId: string;
    sessionKey: string;
    sessionId: string;
    chatId: string;
  }> {
    const tasks = loadTasks();
    const task = tasks.tasks.find(t => t.id === taskId);
    if (!task) throw new Error('task not found');
    if (task.status === 'done') throw new Error('task is already done');
    if (task.status === 'cancelled') throw new Error('task is cancelled');

    const existing = activeTaskRuns.get(taskId);
    if (existing) {
      const active = sessionRegistry.get(existing.sessionKey)?.activeRun || false;
      if (active) throw new Error('task execution already running');
      activeTaskRuns.delete(taskId);
      if (taskRunBySession.get(existing.sessionKey) === taskId) {
        taskRunBySession.delete(existing.sessionKey);
      }
    }

    const chatId = randomUUID();
    const session = sessionRegistry.getOrCreate({
      channel: 'desktop',
      chatType: 'dm',
      chatId,
    });
    const sessionKey = session.key;
    sessionRegistry.incrementMessages(session.key);
    fileSessionManager.setMetadata(session.sessionId, { channel: 'desktop', chatId, chatType: 'dm' });
    broadcastSessionUpdate(session.key);

    const now = new Date().toISOString();
    task.status = 'in_progress';
    task.reason = undefined;
    task.sessionKey = sessionKey;
    task.sessionId = session.sessionId;
    task.updatedAt = now;
    saveTasks(tasks);

    const projectsState = loadProjects();
    const project = task.goalId ? projectsState.projects.find(p => p.id === task.goalId) : undefined;
    const prompt = buildTaskExecutionPrompt(task, project, mode);

    appendTaskLog(task.id, 'run_started', `Task ${mode === 'plan' ? 'planning' : 'started'}: ${task.title}`, { sessionKey, mode });
    broadcast({ event: 'projects.update', data: { taskId: task.id, task, message: `Task started: ${task.title}` } });
    broadcast({
      event: 'tasks.log',
      data: { taskId: task.id, eventType: 'run_started', message: `Task started: ${task.title}`, timestamp: Date.now() },
    });
    markTaskRunStarted(taskId, sessionKey);
    void sendTelegramOwnerStatus(`▶️ Task #${task.id} started: ${task.title}`);

    void handleAgentRun({
      prompt,
      sessionKey,
      source: `tasks/${taskId}`,
      cwd: config.cwd,
      messageMetadata: {
        channel: 'desktop',
        chatId,
        chatType: 'dm',
        body: prompt,
      },
    }).then((res) => {
      if (!res) finishTaskRun(sessionKey, 'error', 'task execution did not start');
    }).catch((err) => {
      finishTaskRun(sessionKey, 'error', err instanceof Error ? err.message : String(err));
    });

    return {
      started: true,
      taskId,
      sessionKey,
      sessionId: session.sessionId,
      chatId,
    };
  }

  // approval pipeline removed -- tasks move freely between statuses

  function getChannelToolPolicy(channel?: string): ToolPolicyConfig | undefined {
    if (!channel || channel === 'desktop') return undefined;
    if (channel === 'whatsapp') return config.channels?.whatsapp?.tools;
    if (channel === 'telegram') return config.channels?.telegram?.tools;
    return undefined;
  }

  function getChannelPathOverride(channel?: string): { allowedPaths?: string[]; deniedPaths?: string[] } | undefined {
    if (!channel || channel === 'desktop') return undefined;
    const ch = channel === 'whatsapp' ? config.channels?.whatsapp : channel === 'telegram' ? config.channels?.telegram : undefined;
    if (!ch) return undefined;
    if (!ch.allowedPaths?.length && !ch.deniedPaths?.length) return undefined;
    return { allowedPaths: ch.allowedPaths, deniedPaths: ch.deniedPaths };
  }

  function makeCanUseTool(runChannel?: string, runChatId?: string, runSessionKey?: string) {
    return async (toolName: string, input: Record<string, unknown>) => {
      return canUseToolImpl(toolName, input, runChannel, runChatId, runSessionKey);
    };
  }

  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    return canUseToolImpl(toolName, input, undefined, undefined, undefined);
  };

  const canUseToolImpl = async (toolName: string, input: Record<string, unknown>, runChannel?: string, runChatId?: string, runSessionKey?: string) => {
    // AskUserQuestion — route to channel or desktop
    if (toolName === 'AskUserQuestion') {
      const questions = input.questions as unknown[];
      if (!questions) {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // channel (telegram/whatsapp): send question and wait for response
      if ((runChannel === 'telegram' || runChannel === 'whatsapp') && runChatId) {
        console.log(`[canUseTool] AskUserQuestion on ${runChannel}, chatId=${runChatId}, ${(questions as any[]).length} question(s)`);
        const answers: Record<string, string> = {};
        const runSource = runSessionKey ? activeRunSources.get(runSessionKey) : undefined;
        const runSession = runSessionKey ? sessionRegistry.get(runSessionKey) : undefined;
        for (let qi = 0; qi < (questions as any[]).length; qi++) {
          const q = (questions as any[])[qi];
          const questionText: string = q.question || `Question ${qi + 1}`;
          const routedQuestionText = (runSource && runSessionKey)
            ? appendRunSessionMarker(questionText, runSource, runSessionKey, runChannel)
            : questionText;
          const opts = (q.options || []) as { label: string; description?: string }[];
          if (!opts.length) continue;

          const requestId = randomUUID();
          try {
            await channelManager.sendQuestion({
              requestId,
              chatId: runChatId,
              question: routedQuestionText,
              options: opts,
            }, runChannel);
            registerChannelQuestionRef(requestId, {
              sessionId: runSession?.sessionId,
              sessionKey: runSessionKey,
              source: runSource,
              channel: runChannel,
              chatId: runChatId,
              chatType: runSession?.chatType || 'dm',
              question: questionText,
              createdAt: Date.now(),
            });
            console.log(`[canUseTool] sent question to ${runChannel}: ${requestId}`);
            updateQuestionState(requestId, 'pending', runSessionKey);
          } catch (err) {
            console.error(`[canUseTool] failed to send question:`, err);
            updateQuestionState(requestId, 'cancelled', runSessionKey);
            answers[questionText] = opts[0]?.label || '';
            continue;
          }

          const { label, timedOut } = await new Promise<{ label: string; timedOut: boolean }>((resolve) => {
            pendingChannelQuestions.set(requestId, { resolve, options: opts });
            setTimeout(() => {
              if (pendingChannelQuestions.has(requestId)) {
                pendingChannelQuestions.delete(requestId);
                resolve({ label: opts[0]?.label || '', timedOut: true });
              }
            }, 120000);
          });
          if (timedOut) updateQuestionState(requestId, 'timeout', runSessionKey);
          else updateQuestionState(requestId, 'answered', runSessionKey);
          // SDK expects question text as key
          answers[questionText] = label;
        }
        return {
          behavior: 'allow' as const,
          updatedInput: { questions, answers },
        };
      }

      // desktop: broadcast and wait
      const authCount = Array.from(clients.values()).filter(c => c.authenticated).length;
      if (authCount === 0) {
        return {
          behavior: 'deny' as const,
          message: 'No UI client connected to answer questions. Proceed with your best judgment.',
        };
      }

      const requestId = randomUUID();
      const askedAt = Date.now();
      broadcast({
        event: 'agent.ask_user',
        data: { requestId, questions, sessionKey: runSessionKey, timestamp: askedAt },
      });
      // persist to snapshot
      if (runSessionKey) {
        const snap = sessionSnapshots.get(runSessionKey);
        if (snap) {
          snap.pendingQuestion = { requestId, questions, timestamp: askedAt };
          snap.pendingQuestionStatus = 'pending';
          snap.pendingQuestionUpdatedAt = askedAt;
          snap.updatedAt = askedAt;
        }
      }
      updateQuestionState(requestId, 'pending', runSessionKey);

      const answers = await new Promise<Record<string, string>>((resolveQ, rejectQ) => {
        const timeout = setTimeout(() => {
          if (pendingQuestions.has(requestId)) {
            const pending = pendingQuestions.get(requestId);
            pendingQuestions.delete(requestId);
            if (pending) updateQuestionState(requestId, 'timeout', pending.sessionKey);
            rejectQ(new Error('Question timeout - no answer received'));
          }
        }, 300000);
        pendingQuestions.set(requestId, { resolve: resolveQ, reject: rejectQ, sessionKey: runSessionKey, timeout });
      });
      updateQuestionState(requestId, 'answered', runSessionKey, answers);

      return {
        behavior: 'allow' as const,
        updatedInput: { questions, answers },
      };
    }

    const cleanName = cleanToolName(toolName);
    if (cleanName === 'message' && runSessionKey) {
      const runSource = activeRunSources.get(runSessionKey);
      const targetChannel = typeof input.channel === 'string' ? input.channel : runChannel;
      if (runSource && typeof input.message === 'string') {
        input.message = appendRunSessionMarker(input.message, runSource, runSessionKey, targetChannel);
      }
    }

    // check tool allow/deny policy (channel-specific + global)
    const channelToolPolicy = getChannelToolPolicy(runChannel);
    const globalToolPolicy = config.security?.tools;
    if (!isToolAllowed(cleanName, channelToolPolicy, globalToolPolicy)) {
      return { behavior: 'deny' as const, message: `tool '${cleanName}' blocked by policy` };
    }

    // classify tool call (use clean name so FORM_MAP in desktop matches)
    const tier = classifyToolCall(cleanName, input);

    // respect permissionMode and approvalMode
    const approvalMode = config.security?.approvalMode || 'approve-sensitive';

    if (config.permissionMode === 'bypassPermissions' || config.permissionMode === 'dontAsk' || approvalMode === 'autonomous') {
      if (tier !== 'auto-allow') {
        broadcast({ event: 'agent.tool_notify', data: { toolName: cleanName, input, tier, timestamp: Date.now() } });
      }
      return { behavior: 'allow' as const, updatedInput: input };
    }

    if (config.permissionMode === 'acceptEdits') {
      const isEdit = ['Write', 'Edit'].includes(cleanName);
      if (isEdit || tier === 'auto-allow') {
        return { behavior: 'allow' as const, updatedInput: input };
      }
      if (tier === 'notify') {
        broadcast({ event: 'agent.tool_notify', data: { toolName: cleanName, input, tier, timestamp: Date.now() } });
        return { behavior: 'allow' as const, updatedInput: input };
      }
    }

    // lockdown — require approval for everything except reads
    if (approvalMode === 'lockdown' && tier !== 'auto-allow') {
      const requestId = randomUUID();
      broadcast({
        event: 'agent.tool_approval',
        data: { requestId, toolName: cleanName, input, tier: 'require-approval', timestamp: Date.now() },
      });
      channelManager.sendApprovalRequest({ requestId, toolName: cleanName, input, chatId: runChatId }, runChannel).catch(() => {});
      const decision = await waitForApproval(requestId, cleanName, input, undefined, runSessionKey);
      if (decision.approved) {
        return { behavior: 'allow' as const, updatedInput: decision.modifiedInput || input };
      }
      return { behavior: 'deny' as const, message: decision.reason || 'user denied' };
    }

    if (tier === 'auto-allow') {
      return { behavior: 'allow' as const, updatedInput: input };
    }

    if (tier === 'notify') {
      broadcast({ event: 'agent.tool_notify', data: { toolName: cleanName, input, tier, timestamp: Date.now() } });
      return { behavior: 'allow' as const, updatedInput: input };
    }

    if (tier === 'require-approval') {
      const requestId = randomUUID();
      broadcast({
        event: 'agent.tool_approval',
        data: { requestId, toolName: cleanName, input, tier, timestamp: Date.now() },
      });
      channelManager.sendApprovalRequest({ requestId, toolName: cleanName, input, chatId: runChatId }, runChannel).catch(() => {});

      const decision = await waitForApproval(requestId, cleanName, input, undefined, runSessionKey);

      if (decision.approved) {
        return { behavior: 'allow' as const, updatedInput: decision.modifiedInput || input };
      }
      return { behavior: 'deny' as const, message: decision.reason || 'user denied' };
    }

    return { behavior: 'allow' as const, updatedInput: input };
  };

  // track which channel each active run belongs to (for tool policy lookups)
  const activeRunChannels = new Map<string, string>();
  const activeRunSources = new Map<string, string>();

  // agent run queue (one per session key)
  const runQueues = new Map<string, Promise<void>>();
  const activeAbortControllers = new Map<string, AbortController>();

  async function getProviderAuthGate(providerName = ((config.provider?.name || 'claude') as ProviderName)): Promise<ProviderAuthGate> {
    const provider = await getProviderByName(providerName);
    const status = await provider.getAuthStatus();
    const gate = buildProviderAuthGate(providerName, status);
    // Keep auth cache warm on every status check
    setCachedAuth(providerName, {
      authenticated: gate.authenticated,
      method: gate.method,
      identity: status.identity,
      error: gate.error,
    }, gate.method === 'oauth' && status.nextRefreshAt
      ? Math.max(status.nextRefreshAt - Date.now(), 60_000)
      : undefined);
    return gate;
  }

  async function refreshProviderAuthGate(providerName: ProviderName): Promise<ProviderAuthGate> {
    const provider = await getProviderByName(providerName);
    await provider.invalidateAuthCache?.();
    const status = await provider.getAuthStatus();
    const gate = buildProviderAuthGate(providerName, status);
    setCachedAuth(providerName, {
      authenticated: gate.authenticated,
      method: gate.method,
      identity: status.identity,
      error: gate.error,
    });
    return gate;
  }

  async function handleAgentRun(params: {
    prompt: string;
    images?: Array<{ data: string; mediaType: string }>;
    sessionKey: string;
    source: string;
    channel?: string;
    cwd?: string;
    extraContext?: string;
    messageMetadata?: import('../session/manager.js').MessageMetadata;
  }): Promise<AgentResult | null> {
    const { prompt, images, sessionKey, source, channel, cwd, extraContext, messageMetadata } = params;
    console.log(`[gateway] agent run: source=${source} sessionKey=${sessionKey} prompt="${prompt.slice(0, 80)}..."`);

    let providerAuth = await getProviderAuthGate();
    // If token expired, try silent refresh before falling back to interactive re-auth
    if (!providerAuth.authenticated && (providerAuth.expired || providerAuth.reconnectRequired)) {
      console.log(`[gateway] ${providerAuth.providerName} auth expired pre-run, attempting silent refresh for ${source}`);
      const refreshedGate = await refreshProviderAuthGate(providerAuth.providerName);
      if (refreshedGate.authenticated) {
        console.log(`[gateway] silent refresh succeeded for ${providerAuth.providerName}`);
        providerAuth = refreshedGate;
      } else {
        providerAuth = refreshedGate;
      }
    }
    if (!providerAuth.authenticated && providerAuth.reconnectRequired) {
      console.log(`[gateway] ${providerAuth.providerName} silent refresh failed, triggering re-auth for ${source}`);
      const started = await startReauthFlow({ prompt, sessionKey, source, channel, chatId: messageMetadata?.chatId, messageMetadata }).catch(() => false);
      if (started) return null;
    }
    if (!providerAuth.authenticated) {
      const error = providerAuth.error || 'Not authenticated';
      console.log(`[gateway] ${providerAuth.providerName} auth unavailable, skipping run for ${source}: ${error}`);
      if (providerAuth.reconnectRequired) {
        broadcastAuthRequired(providerAuth.providerName, error);
      }
      broadcast({ event: 'agent.error', data: { source, sessionKey, error, timestamp: Date.now() } });
      return null;
    }

    const prev = runQueues.get(sessionKey) || Promise.resolve();
    const hasPrev = runQueues.has(sessionKey);
    console.log(`[handleAgentRun] sessionKey=${sessionKey} hasPrevInQueue=${hasPrev}`);
    let result: AgentResult | null = null;

    const run = prev.then(async () => {
      console.log(`[handleAgentRun] prev resolved, starting run for ${sessionKey}`);
      maybeMarkTaskRunFromSource(source, sessionKey);
      sessionRegistry.setActiveRun(sessionKey, true);
      if (channel) activeRunChannels.set(sessionKey, channel);
      activeRunSources.set(sessionKey, source);
      // init snapshot
      sessionSnapshots.set(sessionKey, {
        sessionKey, status: 'thinking', text: '',
        currentTool: null, completedTools: [],
        pendingApproval: null, pendingQuestion: null,
        pendingQuestionStatus: null,
        pendingQuestionUpdatedAt: null,
        taskProgress: {},
        activeWorktrees: [],
        pendingElicitation: null,
        updatedAt: Date.now(),
      });
      broadcastStatus(sessionKey, 'thinking');
      broadcast({ event: 'status.update', data: { activeRun: true, source, sessionKey } });
      broadcastSessionUpdate(sessionKey);
      broadcast({ event: 'agent.user_message', data: { source, sessionKey, prompt, timestamp: Date.now() } });
      const runStart = Date.now();

      const abortController = new AbortController();
      activeAbortControllers.set(sessionKey, abortController);

      // run the stream loop, returns result
      async function executeStream(resumeId: string | undefined): Promise<AgentResult> {
        const session = sessionRegistry.get(sessionKey);
        const connected = getAllChannelStatuses()
          .filter(s => s.connected && ownerChatIds.has(s.channel))
          .map(s => ({ channel: s.channel, chatId: ownerChatIds.get(s.channel)! }));
        const pulseItem = scheduler?.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
        const lastPulseAt = pulseItem?.lastRunAt ? new Date(pulseItem.lastRunAt).getTime() : undefined;
        const gen = streamAgent({
          prompt,
          images,
          sessionId: session?.sessionId,
          resumeId,
          config,
          cwd,
          channel,
          connectedChannels: connected,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          extraContext,
          canUseTool: makeCanUseTool(channel, messageMetadata?.chatId, sessionKey),
          abortController,
          messageMetadata,
          onRunReady: (handle) => { runHandles.set(sessionKey, handle); },
          lastPulseAt,
          hooks: {
            PreCompact: [{ hooks: [async () => {
              broadcast({ event: 'agent.compacting', data: { sessionKey, timestamp: Date.now() } });
              return { continue: true };
            }] }],
          },
        });

        let agentText = '';
        let agentSessionId = '';
        let agentUsage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
        let usedMessageTool = false;
        let hadStreamEvents = false;

        // track Task tool_use IDs so we can recognize their tool_results
        const taskToolUseIds = new Set<string>();
        const toolUseMeta = new Map<string, { name: string; input: Record<string, unknown> }>();

        const maybeRegisterRunRefFromToolResult = (toolUseId: string, toolResultText: string) => {
          const meta = toolUseMeta.get(toolUseId);
          if (!meta) return;

          if (meta.name === 'message') {
            const sentId = toolResultText.match(/Message sent\. ID:\s*([^\s]+)/)?.[1];
            const targetChannel = typeof meta.input.channel === 'string' ? meta.input.channel : channel;
            const targetChatId = typeof meta.input.target === 'string' ? meta.input.target : undefined;
            const outboundText = typeof meta.input.message === 'string' ? meta.input.message : '';
            if (!sentId || !targetChannel || !targetChatId) return;
            registerRunReplyRef(source, sessionKey, targetChannel, targetChatId, sentId, outboundText);
            return;
          }

          if (meta.name === 'plan_update' || meta.name === 'plan_start') {
            const planId = typeof meta.input.id === 'string'
              ? meta.input.id
              : typeof meta.input.planId === 'string'
                ? meta.input.planId
                : undefined;
            if (!planId) return;
            broadcast({
              event: 'plans.log',
              data: {
                planId,
                eventType: meta.name,
                message: toolResultText.slice(0, 500),
                timestamp: Date.now(),
              },
            });
            broadcast({ event: 'plans.update', data: { planId } });
          }

          if (meta.name === 'tasks_update' || meta.name === 'tasks_done' || meta.name === 'tasks_add' || meta.name === 'tasks_delete') {
            let taskId = typeof meta.input.id === 'string'
              ? meta.input.id
              : typeof meta.input.taskId === 'string'
                ? meta.input.taskId
                : undefined;
            if (!taskId) {
              const parsed = toolResultText.match(/Task #(\d+)/);
              taskId = parsed?.[1];
            }
            if (!taskId) return;
            broadcast({
              event: 'tasks.log',
              data: {
                taskId,
                eventType: meta.name,
                message: toolResultText.slice(0, 500),
                timestamp: Date.now(),
              },
            });
            broadcast({ event: 'projects.update', data: { taskId } });
          }

          if (meta.name === 'projects_add' || meta.name === 'projects_update' || meta.name === 'projects_delete') {
            const projectId = typeof meta.input.id === 'string'
              ? meta.input.id
              : toolResultText.match(/Project #(\d+)/)?.[1];
            broadcast({ event: 'projects.update', data: { projectId: projectId || undefined } });
          }
        };

        for await (const msg of gen) {
          const m = msg as Record<string, unknown>;

          if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
            agentSessionId = m.session_id as string;
            sessionRegistry.setSdkSessionId(sessionKey, agentSessionId);
            fileSessionManager.setMetadata(session?.sessionId || '', { sdkSessionId: agentSessionId });
          }

          // ── SDK task system messages (subagent progress) ──────────────
          if (m.type === 'system' && m.subtype === 'task_started') {
            const taskId = m.task_id as string;
            const toolUseId = m.tool_use_id as string;
            const snap = sessionSnapshots.get(sessionKey);
            if (snap) {
              snap.taskProgress[taskId] = {
                taskId, toolUseId, status: 'running',
                toolCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0,
                updatedAt: Date.now(),
              };
              snap.updatedAt = Date.now();
            }
            broadcast({
              event: 'agent.task_started',
              data: { sessionKey, taskId, toolUseId, timestamp: Date.now() },
            });
          }

          if (m.type === 'system' && m.subtype === 'task_progress') {
            const taskId = m.task_id as string;
            const usage = m.usage as Record<string, number> | undefined;
            const summary = m.summary as string | undefined;
            const snap = sessionSnapshots.get(sessionKey);
            if (snap?.taskProgress[taskId]) {
              const tp = snap.taskProgress[taskId];
              tp.toolCount = (m.tool_count as number) || tp.toolCount;
              tp.inputTokens = usage?.input_tokens || tp.inputTokens;
              tp.outputTokens = usage?.output_tokens || tp.outputTokens;
              tp.durationMs = (m.duration_ms as number) || tp.durationMs;
              if (summary) tp.summary = summary;
              tp.updatedAt = Date.now();
              snap.updatedAt = Date.now();
            }
            broadcast({
              event: 'agent.task_progress',
              data: {
                sessionKey, taskId,
                toolCount: m.tool_count, inputTokens: usage?.input_tokens,
                outputTokens: usage?.output_tokens, durationMs: m.duration_ms,
                summary, timestamp: Date.now(),
              },
            });
          }

          if (m.type === 'system' && m.subtype === 'task_notification') {
            const taskId = m.task_id as string;
            const toolUseId = m.tool_use_id as string;
            const snap = sessionSnapshots.get(sessionKey);
            if (snap?.taskProgress[taskId]) {
              snap.taskProgress[taskId].status = 'completed';
              snap.taskProgress[taskId].updatedAt = Date.now();
              snap.updatedAt = Date.now();
            }
            broadcast({
              event: 'agent.task_notification',
              data: { sessionKey, taskId, toolUseId, timestamp: Date.now() },
            });
          }

          // ── Elicitation events ──────────────────────────────────────────
          if (m.type === 'system' && m.subtype === 'elicitation') {
            const snap = sessionSnapshots.get(sessionKey);
            if (snap) {
              snap.pendingElicitation = {
                elicitationId: m.elicitation_id as string,
                message: m.message as string,
                fields: m.fields as any[],
                timestamp: Date.now(),
              };
              snap.updatedAt = Date.now();
            }
            broadcast({
              event: 'agent.elicitation',
              data: {
                sessionKey,
                elicitationId: m.elicitation_id,
                message: m.message,
                fields: m.fields,
                timestamp: Date.now(),
              },
            });
          }

          if (m.type === 'system' && m.subtype === 'elicitation_result') {
            const snap = sessionSnapshots.get(sessionKey);
            if (snap) {
              snap.pendingElicitation = null;
              snap.updatedAt = Date.now();
            }
            broadcast({
              event: 'agent.elicitation_result',
              data: { sessionKey, elicitationId: m.elicitation_id, values: m.values, timestamp: Date.now() },
            });
          }

          // ── Worktree events ──────────────────────────────────────────
          if (m.type === 'system' && m.subtype === 'worktree_created') {
            const snap = sessionSnapshots.get(sessionKey);
            if (snap) {
              snap.activeWorktrees.push({ path: m.worktree_path as string, branch: m.branch as string });
              snap.updatedAt = Date.now();
            }
            broadcast({
              event: 'agent.worktree_created',
              data: { sessionKey, path: m.worktree_path, branch: m.branch, timestamp: Date.now() },
            });
          }

          if (m.type === 'system' && m.subtype === 'worktree_removed') {
            const snap = sessionSnapshots.get(sessionKey);
            if (snap) {
              snap.activeWorktrees = snap.activeWorktrees.filter(w => w.path !== m.worktree_path);
              snap.updatedAt = Date.now();
            }
            broadcast({
              event: 'agent.worktree_removed',
              data: { sessionKey, path: m.worktree_path, timestamp: Date.now() },
            });
          }

          if (m.type === 'stream_event') {
            hadStreamEvents = true;
            const event = m.event as Record<string, unknown>;
            const evtType = event.type as string;

            // track Task tool_use IDs
            if (evtType === 'content_block_start') {
              const cb = event.content_block as Record<string, unknown>;
              if (cb?.type === 'tool_use') {
                const toolName = cleanToolName((cb.name as string) || 'unknown');
                if (toolName === 'Task' || toolName === 'Agent') {
                  taskToolUseIds.add(cb.id as string);
                }
              }
            }

            // SDK sets parent_tool_use_id on user messages (tool_results) but not
            // on stream_events. subagent stream_events are not yielded by the SDK —
            // only their tool_results come through as user messages.
            const parentId = m.parent_tool_use_id || null;

            // new turn starting — re-activate if idle between turns
            if (evtType === 'message_start' && !sessionRegistry.get(sessionKey)?.activeRun) {
              sessionRegistry.setActiveRun(sessionKey, true);
              broadcast({ event: 'status.update', data: { activeRun: true, source, sessionKey } });
              broadcastSessionUpdate(sessionKey);
            }

            // debug: log stream events
            if (evtType === 'content_block_start' || evtType === 'message_start') {
              const cb = (event as any).content_block;
              console.log(`[stream] ${evtType} parent=${parentId} block=${cb?.type || '-'} name=${cb?.name || '-'} id=${cb?.id || '-'}`);
            }

            broadcast({
              event: 'agent.stream',
              data: { source, sessionKey, event, parentToolUseId: parentId, timestamp: Date.now() },
            });

            // update snapshot on stream events
            const snap = sessionSnapshots.get(sessionKey);
            if (snap && !parentId) {
              if (evtType === 'content_block_start') {
                const cb2 = event.content_block as Record<string, unknown>;
                if (cb2?.type === 'text') {
                  snap.status = 'responding';
                  snap.updatedAt = Date.now();
                  broadcastStatus(sessionKey, 'responding');
                }
              } else if (evtType === 'content_block_delta') {
                const delta = event.delta as Record<string, unknown>;
                if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                  snap.text += delta.text as string;
                  snap.updatedAt = Date.now();
                }
              }
            }

            if (event.type === 'content_block_start') {
              const cb = event.content_block as Record<string, unknown>;
              if (cb?.type === 'tool_use') {
                const toolName = cleanToolName((cb.name as string) || 'unknown');
                // debug: log tool_use starts with their IDs
                console.log(`[tool_use] name=${toolName} id=${cb.id} parent=${m.parent_tool_use_id || 'none'}`);
                if (toolName === 'message') usedMessageTool = true;
                broadcast({
                  event: 'agent.tool_use',
                  data: { source, sessionKey, tool: toolName, timestamp: Date.now() },
                });
                // snapshot: tool_use start
                if (snap) {
                  if (snap.currentTool) snap.completedTools.push({ name: snap.currentTool.name, detail: snap.currentTool.detail });
                  snap.currentTool = { name: toolName, inputJson: '', detail: '' };
                  snap.status = 'tool_use';
                  snap.updatedAt = Date.now();
                  broadcastStatus(sessionKey, 'tool_use', toolName);
                }

                // new turn on channel — create fresh status message if none exists
                const ctx = channelRunContexts.get(sessionKey);
                if (ctx && !ctx.statusMsgId) {
                  clearTypingInterval(ctx);
                  const h = getChannelHandler(ctx.channel);
                  if (h) {
                    try {
                      if (h.typing) h.typing(ctx.chatId).catch(() => {});
                      const sent = await h.send(ctx.chatId, 'thinking...');
                      ctx.statusMsgId = sent.id;
                      statusMessages.set(sessionKey, { channel: ctx.channel, chatId: ctx.chatId, messageId: sent.id });
                      if (h.typing) {
                        clearTypingInterval(ctx);
                        ctx.typingInterval = setInterval(() => { h.typing!(ctx.chatId).catch(() => {}); }, 4500);
                      }
                    } catch {}
                  }
                }

                const tl = toolLogs.get(sessionKey);
                if (tl) {
                  // push previous tool as completed
                  if (tl.current) tl.completed.push({ name: tl.current.name, detail: tl.current.detail });
                  tl.current = { name: toolName, inputJson: '', detail: '' };
                  // throttled status edit
                  const sm = statusMessages.get(sessionKey);
                  if (sm) {
                    const now = Date.now();
                    if (now - tl.lastEditAt >= 2500) {
                      tl.lastEditAt = now;
                      const text = buildToolStatusText(tl.completed, tl.current);
                      const h = getChannelHandler(sm.channel);
                      if (h) { h.edit(sm.messageId, text, sm.chatId).catch(() => {}); }
                    }
                  }
                }
              }
            }

            // accumulate tool input json
            if (event.type === 'content_block_delta') {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === 'input_json_delta') {
                const partial = String(delta.partial_json || '');
                const tl = toolLogs.get(sessionKey);
                if (tl?.current) {
                  tl.current.inputJson += partial;
                }
                if (snap?.currentTool) {
                  snap.currentTool.inputJson += partial;
                }
              }
            }

            // tool input complete — extract detail and force update (no throttle)
            if (event.type === 'content_block_stop') {
              const tl = toolLogs.get(sessionKey);
              if (tl?.current && tl.current.inputJson) {
                try {
                  const input = JSON.parse(tl.current.inputJson);
                  const detail = extractToolDetail(tl.current.name, input);
                  tl.current.detail = detail;
                  if (snap?.currentTool) {
                    snap.currentTool.detail = detail;
                    snap.updatedAt = Date.now();
                    broadcastStatus(sessionKey, 'tool_use', snap.currentTool.name, detail);
                  }
                } catch {}
                // force edit — detail is worth showing immediately
                const sm = statusMessages.get(sessionKey);
                if (sm) {
                  tl.lastEditAt = Date.now();
                  const text = buildToolStatusText(tl.completed, tl.current);
                  const h = getChannelHandler(sm.channel);
                  if (h) { h.edit(sm.messageId, text, sm.chatId).catch(() => {}); }
                }
              }
            }
          }

          if (m.type === 'assistant') {
            const isSubagentMsg = !!(m.parent_tool_use_id);
            // broadcast full assistant messages for:
            // 1. non-streaming providers (Codex) — no stream_events exist
            // 2. subagent messages — SDK yields these as complete messages, not stream_events
            if (!hadStreamEvents || isSubagentMsg) {
              broadcast({
                event: 'agent.message',
                data: { source, sessionKey, message: m, parentToolUseId: m.parent_tool_use_id || null, timestamp: Date.now() },
              });
            }
            const assistantMsg = m.message as Record<string, unknown>;
            const content = assistantMsg?.content as unknown[];
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b.type === 'text' && !isSubagentMsg) agentText = b.text as string;
                if (b.type === 'tool_use' && typeof b.id === 'string') {
                  let parsedInput: Record<string, unknown> = {};
                  if (typeof b.input === 'string') {
                    try {
                      const parsed = JSON.parse(b.input);
                      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        parsedInput = parsed as Record<string, unknown>;
                      }
                    } catch {}
                  } else if (b.input && typeof b.input === 'object' && !Array.isArray(b.input)) {
                    parsedInput = b.input as Record<string, unknown>;
                  }
                  toolUseMeta.set(b.id, { name: cleanToolName(String(b.name || '')), input: parsedInput });
                }
                // broadcast tool_use for non-streaming providers and subagent messages
                if ((!hadStreamEvents || isSubagentMsg) && b.type === 'tool_use') {
                  const toolName = cleanToolName((b.name as string) || 'unknown');
                  if (toolName === 'message') usedMessageTool = true;
                  broadcast({
                    event: 'agent.tool_use',
                    data: { source, sessionKey, tool: toolName, timestamp: Date.now() },
                  });

                  const tl = toolLogs.get(sessionKey);
                  if (tl) {
                    if (tl.current) tl.completed.push({ name: tl.current.name, detail: tl.current.detail });
                    const inputStr = typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {});
                    let detail = '';
                    try { detail = extractToolDetail(toolName, JSON.parse(inputStr)); } catch {}
                    tl.current = { name: toolName, inputJson: inputStr, detail };
                    tl.lastEditAt = Date.now();
                    const sm = statusMessages.get(sessionKey);
                    if (sm) {
                      const text = buildToolStatusText(tl.completed, tl.current);
                      const h = getChannelHandler(sm.channel);
                      if (h) { h.edit(sm.messageId, text, sm.chatId).catch(() => {}); }
                    }
                  }
                }
              }
            }
          }

          if (m.type === 'user') {
            const userMsg = (m as any).message;
            const content = userMsg?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  // SDK sets parent_tool_use_id on subagent tool_results correctly.
                  // Task tool_results themselves have null parent (they're top-level).
                  const sdkParentId = (m as any).parent_tool_use_id || null;
                  const isTaskResult = taskToolUseIds.has(block.tool_use_id);
                  const parentId = isTaskResult ? null : sdkParentId;
                  if (isTaskResult) taskToolUseIds.delete(block.tool_use_id);

                  let resultText = '';
                  let imageData: string | undefined;
                  if (typeof block.content === 'string') {
                    resultText = block.content;
                  } else if (Array.isArray(block.content)) {
                    resultText = block.content
                      .filter((c: any) => c.type === 'text')
                      .map((c: any) => c.text)
                      .join('\n');
                    const img = block.content.find((c: any) => c.type === 'image');
                    if (img) {
                      const data = img.data || img.source?.data;
                      const mime = img.mimeType || img.source?.media_type || 'image/png';
                      if (data) imageData = `data:${mime};base64,${data}`;
                    }
                  }
                  maybeRegisterRunRefFromToolResult(String(block.tool_use_id || ''), resultText);
                  broadcast({
                    event: 'agent.tool_result',
                    data: {
                      source,
                      sessionKey,
                      tool_use_id: block.tool_use_id,
                      content: resultText.slice(0, 2000),
                      imageData,
                      is_error: block.is_error || false,
                      parentToolUseId: parentId,
                      timestamp: Date.now(),
                    },
                  });
                  // snapshot: tool_result → thinking
                  const snap2 = sessionSnapshots.get(sessionKey);
                  if (snap2 && !parentId) {
                    if (snap2.currentTool) snap2.completedTools.push({ name: snap2.currentTool.name, detail: snap2.currentTool.detail });
                    snap2.currentTool = null;
                    snap2.status = 'thinking';
                    snap2.updatedAt = Date.now();
                    broadcastStatus(sessionKey, 'thinking');
                  }
                }
              }
            }
          }

          // Codex tool results come as type: 'result' with subtype: 'tool_result'
          if (m.type === 'result' && m.subtype === 'tool_result') {
            const toolUseId = m.tool_use_id as string;
            const resultContent = Array.isArray(m.content)
              ? (m.content as Array<Record<string, unknown>>).filter(c => c.type === 'text').map(c => c.text).join('\n')
              : String(m.content || '');
            maybeRegisterRunRefFromToolResult(toolUseId, resultContent);
            broadcast({
              event: 'agent.tool_result',
              data: {
                source,
                sessionKey,
                tool_use_id: toolUseId,
                content: resultContent.slice(0, 2000),
                is_error: m.is_error || false,
                timestamp: Date.now(),
              },
            });
          }

          if (m.type === 'result' && m.subtype !== 'tool_result') {
            agentText = (m.result as string) || agentText;
            agentSessionId = (m.session_id as string) || agentSessionId;
            if (agentSessionId && session) {
              sessionRegistry.setSdkSessionId(sessionKey, agentSessionId);
              fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: agentSessionId });
            }
            const u = m.usage as Record<string, number>;
            agentUsage = {
              inputTokens: u?.input_tokens || 0,
              outputTokens: u?.output_tokens || 0,
              totalCostUsd: (m.total_cost_usd as number) || 0,
            };

            // per-turn: broadcast agent.result so desktop sets agentStatus to idle
            const resultEvent: WsEvent = {
              event: 'agent.result',
              data: {
                source,
                sessionKey,
                sessionId: agentSessionId || '',
                result: agentText,
                usage: agentUsage,
                timestamp: Date.now(),
              },
            };
            broadcast(resultEvent);
            if (streamV2Enabled && typeof resultEvent.seq === 'number') {
              scheduleRunEventPrune(sessionKey, resultEvent.seq);
              saveCheckpoint(sessionKey, resultEvent.seq);
            }

            // per-turn: broadcast goals/tasks updates if agent used planning tools
            const tl = toolLogs.get(sessionKey);
            if (tl) {
              const allTools = [...tl.completed.map(t => t.name), tl.current?.name].filter(Boolean);
              if (allTools.some(t => (
                t?.startsWith('projects_')
                || t?.startsWith('tasks_')
                || t?.startsWith('mcp__dorabot-tools__projects_')
                || t?.startsWith('mcp__dorabot-tools__tasks_')
              ))) {
                broadcast({ event: 'projects.update', data: { message: 'Projects/tasks updated' } });
              }
              if (allTools.some(t => t?.startsWith('research_') || t?.startsWith('mcp__dorabot-tools__research_'))) {
                broadcast({ event: 'research.update', data: { message: 'Research updated' } });
              }
            }


            // per-turn channel cleanup — delete status msg, send result, reset for next turn
            const ctx = channelRunContexts.get(sessionKey);
            if (ctx) {
              clearTypingInterval(ctx);
              const h = getChannelHandler(ctx.channel);
              if (h && ctx.statusMsgId) {
                try { await h.delete(ctx.statusMsgId, ctx.chatId); } catch {}
                ctx.statusMsgId = undefined;
              }
              statusMessages.delete(sessionKey);
              if (h && !usedMessageTool && agentText) {
                try {
                  const outboundText = appendRunSessionMarker(agentText, source, sessionKey, ctx.channel);
                  const sent = await h.send(ctx.chatId, outboundText);
                  registerRunReplyRef(source, sessionKey, ctx.channel, ctx.chatId, sent.id, outboundText);
                } catch {}
              }
            }

            finishTaskRun(sessionKey, 'completed');

            // per-turn: mark idle so sidebar spinner stops
            sessionRegistry.setActiveRun(sessionKey, false);
            broadcastStatus(sessionKey, 'idle');
            broadcast({ event: 'status.update', data: { activeRun: false, source, sessionKey } });
            broadcastSessionUpdate(sessionKey);

            // clear snapshot on turn end
            sessionSnapshots.delete(sessionKey);

            // reset for next turn (persistent sessions get multiple result events)
            usedMessageTool = false;
            agentText = '';
            toolLogs.set(sessionKey, { completed: [], current: null, lastEditAt: 0 });
          }
        }

        return {
          sessionId: agentSessionId || '',
          result: agentText,
          messages: [],
          usage: agentUsage,
          durationMs: Date.now() - runStart,
          usedMessageTool,
        };
      }

      try {
        const session = sessionRegistry.get(sessionKey);
        const resumeId = session?.sdkSessionId;

        try {
          result = await executeStream(resumeId);
        } catch (err) {
          // if resume failed, clear stale sdkSessionId and retry fresh
          if (resumeId) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(`[gateway] resume failed for ${sessionKey}, retrying fresh: ${errMsg}`);
            sessionRegistry.setSdkSessionId(sessionKey, undefined);
            if (session) fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: undefined });
            result = await executeStream(undefined);
          } else {
            throw err;
          }
        }

        // agent.result and planning updates are broadcast per-turn inside executeStream's result handler.
        // This point is only reached when the run actually ends (abort, error, or non-persistent provider).
        console.log(`[gateway] agent run ended: source=${source} result="${result.result.slice(0, 100)}..." cost=$${result.usage.totalCostUsd?.toFixed(4) || '?'}`);
      } catch (err) {
        console.error(`[gateway] agent error: source=${source}`, err);
        let errMsg = err instanceof Error ? err.message : String(err);
        // Improve error message for common issues
        if (errMsg.includes('spawn node ENOENT') || errMsg.includes('spawn node')) {
          errMsg = 'Node.js not found. Install Node.js (https://nodejs.org) or Claude Code CLI (`npm install -g @anthropic-ai/claude-code`), then restart dorabot.';
        }
        let suppressError = false;
        if (isAuthError(err)) {
          // Try silent refresh before falling back to interactive re-auth
          console.log(`[gateway] auth error for ${source}, attempting silent token refresh`);
          const provName = (config.provider?.name || 'claude') as ProviderName;
          const refreshedGate = await refreshProviderAuthGate(provName);
          if (classifyAuthRecovery(refreshedGate) === 'retry') {
            console.log(`[gateway] silent refresh succeeded, retrying run for ${source}`);
            // Re-queue the failed prompt so user doesn't have to resend
            handleAgentRun(params).catch(() => {});
            suppressError = true;
          } else if (classifyAuthRecovery(refreshedGate) === 'reauth') {
            console.log(`[gateway] silent refresh failed for ${source}, starting interactive re-auth`);
            const started = await startReauthFlow({ prompt, sessionKey, source, channel, chatId: messageMetadata?.chatId, messageMetadata }).catch(() => false);
            if (started) {
              broadcastAuthRequired(provName, refreshedGate.error || 'Authentication required');
              suppressError = true;
            }
          }
        }
        if (!suppressError) {
          finishTaskRun(sessionKey, 'error', errMsg);
          const errorEvent: WsEvent = {
            event: 'agent.error',
            data: { source, sessionKey, error: errMsg, timestamp: Date.now() },
          };
          broadcast(errorEvent);
          if (streamV2Enabled && typeof errorEvent.seq === 'number') {
            scheduleRunEventPrune(sessionKey, errorEvent.seq);
            saveCheckpoint(sessionKey, errorEvent.seq);
          }
        }
      } finally {
        activeAbortControllers.delete(sessionKey);
        activeRunChannels.delete(sessionKey);
        activeRunSources.delete(sessionKey);
        runHandles.delete(sessionKey);
        // clean up any remaining channel context (typing indicator, status message)
        const ctx = channelRunContexts.get(sessionKey);
        if (ctx) {
          clearTypingInterval(ctx);
          if (ctx.statusMsgId) {
            const h = getChannelHandler(ctx.channel);
            if (h) { try { await h.delete(ctx.statusMsgId, ctx.chatId); } catch {} }
          }
          channelRunContexts.delete(sessionKey);
        }
        statusMessages.delete(sessionKey);
        toolLogs.delete(sessionKey);
        cancelPendingQuestionsForSession(sessionKey, 'cancelled');
        sessionSnapshots.delete(sessionKey);
        sessionRegistry.setActiveRun(sessionKey, false);
        broadcastStatus(sessionKey, 'idle');
        broadcast({ event: 'status.update', data: { activeRun: false, source, sessionKey } });
        broadcastSessionUpdate(sessionKey);
        if (taskRunBySession.has(sessionKey)) {
          finishTaskRun(sessionKey, 'error', 'run ended');
        }
      }
    });

    runQueues.set(sessionKey, run.catch(() => {}));
    await run;
    return result;
  }

  // rpc handler
  async function handleRpc(msg: WsMessage, clientWs?: WebSocket): Promise<WsResponse> {
    const { method, params, id } = msg;

    try {
      switch (method) {
        case 'ping': {
          const state = clientWs ? clients.get(clientWs) : undefined;
          if (state) state.lastSeen = Date.now();
          return { id, result: { ok: true, timestamp: Date.now() } };
        }

        case 'status': {
          return {
            id,
            result: {
              running: true,
              startedAt,
              channels: channelManager.getStatuses(),
              sessions: sessionRegistry.list(),
              calendar: scheduler ? {
                enabled: true,
                itemCount: scheduler.listItems().length,
              } : null,
            },
          };
        }

        case 'sessions.subscribe': {
          const keys = params?.sessionKeys as string[];
          if (!Array.isArray(keys)) return { id, error: 'sessionKeys required' };
          const lastSeq = typeof params?.lastSeq === 'number' ? params.lastSeq : 0;
          const lastSeqBySession = (params?.lastSeqBySession || {}) as Record<string, number>;
          const requestedLimit = Number(params?.limit);
          const replayLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(Math.floor(requestedLimit), REPLAY_BATCH_MAX_LIMIT)
            : REPLAY_BATCH_DEFAULT_LIMIT;
          const state = clientWs ? clients.get(clientWs) : undefined;
          if (state) {
            keys.forEach(k => state.subscriptions.add(k));
            state.lastSeen = Date.now();
          }
          // replay persisted events for exact continuity before snapshot/live stream
          // Use checkpoint seqs for any session key that has no client-provided cursor,
          // skipping already-incorporated events on cold start or partial reconnect.
          const keysNeedingCheckpoint = keys.filter(sk => {
            const perSessionSeq = Number(lastSeqBySession?.[sk]);
            return !(Number.isFinite(perSessionSeq) && perSessionSeq > 0);
          });
          const checkpointSeqs = keysNeedingCheckpoint.length > 0
            ? getCheckpointSeqs(keysNeedingCheckpoint)
            : new Map<string, number>();

          let replayCount = 0;
          if (clientWs) {
            const replayStartedAt = Date.now();
            const cursorBySession = new Map<string, number>();
            for (const sk of keys) {
              const perSessionSeq = Number(lastSeqBySession?.[sk]);
              if (Number.isFinite(perSessionSeq) && perSessionSeq > 0) {
                cursorBySession.set(sk, perSessionSeq);
              } else if (checkpointSeqs.has(sk)) {
                cursorBySession.set(sk, checkpointSeqs.get(sk)!);
              } else {
                cursorBySession.set(sk, lastSeq);
              }
            }

            while (true) {
              const rows = queryEventsBySessionCursor(
                keys.map((sessionKey) => ({
                  sessionKey,
                  afterSeq: cursorBySession.get(sessionKey) || 0,
                })),
                replayLimit,
              );
              if (rows.length === 0) break;
              for (const row of rows) {
                clientWs.send(JSON.stringify({ event: row.event_type, data: JSON.parse(row.data), seq: row.seq }));
                replayCount += 1;
                cursorBySession.set(row.session_key, row.seq);
              }
              if (rows.length < replayLimit) break;
            }

            const replayMs = Date.now() - replayStartedAt;
            const telemetry = {
              connect_id: state?.connectId,
              session_count: sessionRegistry.list().length,
              subscribed_count: state?.subscriptions.size || keys.length,
              replay_count: replayCount,
              replay_ms: replayMs,
              buffered_amount_max: state?.bufferedAmountMax || 0,
              timestamp: Date.now(),
            };
            clientWs.send(JSON.stringify({ event: 'gateway.telemetry', data: telemetry }));
            console.log('[gateway][replay]', telemetry);
          }
          // send snapshots for any active sessions
          for (const sk of keys) {
            const snap = sessionSnapshots.get(sk);
            if (snap && clientWs) {
              const snapshotData = (snap.pendingQuestionStatus && snap.pendingQuestionStatus !== 'pending')
                ? { ...snap, pendingQuestion: null }
                : snap;
              clientWs.send(JSON.stringify({ event: 'session.snapshot', data: snapshotData }));
            }
          }
          return { id, result: { subscribed: keys, replayCount, limit: replayLimit } };
        }

        case 'sessions.unsubscribe': {
          const keys = params?.sessionKeys as string[];
          if (!Array.isArray(keys)) return { id, error: 'sessionKeys required' };
          const state = clientWs ? clients.get(clientWs) : undefined;
          if (state) keys.forEach(k => state.subscriptions.delete(k));
          return { id, result: { unsubscribed: keys } };
        }

        case 'chat.send': {
          const prompt = params?.prompt as string;
          const images = params?.images as Array<{ data: string; mediaType: string }> | undefined;
          if (!prompt) return { id, error: 'prompt required' };

          const chatId = (params?.chatId as string) || randomUUID();
          const requestedSessionKey = params?.sessionKey as string | undefined;
          // use client-provided sessionKey if it exists in the registry (e.g. replying to a calendar session)
          const existingSession = requestedSessionKey ? sessionRegistry.get(requestedSessionKey) : undefined;
          const sessionKey = existingSession ? requestedSessionKey! : `desktop:dm:${chatId}`;
          let session = existingSession || sessionRegistry.getOrCreate({
            channel: 'desktop',
            chatId,
          });

          // idle timeout: reset session if too long since last message (skip for cross-session replies)
          if (!existingSession) {
            const desktopGap = Date.now() - session.lastMessageAt;
            if (session.messageCount > 0 && desktopGap > IDLE_TIMEOUT_MS) {
              console.log(`[gateway] idle timeout for ${session.key} (${Math.floor(desktopGap / 3600000)}h), starting new session`);
              fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: undefined });
              sessionRegistry.remove(session.key);
              session = sessionRegistry.getOrCreate({ channel: 'desktop', chatId });
            }
            fileSessionManager.setMetadata(session.sessionId, { channel: 'desktop', chatId, chatType: 'dm' });
          }

          sessionRegistry.incrementMessages(session.key);
          broadcastSessionUpdate(sessionKey);

          // try injection into active run first
          const handle = runHandles.get(sessionKey);
          if (handle?.active) {
            handle.inject(prompt, images);
            // record injected user message in session (CLI doesn't echo user text back)
            const injectedContent: Array<Record<string, unknown>> = [];
            if (images?.length) {
              for (const img of images) {
                injectedContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
              }
            }
            injectedContent.push({ type: 'text', text: prompt });
            fileSessionManager.append(session.sessionId, {
              type: 'user',
              timestamp: new Date().toISOString(),
              content: { type: 'user', message: { role: 'user', content: injectedContent } },
            });
            broadcast({ event: 'agent.user_message', data: {
              source: 'desktop/chat', sessionKey, prompt, injected: true, timestamp: Date.now(),
            }});
            return { id, result: { sessionKey, sessionId: session.sessionId, injected: true } };
          }

          // no active session — start new run
          handleAgentRun({
            prompt,
            images,
            sessionKey,
            source: 'desktop/chat',
          });

          return { id, result: { sessionKey, sessionId: session.sessionId, queued: true } };
        }

        case 'agent.abort': {
          const sk = params?.sessionKey as string;
          if (!sk) return { id, error: 'sessionKey required' };
          const ac = activeAbortControllers.get(sk);
          if (!ac) return { id, error: 'no active run for that session' };
          ac.abort();
          console.log(`[gateway] agent aborted: sessionKey=${sk}`);
          return { id, result: { aborted: true, sessionKey: sk } };
        }

        case 'agent.interrupt': {
          const sk = params?.sessionKey as string;
          if (!sk) return { id, error: 'sessionKey required' };
          const h = runHandles.get(sk);
          if (!h?.active) return { id, error: 'no active run for that session' };
          if (!h.interrupt) return { id, error: 'interrupt not supported by current provider' };
          await h.interrupt();
          return { id, result: { interrupted: true, sessionKey: sk } };
        }

        case 'agent.setModel': {
          const sk = params?.sessionKey as string;
          const model = params?.model as string;
          if (!sk) return { id, error: 'sessionKey required' };
          if (!model) return { id, error: 'model required' };
          const h = runHandles.get(sk);
          if (!h?.active) return { id, error: 'no active run for that session' };
          if (!h.setModel) return { id, error: 'setModel not supported by current provider' };
          await h.setModel(model);
          return { id, result: { model, sessionKey: sk } };
        }

        case 'agent.stopTask': {
          const sk = params?.sessionKey as string;
          const taskId = params?.taskId as string;
          if (!sk) return { id, error: 'sessionKey required' };
          if (!taskId) return { id, error: 'taskId required' };
          const h = runHandles.get(sk);
          if (!h?.active) return { id, error: 'no active run for that session' };
          if (!h.stopTask) return { id, error: 'stopTask not supported by current provider' };
          await h.stopTask(taskId);
          return { id, result: { stopped: true, taskId, sessionKey: sk } };
        }

        case 'agent.mcpStatus': {
          const sk = params?.sessionKey as string;
          if (!sk) return { id, error: 'sessionKey required' };
          const h = runHandles.get(sk);
          if (!h?.active) return { id, error: 'no active run for that session' };
          if (!h.mcpServerStatus) return { id, error: 'mcpServerStatus not supported by current provider' };
          const status = await h.mcpServerStatus();
          return { id, result: status };
        }

        // ── MCP server management RPCs ────────────────────────────
        case 'mcp.list': {
          const entries = Object.entries(config.mcpServers || {}).map(([name, cfg]) => ({
            name,
            config: cfg,
          }));
          return { id, result: entries };
        }

        case 'mcp.add': {
          const name = params?.name as string;
          const serverConfig = params?.config as Record<string, unknown>;
          if (!name) return { id, error: 'name required' };
          if (!serverConfig) return { id, error: 'config required' };
          if (!config.mcpServers) config.mcpServers = {};
          if (config.mcpServers[name]) return { id, error: `server "${name}" already exists` };
          config.mcpServers[name] = serverConfig as any;
          saveConfig(config);
          broadcast({ event: 'mcp.update', data: {} });
          return { id, result: { added: name } };
        }

        case 'mcp.update': {
          const name = params?.name as string;
          const serverConfig = params?.config as Record<string, unknown>;
          if (!name) return { id, error: 'name required' };
          if (!serverConfig) return { id, error: 'config required' };
          if (!config.mcpServers?.[name]) return { id, error: `server "${name}" not found` };
          config.mcpServers[name] = serverConfig as any;
          saveConfig(config);
          broadcast({ event: 'mcp.update', data: {} });
          return { id, result: { updated: name } };
        }

        case 'mcp.remove': {
          const name = params?.name as string;
          if (!name) return { id, error: 'name required' };
          if (!config.mcpServers?.[name]) return { id, error: `server "${name}" not found` };
          delete config.mcpServers[name];
          if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;
          saveConfig(config);
          broadcast({ event: 'mcp.update', data: {} });
          return { id, result: { removed: name } };
        }

        case 'mcp.status': {
          // Try to get live status from any active run handle
          for (const [, h] of runHandles) {
            if (h.active && h.mcpServerStatus) {
              try {
                const status = await h.mcpServerStatus();
                return { id, result: status };
              } catch { /* fall through */ }
            }
          }
          // No active run, return config-based entries with unknown status
          const entries = Object.entries(config.mcpServers || {}).map(([name]) => ({
            name,
            status: 'pending',
          }));
          return { id, result: entries };
        }

        case 'mcp.reconnect': {
          const name = params?.name as string;
          if (!name) return { id, error: 'name required' };
          for (const [, h] of runHandles) {
            if (h.active && h.reconnectMcpServer) {
              await h.reconnectMcpServer(name);
              return { id, result: { reconnected: name } };
            }
          }
          return { id, error: 'no active run to reconnect MCP server' };
        }

        case 'mcp.toggle': {
          const name = params?.name as string;
          const enabled = params?.enabled as boolean;
          if (!name) return { id, error: 'name required' };
          if (typeof enabled !== 'boolean') return { id, error: 'enabled (boolean) required' };
          for (const [, h] of runHandles) {
            if (h.active && h.toggleMcpServer) {
              await h.toggleMcpServer(name, enabled);
              return { id, result: { toggled: name, enabled } };
            }
          }
          return { id, error: 'no active run to toggle MCP server' };
        }

        case 'chat.answerQuestion': {
          const requestId = params?.requestId as string;
          const answers = params?.answers as Record<string, string>;
          if (!requestId) return { id, error: 'requestId required' };
          if (!answers) return { id, error: 'answers required' };
          const pending = pendingQuestions.get(requestId);
          if (!pending) {
            const known = questionStates.get(requestId);
            if (known?.status === 'answered') {
              return { id, result: { answered: true, idempotent: true } };
            }
            if (known?.status === 'timeout' || known?.status === 'cancelled') {
              return { id, error: `question is already ${known.status}` };
            }
            return { id, error: 'no pending question with that ID' };
          }
          pendingQuestions.delete(requestId);
          clearTimeout(pending.timeout);
          updateQuestionState(requestId, 'answered', pending.sessionKey, answers);
          pending.resolve(answers);
          return { id, result: { answered: true, idempotent: false } };
        }

        case 'chat.answerElicitation': {
          const elicitationId = params?.elicitationId as string;
          const values = params?.values as Record<string, unknown>;
          const sk = params?.sessionKey as string;
          if (!elicitationId) return { id, error: 'elicitationId required' };
          // Clear the pending elicitation from snapshot
          const snap = sk ? sessionSnapshots.get(sk) : undefined;
          if (snap) {
            snap.pendingElicitation = null;
            snap.updatedAt = Date.now();
          }
          // Broadcast to clear UI on other clients
          if (sk) {
            broadcast({ event: 'agent.elicitation_result', data: { sessionKey: sk, elicitationId, values, timestamp: Date.now() } });
          }
          return { id, result: { answered: true } };
        }

        case 'chat.dismissElicitation': {
          const elicitationId = params?.elicitationId as string;
          const sk = params?.sessionKey as string;
          if (!elicitationId) return { id, error: 'elicitationId required' };
          const snap = sk ? sessionSnapshots.get(sk) : undefined;
          if (snap) {
            snap.pendingElicitation = null;
            snap.updatedAt = Date.now();
          }
          if (sk) {
            broadcast({ event: 'agent.elicitation_result', data: { sessionKey: sk, elicitationId, values: null, timestamp: Date.now() } });
          }
          return { id, result: { dismissed: true } };
        }

        case 'chat.history': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const messages = fileSessionManager.load(sessionId);
          return { id, result: messages };
        }

        case 'sessions.list': {
          const fileSessions = fileSessionManager.list();
          const activeIds = new Set(
            sessionRegistry.getActiveRunKeys()
              .map(k => sessionRegistry.get(k)?.sessionId)
              .filter(Boolean),
          );
          const result = fileSessions.map(s => ({
            ...s,
            activeRun: activeIds.has(s.id),
          }));
          return { id, result };
        }

        case 'sessions.get': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const messages = fileSessionManager.load(sessionId);
          return { id, result: { sessionId, messages } };
        }

        case 'sessions.delete': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const deleted = fileSessionManager.delete(sessionId);
          return { id, result: { deleted } };
        }

        case 'sessions.reset': {
          const channel = params?.channel as string;
          const chatId = params?.chatId as string;
          if (!channel || !chatId) return { id, error: 'channel and chatId required' };
          const key = sessionRegistry.makeKey({ channel, chatId });
          const oldSession = sessionRegistry.get(key);
          if (oldSession) fileSessionManager.setMetadata(oldSession.sessionId, { sdkSessionId: undefined });
          sessionRegistry.remove(key);
          return { id, result: { reset: true, key } };
        }

        case 'sessions.resume': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const meta = fileSessionManager.getMetadata(sessionId);
          if (!meta) return { id, error: 'session metadata not found' };

          const ch = (params?.channel as string) || meta.channel || 'desktop';
          const cid = (params?.chatId as string) || meta.chatId || sessionId;
          const ct = meta.chatType || 'dm';
          const key = sessionRegistry.makeKey({ channel: ch, chatId: cid, chatType: ct });

          const existing = sessionRegistry.get(key);
          if (existing?.activeRun) return { id, error: 'cannot resume while agent is running' };

          sessionRegistry.remove(key);
          sessionRegistry.getOrCreate({ channel: ch, chatId: cid, chatType: ct, sessionId });
          if (meta.sdkSessionId) {
            sessionRegistry.setSdkSessionId(key, meta.sdkSessionId);
          }
          // backfill chatId into metadata so future resumes don't fallback
          if (!meta.chatId && cid !== 'default') {
            fileSessionManager.setMetadata(sessionId, { channel: ch, chatId: cid, chatType: ct });
          }

          return { id, result: { resumed: true, key, sessionId, sdkSessionId: meta.sdkSessionId || null } };
        }

        case 'sessions.checkpoint.get': {
          const sessionKey = params?.sessionKey as string;
          if (!sessionKey) return { id, error: 'sessionKey required' };
          const seq = getCheckpointSeq(sessionKey);
          return { id, result: { sessionKey, seq } };
        }

        case 'sessions.fork': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          try {
            const { forkSession } = await import('@anthropic-ai/claude-agent-sdk');
            const forked = await forkSession(sessionId);
            return { id, result: { sessionId: forked.sessionId } };
          } catch (err) {
            return { id, error: `fork failed: ${err instanceof Error ? err.message : String(err)}` };
          }
        }

        case 'sessions.tag': {
          const sessionId = params?.sessionId as string;
          const tag = params?.tag as string | null;
          if (!sessionId) return { id, error: 'sessionId required' };
          try {
            const { tagSession } = await import('@anthropic-ai/claude-agent-sdk');
            await tagSession(sessionId, tag ?? null);
            return { id, result: { tagged: true } };
          } catch (err) {
            return { id, error: `tag failed: ${err instanceof Error ? err.message : String(err)}` };
          }
        }

        case 'sessions.rename': {
          const sessionId = params?.sessionId as string;
          const name = params?.name as string;
          if (!sessionId || !name) return { id, error: 'sessionId and name required' };
          try {
            const { renameSession } = await import('@anthropic-ai/claude-agent-sdk');
            await renameSession(sessionId, name);
            return { id, result: { renamed: true } };
          } catch (err) {
            return { id, error: `rename failed: ${err instanceof Error ? err.message : String(err)}` };
          }
        }

        case 'channels.status': {
          return { id, result: channelManager.getStatuses() };
        }

        case 'channels.start': {
          const channelId = params?.channel as string;
          if (!channelId) return { id, error: 'channel required' };
          await channelManager.startChannel(channelId);
          return { id, result: { started: channelId } };
        }

        case 'channels.stop': {
          const channelId = params?.channel as string;
          if (!channelId) return { id, error: 'channel required' };
          await channelManager.stopChannel(channelId);
          return { id, result: { stopped: channelId } };
        }

        case 'channels.whatsapp.status': {
          const authDir = config.channels?.whatsapp?.authDir || getDefaultAuthDir();
          const linked = isWhatsAppLinked(authDir);
          return { id, result: { linked } };
        }

        case 'channels.whatsapp.login': {
          const authDir = config.channels?.whatsapp?.authDir || getDefaultAuthDir();
          if (whatsappLoginInProgress) {
            return { id, result: { success: true, started: true, inProgress: true } };
          }

          whatsappLoginInProgress = true;
          broadcast({ event: 'whatsapp.login_status', data: { status: 'connecting' } });

          void (async () => {
            try {
              const result = await loginWhatsApp(authDir, (qr) => {
                broadcast({ event: 'whatsapp.qr', data: { qr } });
                broadcast({ event: 'whatsapp.login_status', data: { status: 'qr_ready' } });
              });

              if (result.success) {
                // auto-enable whatsapp in config
                if (!config.channels) config.channels = {};
                if (!config.channels.whatsapp) config.channels.whatsapp = {};
                config.channels.whatsapp.enabled = true;
                saveConfig(config);

                broadcast({ event: 'whatsapp.login_status', data: { status: 'connected' } });

                // auto-start the monitor
                await channelManager.startChannel('whatsapp');
              } else {
                broadcast({ event: 'whatsapp.login_status', data: { status: 'failed', error: result.error } });
              }
            } catch (err) {
              const error = err instanceof Error ? err.message : String(err);
              broadcast({ event: 'whatsapp.login_status', data: { status: 'failed', error } });
            } finally {
              whatsappLoginInProgress = false;
            }
          })();

          return { id, result: { success: true, started: true } };
        }

        case 'channels.whatsapp.logout': {
          whatsappLoginInProgress = false;
          await channelManager.stopChannel('whatsapp');
          const authDir = config.channels?.whatsapp?.authDir || getDefaultAuthDir();
          await logoutWhatsApp(authDir);

          if (config.channels?.whatsapp) {
            config.channels.whatsapp.enabled = false;
            saveConfig(config);
          }

          broadcast({ event: 'whatsapp.login_status', data: { status: 'disconnected' } });
          return { id, result: { success: true } };
        }

        case 'channels.telegram.status': {
          const tokenFile = config.channels?.telegram?.tokenFile
            || TELEGRAM_TOKEN_PATH;
          const linked = existsSync(tokenFile) && readFileSync(tokenFile, 'utf-8').trim().length > 0;
          const botUsername = linked ? (config.channels?.telegram?.accountId || null) : null;
          return { id, result: { linked, botUsername } };
        }

        case 'channels.telegram.link': {
          const token = (params?.token as string || '').trim();
          if (!token) return { id, error: 'token is required' };
          if (!token.includes(':')) {
            return { id, error: 'Invalid token format. Expected format: 123456:ABC-DEF1234...' };
          }

          let botInfo: { id: number; username: string; firstName: string };
          try {
            botInfo = await validateTelegramToken(token);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { id, error: `Invalid token: ${msg}` };
          }

          const tokenDir = TELEGRAM_DIR;
          mkdirSync(tokenDir, { recursive: true });
          writeFileSync(join(tokenDir, 'token'), token, { mode: 0o600 });

          if (!config.channels) config.channels = {};
          if (!config.channels.telegram) config.channels.telegram = {};
          config.channels.telegram.enabled = true;
          config.channels.telegram.accountId = `@${botInfo.username}`;
          saveConfig(config);

          broadcast({
            event: 'telegram.link_status',
            data: { status: 'linked', botUsername: `@${botInfo.username}` },
          });

          try {
            await channelManager.startChannel('telegram');
          } catch (err) {
            console.error('[gateway] telegram auto-start failed:', err);
          }

          return {
            id,
            result: {
              success: true,
              botId: botInfo.id,
              botUsername: `@${botInfo.username}`,
              botName: botInfo.firstName,
            },
          };
        }

        case 'channels.telegram.unlink': {
          await channelManager.stopChannel('telegram');

          const tokenFile = config.channels?.telegram?.tokenFile
            || TELEGRAM_TOKEN_PATH;
          if (existsSync(tokenFile)) rmSync(tokenFile);

          if (config.channels?.telegram) {
            config.channels.telegram.enabled = false;
            delete config.channels.telegram.accountId;
            saveConfig(config);
          }

          broadcast({ event: 'telegram.link_status', data: { status: 'unlinked' } });
          return { id, result: { success: true } };
        }

        case 'calendar.list':
        case 'cron.list': {
          const items = scheduler?.listItems() || loadCalendarItems();
          return { id, result: items };
        }

        case 'calendar.add':
        case 'cron.add': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const data = params as any;
          // backward compat: map old CronJob fields to CalendarItem
          if (data.name && !data.summary) data.summary = data.name;
          if (!data.dtstart) data.dtstart = new Date().toISOString();
          if (!data.type) data.type = data.deleteAfterRun ? 'reminder' : 'event';
          if (!data.message) return { id, error: 'message required' };
          const item = scheduler.addItem(data);
          return { id, result: item };
        }

        case 'calendar.remove':
        case 'cron.remove': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const removed = scheduler.removeItem(itemId);
          return { id, result: { removed } };
        }

        case 'calendar.toggle':
        case 'cron.toggle': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const items = scheduler.listItems();
          const item = items.find(i => i.id === itemId);
          if (!item) return { id, error: 'item not found' };
          const updated = scheduler.updateItem(itemId, { enabled: !item.enabled });
          return { id, result: { id: itemId, enabled: updated?.enabled } };
        }

        case 'calendar.run':
        case 'cron.run': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          // fire and forget — agent runs can take minutes, don't block the RPC
          scheduler.runItemNow(itemId).catch(err => {
            console.error(`[gateway] calendar run failed for ${itemId}:`, err);
          });
          return { id, result: { status: 'started' } };
        }

        case 'calendar.update': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const { id: _removeId, ...updates } = params as any;
          const updated = scheduler.updateItem(itemId, updates);
          if (!updated) return { id, error: 'item not found' };
          return { id, result: updated };
        }

        case 'calendar.export': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const icsString = scheduler.exportIcs();
          return { id, result: { ics: icsString } };
        }

        case 'pulse.status': {
          const pulseItem = scheduler?.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
          return {
            id,
            result: {
              enabled: !!pulseItem?.enabled,
              interval: pulseItem ? rruleToPulseInterval(pulseItem.rrule || '') : DEFAULT_PULSE_INTERVAL,
              lastRunAt: pulseItem?.lastRunAt || null,
              nextRunAt: pulseItem?.nextRunAt || null,
            },
          };
        }

        case 'pulse.setInterval': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const interval = params?.interval as string;
          if (!PULSE_INTERVALS.includes(interval)) return { id, error: `interval must be one of: ${PULSE_INTERVALS.join(', ')}` };
          const item = scheduler.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
          if (!item) return { id, error: 'pulse not enabled' };
          const updated = scheduler.updateItem(AUTONOMOUS_SCHEDULE_ID, { rrule: pulseIntervalToRrule(interval) });
          return { id, result: updated };
        }

        // legacy APIs removed in goals/tasks migration
        case 'plans.list':
        case 'plans.update':
        case 'plans.delete':
        case 'plans.start':
        case 'plans.logs':
        case 'ideas.list':
        case 'ideas.add':
        case 'ideas.update':
        case 'ideas.delete':
        case 'ideas.move':
        case 'ideas.create_plan':
        case 'worktree.create':
        case 'worktree.stats':
        case 'worktree.merge':
        case 'worktree.remove':
        case 'worktree.push_pr': {
          return {
            id,
            error: 'deprecated API: plans/ideas/worktree has been removed, use projects.* and tasks.*',
          };
        }

        // ── Goals & Tasks ──

        case 'goals.list':
        case 'projects.list': {
          const state = loadProjects();
          return { id, result: state.projects };
        }

        case 'goals.add':
        case 'projects.add': {
          const title = (params?.title as string || '').trim();
          if (!title) return { id, error: 'title required' };
          const state = loadProjects();
          const now = new Date().toISOString();
          const ids = state.projects.map(p => Number.parseInt(p.id, 10)).filter(n => Number.isFinite(n));
          const project: Project = {
            id: String((ids.length ? Math.max(...ids) : 0) + 1),
            title,
            description: params?.description as string | undefined,
            status: (params?.status as Project['status']) || 'active',
            tags: (params?.tags as string[] | undefined) || [],
            reason: params?.reason as string | undefined,
            createdAt: now,
            updatedAt: now,
          };
          state.projects.push(project);
          saveProjects(state);
          broadcast({ event: 'projects.update', data: { projectId: project.id, project, message: `Project created: ${project.title}` } });
          return { id, result: project };
        }

        case 'goals.update':
        case 'projects.update': {
          const projectId = params?.id as string;
          if (!projectId) return { id, error: 'id required' };
          const state = loadProjects();
          const project = state.projects.find(p => p.id === projectId);
          if (!project) return { id, error: 'project not found' };

          if (params?.title !== undefined) project.title = params.title as string;
          if (params?.description !== undefined) project.description = params.description as string;
          if (params?.status !== undefined) project.status = params.status as Project['status'];
          if (params?.tags !== undefined) project.tags = params.tags as string[];
          if (params?.reason !== undefined) project.reason = params.reason as string;
          project.updatedAt = new Date().toISOString();
          saveProjects(state);

          // when project is marked done, cancel pending tasks under it
          if (project.status === 'done') {
            const tasks = loadTasks();
            let changed = false;
            for (const task of tasks.tasks) {
              if (task.goalId !== projectId) continue;
              if (task.status === 'done' || task.status === 'cancelled') continue;
              if (task.status === 'in_progress') continue;
              task.status = 'cancelled';
              task.reason = 'project completed';
              task.updatedAt = project.updatedAt;
              appendTaskLog(task.id, 'auto_cancelled', 'Cancelled: parent project marked done');
              changed = true;
            }
            if (changed) saveTasks(tasks);
          }

          broadcast({ event: 'projects.update', data: { projectId: project.id, project, message: `Project updated: ${project.title}` } });
          return { id, result: project };
        }

        case 'goals.delete':
        case 'projects.delete': {
          const projectId = params?.id as string;
          if (!projectId) return { id, error: 'id required' };

          const state = loadProjects();
          const before = state.projects.length;
          state.projects = state.projects.filter(p => p.id !== projectId);
          if (state.projects.length === before) return { id, error: 'project not found' };
          saveProjects(state);

          // unassign orphan tasks
          const tasks = loadTasks();
          let changed = false;
          for (const task of tasks.tasks) {
            if (task.goalId === projectId) {
              task.goalId = undefined;
              task.updatedAt = new Date().toISOString();
              changed = true;
            }
          }
          if (changed) saveTasks(tasks);

          broadcast({ event: 'projects.update', data: { projectId, deleted: true, message: `Project deleted: #${projectId}` } });
          return { id, result: { deleted: true } };
        }

        case 'tasks.list': {
          const tasks = loadTasks();
          return { id, result: tasks.tasks };
        }

        case 'tasks.view': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const tasks = loadTasks();
          const task = tasks.tasks.find(t => t.id === taskId);
          if (!task) return { id, error: 'task not found' };
          return { id, result: task };
        }

        case 'tasks.add': {
          const title = (params?.title as string || '').trim();
          if (!title) return { id, error: 'title required' };
          const tasks = loadTasks();
          const now = new Date().toISOString();
          const ids = tasks.tasks.map(t => Number.parseInt(t.id, 10)).filter(n => Number.isFinite(n));
          const taskId = String((ids.length ? Math.max(...ids) : 0) + 1);
          const normalizedStatus = (params?.status as Task['status']) || 'todo';
          const task: Task = {
            id: taskId,
            goalId: params?.goalId as string | undefined,
            title,
            status: normalizedStatus,
            result: params?.result as string | undefined,
            reason: params?.reason as string | undefined,
            sessionId: params?.sessionId as string | undefined,
            sessionKey: params?.sessionKey as string | undefined,
            createdAt: now,
            updatedAt: now,
          };
          tasks.tasks.push(task);
          saveTasks(tasks);
          appendTaskLog(task.id, 'rpc_add', `Task created: ${task.title}`);
          broadcast({ event: 'projects.update', data: { taskId: task.id, task, message: `Task created: ${task.title}` } });
          return { id, result: task };
        }

        case 'tasks.update': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const tasks = loadTasks();
          const task = tasks.tasks.find(t => t.id === taskId);
          if (!task) return { id, error: 'task not found' };

          if (params?.title !== undefined) task.title = params.title as string;
          if (params?.goalId !== undefined) task.goalId = (params.goalId as string) || undefined;
          if (params?.result !== undefined) task.result = params.result as string;
          if (params?.reason !== undefined) task.reason = params.reason as string;
          if (params?.sessionId !== undefined) task.sessionId = params.sessionId as string;
          if (params?.sessionKey !== undefined) task.sessionKey = params.sessionKey as string;

          const requestedStatus = params?.status as Task['status'] | undefined;
          if (requestedStatus !== undefined) {
            task.status = requestedStatus;
          }

          task.updatedAt = new Date().toISOString();
          if (task.status === 'done' && !task.completedAt) task.completedAt = task.updatedAt;
          if (task.status !== 'done') task.completedAt = undefined;
          saveTasks(tasks);

          appendTaskLog(task.id, 'rpc_update', `Task updated: ${task.title}`, {
            status: task.status,
            goalId: task.goalId,
          });
          broadcast({ event: 'projects.update', data: { taskId: task.id, task, message: `Task updated: ${task.title}` } });

          return { id, result: task };
        }

        case 'tasks.delete': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const tasks = loadTasks();
          const before = tasks.tasks.length;
          tasks.tasks = tasks.tasks.filter(t => t.id !== taskId);
          if (tasks.tasks.length === before) return { id, error: 'task not found' };
          saveTasks(tasks);
          activeTaskRuns.delete(taskId);
          appendTaskLog(taskId, 'rpc_delete', `Task #${taskId} deleted`);
          broadcast({ event: 'projects.update', data: { taskId, deleted: true, message: `Task deleted: #${taskId}` } });
          return { id, result: { deleted: true } };
        }

        case 'tasks.logs': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const limit = Number(params?.limit || 100);
          return { id, result: readTaskLogs(taskId, Math.min(Math.max(limit, 1), 500)) };
        }

        case 'tasks.start': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const mode = (params?.mode as 'plan' | 'execute') || 'execute';

          try {
            const started = await startTaskExecution(taskId, mode);
            return { id, result: started };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        // ── Research ──

        case 'research.add': {
          const topic = (params?.topic as string) || 'uncategorized';
          const title = (params?.title as string) || 'Untitled';
          const content = (params?.content as string) || '';
          const research = loadResearch();
          const now = new Date().toISOString();
          const item: ResearchItem = {
            id: nextResearchId(research),
            topic,
            title,
            filePath: '',
            status: 'active',
            sources: (params?.sources as string[]) || undefined,
            tags: (params?.tags as string[]) || undefined,
            createdAt: now,
            updatedAt: now,
          };
          item.filePath = writeResearchFile(item, content);
          research.items.push(item);
          saveResearch(research);
          broadcast({ event: 'research.update', data: {} });
          return { id, result: item };
        }

        case 'research.list': {
          const research = loadResearch();
          const withPreviews = research.items.map(item => {
            const raw = readResearchContent(item.filePath);
            // strip markdown headers/formatting for a clean preview
            const plain = raw.replace(/^#{1,6}\s+.*$/gm, '').replace(/[*_`~\[\]]/g, '').replace(/\n+/g, ' ').trim();
            return { ...item, preview: plain.slice(0, 200) };
          });
          return { id, result: withPreviews };
        }

        case 'research.read': {
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const research = loadResearch();
          const item = research.items.find(i => i.id === itemId);
          if (!item) return { id, error: 'item not found' };
          const content = readResearchContent(item.filePath);
          return { id, result: { ...item, content } };
        }

        case 'research.update': {
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const research = loadResearch();
          const item = research.items.find(i => i.id === itemId);
          if (!item) return { id, error: 'item not found' };
          if (params?.status !== undefined) item.status = params.status as ResearchItem['status'];
          if (params?.title !== undefined) item.title = params.title as string;
          if (params?.topic !== undefined) item.topic = params.topic as string;
          if (params?.sources !== undefined) item.sources = params.sources as string[];
          if (params?.tags !== undefined) item.tags = params.tags as string[];
          item.updatedAt = new Date().toISOString();
          // rewrite file if content or metadata changed
          const content = params?.content !== undefined
            ? params.content as string
            : readResearchContent(item.filePath);
          const oldPath = item.filePath;
          item.filePath = writeResearchFile(item, content);
          if (oldPath !== item.filePath && existsSync(oldPath)) {
            try { unlinkSync(oldPath); } catch {}
          }
          saveResearch(research);
          broadcast({ event: 'research.update', data: { message: `Research updated: ${item.title}` } });
          return { id, result: item };
        }

        case 'research.delete': {
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const research = loadResearch();
          const deleted = research.items.find(i => i.id === itemId);
          if (!deleted) return { id, error: 'item not found' };
          research.items = research.items.filter(i => i.id !== itemId);
          saveResearch(research);
          // clean up file
          try { if (existsSync(deleted.filePath)) unlinkSync(deleted.filePath); } catch {}
          broadcast({ event: 'research.update', data: { message: `Research deleted: ${deleted.title}` } });
          return { id, result: { deleted: true } };
        }

        // ── agents ─────────────────────────────────────────────────

        case 'agents.list': {
          const all = getAllAgents(config);
          const result = Object.entries(all).map(([name, def]) => ({
            name,
            ...def,
            builtIn: name in builtInAgents,
            modified: name in builtInAgents && name in config.agents,
          }));
          return { id, result };
        }

        case 'agents.get': {
          const name = params?.name as string;
          if (!name || typeof name !== 'string') return { id, error: 'name required' };
          const all = getAllAgents(config);
          const def = all[name];
          if (!def) return { id, error: `agent not found: ${name}` };
          return {
            id,
            result: {
              name,
              ...def,
              builtIn: name in builtInAgents,
              modified: name in builtInAgents && name in config.agents,
            },
          };
        }

        case 'agents.set': {
          const name = params?.name as string;
          if (!name || typeof name !== 'string') return { id, error: 'name required' };
          if (!/^[a-z0-9_-]+$/.test(name)) return { id, error: 'name must be lowercase alphanumeric, hyphens, or underscores' };
          if (name.length > 64) return { id, error: 'name must be 64 characters or fewer' };
          const description = params?.description as string;
          const prompt = params?.prompt as string;
          if (typeof description !== 'string' || !description) return { id, error: 'description required' };
          if (typeof prompt !== 'string' || !prompt) return { id, error: 'prompt required' };
          const validModels = ['sonnet', 'opus', 'haiku', 'inherit'];
          if (params?.model !== undefined && (typeof params.model !== 'string' || !validModels.includes(params.model))) {
            return { id, error: `model must be one of: ${validModels.join(', ')}` };
          }
          if (params?.tools !== undefined && (!Array.isArray(params.tools) || !params.tools.every((t: unknown) => typeof t === 'string'))) {
            return { id, error: 'tools must be an array of strings' };
          }
          if (params?.skills !== undefined && (!Array.isArray(params.skills) || !params.skills.every((s: unknown) => typeof s === 'string'))) {
            return { id, error: 'skills must be an array of strings' };
          }
          const def: import('../config.js').AgentDefinition = { description, prompt };
          if (params?.tools) def.tools = params.tools as string[];
          if (params?.skills) def.skills = params.skills as string[];
          if (params?.model) def.model = params.model as typeof def.model;
          config.agents[name] = def;
          saveConfig(config);
          broadcast({ event: 'agents.update', data: { name } });
          return { id, result: { name, ...def, builtIn: name in builtInAgents, modified: true } };
        }

        case 'agents.delete': {
          const name = params?.name as string;
          if (!name || typeof name !== 'string') return { id, error: 'name required' };
          if (name in builtInAgents && !(name in config.agents)) {
            return { id, error: 'cannot delete built-in agent' };
          }
          delete config.agents[name];
          saveConfig(config);
          broadcast({ event: 'agents.update', data: { name } });
          return { id, result: { deleted: true } };
        }

        case 'agents.reset': {
          const name = params?.name as string;
          if (!name || typeof name !== 'string') return { id, error: 'name required' };
          if (!(name in builtInAgents)) return { id, error: 'not a built-in agent' };
          const def = builtInAgents[name];
          if (!(name in config.agents)) {
            return { id, result: { name, ...def, builtIn: true, modified: false } };
          }
          delete config.agents[name];
          saveConfig(config);
          broadcast({ event: 'agents.update', data: { name } });
          return { id, result: { name, ...def, builtIn: true, modified: false } };
        }

        case 'skills.list': {
          const userSkillsDir = SKILLS_DIR;
          const allSkills = loadAllSkills(config);
          const result = allSkills.map(skill => ({
            name: skill.name,
            description: skill.description,
            path: skill.path,
            dir: skill.dir,
            userInvocable: skill.userInvocable,
            metadata: skill.metadata,
            eligibility: checkSkillEligibility(skill, config),
            builtIn: !skill.path.startsWith(userSkillsDir),
            files: skill.files,
          }));
          return { id, result };
        }

        case 'skills.read': {
          const name = params?.name as string;
          if (!name) return { id, error: 'name required' };
          const skill = findSkillByName(name, config);
          if (!skill) return { id, error: `skill not found: ${name}` };
          try {
            const raw = readFileSync(skill.path, 'utf-8');
            return { id, result: { name: skill.name, path: skill.path, dir: skill.dir, raw, files: skill.files } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'skills.readFile': {
          const name = params?.name as string;
          const filePath = params?.filePath as string;
          if (!name) return { id, error: 'name required' };
          if (!filePath) return { id, error: 'filePath required' };
          if (filePath.includes('..') || filePath.startsWith('/')) {
            return { id, error: 'invalid file path' };
          }
          const skill = findSkillByName(name, config);
          if (!skill) return { id, error: `skill not found: ${name}` };
          const fullPath = join(skill.dir, filePath);
          if (!existsSync(fullPath)) return { id, error: `file not found: ${filePath}` };
          // resolve symlinks and verify path stays within skill dir
          try {
            const resolved = realpathSync(fullPath);
            const skillDirReal = realpathSync(skill.dir);
            if (!resolved.startsWith(skillDirReal + sep)) {
              return { id, error: 'invalid file path' };
            }
            const content = readFileSync(resolved, 'utf-8');
            return { id, result: { name, filePath, content } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'skills.create': {
          const name = params?.name as string;
          const description = params?.description as string || '';
          const content = params?.content as string || '';
          const userInvocable = params?.userInvocable !== false;
          const metadata = params?.metadata as Record<string, unknown> | undefined;

          if (!name) return { id, error: 'name required' };
          if (/[\/\\]/.test(name)) return { id, error: 'name cannot contain slashes' };

          const skillDir = join(SKILLS_DIR, name);
          const skillPath = join(skillDir, 'SKILL.md');

          // build frontmatter
          const fm: Record<string, unknown> = { name, description };
          if (!userInvocable) fm['user-invocable'] = false;
          if (metadata?.requires) fm.metadata = { requires: metadata.requires };

          const yamlLines = ['---'];
          yamlLines.push(`name: "${(fm.name as string).replace(/"/g, '\\"')}"`);
          yamlLines.push(`description: "${(fm.description as string).replace(/"/g, '\\"')}"`);
          if (fm['user-invocable'] === false) yamlLines.push('user-invocable: false');
          if (fm.metadata) {
            const req = (fm.metadata as any).requires;
            if (req) {
              yamlLines.push('metadata:');
              yamlLines.push('  requires:');
              if (req.bins?.length) yamlLines.push(`    bins: [${req.bins.map((b: string) => `'${b}'`).join(', ')}]`);
              if (req.env?.length) yamlLines.push(`    env: [${req.env.map((e: string) => `'${e}'`).join(', ')}]`);
            }
          }
          yamlLines.push('---');
          yamlLines.push('');

          const fileContent = yamlLines.join('\n') + content;

          try {
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(skillPath, fileContent, 'utf-8');
            return { id, result: { name, path: skillPath } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'skills.install': {
          const repo = params?.repo as string;
          const skillPath = params?.skillPath as string;
          const skillName = (params?.name as string) || skillPath?.split('/').pop();
          if (!repo) return { id, error: 'repo required' };
          if (!skillPath) return { id, error: 'skillPath required' };
          if (!skillName) return { id, error: 'could not determine skill name' };

          // validate repo format (owner/name) and skillPath (no traversal)
          if (!/^[\w.\-]+\/[\w.\-]+$/.test(repo)) {
            return { id, error: 'invalid repo format, expected owner/repo' };
          }
          if (skillPath.includes('..')) {
            return { id, error: 'invalid skill path' };
          }
          if (!/^[a-zA-Z0-9_\-]+$/.test(skillName)) {
            return { id, error: 'invalid skill name' };
          }

          const installDir = join(SKILLS_DIR, skillName);
          if (existsSync(installDir)) {
            return { id, error: `skill "${skillName}" already installed` };
          }

          const tmp = join(tmpdir(), `dorabot-skill-${Date.now()}`);
          const tarPath = tmp + '.tar.gz';
          const extractDir = tmp + '-extract';

          try {
            // Download repo tarball (single HTTP request, no API rate limits, no auth)
            const tarUrl = `https://github.com/${repo}/archive/HEAD.tar.gz`;
            const res = await fetch(tarUrl, { redirect: 'follow' });
            if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);

            await pipeline(res.body as any, createWriteStream(tarPath));

            // Extract tarball using system tar (always available on macOS)
            mkdirSync(extractDir, { recursive: true });
            execFileSync('tar', ['xzf', tarPath, '-C', extractDir], { timeout: 30_000 });

            // Find extracted root dir (format: repo-name-{sha}/)
            const roots = readdirSync(extractDir);
            if (roots.length !== 1) throw new Error('unexpected tarball structure');
            const srcDir = join(extractDir, roots[0], skillPath);

            if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
              throw new Error(`skill path not found in repo: ${skillPath}`);
            }

            // Verify SKILL.md exists
            if (!existsSync(join(srcDir, 'SKILL.md'))) {
              throw new Error(`no SKILL.md found in ${skillPath}`);
            }

            // Copy skill directory to install location
            mkdirSync(SKILLS_DIR, { recursive: true });
            cpSync(srcDir, installDir, { recursive: true });

            const skill = findSkillByName(skillName, config);
            return { id, result: { name: skillName, installed: true, path: installDir, skill } };
          } catch (err) {
            if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
            return { id, error: err instanceof Error ? err.message : String(err) };
          } finally {
            // cleanup temp files
            if (existsSync(tarPath)) rmSync(tarPath, { force: true });
            if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
          }
        }

        case 'skills.delete': {
          const name = params?.name as string;
          if (!name) return { id, error: 'name required' };

          const skill = findSkillByName(name, config);
          if (!skill) return { id, error: `skill not found: ${name}` };

          const userSkillsDir = SKILLS_DIR + sep;
          if (!skill.path.startsWith(userSkillsDir)) {
            return { id, error: 'cannot delete built-in skills' };
          }

          try {
            const skillDir = join(SKILLS_DIR, name);
            rmSync(skillDir, { recursive: true, force: true });
            return { id, result: { deleted: name } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        // ── provider RPCs ─────────────────────────────────────────
        case 'provider.detect': {
          const [claudeInstalled, codexInstalled, claudeOAuth, codexAuth, apiKey] =
            await Promise.all([
              isClaudeInstalled(),
              isCodexInstalled(),
              Promise.resolve(hasOAuthTokens()),
              Promise.resolve(hasCodexAuth()),
              Promise.resolve(!!getClaudeApiKey()),
            ]);

          return { id, result: {
            claude: { installed: claudeInstalled, hasOAuth: claudeOAuth, hasApiKey: apiKey },
            codex: { installed: codexInstalled, hasAuth: codexAuth },
          }};
        }

        case 'provider.get': {
          try {
            const provider = await getProvider(config);
            const authStatus = await provider.getAuthStatus();
            return { id, result: { name: config.provider.name, auth: authStatus } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.set': {
          const name = params?.name as ProviderName;
          if (!name || !['claude', 'codex'].includes(name)) {
            return { id, error: 'name must be "claude" or "codex"' };
          }
          config.provider.name = name;
          saveConfig(config);
          broadcast({ event: 'config.update', data: { key: 'provider', value: config.provider } });
          return { id, result: { provider: name } };
        }

        case 'provider.auth.method': {
          const authGate = await getProviderAuthGate(((params?.provider as string) || config.provider.name || 'claude') as ProviderName);
          return { id, result: {
            method: authGate.method,
            expired: authGate.expired,
          } };
        }

        case 'provider.auth.status': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const p = await getProviderByName(providerName);
            return { id, result: await p.getAuthStatus() };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.auth.apiKey': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const apiKey = params?.apiKey as string;
            if (!apiKey) return { id, error: 'apiKey required' };
            const p = await getProviderByName(providerName);
            const status = await p.loginWithApiKey(apiKey);
            broadcast({ event: 'provider.auth_complete', data: { provider: providerName, status } });
            return { id, result: status };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.auth.oauth': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const p = await getProviderByName(providerName);
            if (!p.loginWithOAuth) {
              return { id, error: `${providerName} doesn't support OAuth` };
            }
            const { authUrl, loginId } = await p.loginWithOAuth();
            broadcast({ event: 'provider.oauth_url', data: { provider: providerName, authUrl, loginId } });
            return { id, result: { authUrl, loginId } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.auth.oauth.complete': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const loginId = params?.loginId as string;
            const p = await getProviderByName(providerName);
            if (!p.completeOAuthLogin) {
              return { id, error: `${providerName} doesn't support OAuth` };
            }
            const status = await p.completeOAuthLogin(loginId);
            broadcast({ event: 'provider.auth_complete', data: { provider: providerName, status } });
            return { id, result: status };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.check': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const p = await getProviderByName(providerName);
            return { id, result: await p.checkReady() };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        // ── config RPCs ──────────────────────────────────────────
        case 'config.get': {
          const safe = structuredClone(config);
          if (safe.channels?.telegram) {
            delete (safe.channels.telegram as any).botToken;
          }
          return { id, result: safe };
        }

        case 'config.set': {
          const key = params?.key as string;
          const value = params?.value;
          if (!key) return { id, error: 'key required' };
          if (key === 'model' && typeof value === 'string') {
            config.model = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { model: value } };
          }

          if (key === 'permissionMode' && typeof value === 'string') {
            const valid = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'delegate'];
            if (!valid.includes(value)) return { id, error: `permissionMode must be one of: ${valid.join(', ')}` };
            config.permissionMode = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'security.approvalMode' && typeof value === 'string') {
            const valid = ['approve-sensitive', 'autonomous', 'lockdown'];
            if (!valid.includes(value)) return { id, error: `approvalMode must be one of: ${valid.join(', ')}` };
            if (!config.security) config.security = {};
            config.security.approvalMode = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'autonomy' && typeof value === 'string') {
            const valid = ['supervised', 'autonomous'];
            if (!valid.includes(value)) return { id, error: `autonomy must be one of: ${valid.join(', ')}` };
            config.autonomy = value as any;

            // sync permissionMode to match
            if (value === 'autonomous') {
              config.permissionMode = 'bypassPermissions';
              if (!config.security) config.security = {};
              config.security.approvalMode = 'autonomous';
            } else {
              config.permissionMode = 'default';
              if (!config.security) config.security = {};
              config.security.approvalMode = 'approve-sensitive';
            }

            // manage autonomous schedule
            if (scheduler) {
              const existing = scheduler.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
              if (value === 'autonomous' && !existing) {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const item = buildAutonomousCalendarItem(tz);
                scheduler.addItem({ ...item, id: AUTONOMOUS_SCHEDULE_ID });
                console.log('[gateway] created autonomy pulse schedule');
              } else if (value === 'autonomous' && existing) {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const desired = buildAutonomousCalendarItem(tz);
                scheduler.updateItem(AUTONOMOUS_SCHEDULE_ID, {
                  summary: desired.summary,
                  description: desired.description,
                  message: desired.message,
                  timezone: desired.timezone,
                  enabled: true,
                });
                console.log('[gateway] refreshed autonomy pulse schedule');
              } else if (value === 'supervised' && existing) {
                scheduler.removeItem(AUTONOMOUS_SCHEDULE_ID);
                console.log('[gateway] removed autonomy pulse schedule');
              }
            }

            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          // provider config keys
          if (key === 'provider.name' && typeof value === 'string') {
            if (!['claude', 'codex', 'minimax'].includes(value)) {
              return { id, error: 'provider.name must be "claude", "codex", or "minimax"' };
            }
            config.provider.name = value as ProviderName;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'reasoningEffort') {
            const valid = ['minimal', 'low', 'medium', 'high', 'max', null];
            if (value !== null && !valid.includes(value as string)) {
              return { id, error: `reasoningEffort must be one of: ${valid.filter(Boolean).join(', ')} (or null to clear)` };
            }
            config.reasoningEffort = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'thinking') {
            // value: 'adaptive' | 'disabled' | null | { type: 'enabled', budgetTokens: number }
            if (value === null || value === undefined) {
              config.thinking = undefined;
            } else if (value === 'adaptive' || value === 'disabled') {
              config.thinking = value;
            } else if (typeof value === 'object' && (value as any).type === 'enabled' && typeof (value as any).budgetTokens === 'number') {
              config.thinking = value as any;
            } else {
              return { id, error: 'thinking must be "adaptive", "disabled", null, or { type: "enabled", budgetTokens: number }' };
            }
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'maxBudgetUsd') {
            if (value === null || value === undefined) {
              config.maxBudgetUsd = undefined;
            } else if (typeof value === 'number' && value > 0) {
              config.maxBudgetUsd = value;
            } else {
              return { id, error: 'maxBudgetUsd must be a positive number or null to clear' };
            }
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.model' && typeof value === 'string') {
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.model = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.approvalPolicy' && typeof value === 'string') {
            const valid = ['never', 'on-request', 'on-failure', 'untrusted'];
            if (!valid.includes(value)) return { id, error: `approvalPolicy must be one of: ${valid.join(', ')}` };
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.approvalPolicy = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.sandboxMode' && typeof value === 'string') {
            const valid = ['read-only', 'workspace-write', 'danger-full-access'];
            if (!valid.includes(value)) return { id, error: `sandboxMode must be one of: ${valid.join(', ')}` };
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.sandboxMode = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.networkAccess' && typeof value === 'boolean') {
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.networkAccess = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.webSearch' && typeof value === 'string') {
            const valid = ['disabled', 'cached', 'live'];
            if (!valid.includes(value)) return { id, error: `webSearch must be one of: ${valid.join(', ')}` };
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.webSearch = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.mcpOauthCredentialsStore' && typeof value === 'string') {
            const valid = ['auto', 'file', 'keyring'];
            if (!valid.includes(value)) return { id, error: `mcpOauthCredentialsStore must be one of: ${valid.join(', ')}` };
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.mcpOauthCredentialsStore = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'browser.enabled' && typeof value === 'boolean') {
            if (!config.browser) config.browser = {};
            config.browser.enabled = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'browser.headless' && typeof value === 'boolean') {
            if (!config.browser) config.browser = {};
            config.browser.headless = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          // channel policy keys: channels.<channel>.dmPolicy / groupPolicy
          const policyMatch = key.match(/^channels\.(telegram|whatsapp)\.(dmPolicy|groupPolicy)$/);
          if (policyMatch) {
            const ch = policyMatch[1] as 'telegram' | 'whatsapp';
            const field = policyMatch[2] as 'dmPolicy' | 'groupPolicy';
            if (field === 'dmPolicy' && value !== 'open' && value !== 'allowlist') {
              return { id, error: 'dmPolicy must be open or allowlist' };
            }
            if (field === 'groupPolicy' && value !== 'open' && value !== 'allowlist' && value !== 'disabled') {
              return { id, error: 'groupPolicy must be open, allowlist, or disabled' };
            }
            if (!config.channels) config.channels = {};
            if (!config.channels[ch]) config.channels[ch] = {};
            (config.channels[ch] as any)[field] = value;
            saveConfig(config);
            return { id, result: { key, value } };
          }

          // sandbox settings
          const sandboxMatch = key.match(/^sandbox\.(mode|scope|workspaceAccess|enabled)$/);
          if (sandboxMatch) {
            const field = sandboxMatch[1];
            if (field === 'mode') {
              const valid = ['off', 'non-main', 'all'];
              if (!valid.includes(value as string)) return { id, error: `sandbox.mode must be one of: ${valid.join(', ')}` };
              config.sandbox.mode = value as any;
            } else if (field === 'scope') {
              const valid = ['session', 'agent', 'shared'];
              if (!valid.includes(value as string)) return { id, error: `sandbox.scope must be one of: ${valid.join(', ')}` };
              config.sandbox.scope = value as any;
            } else if (field === 'workspaceAccess') {
              const valid = ['none', 'ro', 'rw'];
              if (!valid.includes(value as string)) return { id, error: `sandbox.workspaceAccess must be one of: ${valid.join(', ')}` };
              config.sandbox.workspaceAccess = value as any;
            } else if (field === 'enabled') {
              config.sandbox.enabled = !!value;
            }
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'sandbox.network.enabled' && typeof value === 'boolean') {
            if (!config.sandbox.network) config.sandbox.network = {};
            config.sandbox.network.enabled = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'userName' && typeof value === 'string') {
            config.userName = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'userTimezone' && typeof value === 'string') {
            config.userTimezone = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'betas') {
            if (value === null || value === undefined) {
              config.betas = undefined;
            } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
              config.betas = value as string[];
            } else {
              return { id, error: 'betas must be a string array or null' };
            }
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'settingSources') {
            if (value === null || value === undefined) {
              config.settingSources = undefined;
            } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
              config.settingSources = value as string[];
            } else {
              return { id, error: 'settingSources must be a string array or null' };
            }
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'agentProgressSummaries' && typeof value === 'boolean') {
            config.agentProgressSummaries = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          return { id, error: `unsupported config key: ${key}` };
        }

        case 'fs.list': {
          const dirPath = params?.path as string;
          if (!dirPath) return { id, error: 'path required' };
          const resolved = resolve(dirPath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            const entries = readdirSync(resolved, { withFileTypes: true });
            const items = entries.map(e => ({
              name: e.name,
              type: (e.isDirectory() ? 'directory' : 'file') as 'directory' | 'file',
              size: e.isFile() ? (() => { try { return statSync(join(resolved, e.name)).size; } catch { return 0; } })() : undefined,
            }));
            items.sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            return { id, result: items };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.read': {
          const filePath = params?.path as string;
          if (!filePath) return { id, error: 'path required' };
          const resolved = resolve(filePath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            const content = readFileSync(resolved, 'utf-8');
            return { id, result: { content, path: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.readBinary': {
          const filePath = params?.path as string;
          if (!filePath) return { id, error: 'path required' };
          const resolved = resolve(filePath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            const buffer = readFileSync(resolved);
            const base64 = buffer.toString('base64');
            return { id, result: { content: base64, path: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.write': {
          const filePath = params?.path as string;
          const content = params?.content as string;
          if (!filePath) return { id, error: 'path required' };
          if (typeof content !== 'string') return { id, error: 'content required' };
          const resolved = resolve(filePath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            writeFileSync(resolved, content, 'utf-8');
            return { id, result: { path: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.mkdir': {
          const dirPath = params?.path as string;
          if (!dirPath) return { id, error: 'path required' };
          const resolved = resolve(dirPath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            mkdirSync(resolved, { recursive: true });
            return { id, result: { created: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.delete': {
          const targetPath = params?.path as string;
          if (!targetPath) return { id, error: 'path required' };
          const resolved = resolve(targetPath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            rmSync(resolved, { recursive: true, force: true });
            return { id, result: { deleted: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.rename': {
          const oldPath = params?.oldPath as string;
          const newPath = params?.newPath as string;
          if (!oldPath || !newPath) return { id, error: 'oldPath and newPath required' };
          const resolvedOld = resolve(oldPath);
          const resolvedNew = resolve(newPath);
          if (!isPathAllowed(resolvedOld, config) || !isPathAllowed(resolvedNew, config)) {
            return { id, error: `path not allowed` };
          }
          try {
            renameSync(resolvedOld, resolvedNew);
            return { id, result: { oldPath: resolvedOld, newPath: resolvedNew } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.reveal': {
          const filePath = params?.path as string;
          if (!filePath) return { id, error: 'path required' };
          const resolved = resolve(filePath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: 'path not allowed' };
          }
          try {
            const { execFile } = await import('node:child_process');
            execFile('open', ['-R', resolved]);
            return { id, result: { revealed: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.stat': {
          const filePath = params?.path as string;
          if (!filePath) return { id, error: 'path required' };
          const resolved = resolve(filePath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            const st = statSync(resolved);
            return { id, result: { size: st.size, mtime: st.mtimeMs, isFile: st.isFile(), isDirectory: st.isDirectory() } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.watch.start': {
          const watchPath = params?.path as string;
          if (!watchPath) return { id, error: 'path required' };
          const resolvedWatch = resolve(watchPath);
          if (!isPathAllowed(resolvedWatch, config)) {
            return { id, error: `path not allowed: ${resolvedWatch}` };
          }
          const tracked = clientWs ? watchedPathsByClient.get(clientWs) : undefined;
          if (!tracked?.has(resolvedWatch)) {
            startWatching(resolvedWatch);
            tracked?.add(resolvedWatch);
          }
          return { id, result: { watching: resolvedWatch } };
        }

        case 'fs.watch.stop': {
          const watchPath = params?.path as string;
          if (!watchPath) return { id, error: 'path required' };
          const resolvedWatch = resolve(watchPath);
          stopWatching(resolvedWatch);
          const tracked = clientWs ? watchedPathsByClient.get(clientWs) : undefined;
          tracked?.delete(resolvedWatch);
          return { id, result: { stopped: resolvedWatch } };
        }

        case 'git.detect': {
          // Walk up from path to find nearest .git directory
          const detectPath = params?.path as string;
          if (!detectPath) return { id, error: 'path required' };
          let dir = resolve(detectPath);
          if (!isPathAllowed(dir, config)) {
            return { id, error: `path not allowed: ${dir}` };
          }
          while (dir !== '/' && dir !== '.') {
            try {
              const gitDir = join(dir, '.git');
              const st = statSync(gitDir);
              if (st.isDirectory()) return { id, result: { root: dir } };
            } catch { /* not found, keep walking */ }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
          }
          return { id, result: { root: null } };
        }

        case 'git.status': {
          // Get working tree changes + diff against origin
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            // Working tree status (staged + unstaged) using NUL-separated output
            const raw = execFileSync('git', ['status', '--porcelain', '-z', '-uall'], {
              cwd: resolved, encoding: 'utf-8', timeout: 5000,
            });
            const files: { path: string; status: string; staged: boolean }[] = [];
            if (raw) {
              const entries = raw.split('\0').filter(Boolean);
              let i = 0;
              while (i < entries.length) {
                const entry = entries[i];
                // Each entry: XY<space>path (min 4 chars: 2 status + space + 1 char path)
                if (entry.length < 4 || entry[2] !== ' ') { i++; continue; }
                const ix = entry[0];   // index (staged) status
                const wt = entry[1];   // worktree status
                const filePath = entry.substring(3);
                if (ix === '?' && wt === '?') {
                    files.push({ path: filePath, status: '?', staged: false });
                } else {
                  if (ix !== ' ' && ix !== '?') {
                    files.push({ path: filePath, status: ix, staged: true });
                  }
                  if (wt !== ' ' && wt !== '?') {
                    files.push({ path: filePath, status: wt, staged: false });
                  }
                }
                // Renames/copies have a second path entry (the original path)
                if (ix === 'R' || ix === 'C' || wt === 'R' || wt === 'C') i++;
                i++;
              }
            }
            // Current branch
            let branch = '';
            try {
              branch = execFileSync('git', ['branch', '--show-current'], {
                cwd: resolved, encoding: 'utf-8', timeout: 3000,
              }).trim();
            } catch { /* detached HEAD */ }
            // Ahead/behind upstream
            let ahead = 0, behind = 0;
            try {
              const revList = execFileSync('git', ['rev-list', '--count', '--left-right', 'HEAD...@{upstream}'], {
                cwd: resolved, encoding: 'utf-8', timeout: 3000,
              }).trim();
              const parts = revList.split('\t');
              ahead = parseInt(parts[0], 10) || 0;
              behind = parseInt(parts[1], 10) || 0;
            } catch { /* no upstream configured */ }
            return { id, result: { root: resolved, branch, files, ahead, behind } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.branches': {
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            const raw = execFileSync('git', [
              'branch', '-a', '--sort=-committerdate', '--no-color',
              '--format=%(refname:short)|%(committerdate:iso8601)|%(authorname)|%(HEAD)',
            ], {
              cwd: resolved, encoding: 'utf-8', timeout: 5000,
            }).trim();
            const userName = execFileSync('git', ['config', 'user.name'], {
              cwd: resolved, encoding: 'utf-8', timeout: 2000,
            }).trim();
            const branches: { name: string; current: boolean; remote: boolean; lastCommitDate: string; author: string; isMine: boolean }[] = [];
            if (raw) {
              for (const line of raw.split('\n')) {
                const parts = line.split('|');
                if (parts.length < 4) continue;
                const rawName = parts[0].trim();
                const date = parts[1].trim();
                const author = parts[2].trim();
                const head = parts[3].trim();
                if (rawName.includes(' -> ')) continue;
                const remote = rawName.startsWith('origin/');
                const name = remote ? rawName : rawName;
                branches.push({
                  name,
                  current: head === '*',
                  remote,
                  lastCommitDate: date,
                  author,
                  isMine: author === userName,
                });
              }
            }
            return { id, result: { branches } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.checkout': {
          const repoRoot = params?.path as string;
          const branch = params?.branch as string;
          const create = params?.create as boolean;
          if (!repoRoot || !branch) return { id, error: 'path and branch required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            // Create new branch
            if (create) {
              execFileSync('git', ['checkout', '-b', branch], {
                cwd: resolved, encoding: 'utf-8', timeout: 10000,
              });
              return { id, result: { switched: branch, created: true } };
            }
            // For remote branches like origin/foo, try to create local tracking branch
            if (branch.includes('/')) {
              const parts = branch.split('/');
              const localName = parts.slice(1).join('/');
              try {
                execFileSync('git', ['checkout', '-b', localName, '--track', branch], {
                  cwd: resolved, encoding: 'utf-8', timeout: 10000,
                });
                return { id, result: { switched: localName } };
              } catch {
                // Local branch might already exist, try plain checkout
                execFileSync('git', ['checkout', localName], {
                  cwd: resolved, encoding: 'utf-8', timeout: 10000,
                });
                return { id, result: { switched: localName } };
              }
            }
            execFileSync('git', ['checkout', branch], {
              cwd: resolved, encoding: 'utf-8', timeout: 10000,
            });
            return { id, result: { switched: branch } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.fetch': {
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            execFileSync('git', ['fetch', '--all', '--prune'], {
              cwd: resolved, encoding: 'utf-8', timeout: 30000,
            });
            return { id, result: { fetched: true } };
          } catch (err: any) {
            const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
            const msg = stderr || (err instanceof Error ? err.message : String(err));
            return { id, error: msg };
          }
        }

        case 'git.pull': {
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            const output = execFileSync('git', ['pull'], {
              cwd: resolved, encoding: 'utf-8', timeout: 30000,
            }).trim();
            return { id, result: { output } };
          } catch (err: any) {
            const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
            const msg = stderr || (err instanceof Error ? err.message : String(err));
            return { id, error: msg };
          }
        }

        case 'git.push': {
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            const output = execFileSync('git', ['push'], {
              cwd: resolved, encoding: 'utf-8', timeout: 30000,
            }).trim();
            return { id, result: { output } };
          } catch (err: any) {
            const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
            const msg = stderr || (err instanceof Error ? err.message : String(err));
            return { id, error: msg };
          }
        }

        case 'git.showFile': {
          const repoRoot = params?.path as string;
          const filePath = params?.file as string;
          const ref = (params?.ref as string) || 'HEAD';
          const binary = params?.binary as boolean;
          if (!repoRoot || !filePath) return { id, error: 'path and file required' };
          // Validate ref is safe (alphanumeric, /, -, _, ~, ^, .)
          if (!/^[a-zA-Z0-9/_\-.~^]+$/.test(ref)) return { id, error: 'invalid ref' };
          const resolved = resolve(repoRoot);
          // Validate file path stays within repo
          if (!pathResolve(resolved, filePath).startsWith(resolved)) return { id, error: 'path traversal not allowed' };
          try {
            const { execFileSync } = await import('node:child_process');
            if (binary) {
              const buf = execFileSync('git', ['show', `${ref}:${filePath}`], {
                cwd: resolved, timeout: 5000, maxBuffer: 10 * 1024 * 1024,
              });
              return { id, result: { content: buf.toString('base64'), encoding: 'base64' } };
            }
            const content = execFileSync('git', ['show', `${ref}:${filePath}`], {
              cwd: resolved, encoding: 'utf-8', timeout: 5000,
            });
            return { id, result: { content } };
          } catch {
            // File doesn't exist in that ref (new file)
            return { id, result: { content: '' } };
          }
        }

        case 'git.stageFile': {
          const repoRoot = params?.path as string;
          const filePath = params?.file as string;
          if (!repoRoot || !filePath) return { id, error: 'path and file required' };
          const resolved = resolve(repoRoot);
          if (!pathResolve(resolved, filePath).startsWith(resolved)) return { id, error: 'path traversal not allowed' };
          try {
            const { execFileSync } = await import('node:child_process');
            execFileSync('git', ['add', filePath], {
              cwd: resolved, encoding: 'utf-8', timeout: 5000,
            });
            return { id, result: { staged: filePath } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.unstageFile': {
          const repoRoot = params?.path as string;
          const filePath = params?.file as string;
          if (!repoRoot || !filePath) return { id, error: 'path and file required' };
          const resolved = resolve(repoRoot);
          if (!pathResolve(resolved, filePath).startsWith(resolved)) return { id, error: 'path traversal not allowed' };
          try {
            const { execFileSync } = await import('node:child_process');
            execFileSync('git', ['reset', 'HEAD', '--', filePath], {
              cwd: resolved, encoding: 'utf-8', timeout: 5000,
            });
            return { id, result: { unstaged: filePath } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.discardFile': {
          const repoRoot = params?.path as string;
          const filePath = params?.file as string;
          if (!repoRoot || !filePath) return { id, error: 'path and file required' };
          const resolved = resolve(repoRoot);
          if (!pathResolve(resolved, filePath).startsWith(resolved)) return { id, error: 'path traversal not allowed' };
          try {
            const { execFileSync } = await import('node:child_process');
            // Check if the file is untracked
            const status = execFileSync('git', ['status', '--porcelain', '--', filePath], {
              cwd: resolved, encoding: 'utf-8', timeout: 5000,
            }).trim();
            if (status.startsWith('??')) {
              // Untracked: remove the file
              unlinkSync(pathResolve(resolved, filePath));
            } else {
              // Tracked: restore from HEAD
              execFileSync('git', ['checkout', 'HEAD', '--', filePath], {
                cwd: resolved, encoding: 'utf-8', timeout: 5000,
              });
            }
            return { id, result: { discarded: filePath } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.stageAll': {
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            execFileSync('git', ['add', '-A'], {
              cwd: resolved, encoding: 'utf-8', timeout: 10000,
            });
            return { id, result: { staged: 'all' } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.unstageAll': {
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            execFileSync('git', ['reset', 'HEAD'], {
              cwd: resolved, encoding: 'utf-8', timeout: 10000,
            });
            return { id, result: { unstaged: 'all' } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.commit': {
          const repoRoot = params?.path as string;
          const message = params?.message as string;
          if (!repoRoot || !message) return { id, error: 'path and message required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            const output = execFileSync('git', ['commit', '-m', message], {
              cwd: resolved, encoding: 'utf-8', timeout: 10000,
            }).trim();
            return { id, result: { output } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.log': {
          const repoRoot = params?.path as string;
          const rawCount = Number(params?.count) || 20;
          const count = Math.max(1, Math.min(200, Math.floor(rawCount)));
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            const raw = execFileSync('git', [
              'log', `--max-count=${count}`,
              '--format=%H%x00%h%x00%s%x00%an%x00%aI',
            ], { cwd: resolved, encoding: 'utf-8', timeout: 5000 }).trim();
            const commits = raw ? raw.split('\n').map(line => {
              const [hash, short, subject, author, date] = line.split('\0');
              return { hash, short, subject, author, date };
            }) : [];
            return { id, result: { commits } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.diff': {
          const repoRoot = params?.path as string;
          const filePath = params?.file as string;
          const staged = params?.staged as boolean;
          if (!repoRoot || !filePath) return { id, error: 'path and file required' };
          const resolved = resolve(repoRoot);
          if (!pathResolve(resolved, filePath).startsWith(resolved)) return { id, error: 'path traversal not allowed' };
          try {
            const { execFileSync } = await import('node:child_process');
            const args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath];
            const output = execFileSync('git', args, {
              cwd: resolved, encoding: 'utf-8', timeout: 5000,
            });
            return { id, result: { diff: output } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.worktrees': {
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            const raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
              cwd: resolved, encoding: 'utf-8', timeout: 5000,
            });
            const worktrees: { path: string; branch: string; head: string; bare: boolean; isMain: boolean;
              clean: boolean; staged: number; changed: number; untracked: number; ahead: number; behind: number; lastCommit: string;
            }[] = [];
            // Parse porcelain output: blocks separated by blank lines
            const blocks = raw.split('\n\n').filter(Boolean);
            // First block is the main worktree
            for (let bi = 0; bi < blocks.length; bi++) {
              const lines = blocks[bi].split('\n').filter(Boolean);
              let wtPath = '';
              let head = '';
              let branch = '';
              let bare = false;
              let prunable = false;
              for (const line of lines) {
                if (line.startsWith('worktree ')) wtPath = line.slice(9);
                else if (line.startsWith('HEAD ')) head = line.slice(5);
                else if (line.startsWith('branch ')) branch = line.slice(7).replace(/^refs\/heads\//, '');
                else if (line === 'bare') bare = true;
                else if (line === 'detached') branch = '(detached)';
                else if (line.startsWith('prunable')) prunable = true;
              }
              if (!wtPath || bare || prunable) continue;
              // Get stats for each worktree
              try {
                const stats = getWorktreeStats(wtPath);
                worktrees.push({
                  path: wtPath, branch: branch || stats.branch, head, bare, isMain: bi === 0,
                  clean: stats.clean, staged: stats.staged, changed: stats.changed,
                  untracked: stats.untracked, ahead: stats.ahead, behind: stats.behind, lastCommit: stats.lastCommit,
                });
              } catch {
                worktrees.push({
                  path: wtPath, branch, head, bare, isMain: bi === 0,
                  clean: true, staged: 0, changed: 0, untracked: 0, ahead: 0, behind: 0, lastCommit: '',
                });
              }
            }
            return { id, result: { worktrees } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.worktreeRemove': {
          const repoRoot = params?.path as string;
          const worktreePath = params?.worktreePath as string;
          const branch = params?.branch as string | undefined;
          const removeBranch = params?.removeBranch as boolean | undefined;
          if (!repoRoot || !worktreePath) return { id, error: 'path and worktreePath required' };
          const resolvedRepo = resolve(repoRoot);
          const resolvedWt = resolve(worktreePath);
          // Path containment: worktree path must be under the repo or the well-known worktrees dir
          if (!resolvedWt.startsWith(resolvedRepo + '/') && !resolvedWt.includes('/.dorabot/worktrees/')) {
            return { id, error: 'worktree path must be within repo or ~/.dorabot/worktrees/' };
          }
          // Branch name validation: reject anything starting with '-' to prevent git flag injection
          if (branch && branch.startsWith('-')) {
            return { id, error: 'invalid branch name' };
          }
          try {
            const result = removeWorktree({ cwd: resolvedRepo, worktreePath: resolvedWt, branch, removeBranch: removeBranch ?? false });
            return { id, result };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.prs': {
          const repoRoot = params?.path as string;
          if (!repoRoot) return { id, error: 'path required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            const raw = execFileSync('gh', [
              'pr', 'list', '--state', 'open', '--author', '@me',
              '--json', 'number,title,headRefName,baseRefName,state,isDraft,additions,deletions,changedFiles,url,createdAt,updatedAt',
              '--limit', '20',
            ], { cwd: resolved, encoding: 'utf-8', timeout: 15000 });
            const prs = JSON.parse(raw || '[]');
            if (!Array.isArray(prs)) return { id, error: 'unexpected gh output' };
            return { id, result: { prs } };
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              return { id, result: { prs: [], ghMissing: true } };
            }
            const msg = err instanceof Error ? err.message : String(err);
            // gh auth or connectivity issues: return empty with a hint rather than a raw error
            if (msg.includes('auth') || msg.includes('login') || msg.includes('token')) {
              return { id, result: { prs: [], ghAuthError: true } };
            }
            return { id, error: msg };
          }
        }

        case 'git.prDiff': {
          const repoRoot = params?.path as string;
          const prNumber = Number(params?.number);
          if (!repoRoot || !Number.isInteger(prNumber) || prNumber <= 0) return { id, error: 'path and a positive integer number required' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            const statRaw = execFileSync('gh', [
              'pr', 'view', String(prNumber),
              '--json', 'files',
            ], { cwd: resolved, encoding: 'utf-8', timeout: 15000 });
            const statData = JSON.parse(statRaw || '{}');
            const rawFiles = Array.isArray(statData.files) ? statData.files : [];
            const files = rawFiles.map((f: { path: string; additions: number; deletions: number }) => ({
              path: f.path,
              additions: f.additions || 0,
              deletions: f.deletions || 0,
            }));
            return { id, result: { files } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'git.branchCompare': {
          const repoRoot = params?.path as string;
          const base = params?.base as string;
          const compare = params?.compare as string;
          if (!repoRoot || !base || !compare) return { id, error: 'path, base, and compare required' };
          // Allowlist branch name characters (matches git.showFile ref validation)
          const branchRe = /^[a-zA-Z0-9/_\-.~^]+$/;
          if (!branchRe.test(base) || !branchRe.test(compare)) return { id, error: 'invalid branch name' };
          if (base.includes('..') || compare.includes('..')) return { id, error: 'invalid branch name' };
          const resolved = resolve(repoRoot);
          try {
            const { execFileSync } = await import('node:child_process');
            // Get file-level diff stats
            const numstatRaw = execFileSync('git', [
              'diff', '--numstat', `${base}...${compare}`, '--',
            ], { cwd: resolved, encoding: 'utf-8', timeout: 10000 }).trim();
            const files = numstatRaw ? numstatRaw.split('\n').map(line => {
              const [add, del, ...pathParts] = line.split('\t');
              const path = pathParts.join('\t');
              const isBinary = add === '-' && del === '-';
              return { path, additions: isBinary ? 0 : (Number(add) || 0), deletions: isBinary ? 0 : (Number(del) || 0), binary: isBinary };
            }) : [];
            // Get commit list
            const logRaw = execFileSync('git', [
              'log', '--format=%H%x00%h%x00%s%x00%an%x00%aI', `${base}..${compare}`,
              '--max-count=50', '--',
            ], { cwd: resolved, encoding: 'utf-8', timeout: 5000 }).trim();
            const commits = logRaw ? logRaw.split('\n').map(line => {
              const [hash, short, subject, author, date] = line.split('\0');
              return { hash, short, subject, author, date };
            }) : [];
            const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
            const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
            return { id, result: { files, commits, totalAdditions, totalDeletions, base, compare } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'shell.spawn': {
          const shellId = params?.shellId as string;
          const cols = (params?.cols as number) || 80;
          const rows = (params?.rows as number) || 24;
          const shellSessionKey = params?.sessionKey as string | undefined;
          if (!shellId) return { id, error: 'shellId required' };
          if (shellSessionKey) shellSessionKeys.set(shellId, shellSessionKey);
          if (shellProcesses.has(shellId)) {
            // reclaim orphaned shell if a new client is spawning with the same ID
            const orphanTimer = orphanedShells.get(shellId);
            if (orphanTimer) {
              clearTimeout(orphanTimer);
              orphanedShells.delete(shellId);
              console.log(`[gateway] reclaimed orphaned shell ${shellId}`);
            }
            // re-associate with the current client
            if (clientWs) {
              if (!shellsByClient.has(clientWs)) shellsByClient.set(clientWs, new Set());
              shellsByClient.get(clientWs)!.add(shellId);
            }
            // send scrollback buffer so client can restore terminal output
            const sb = shellScrollbacks.get(shellId);
            const scrollback = sb && sb.size > 0 ? sb.toBase64() : undefined;
            return { id, result: { spawned: true, reclaimed: true, scrollback } };
          }

          const shell = process.env.SHELL || '/bin/zsh';
          const cwd = (params?.cwd as string) || config.cwd || homedir();

          const pty = nodePty.spawn(shell, ['-l'], {
            name: 'xterm-256color',
            cols,
            rows,
            cwd,
            env: {
              ...process.env,
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
            } as Record<string, string>,
          });

          shellProcesses.set(shellId, pty);
          shellScrollbacks.set(shellId, new ScrollbackBuffer());
          if (clientWs) {
            if (!shellsByClient.has(clientWs)) shellsByClient.set(clientWs, new Set());
            shellsByClient.get(clientWs)!.add(shellId);
          }

          pty.onData((data) => {
            shellScrollbacks.get(shellId)?.write(data);
            broadcast({ event: 'shell.data', data: { shellId, type: 'data', data } });
          });
          pty.onExit(({ exitCode }) => {
            // skip if shell was already cleaned up by shell.kill
            if (!shellProcesses.has(shellId)) return;
            saveScrollbackToDisk(shellId);
            shellScrollbacks.delete(shellId);
            shellSessionKeys.delete(shellId);
            shellProcesses.delete(shellId);
            // remove from all client shell sets (clientWs may be stale after refresh)
            for (const [, shells] of shellsByClient) shells.delete(shellId);
            broadcast({ event: 'shell.data', data: { shellId, type: 'exit', code: exitCode } });
          });

          return { id, result: { spawned: true } };
        }

        case 'shell.write': {
          const shellId = params?.shellId as string;
          const data = params?.data as string;
          if (!shellId || data == null) return { id, error: 'shellId and data required' };
          const pty = shellProcesses.get(shellId);
          if (!pty) return { id, error: 'shell not found' };
          pty.write(data);
          return { id, result: { written: true } };
        }

        case 'shell.resize': {
          const shellId = params?.shellId as string;
          const cols = params?.cols as number;
          const rows = params?.rows as number;
          if (!shellId || cols == null || rows == null) return { id, error: 'shellId, cols, and rows required' };
          const pty = shellProcesses.get(shellId);
          if (!pty) return { id, error: 'shell not found' };
          pty.resize(cols, rows);
          return { id, result: { resized: true } };
        }

        case 'shell.kill': {
          const shellId = params?.shellId as string;
          if (!shellId) return { id, error: 'shellId required' };
          const pty = shellProcesses.get(shellId);
          if (pty) {
            saveScrollbackToDisk(shellId);
            shellScrollbacks.delete(shellId);
            shellSessionKeys.delete(shellId);
            pty.kill();
            shellProcesses.delete(shellId);
          }
          // cancel any pending orphan timer
          const orphanTimer = orphanedShells.get(shellId);
          if (orphanTimer) { clearTimeout(orphanTimer); orphanedShells.delete(shellId); }
          // remove from all client shell sets
          for (const [, shells] of shellsByClient) shells.delete(shellId);
          return { id, result: { killed: true } };
        }

        case 'shell.scrollback': {
          // Get saved scrollback from disk for a previous shell session
          const shellId = params?.shellId as string;
          if (!shellId) return { id, error: 'shellId required' };
          if (!isValidShellId(shellId)) return { id, error: 'invalid shellId' };
          // Check live buffer first, then disk
          const liveSb = shellScrollbacks.get(shellId);
          if (liveSb && liveSb.size > 0) {
            return { id, result: { scrollback: liveSb.toBase64(), live: true } };
          }
          const saved = loadScrollbackFromDisk(shellId);
          return { id, result: { scrollback: saved, live: false } };
        }

        case 'shell.list': {
          // List active shells and saved scrollback files
          const active = Array.from(shellProcesses.keys()).map(shellId => ({
            shellId,
            sessionKey: shellSessionKeys.get(shellId),
            live: true,
          }));
          let saved: Array<{ shellId: string; sessionKey?: string; savedAt?: number }> = [];
          try {
            const files = readdirSync(SCROLLBACK_DIR).filter(f => f.endsWith('.scrollback'));
            saved = files.map(f => {
              const shellId = f.replace('.scrollback', '');
              let sessionKey: string | undefined;
              let savedAt: number | undefined;
              try {
                const metaPath = join(SCROLLBACK_DIR, `${shellId}.meta`);
                if (existsSync(metaPath)) {
                  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
                  sessionKey = meta.sessionKey;
                  savedAt = meta.savedAt;
                }
              } catch {}
              return { shellId, sessionKey, savedAt, live: false };
            });
          } catch {}
          return { id, result: { active, saved } };
        }

        case 'tool.approve': {
          const requestId = params?.requestId as string;
          if (!requestId) return { id, error: 'requestId required' };
          const pending = pendingApprovals.get(requestId);
          if (!pending) return { id, error: 'no pending approval with that ID' };
          pendingApprovals.delete(requestId);
          if (pending.timeout) clearTimeout(pending.timeout);
          pending.resolve({ approved: true, modifiedInput: params?.modifiedInput as Record<string, unknown> });
          return { id, result: { approved: true } };
        }

        case 'tool.deny': {
          const requestId = params?.requestId as string;
          if (!requestId) return { id, error: 'requestId required' };
          const pending = pendingApprovals.get(requestId);
          if (!pending) return { id, error: 'no pending approval with that ID' };
          pendingApprovals.delete(requestId);
          if (pending.timeout) clearTimeout(pending.timeout);
          pending.resolve({ approved: false, reason: (params?.reason as string) || 'user denied' });
          return { id, result: { denied: true } };
        }

        case 'tool.pending': {
          const list = Array.from(pendingApprovals.entries()).map(([reqId, p]) => ({
            requestId: reqId,
            toolName: p.toolName,
            input: p.input,
          }));
          return { id, result: list };
        }

        case 'security.get': {
          return { id, result: {
            approvalMode: config.security?.approvalMode || 'approve-sensitive',
            allowedPaths: config.gateway?.allowedPaths || [homedir()],
            deniedPaths: config.gateway?.deniedPaths || [],
            telegramAllowFrom: config.channels?.telegram?.allowFrom || [],
            whatsappAllowFrom: config.channels?.whatsapp?.allowFrom || [],
          }};
        }

        case 'security.senders.list': {
          return { id, result: {
            telegram: config.channels?.telegram?.allowFrom || [],
            whatsapp: config.channels?.whatsapp?.allowFrom || [],
          }};
        }

        case 'security.senders.add': {
          const channel = params?.channel as string;
          const senderId = params?.senderId as string;
          if (!channel || !senderId) return { id, error: 'channel and senderId required' };
          if (channel === 'telegram') {
            if (!config.channels) config.channels = {};
            if (!config.channels.telegram) config.channels.telegram = {};
            if (!config.channels.telegram.allowFrom) config.channels.telegram.allowFrom = [];
            if (!config.channels.telegram.allowFrom.includes(senderId)) {
              config.channels.telegram.allowFrom.push(senderId);
              saveConfig(config);
            }
          } else if (channel === 'whatsapp') {
            if (!config.channels) config.channels = {};
            if (!config.channels.whatsapp) config.channels.whatsapp = {};
            if (!config.channels.whatsapp.allowFrom) config.channels.whatsapp.allowFrom = [];
            if (!config.channels.whatsapp.allowFrom.includes(senderId)) {
              config.channels.whatsapp.allowFrom.push(senderId);
              saveConfig(config);
            }
          } else {
            return { id, error: `unsupported channel: ${channel}` };
          }
          return { id, result: { added: senderId, channel } };
        }

        case 'security.senders.remove': {
          const channel = params?.channel as string;
          const senderId = params?.senderId as string;
          if (!channel || !senderId) return { id, error: 'channel and senderId required' };
          if (channel === 'telegram' && config.channels?.telegram?.allowFrom) {
            config.channels.telegram.allowFrom = config.channels.telegram.allowFrom.filter(s => s !== senderId);
            saveConfig(config);
          } else if (channel === 'whatsapp' && config.channels?.whatsapp?.allowFrom) {
            config.channels.whatsapp.allowFrom = config.channels.whatsapp.allowFrom.filter(s => s !== senderId);
            saveConfig(config);
          }
          return { id, result: { removed: senderId, channel } };
        }

        case 'security.tools.get': {
          return { id, result: {
            global: config.security?.tools || {},
            whatsapp: config.channels?.whatsapp?.tools || {},
            telegram: config.channels?.telegram?.tools || {},
          }};
        }

        case 'security.tools.set': {
          const target = params?.target as string;  // 'global' | 'whatsapp' | 'telegram'
          const allow = params?.allow as string[] | undefined;
          const deny = params?.deny as string[] | undefined;
          if (!target) return { id, error: 'target required (global, whatsapp, telegram)' };

          const policy: ToolPolicyConfig = {};
          if (allow !== undefined) policy.allow = allow;
          if (deny !== undefined) policy.deny = deny;

          if (target === 'global') {
            if (!config.security) config.security = {};
            config.security.tools = policy;
          } else if (target === 'whatsapp') {
            if (!config.channels) config.channels = {};
            if (!config.channels.whatsapp) config.channels.whatsapp = {};
            config.channels.whatsapp.tools = policy;
          } else if (target === 'telegram') {
            if (!config.channels) config.channels = {};
            if (!config.channels.telegram) config.channels.telegram = {};
            config.channels.telegram.tools = policy;
          } else {
            return { id, error: `unsupported target: ${target}` };
          }
          saveConfig(config);
          broadcast({ event: 'config.update', data: { key: `security.tools.${target}`, value: policy } });
          return { id, result: { target, policy } };
        }

        case 'security.paths.get': {
          return { id, result: {
            global: {
              allowed: config.gateway?.allowedPaths || [homedir(), '/tmp'],
              denied: config.gateway?.deniedPaths || [],
              alwaysDenied: ALWAYS_DENIED,
            },
            whatsapp: {
              allowed: config.channels?.whatsapp?.allowedPaths || [],
              denied: config.channels?.whatsapp?.deniedPaths || [],
            },
            telegram: {
              allowed: config.channels?.telegram?.allowedPaths || [],
              denied: config.channels?.telegram?.deniedPaths || [],
            },
          }};
        }

        case 'security.paths.set': {
          const target = params?.target as string;
          const allowed = params?.allowed as string[] | undefined;
          const denied = params?.denied as string[] | undefined;
          if (!target) return { id, error: 'target required (global, whatsapp, telegram)' };

          if (target === 'global') {
            if (!config.gateway) config.gateway = {};
            if (allowed !== undefined) config.gateway.allowedPaths = allowed;
            if (denied !== undefined) config.gateway.deniedPaths = denied;
          } else if (target === 'whatsapp') {
            if (!config.channels) config.channels = {};
            if (!config.channels.whatsapp) config.channels.whatsapp = {};
            if (allowed !== undefined) config.channels.whatsapp.allowedPaths = allowed;
            if (denied !== undefined) config.channels.whatsapp.deniedPaths = denied;
          } else if (target === 'telegram') {
            if (!config.channels) config.channels = {};
            if (!config.channels.telegram) config.channels.telegram = {};
            if (allowed !== undefined) config.channels.telegram.allowedPaths = allowed;
            if (denied !== undefined) config.channels.telegram.deniedPaths = denied;
          } else {
            return { id, error: `unsupported target: ${target}` };
          }
          saveConfig(config);
          broadcast({ event: 'config.update', data: { key: `security.paths.${target}`, value: { allowed, denied } } });
          return { id, result: { target, allowed, denied } };
        }

        case 'agent.run_background': {
          const prompt = params?.prompt as string;
          if (!prompt) return { id, error: 'prompt required' };

          const bgId = randomUUID();
          const sessionKey = `bg:${bgId}`;
          const bgRun: BackgroundRun = {
            id: bgId, sessionKey, prompt,
            startedAt: Date.now(), status: 'running',
          };
          backgroundRuns.set(bgId, bgRun);
          broadcast({ event: 'background.status', data: bgRun });

          // fire and forget — runs on its own session key
          handleAgentRun({ prompt, sessionKey, source: 'desktop/background' }).then(result => {
            bgRun.status = 'completed';
            bgRun.result = result?.result;
            broadcast({ event: 'background.status', data: bgRun });
          }).catch(err => {
            bgRun.status = 'error';
            bgRun.error = err instanceof Error ? err.message : String(err);
            broadcast({ event: 'background.status', data: bgRun });
          });

          return { id, result: { backgroundRunId: bgId, sessionKey } };
        }

        case 'agent.background_runs': {
          return { id, result: Array.from(backgroundRuns.values()) };
        }

        case 'search.memory': {
          const query = params?.query as string;
          const limit = Math.min((params?.limit as number) || 20, 50);
          const channel = params?.channel as string | undefined;
          const type = params?.type as string | undefined;
          if (!query) return { id, error: 'query required' };
          try {
            const { getDb, extractMessageText } = await import('../db.js');
            const db = getDb();

            let sql = `
              SELECT
                m.id,
                m.session_id,
                m.type,
                m.timestamp,
                m.content,
                s.channel,
                s.chat_id,
                s.sender_name,
                s.created_at as session_created_at,
                f.rank
              FROM messages_fts f
              JOIN messages m ON m.id = f.rowid
              LEFT JOIN sessions s ON s.id = m.session_id
              WHERE messages_fts MATCH ?
            `;
            const sqlParams: unknown[] = [query];

            if (channel) {
              sql += ' AND s.channel = ?';
              sqlParams.push(channel);
            }
            if (type) {
              sql += ' AND m.type = ?';
              sqlParams.push(type);
            }

            sql += ' ORDER BY f.rank LIMIT ?';
            sqlParams.push(limit);

            const rows = db.prepare(sql).all(...sqlParams) as {
              id: number;
              session_id: string;
              type: string;
              timestamp: string;
              content: string;
              channel: string | null;
              chat_id: string | null;
              sender_name: string | null;
              session_created_at: string | null;
              rank: number;
            }[];

            const results = rows.map(row => {
              const text = extractMessageText(row.content);
              const preview = text.length > 300 ? text.slice(0, 300) + '...' : text;
              return {
                id: row.id,
                sessionId: row.session_id,
                type: row.type,
                timestamp: row.timestamp,
                channel: row.channel,
                chatId: row.chat_id,
                senderName: row.sender_name,
                sessionCreatedAt: row.session_created_at,
                preview,
                rank: row.rank,
              };
            });

            return { id, result: { results } };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('fts5: syntax error')) {
              return { id, error: 'Search syntax error. Try simpler keywords or quote exact phrases.' };
            }
            return { id, error: msg };
          }
        }

        case 'search.ripgrep':
        case 'search.files': {
          const searchPath = params?.path as string;
          const query = params?.query as string;
          const maxResults = (params?.maxResults as number) || 100;
          if (!searchPath || !query) return { id, error: 'path and query required' };
          try {
            const { readdir, readFile } = await import('node:fs/promises');
            const { join: pathJoin } = await import('node:path');

            // recursively collect text files (skip hidden dirs, node_modules, .git, binaries)
            const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', '__pycache__', '.venv', '.dorabot']);
            const TEXT_EXTS = new Set([
              '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.scss',
              '.html', '.yaml', '.yml', '.toml', '.py', '.rs', '.go', '.sh', '.sql',
              '.env', '.cfg', '.ini', '.csv', '.xml', '.svg', '.graphql', '.prisma',
            ]);

            const files: string[] = [];
            const walk = async (dir: string, depth = 0) => {
              if (depth > 10 || files.length > 5000) return;
              let entries;
              try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
              for (const e of entries) {
                if (e.name.startsWith('.') && SKIP_DIRS.has(e.name)) continue;
                const full = pathJoin(dir, e.name);
                if (e.isDirectory()) {
                  if (SKIP_DIRS.has(e.name)) continue;
                  await walk(full, depth + 1);
                } else if (e.isFile()) {
                  const ext = e.name.includes('.') ? '.' + e.name.split('.').pop()!.toLowerCase() : '';
                  if (TEXT_EXTS.has(ext) || !ext) files.push(full);
                }
              }
            };
            await walk(resolve(searchPath));

            const results: { path: string; line: number; text: string }[] = [];
            const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const maxPerFile = 3;

            for (const filePath of files) {
              if (results.length >= maxResults) break;
              let content: string;
              try { content = await readFile(filePath, 'utf-8'); } catch { continue; }
              const lines = content.split('\n');
              let fileMatches = 0;
              for (let i = 0; i < lines.length && fileMatches < maxPerFile; i++) {
                if (re.test(lines[i])) {
                  results.push({ path: filePath, line: i + 1, text: lines[i].trim().slice(0, 200) });
                  fileMatches++;
                }
              }
            }

            return { id, result: { results } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        default:
          return { id, error: `unknown method: ${method}` };
      }
    } catch (err) {
      return { id, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── HTTP server over Unix socket ───────────────────────────
  const requestHandler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - startedAt }));
      return;
    }
    res.writeHead(404);
    res.end();
  };

  const httpServer = createServer(requestHandler);

  const connectToSocket = (targetPath: string, timeoutMs = 500): Promise<void> => new Promise((resolve, reject) => {
    const socket = createConnection({ path: targetPath });
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      fn();
    };
    socket.once('connect', () => finish(resolve));
    socket.once('error', (err) => finish(() => reject(err)));
    socket.setTimeout(timeoutMs, () => {
      const timeoutErr = new Error(`timeout connecting to socket ${targetPath}`) as NodeJS.ErrnoException;
      timeoutErr.code = 'ETIMEDOUT';
      finish(() => reject(timeoutErr));
    });
  });

  const prepareGatewaySocket = async (targetPath: string): Promise<void> => {
    if (!existsSync(targetPath)) return;
    try {
      await connectToSocket(targetPath, 400);
      throw new Error(`gateway already running on ${targetPath}`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOENT' || code === 'ENOTSOCK') {
        try {
          unlinkSync(targetPath);
          console.log(`[gateway] removed stale socket at ${targetPath}`);
        } catch (unlinkErr) {
          const message = unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr);
          throw new Error(`failed to remove stale gateway socket ${targetPath}: ${message}`);
        }
        return;
      }
      throw err;
    }
  };

  // ── WebSocket origin validation ────────────────────────────
  const allowedOrigins = new Set([
    'http://localhost:5173',  // vite dev
    'https://localhost:5173',
    'file://',                // production Electron
    ...(config.gateway?.allowedOrigins || []),
  ]);

  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: ({ req }: { req: import('node:http').IncomingMessage }) => {
      const origin = req.headers.origin;
      // no origin = non-browser client (Node WS, Electron, CLI) — allow
      if (!origin) return true;
      if (allowedOrigins.has(origin)) return true;
      console.log(`[gateway] rejected WS connection from origin: ${origin}`);
      return false;
    },
  });

  wss.on('connection', (ws) => {
    const connectId = `conn-${++connectCounter}`;
    clients.set(ws, {
      authenticated: false,
      subscriptions: new Set(),
      lastSeen: Date.now(),
      connectId,
      bufferedAmountMax: 0,
      disconnectReason: null,
    });
    watchedPathsByClient.set(ws, new Set());
    shellsByClient.set(ws, new Set());
    console.log(`[gateway] client connected (${clients.size} total) connect_id=${connectId}`);

    // auth timeout
    const authTimeout = setTimeout(() => {
      const state = clients.get(ws);
      if (state && !state.authenticated) {
        state.disconnectReason = 'auth_timeout';
        console.log(`[gateway] auth timeout, closing connection connect_id=${state.connectId}`);
        ws.close();
      }
    }, 5000);
    authTimeout.unref?.();

    ws.on('message', async (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ error: 'invalid json' }));
        return;
      }

      if (!msg.method) {
        ws.send(JSON.stringify({ error: 'method required' }));
        return;
      }

      const clientState = clients.get(ws);
      if (!clientState) {
        ws.close();
        return;
      }
      clientState.lastSeen = Date.now();

      // auth check
      if (!clientState.authenticated) {
        if (msg.method === 'auth') {
          const token = (msg.params as any)?.token as string;
          const tokenBuf = Buffer.from(token || '', 'utf-8');
          const expectedBuf = Buffer.from(gatewayToken, 'utf-8');
          if (tokenBuf.length === expectedBuf.length && timingSafeEqual(tokenBuf, expectedBuf)) {
            clientState.authenticated = true;
            clientState.lastSeen = Date.now();
            const activeRunKeys = sessionRegistry.getActiveRunKeys();
            const hasActiveRun = activeRunKeys.length > 0;
            const connectTelemetry = {
              connect_id: clientState.connectId,
              session_count: sessionRegistry.list().length,
              subscribed_count: clientState.subscriptions.size,
              timestamp: Date.now(),
            };
            console.log('[gateway][connect]', connectTelemetry);
            ws.send(JSON.stringify({
              event: 'gateway.telemetry',
              data: connectTelemetry,
            }));
            ws.send(JSON.stringify({
              event: 'status.update',
              data: {
                running: true,
                startedAt,
                activeRun: hasActiveRun,
                source: hasActiveRun ? activeRunKeys[0] : undefined,
                sessionKey: hasActiveRun ? activeRunKeys[0] : undefined,
                channels: channelManager.getStatuses(),
                sessions: sessionRegistry.list(),
              },
            }));
            ws.send(JSON.stringify({ id: msg.id, result: { authenticated: true, connectId: clientState.connectId } }));
          } else {
            clientState.disconnectReason = 'invalid_token';
            ws.send(JSON.stringify({ id: msg.id, error: 'invalid token' }));
            ws.close();
          }
          return;
        }
        ws.send(JSON.stringify({ id: msg.id, error: 'not authenticated' }));
        return;
      }

      const response = await handleRpc(msg, ws);
      ws.send(JSON.stringify(response));
    });

    const releaseClientWatches = () => {
      const watched = watchedPathsByClient.get(ws);
      if (!watched) return;
      for (const p of watched) stopWatching(p);
      watchedPathsByClient.delete(ws);
    };

    const releaseClientShells = () => {
      const shells = shellsByClient.get(ws);
      if (!shells) return;
      for (const shellId of shells) {
        if (!shellProcesses.has(shellId)) continue;
        // grace period: don't kill immediately, allow reconnecting client to reclaim
        const timer = setTimeout(() => {
          orphanedShells.delete(shellId);
          const pty = shellProcesses.get(shellId);
          if (pty) {
            console.log(`[gateway] killing orphaned shell ${shellId} (no reclaim within ${SHELL_ORPHAN_GRACE_MS / 1000}s)`);
            saveScrollbackToDisk(shellId);
            shellScrollbacks.delete(shellId);
            shellSessionKeys.delete(shellId);
            pty.kill();
            shellProcesses.delete(shellId);
          }
        }, SHELL_ORPHAN_GRACE_MS);
        timer.unref?.();
        orphanedShells.set(shellId, timer);
      }
      shellsByClient.delete(ws);
    };

    let finalized = false;
    const finalizeClient = (disconnectReason: string) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(authTimeout);
      releaseClientWatches();
      releaseClientShells();
      const batch = streamBatches.get(ws);
      if (batch?.timer) clearTimeout(batch.timer);
      streamBatches.delete(ws);
      const state = clients.get(ws);
      const reason = state?.disconnectReason || disconnectReason;
      const telemetry = {
        connect_id: state?.connectId || connectId,
        session_count: sessionRegistry.list().length,
        subscribed_count: state?.subscriptions.size || 0,
        replay_count: 0,
        replay_ms: 0,
        buffered_amount_max: state?.bufferedAmountMax || 0,
        disconnect_reason: reason,
        timestamp: Date.now(),
      };
      console.log('[gateway][disconnect]', telemetry);
      clients.delete(ws);
      if (streamV2Enabled) {
        broadcast({ event: 'gateway.telemetry', data: telemetry });
      }
      console.log(`[gateway] client disconnected (${clients.size} total)`);
    };

    ws.on('close', (code, reasonBuffer) => {
      const reason = reasonBuffer?.toString() || `close_code_${code}`;
      finalizeClient(reason);
    });

    ws.on('error', (err) => {
      console.error('[gateway] ws error:', err.message);
      const state = clients.get(ws);
      if (state) state.disconnectReason = `ws_error:${err.message}`;
      finalizeClient(`ws_error:${err.message}`);
    });
  });

  await prepareGatewaySocket(socketPath);
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      httpServer.off('error', onError);
      reject(err);
    };
    httpServer.on('error', onError);
    httpServer.listen(socketPath, () => {
      httpServer.off('error', onError);
      try {
        chmodSync(socketPath, 0o600);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        httpServer.close(() => {
          reject(new Error(`failed to chmod gateway socket ${socketPath}: ${message}`));
        });
        return;
      }
      console.log(`[gateway] listening on unix://${socketPath}`);
      resolve();
    });
  });

  // start channels
  await channelManager.startAll();

  // Start HTTP auth fallback server (Phase 2)
  let httpAuth: HttpAuthServer | null = null;
  try {
    httpAuth = await startHttpAuthServer();
    console.log(`[gateway] HTTP auth server started on port ${httpAuth.port}`);
  } catch (err) {
    console.error('[gateway] HTTP auth server failed to start (non-fatal):', err);
  }

  return {
    httpAuthPort: httpAuth?.port || 0,
    close: async () => {
      clearInterval(heartbeatSweepTimer);
      for (const [, batch] of streamBatches) { if (batch.timer) clearTimeout(batch.timer); }
      streamBatches.clear();
      unsubscribeClaudeAuthRequired();
      unsubscribeCodexAuthRequired();
      // Shut down HTTP auth server and flush auth cache
      await httpAuth?.close();
      flushAuthCache();
      for (const [, timer] of runEventPruneTimers) clearTimeout(timer);
      runEventPruneTimers.clear();
      scheduler?.stop();
      await channelManager.stopAll();
      await closeBrowser();
      await disposeAllProviders();

      // close all file watchers
      for (const [path, entry] of fileWatchers) {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        const { watcher } = entry;
        watcher.close();
        console.log(`[gateway] closed watcher: ${path}`);
      }
      fileWatchers.clear();
      watchedPathsByClient.clear();

      // Kill PTY processes first, then save scrollback buffers
      for (const [, timer] of orphanedShells) clearTimeout(timer);
      orphanedShells.clear();
      for (const [, pty] of shellProcesses) { try { pty.kill(); } catch { /* ignore */ } }
      // save after kill so buffer includes all output up to termination
      for (const [shellId] of shellScrollbacks) saveScrollbackToDisk(shellId);
      shellScrollbacks.clear();
      shellSessionKeys.clear();
      shellProcesses.clear();
      shellsByClient.clear();

      for (const [ws] of clients) {
        ws.close();
      }
      clients.clear();

      await new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.close(() => {
            try {
              if (existsSync(socketPath)) unlinkSync(socketPath);
            } catch {
              // ignore cleanup failures on shutdown
            }
            resolve();
          });
        });
      });
    },
    broadcast,
    sessionRegistry,
    channelManager,
    scheduler,
    context,
  };
}
