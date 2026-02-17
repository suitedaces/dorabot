import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, chmodSync, unlinkSync, watch, type FSWatcher } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { resolve as pathResolve, join } from 'node:path';
import { homedir } from 'node:os';

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
import type { InboundMessage } from '../channels/types.js';
import { getAllChannelStatuses } from '../channels/index.js';
import { loginWhatsApp, logoutWhatsApp, isWhatsAppLinked } from '../channels/whatsapp/login.js';
import { getDefaultAuthDir } from '../channels/whatsapp/session.js';
import { validateTelegramToken } from '../channels/telegram/bot.js';
import { insertEvent, queryEventsBySessionCursor, deleteEventsUpToSeq, cleanupOldEvents } from './event-log.js';
import { getChannelHandler } from '../tools/messaging.js';
import { setScheduler } from '../tools/index.js';
import { loadPlans, savePlans, type Plan, appendPlanLog, readPlanLogs, readPlanDoc, createPlanFromRoadmapItem } from '../tools/plans.js';
import { loadRoadmap, saveRoadmap } from '../roadmap/tools.js';
import { loadResearch, saveResearch, readResearchContent, type ResearchItem } from '../tools/research.js';
import { getProvider, getProviderByName, disposeAllProviders } from '../providers/index.js';
import { isClaudeInstalled, hasOAuthTokens, getApiKey as getClaudeApiKey, getActiveAuthMethod, isOAuthTokenExpired, onClaudeAuthRequired } from '../providers/claude.js';
import { isCodexInstalled, hasCodexAuth, onCodexAuthRequired } from '../providers/codex.js';
import type { ProviderName } from '../config.js';
import { randomUUID, randomBytes } from 'node:crypto';
import { classifyToolCall, cleanToolName, isToolAllowed, type Tier } from './tool-policy.js';
import { AUTONOMOUS_SCHEDULE_ID, buildAutonomousCalendarItem, PULSE_INTERVALS, DEFAULT_PULSE_INTERVAL, pulseIntervalToRrule, rruleToPulseInterval } from '../autonomous.js';
import { ensureWorktreeForPlan, getWorktreeStats, mergeWorktreeBranch, pushWorktreePr, removeWorktree } from '../worktree/manager.js';
import {
  DORABOT_DIR,
  GATEWAY_TOKEN_PATH,
  OWNER_CHAT_IDS_PATH,
  SKILLS_DIR,
  TELEGRAM_DIR,
  TELEGRAM_TOKEN_PATH,
  TLS_CERT_PATH,
  TLS_DIR,
  TLS_KEY_PATH,
  ensureWorkspace,
} from '../workspace.js';

const DEFAULT_PORT = 18789;
const DEFAULT_HOST = '127.0.0.1';

