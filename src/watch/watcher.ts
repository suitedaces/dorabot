import { execFile } from 'node:child_process';
import { getDb } from '../db.js';

// a watch is a shell command the gateway re-runs on a timer with no llm in the loop.
// it pushes only when the output changes or the `until` regex matches.

export type WatchStatus = 'active' | 'done' | 'expired' | 'cancelled';

export type Watch = {
  id: string;
  summary: string;
  command: string;
  cwd?: string;
  intervalSec: number;
  until?: string;
  notify: 'change' | 'done';
  wake: boolean;
  // where pushes go: the chat that set the watch, plus an optional channel
  sessionKey?: string;
  channel?: string;
  chatId?: string;
  createdAt: string;
  expiresAt: string;
  status: WatchStatus;
  lastRunAt?: string;
  lastOutput?: string;
  lastExitCode?: number;
  ticks: number;
  pushes: number;
  doneAt?: string;
};

export type WatchInput = {
  summary: string;
  command: string;
  cwd?: string;
  intervalSec?: number;
  until?: string;
  notify?: 'change' | 'done';
  wake?: boolean;
  sessionKey?: string;
  channel?: string;
  chatId?: string;
  expiresInSec?: number;
};

export const MIN_INTERVAL_SEC = 30;
export const DEFAULT_INTERVAL_SEC = 300;
export const DEFAULT_EXPIRES_SEC = 24 * 3600;
export const COMMAND_TIMEOUT_MS = 60_000;
const TAIL_LINES = 10;
const MAX_OUTPUT_CHARS = 20_000;

// --- db ---

export function loadWatches(): Watch[] {
  const rows = getDb().prepare('SELECT data FROM watches').all() as { data: string }[];
  return rows.map(r => JSON.parse(r.data));
}

export function getWatch(id: string): Watch | null {
  const row = getDb().prepare('SELECT data FROM watches WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function saveWatch(watch: Watch): void {
  getDb().prepare('INSERT OR REPLACE INTO watches (id, data) VALUES (?, ?)').run(watch.id, JSON.stringify(watch));
}

export function deleteWatch(id: string): boolean {
  return getDb().prepare('DELETE FROM watches WHERE id = ?').run(id).changes > 0;
}

export function addWatch(input: WatchInput): Watch {
  if (!input.command.trim()) throw new Error('command is empty');
  if (input.until) new RegExp(input.until);
  const now = Date.now();
  const watch: Watch = {
    id: `w-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    summary: input.summary,
    command: input.command,
    cwd: input.cwd,
    intervalSec: Math.max(MIN_INTERVAL_SEC, Math.round(input.intervalSec ?? DEFAULT_INTERVAL_SEC)),
    until: input.until || undefined,
    notify: input.notify ?? 'change',
    wake: input.wake ?? false,
    sessionKey: input.sessionKey,
    channel: input.channel,
    chatId: input.chatId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (input.expiresInSec ?? DEFAULT_EXPIRES_SEC) * 1000).toISOString(),
    status: 'active',
    ticks: 0,
    pushes: 0,
  };
  saveWatch(watch);
  return watch;
}

export function cancelWatch(id: string): Watch | null {
  const watch = getWatch(id);
  if (!watch) return null;
  if (watch.status === 'active') {
    watch.status = 'cancelled';
    saveWatch(watch);
  }
  return watch;
}

export function tail(output: string, lines = TAIL_LINES): string {
  const all = output.trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}

// --- runner ---

export type WatchEvent = {
  watch: Watch;
  // 'change' = output differs from last tick, 'done' = until matched, 'expired' = ran out of time
  reason: 'change' | 'done' | 'expired';
  output: string;
};

export type RunCommand = (watch: Watch) => Promise<{ output: string; exitCode: number }>;

export const runShellCommand: RunCommand = (watch) => new Promise((resolve) => {
  execFile('/bin/zsh', ['-lc', watch.command], {
    cwd: watch.cwd,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  }, (err, stdout, stderr) => {
    const code = err && typeof (err as any).code === 'number' ? (err as any).code as number : err ? 1 : 0;
    let output = [stdout, stderr].filter(s => s && s.trim()).join('\n');
    if (err && (err as any).killed) output += `\n[watch] command timed out after ${COMMAND_TIMEOUT_MS / 1000}s`;
    if (output.length > MAX_OUTPUT_CHARS) output = output.slice(-MAX_OUTPUT_CHARS);
    resolve({ output: output.trimEnd(), exitCode: code });
  });
});

export type WatcherRunner = {
  stop: () => void;
  tick: () => Promise<void>;
  list: () => Watch[];
};

export function startWatcher(opts: {
  tickIntervalMs?: number;
  runCommand?: RunCommand;
  onEvent: (event: WatchEvent) => void | Promise<void>;
  silent?: boolean;
}): WatcherRunner {
  const tickMs = opts.tickIntervalMs ?? 15_000;
  const runCommand = opts.runCommand ?? runShellCommand;
  const running = new Set<string>();
  let stopped = false;

  const emit = async (event: WatchEvent) => {
    event.watch.pushes += 1;
    saveWatch(event.watch);
    try {
      await opts.onEvent(event);
    } catch (err) {
      console.error(`[watch] push failed for ${event.watch.id}:`, err);
    }
  };

  const check = async (watch: Watch) => {
    const now = Date.now();
    if (new Date(watch.expiresAt).getTime() <= now) {
      watch.status = 'expired';
      watch.doneAt = new Date(now).toISOString();
      await emit({ watch, reason: 'expired', output: watch.lastOutput ?? '' });
      return;
    }

    const { output, exitCode } = await runCommand(watch);
    const first = watch.ticks === 0;
    const changed = output !== watch.lastOutput || exitCode !== watch.lastExitCode;
    const done = !!watch.until && new RegExp(watch.until, 'm').test(output);

    watch.ticks += 1;
    watch.lastRunAt = new Date().toISOString();
    watch.lastOutput = output;
    watch.lastExitCode = exitCode;

    if (done) {
      watch.status = 'done';
      watch.doneAt = watch.lastRunAt;
      await emit({ watch, reason: 'done', output });
      return;
    }
    saveWatch(watch);
    // the first tick is the baseline: the agent just looked at this output when it set the watch
    if (first) return;
    if (watch.notify === 'change' && changed) await emit({ watch, reason: 'change', output });
  };

  const tick = async () => {
    if (stopped) return;
    // reload every tick: the codex mcp child writes watches straight to the db
    const now = Date.now();
    const due = loadWatches().filter(w => w.status === 'active' && !running.has(w.id)
      && (!w.lastRunAt || new Date(w.lastRunAt).getTime() + w.intervalSec * 1000 <= now));
    await Promise.all(due.map(async (w) => {
      running.add(w.id);
      try {
        await check(w);
      } catch (err) {
        console.error(`[watch] ${w.id} failed:`, err);
      } finally {
        running.delete(w.id);
      }
    }));
  };

  const timer = setInterval(() => { void tick(); }, tickMs);
  timer.unref?.();
  void tick();

  if (!opts.silent) {
    const active = loadWatches().filter(w => w.status === 'active').length;
    console.error(`[watch] started with ${active} active watches (tick: ${tickMs}ms)`);
  }

  return {
    stop: () => { stopped = true; clearInterval(timer); },
    tick,
    list: loadWatches,
  };
}

// text for a push: what changed, where to look
export function formatWatchEvent(event: WatchEvent): string {
  const { watch, reason, output } = event;
  const body = tail(output);
  if (reason === 'expired') return `Watch "${watch.summary}" expired after ${Math.round((Date.now() - new Date(watch.createdAt).getTime()) / 60000)} min without finishing.${body ? `\n\nLast output:\n${body}` : ''}`;
  if (reason === 'done') return `Watch "${watch.summary}" done.${body ? `\n\n${body}` : ''}`;
  return `Watch "${watch.summary}":\n\n${body || '(no output)'}`;
}