function macNotify(title: string, body: string) {
  try {
    const t = title.replace(/"/g, '\\"');
    const b = body.replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${b}" with title "${t}"'`, { stdio: 'ignore' });
  } catch { /* ignore */ }
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
  plan_view: '🎯', plan_add: '🎯', plan_update: '🎯', plan_start: '🎯',
  roadmap_view: '🗺️', roadmap_add: '🗺️', roadmap_update: '🗺️', roadmap_create_plan: '🗺️',
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
  plan_view: 'Checked plans', plan_add: 'Added plan', plan_update: 'Updated plan', plan_start: 'Started plan',
  roadmap_view: 'Checked roadmap', roadmap_add: 'Added roadmap item', roadmap_update: 'Updated roadmap item', roadmap_create_plan: 'Created plan',
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
  plan_view: 'Checking plans', plan_add: 'Adding plan', plan_update: 'Updating plan', plan_start: 'Starting plan',
  roadmap_view: 'Checking roadmap', roadmap_add: 'Adding roadmap item', roadmap_update: 'Updating roadmap item', roadmap_create_plan: 'Creating plan',
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
    case 'Task': return String(input.description || '').slice(0, 40);
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
  port?: number;
  host?: string;
};

export type Gateway = {
  close: () => Promise<void>;
  broadcast: (event: WsEvent) => void;
  sessionRegistry: SessionRegistry;
  channelManager: ChannelManager;
  scheduler: SchedulerRunner | null;
  context: GatewayContext;
};

export async function startGateway(opts: GatewayOptions): Promise<Gateway> {
  const { config } = opts;
  const port = opts.port || config.gateway?.port || DEFAULT_PORT;
  const host = opts.host || config.gateway?.host || DEFAULT_HOST;
  const startedAt = Date.now();
  ensureWorkspace();

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

  const unsubscribeClaudeAuthRequired = onClaudeAuthRequired((reason) => {
    broadcast({
      event: 'provider.auth_required',
      data: { provider: 'claude', reason, timestamp: Date.now() },
    });
  });
  const unsubscribeCodexAuthRequired = onCodexAuthRequired((reason) => {
    broadcast({
      event: 'provider.auth_required',
      data: { provider: 'codex', reason, timestamp: Date.now() },
    });
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
  const activePlanRuns = new Map<string, { sessionKey: string; startedAt: number }>();
  const planRunBySession = new Map<string, string>();
  const runEventPruneTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const RUN_EVENT_PRUNE_GRACE_MS = 10 * 60 * 1000;
  // keep replay data for an extended window across crashes; normal pruning is run-end based.
  cleanupOldEvents(7 * 24 * 60 * 60);

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
    prompt: string;
    sessionKey: string;
    source: string;
    channel: string;
    chatId: string;
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
    return source === `calendar/${AUTONOMOUS_SCHEDULE_ID}` || source.startsWith('plans/');
  }

  function extractPlanIdFromSource(source: string): string | null {
    const m = source.match(/^plans\/([^/]+)$/);
    return m ? m[1] : null;
  }

  function buildPlanExecutionPrompt(task: Plan, roadmapContext?: string, planDoc?: string): string {
    const tagLine = task.tags?.length ? `Tags: ${task.tags.join(', ')}` : '';
    const descriptionLine = task.description ? `Description:\n${task.description}` : 'Description:\n(No extra description provided)';
    const roadmapLine = roadmapContext ? `Roadmap context:\n${roadmapContext}` : '';
    const planDocLine = planDoc ? `plan.md:\n${planDoc}` : '';

    return [
      `Execute plan #${task.id}: ${task.title}`,
      '',
      descriptionLine,
      roadmapLine,
      planDocLine,
      tagLine,
      '',
      'Execution protocol:',
      '- Push this plan as far as possible toward completion in this run.',
      '- Default to concrete action, not planning-only responses.',
      '- Keep plan state accurate with plan_update (status/runState/result/error).',
      '- If blocked by missing user input, ask AskUserQuestion with specific options.',
      '- If AskUserQuestion times out: message the user on an available channel, sleep 120 seconds, ask once more, then continue with the best defensible assumption and document that assumption in the plan result.',
      '',
      'Done criteria:',
      '- Mark done only when objective is achieved.',
      '- If not done, leave clear progress notes and next concrete step in result.',
    ].filter(Boolean).join('\n');
  }

  function markPlanRunStarted(planId: string, sessionKey: string): void {
    activePlanRuns.set(planId, { sessionKey, startedAt: Date.now() });
    planRunBySession.set(sessionKey, planId);
    broadcast({
      event: 'plans.run',
      data: { planId, sessionKey, status: 'started', timestamp: Date.now() },
    });
  }

  function finishPlanRun(sessionKey: string, status: 'completed' | 'error', error?: string): void {
    const planId = planRunBySession.get(sessionKey);
    if (!planId) return;
    const current = activePlanRuns.get(planId);
    if (current?.sessionKey === sessionKey) activePlanRuns.delete(planId);
    planRunBySession.delete(sessionKey);

    const plans = loadPlans();
    const plan = plans.tasks.find(p => p.id === planId);
    if (plan) {
      plan.runState = status === 'completed' ? 'idle' : 'failed';
      plan.error = status === 'error' ? (error || 'Plan run failed') : undefined;
      plan.updatedAt = new Date().toISOString();
      if (status === 'completed') {
        plan.status = 'done';
        plan.completedAt = plan.updatedAt;
      }
      savePlans(plans);
      appendPlanLog(plan.id, status === 'completed' ? 'run_completed' : 'run_error', status === 'completed' ? 'Plan run completed' : (error || 'Plan run failed'));
      broadcast({ event: 'plans.update', data: { planId: plan.id, plan } });
      broadcast({
        event: 'plans.log',
        data: {
          planId: plan.id,
          eventType: status === 'completed' ? 'run_completed' : 'run_error',
          message: status === 'completed' ? 'Plan run completed' : (error || 'Plan run failed'),
          timestamp: Date.now(),
        },
      });
    }

    broadcast({
      event: 'plans.run',
      data: { planId, sessionKey, status, timestamp: Date.now(), ...(error ? { error } : {}) },
    });
  }

  function maybeMarkPlanRunFromSource(source: string, sessionKey: string): void {
    const planId = extractPlanIdFromSource(source);
    if (!planId) return;
    if (planRunBySession.get(sessionKey) === planId) return;
    markPlanRunStarted(planId, sessionKey);
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
  }): Promise<void> {
    const provider = await getProviderByName('claude');
    if (!provider.loginWithOAuth) return;

    const { authUrl } = await provider.loginWithOAuth();

    // broadcast to desktop regardless — it can show an inline re-auth UI
    broadcast({ event: 'auth.reauth_required', data: {
      channel: params.channel, chatId: params.chatId, authUrl,
    } });

    // if this came from a channel, send the link there and save context for replay
    const channel = params.channel;
    const chatId = params.chatId || params.messageMetadata?.chatId;
    if (channel && chatId) {
      const handler = getChannelHandler(channel);
      if (handler) {
        pendingReauths.set(chatId, {
          prompt: params.prompt,
          sessionKey: params.sessionKey,
          source: params.source,
          channel,
          chatId,
          messageMetadata: params.messageMetadata,
        });
        await handler.send(chatId, [
          'Auth token expired. Please re-authenticate:',
          '',
          authUrl,
          '',
          'Open the link, click Authorize, then paste the code here.',
        ].join('\n'));
      }
    }
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
      // if it doesn't look like an OAuth code, treat as a normal message
      // (user might be chatting while re-auth is pending)
      if (code && looksLikeOAuthCode(code)) {
        const handler = getChannelHandler(msg.channel);
        try {
          const provider = await getProviderByName('claude');
          if (!provider.completeOAuthLogin) throw new Error('provider missing completeOAuthLogin');
          const status = await provider.completeOAuthLogin(code);
          if (!status.authenticated) {
            // keep pendingReauth so user can retry
            if (handler) await handler.send(msg.chatId, `re-auth failed: ${status.error || 'unknown'}. paste the code again or send /cancel to skip.`);
            return;
          }
          pendingReauths.delete(msg.chatId);
          broadcast({ event: 'provider.auth_complete', data: { provider: 'claude', status } });
          if (handler) await handler.send(msg.chatId, 'authenticated, retrying your message...');
          await processChannelMessage({
            ...msg,
            body: pendingReauth.messageMetadata?.body || msg.body,
            channel: pendingReauth.channel,
            chatId: pendingReauth.chatId,
          });
        } catch (err) {
          console.error('[gateway] re-auth completion failed:', err);
          if (handler) await handler.send(msg.chatId, `re-auth failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      // "/cancel" clears the pending re-auth
      if (code.toLowerCase() === '/cancel') {
        pendingReauths.delete(msg.chatId);
        const handler = getChannelHandler(msg.channel);
        if (handler) await handler.send(msg.chatId, 'Re-auth cancelled.');
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
          macNotify('Dora', `Working on "${item.summary}"`);
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

  async function handleAgentRun(params: {
    prompt: string;
    sessionKey: string;
    source: string;
    channel?: string;
    cwd?: string;
    extraContext?: string;
    messageMetadata?: import('../session/manager.js').MessageMetadata;
  }): Promise<AgentResult | null> {
    const { prompt, sessionKey, source, channel, cwd, extraContext, messageMetadata } = params;
    console.log(`[gateway] agent run: source=${source} sessionKey=${sessionKey} prompt="${prompt.slice(0, 80)}..."`);

    // pre-run auth check: if dorabot_oauth token is expired, don't waste a run
    const authMethod = getActiveAuthMethod();
    if (authMethod === 'dorabot_oauth' && isOAuthTokenExpired()) {
      console.log(`[gateway] token expired pre-run, triggering re-auth for ${source}`);
      await startReauthFlow({ prompt, sessionKey, source, channel, chatId: messageMetadata?.chatId, messageMetadata }).catch(() => {});
      return null;
    }
    if (authMethod === 'none') {
      console.log(`[gateway] no auth configured, skipping run for ${source}`);
      broadcast({ event: 'agent.error', data: { source, sessionKey, error: 'Not authenticated', timestamp: Date.now() } });
      return null;
    }

    const prev = runQueues.get(sessionKey) || Promise.resolve();
    const hasPrev = runQueues.has(sessionKey);
    console.log(`[handleAgentRun] sessionKey=${sessionKey} hasPrevInQueue=${hasPrev}`);
    let result: AgentResult | null = null;

    const run = prev.then(async () => {
      console.log(`[handleAgentRun] prev resolved, starting run for ${sessionKey}`);
      maybeMarkPlanRunFromSource(source, sessionKey);
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
        };

        for await (const msg of gen) {
          const m = msg as Record<string, unknown>;

          if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
            agentSessionId = m.session_id as string;
            sessionRegistry.setSdkSessionId(sessionKey, agentSessionId);
            fileSessionManager.setMetadata(session?.sessionId || '', { sdkSessionId: agentSessionId });
          }

          if (m.type === 'stream_event') {
            hadStreamEvents = true;
            const event = m.event as Record<string, unknown>;
            const evtType = event.type as string;

            // track Task tool_use IDs
            if (evtType === 'content_block_start') {
              const cb = event.content_block as Record<string, unknown>;
              if (cb?.type === 'tool_use' && cleanToolName(cb.name as string) === 'Task') {
                taskToolUseIds.add(cb.id as string);
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
                const toolName = cleanToolName(cb.name as string);
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
                  const toolName = cleanToolName(b.name as string);
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
            }

            // per-turn: broadcast plans/roadmap updates if agent used plan tools
            const tl = toolLogs.get(sessionKey);
            if (tl) {
              const allTools = [...tl.completed.map(t => t.name), tl.current?.name].filter(Boolean);
              if (allTools.some(t => (
                t?.startsWith('plan_')
                || t?.startsWith('roadmap_')
                || t?.startsWith('mcp__dorabot-tools__plan_')
                || t?.startsWith('mcp__dorabot-tools__roadmap_')
              ))) {
                broadcast({ event: 'plans.update', data: {} });
                macNotify('Dora', 'Plans updated');
              }
              if (allTools.some(t => t?.startsWith('research_') || t?.startsWith('mcp__dorabot-tools__research_'))) {
                broadcast({ event: 'research.update', data: {} });
                macNotify('Dora', 'Research updated');
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

            finishPlanRun(sessionKey, 'completed');

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

        // agent.result and plans.update are broadcast per-turn inside executeStream's result handler.
        // This point is only reached when the run actually ends (abort, error, or non-persistent provider).
        console.log(`[gateway] agent run ended: source=${source} result="${result.result.slice(0, 100)}..." cost=$${result.usage.totalCostUsd?.toFixed(4) || '?'}`);
      } catch (err) {
        console.error(`[gateway] agent error: source=${source}`, err);
        const errMsg = err instanceof Error ? err.message : String(err);
        finishPlanRun(sessionKey, 'error', errMsg);
        if (isAuthError(err)) {
          console.log(`[gateway] auth error for ${source}, starting re-auth flow`);
          await startReauthFlow({ prompt, sessionKey, source, channel, chatId: messageMetadata?.chatId, messageMetadata }).catch(() => {});
        }
        const errorEvent: WsEvent = {
          event: 'agent.error',
          data: { source, sessionKey, error: errMsg, timestamp: Date.now() },
        };
        broadcast(errorEvent);
        if (streamV2Enabled && typeof errorEvent.seq === 'number') {
          scheduleRunEventPrune(sessionKey, errorEvent.seq);
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
        if (planRunBySession.has(sessionKey)) {
          finishPlanRun(sessionKey, 'error', 'run ended');
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
          let replayCount = 0;
          if (clientWs) {
            const replayStartedAt = Date.now();
            const cursorBySession = new Map<string, number>();
            for (const sk of keys) {
              const perSessionSeq = Number(lastSeqBySession?.[sk]);
              cursorBySession.set(sk, Number.isFinite(perSessionSeq) ? perSessionSeq : lastSeq);
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
          if (!prompt) return { id, error: 'prompt required' };

          const chatId = (params?.chatId as string) || `task-${Date.now()}`;
          const sessionKey = `desktop:dm:${chatId}`;
          let session = sessionRegistry.getOrCreate({
            channel: 'desktop',
            chatId,
          });

          // idle timeout: reset session if too long since last message
          const desktopGap = Date.now() - session.lastMessageAt;
          if (session.messageCount > 0 && desktopGap > IDLE_TIMEOUT_MS) {
            console.log(`[gateway] idle timeout for ${session.key} (${Math.floor(desktopGap / 3600000)}h), starting new session`);
            fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: undefined });
            sessionRegistry.remove(session.key);
            session = sessionRegistry.getOrCreate({ channel: 'desktop', chatId });
          }

          sessionRegistry.incrementMessages(session.key);
          fileSessionManager.setMetadata(session.sessionId, { channel: 'desktop', chatId, chatType: 'dm' });
          broadcastSessionUpdate(sessionKey);

          // try injection into active run first
          const handle = runHandles.get(sessionKey);
          if (handle?.active) {
            handle.inject(prompt);
            // record injected user message in session (CLI doesn't echo user text back)
            fileSessionManager.append(session.sessionId, {
              type: 'user',
              timestamp: new Date().toISOString(),
              content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } },
            });
            broadcast({ event: 'agent.user_message', data: {
              source: 'desktop/chat', sessionKey, prompt, injected: true, timestamp: Date.now(),
            }});
            return { id, result: { sessionKey, sessionId: session.sessionId, injected: true } };
          }

          // no active session — start new run
          handleAgentRun({
            prompt,
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

        case 'plans.list': {
          const plans = loadPlans();
          return { id, result: plans.tasks };
        }

        case 'plans.update': {
          const planId = params?.id as string;
          if (!planId) return { id, error: 'id required' };
          const plans = loadPlans();
          const plan = plans.tasks.find(t => t.id === planId);
          if (!plan) return { id, error: 'plan not found' };

          if (params?.title !== undefined) plan.title = params.title as string;
          if (params?.description !== undefined) plan.description = params.description as string;
          if (params?.type !== undefined) plan.type = params.type as Plan['type'];
          if (params?.status !== undefined) plan.status = params.status as Plan['status'];
          if (params?.runState !== undefined) plan.runState = params.runState as Plan['runState'];
          if (params?.result !== undefined) plan.result = params.result as string;
          if (params?.error !== undefined) plan.error = params.error as string;
          if (params?.tags !== undefined) plan.tags = params.tags as string[];
          if (params?.sessionKey !== undefined) plan.sessionKey = params.sessionKey as string;
          if (params?.worktreePath !== undefined) plan.worktreePath = params.worktreePath as string;
          if (params?.branch !== undefined) plan.branch = params.branch as string;
          plan.updatedAt = new Date().toISOString();
          if (plan.status === 'done' && !plan.completedAt) plan.completedAt = plan.updatedAt;
          if (plan.status !== 'done') plan.completedAt = undefined;

          savePlans(plans);
          appendPlanLog(plan.id, 'rpc_update', `Plan updated: ${plan.title}`, {
            status: plan.status,
            runState: plan.runState,
          });
          broadcast({ event: 'plans.update', data: { planId: plan.id, plan } });
          broadcast({
            event: 'plans.log',
            data: { planId: plan.id, eventType: 'rpc_update', message: `Plan updated: ${plan.title}`, timestamp: Date.now() },
          });
          macNotify('Dora', `Plan updated: ${plan.title}`);
          return { id, result: plan };
        }

        case 'plans.delete': {
          const planId = params?.id as string;
          if (!planId) return { id, error: 'id required' };
          const plans = loadPlans();
          const before = plans.tasks.length;
          plans.tasks = plans.tasks.filter(t => t.id !== planId);
          if (plans.tasks.length === before) return { id, error: 'plan not found' };
          savePlans(plans);
          activePlanRuns.delete(planId);
          broadcast({ event: 'plans.update', data: { planId, deleted: true } });
          macNotify('Dora', `Plan deleted: #${planId}`);
          return { id, result: { deleted: true } };
        }

        case 'plans.logs': {
          const planId = params?.id as string;
          if (!planId) return { id, error: 'id required' };
          const limit = Number(params?.limit || 100);
          return { id, result: readPlanLogs(planId, Math.min(Math.max(limit, 1), 500)) };
        }

        case 'plans.start': {
          const planId = params?.id as string;
          if (!planId) return { id, error: 'id required' };

          const plans = loadPlans();
          const plan = plans.tasks.find(t => t.id === planId);
          if (!plan) return { id, error: 'plan not found' };
          if (plan.status === 'done') return { id, error: 'plan is already done' };

          const existing = activePlanRuns.get(planId);
          if (existing) {
            const active = sessionRegistry.get(existing.sessionKey)?.activeRun || false;
            if (active) return { id, error: 'plan execution already running' };
            activePlanRuns.delete(planId);
            if (planRunBySession.get(existing.sessionKey) === planId) {
              planRunBySession.delete(existing.sessionKey);
            }
          }

          const worktree = ensureWorktreeForPlan({
            planId,
            title: plan.title,
            cwd: config.cwd,
            baseBranch: params?.baseBranch as string | undefined,
          });

          const chatId = `plan-${planId}`;
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
          plan.status = 'in_progress';
          plan.runState = 'running';
          plan.error = undefined;
          plan.sessionKey = sessionKey;
          plan.worktreePath = worktree.path;
          plan.branch = worktree.branch;
          plan.updatedAt = now;
          savePlans(plans);

          const roadmap = loadRoadmap();
          const roadmapItem = plan.roadmapItemId ? roadmap.items.find(r => r.id === plan.roadmapItemId) : null;
          const roadmapContext = roadmapItem
            ? `#${roadmapItem.id} [${roadmapItem.lane}] ${roadmapItem.title}\nProblem: ${roadmapItem.problem || ''}\nOutcome: ${roadmapItem.outcome || ''}\nAudience: ${roadmapItem.audience || ''}`
            : undefined;
          const prompt = buildPlanExecutionPrompt(plan, roadmapContext, readPlanDoc(plan));

          appendPlanLog(plan.id, 'run_started', `Plan started: ${plan.title}`, {
            sessionKey,
            worktreePath: worktree.path,
            branch: worktree.branch,
          });
          broadcast({ event: 'plans.update', data: { planId: plan.id, plan } });
          broadcast({
            event: 'plans.log',
            data: { planId: plan.id, eventType: 'run_started', message: `Plan started: ${plan.title}`, timestamp: Date.now() },
          });
          markPlanRunStarted(planId, sessionKey);
          macNotify('Dora', `Plan started: ${plan.title}`);

          void handleAgentRun({
            prompt,
            sessionKey,
            source: `plans/${planId}`,
            cwd: worktree.path,
            extraContext: `Worktree path: ${worktree.path}\nBranch: ${worktree.branch}\nBase branch: ${worktree.baseBranch}`,
            messageMetadata: {
              channel: 'desktop',
              chatId,
              chatType: 'dm',
              body: prompt,
            },
          }).then((res) => {
            if (!res) finishPlanRun(sessionKey, 'error', 'plan execution did not start');
          }).catch((err) => {
            finishPlanRun(sessionKey, 'error', err instanceof Error ? err.message : String(err));
          });

          return {
            id,
            result: {
              started: true,
              planId,
              sessionKey,
              sessionId: session.sessionId,
              chatId,
              worktreePath: worktree.path,
              branch: worktree.branch,
            },
          };
        }

        case 'roadmap.list': {
          const roadmap = loadRoadmap();
          return { id, result: roadmap.items };
        }

        case 'roadmap.add': {
          const title = params?.title as string;
          if (!title) return { id, error: 'title required' };
          const roadmap = loadRoadmap();
          const now = new Date().toISOString();
          const lane = (params?.lane as 'now' | 'next' | 'later') || 'next';
          const sortOrder = Math.max(
            0,
            ...roadmap.items.filter(i => i.lane === lane).map(i => i.sortOrder || 0),
          ) + 1;
          const ids = roadmap.items.map(i => Number.parseInt(i.id, 10)).filter(n => Number.isFinite(n));
          const item = {
            id: String((ids.length ? Math.max(...ids) : 0) + 1),
            title,
            description: params?.description as string | undefined,
            lane,
            impact: params?.impact as string | undefined,
            effort: params?.effort as string | undefined,
            problem: params?.problem as string | undefined,
            outcome: params?.outcome as string | undefined,
            audience: params?.audience as string | undefined,
            risks: params?.risks as string | undefined,
            notes: params?.notes as string | undefined,
            tags: params?.tags as string[] | undefined,
            linkedPlanIds: [] as string[],
            createdAt: now,
            updatedAt: now,
            sortOrder,
          };
          roadmap.items.push(item);
          saveRoadmap(roadmap);
          broadcast({ event: 'plans.update', data: { roadmapVersion: roadmap.version } });
          return { id, result: item };
        }

        case 'roadmap.update': {
          const roadmapId = params?.id as string;
          if (!roadmapId) return { id, error: 'id required' };
          const roadmap = loadRoadmap();
          const item = roadmap.items.find(i => i.id === roadmapId);
          if (!item) return { id, error: 'roadmap item not found' };

          if (params?.title !== undefined) item.title = params.title as string;
          if (params?.description !== undefined) item.description = params.description as string;
          if (params?.lane !== undefined) item.lane = params.lane as 'now' | 'next' | 'later';
          if (params?.impact !== undefined) item.impact = params.impact as string;
          if (params?.effort !== undefined) item.effort = params.effort as string;
          if (params?.problem !== undefined) item.problem = params.problem as string;
          if (params?.outcome !== undefined) item.outcome = params.outcome as string;
          if (params?.audience !== undefined) item.audience = params.audience as string;
          if (params?.risks !== undefined) item.risks = params.risks as string;
          if (params?.notes !== undefined) item.notes = params.notes as string;
          if (params?.tags !== undefined) item.tags = params.tags as string[];
          if (params?.linkedPlanIds !== undefined) item.linkedPlanIds = params.linkedPlanIds as string[];
          if (params?.sortOrder !== undefined) item.sortOrder = Number(params.sortOrder);
          item.updatedAt = new Date().toISOString();
          saveRoadmap(roadmap);
          broadcast({ event: 'plans.update', data: { roadmapItemId: item.id } });
          return { id, result: item };
        }

        case 'roadmap.delete': {
          const roadmapId = params?.id as string;
          if (!roadmapId) return { id, error: 'id required' };
          const roadmap = loadRoadmap();
          const before = roadmap.items.length;
          roadmap.items = roadmap.items.filter(i => i.id !== roadmapId);
          if (roadmap.items.length === before) return { id, error: 'roadmap item not found' };
          saveRoadmap(roadmap);
          broadcast({ event: 'plans.update', data: { roadmapItemId: roadmapId, deleted: true } });
          return { id, result: { deleted: true } };
        }

        case 'roadmap.move': {
          const roadmapId = params?.id as string;
          if (!roadmapId) return { id, error: 'id required' };
          const roadmap = loadRoadmap();
          const item = roadmap.items.find(i => i.id === roadmapId);
          if (!item) return { id, error: 'roadmap item not found' };
          const lane = (params?.lane as 'now' | 'next' | 'later') || item.lane;
          item.lane = lane;
          item.sortOrder = Number(params?.sortOrder || item.sortOrder || 1);
          item.updatedAt = new Date().toISOString();
          saveRoadmap(roadmap);
          broadcast({ event: 'plans.update', data: { roadmapItemId: item.id } });
          return { id, result: item };
        }

        case 'roadmap.create_plan': {
          const roadmapItemId = params?.roadmapItemId as string;
          if (!roadmapItemId) return { id, error: 'roadmapItemId required' };
          const roadmap = loadRoadmap();
          const item = roadmap.items.find(i => i.id === roadmapItemId);
          if (!item) return { id, error: 'roadmap item not found' };

          const plan = createPlanFromRoadmapItem({
            roadmapItemId: item.id,
            title: (params?.title as string) || item.title,
            description: (params?.description as string) || item.description || item.outcome || item.problem,
            type: (params?.type as Plan['type']) || 'feature',
            tags: (params?.tags as string[]) || item.tags,
          });

          if (!item.linkedPlanIds.includes(plan.id)) {
            item.linkedPlanIds.push(plan.id);
            item.updatedAt = new Date().toISOString();
            saveRoadmap(roadmap);
          }

          appendPlanLog(plan.id, 'created_from_roadmap', `Created from roadmap item #${item.id}`, { roadmapItemId: item.id });
          broadcast({ event: 'plans.update', data: { planId: plan.id, roadmapItemId: item.id } });
          broadcast({
            event: 'plans.log',
            data: { planId: plan.id, eventType: 'created_from_roadmap', message: `Created from roadmap item #${item.id}`, timestamp: Date.now() },
          });
          return { id, result: { plan, roadmapItem: item } };
        }

        case 'worktree.create': {
          const planId = params?.planId as string;
          if (!planId) return { id, error: 'planId required' };
          const plans = loadPlans();
          const plan = plans.tasks.find(p => p.id === planId);
          const worktree = ensureWorktreeForPlan({
            planId,
            title: plan?.title,
            cwd: config.cwd,
            baseBranch: params?.baseBranch as string | undefined,
          });
          if (plan) {
            plan.worktreePath = worktree.path;
            plan.branch = worktree.branch;
            plan.updatedAt = new Date().toISOString();
            savePlans(plans);
            broadcast({ event: 'plans.update', data: { planId: plan.id, plan } });
          }
          return { id, result: worktree };
        }

        case 'worktree.stats': {
          const planId = params?.planId as string | undefined;
          let worktreePath = params?.path as string | undefined;
          if (!worktreePath && planId) {
            const plans = loadPlans();
            worktreePath = plans.tasks.find(p => p.id === planId)?.worktreePath;
          }
          if (!worktreePath) return { id, error: 'path or planId required' };
          return { id, result: getWorktreeStats(worktreePath) };
        }

        case 'worktree.merge': {
          const planId = params?.planId as string | undefined;
          let sourceBranch = params?.sourceBranch as string | undefined;
          if (!sourceBranch && planId) {
            const plans = loadPlans();
            sourceBranch = plans.tasks.find(p => p.id === planId)?.branch;
          }
          if (!sourceBranch) return { id, error: 'sourceBranch or planId required' };
          const merged = mergeWorktreeBranch({
            cwd: config.cwd,
            sourceBranch,
            targetBranch: params?.targetBranch as string | undefined,
          });
          return { id, result: merged };
        }

        case 'worktree.push_pr': {
          const planId = params?.planId as string | undefined;
          let worktreePath = params?.path as string | undefined;
          if (!worktreePath && planId) {
            const plans = loadPlans();
            worktreePath = plans.tasks.find(p => p.id === planId)?.worktreePath;
          }
          if (!worktreePath) return { id, error: 'path or planId required' };
          const pushed = pushWorktreePr({
            worktreePath,
            baseBranch: params?.baseBranch as string | undefined,
            title: params?.title as string | undefined,
            body: params?.body as string | undefined,
          });
          return { id, result: pushed };
        }

        case 'worktree.remove': {
          const planId = params?.planId as string | undefined;
          let worktreePath = params?.path as string | undefined;
          let branch = params?.branch as string | undefined;
          const plans = loadPlans();
          const plan = planId ? plans.tasks.find(p => p.id === planId) : undefined;
          if (!worktreePath && plan) worktreePath = plan.worktreePath;
          if (!branch && plan) branch = plan.branch;
          if (!worktreePath) return { id, error: 'path or planId required' };
          const removed = removeWorktree({
            cwd: config.cwd,
            worktreePath,
            branch,
            removeBranch: Boolean(params?.removeBranch),
          });
          if (plan) {
            plan.worktreePath = undefined;
            plan.branch = undefined;
            plan.updatedAt = new Date().toISOString();
            savePlans(plans);
            broadcast({ event: 'plans.update', data: { planId: plan.id, plan } });
          }
          return { id, result: removed };
        }

        // ── Research ──

        case 'research.list': {
          const research = loadResearch();
          return { id, result: research.items };
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
          saveResearch(research);
          broadcast({ event: 'research.update', data: {} });
          macNotify('Dora', `Research updated: ${item.title}`);
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
          broadcast({ event: 'research.update', data: {} });
          macNotify('Dora', `Research deleted: ${deleted.title}`);
          return { id, result: { deleted: true } };
        }

        case 'skills.list': {
          const userSkillsDir = SKILLS_DIR;
          const allSkills = loadAllSkills(config);
          const result = allSkills.map(skill => ({
            name: skill.name,
            description: skill.description,
            path: skill.path,
            userInvocable: skill.userInvocable,
            metadata: skill.metadata,
            eligibility: checkSkillEligibility(skill, config),
            builtIn: !skill.path.startsWith(userSkillsDir),
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
            return { id, result: { name: skill.name, path: skill.path, raw } };
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
          yamlLines.push(`name: ${fm.name}`);
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

        case 'skills.delete': {
          const name = params?.name as string;
          if (!name) return { id, error: 'name required' };

          const skill = findSkillByName(name, config);
          if (!skill) return { id, error: `skill not found: ${name}` };

          const userSkillsDir = SKILLS_DIR;
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
          return { id, result: {
            method: getActiveAuthMethod(),
            expired: getActiveAuthMethod() === 'dorabot_oauth' ? isOAuthTokenExpired() : false,
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

        default:
          return { id, error: `unknown method: ${method}` };
      }
    } catch (err) {
      return { id, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── TLS setup ───────────────────────────────────────────────
  const useTls = config.gateway?.tls !== false;
  const tlsDir = TLS_DIR;
  const certPath = TLS_CERT_PATH;
  const keyPath = TLS_KEY_PATH;

  if (useTls && (!existsSync(certPath) || !existsSync(keyPath))) {
    console.log('[gateway] generating self-signed TLS certificate...');
    mkdirSync(tlsDir, { recursive: true });
    execSync(
      `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 ` +
      `-keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes ` +
      `-subj "/CN=dorabot-gateway" ` +
      `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
      { stdio: 'ignore' },
    );
    chmodSync(keyPath, 0o600);
    chmodSync(certPath, 0o600);
    console.log(`[gateway] TLS cert created at ${tlsDir}`);
  }

  // ── HTTP/HTTPS server ──────────────────────────────────────
  const requestHandler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - startedAt, tls: useTls }));
      return;
    }
    res.writeHead(404);
    res.end();
  };

  const httpServer = useTls
    ? createTlsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, requestHandler)
    : createServer(requestHandler);

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
          if (token === gatewayToken) {
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

    let finalized = false;
    const finalizeClient = (disconnectReason: string) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(authTimeout);
      releaseClientWatches();
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

  function reclaimGatewayPort(listenPort: number): boolean {
    try {
      const out = execSync(`lsof -nP -iTCP:${listenPort} -sTCP:LISTEN -t`, { encoding: 'utf-8' }).trim();
      if (!out) return false;
      const pids = out.split('\n').map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 1);
      let killedAny = false;
      for (const pid of pids) {
        if (pid === process.pid) continue;
        let command = '';
        try {
          command = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8' }).trim();
        } catch {
          continue;
        }
        const looksLikeDorabotGateway = /dorabot|my-agent|dist\/index\.js|src\/index\.ts/i.test(command);
        if (!looksLikeDorabotGateway) {
          console.warn(`[gateway] refusing to kill pid ${pid} on port ${listenPort}; command did not match dorabot gateway`);
          continue;
        }
        try {
          execSync(`kill -TERM ${pid}`);
          killedAny = true;
          console.log(`[gateway] terminated stale gateway pid=${pid}`);
        } catch (err) {
          console.warn(`[gateway] failed to terminate stale gateway pid=${pid}:`, err);
        }
      }
      return killedAny;
    } catch {
      return false;
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[gateway] port ${port} in use, checking for stale dorabot gateway owner...`);
        const reclaimed = reclaimGatewayPort(port);
        if (!reclaimed) {
          reject(new Error(`port ${port} is already in use by a non-dorabot process`));
          return;
        }
        setTimeout(() => {
          httpServer.listen(port, host, () => {
            console.log(`[gateway] listening on ${useTls ? 'wss' : 'ws'}://${host}:${port}`);
            resolve();
          });
        }, 500);
      } else {
        reject(err);
      }
    });
    httpServer.listen(port, host, () => {
      console.log(`[gateway] listening on ${useTls ? 'wss' : 'ws'}://${host}:${port}`);
      resolve();
    });
  });

  // start channels
  await channelManager.startAll();

  return {
    close: async () => {
      clearInterval(heartbeatSweepTimer);
      for (const [, batch] of streamBatches) { if (batch.timer) clearTimeout(batch.timer); }
      streamBatches.clear();
      unsubscribeClaudeAuthRequired();
      unsubscribeCodexAuthRequired();
      for (const [, timer] of runEventPruneTimers) clearTimeout(timer);
      runEventPruneTimers.clear();
      scheduler?.stop();
      await channelManager.stopAll();
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

      for (const [ws] of clients) {
        ws.close();
      }
      clients.clear();

      await new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.close(() => resolve());
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
