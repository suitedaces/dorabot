// plan usage limits, one shape for every provider so the desktop shows a single meter

export type UsageWindow = {
  label: string;
  usedPercent: number;
  resetsAt?: number; // ms
};

export type ProviderUsage = {
  provider: 'claude' | 'codex';
  windows: UsageWindow[];
  plan?: string;
  updatedAt: number;
};

const latest = new Map<string, ProviderUsage>();
const listeners = new Set<(usage: ProviderUsage) => void>();

export function setProviderUsage(usage: ProviderUsage | null): void {
  if (!usage || usage.windows.length === 0) return;
  latest.set(usage.provider, usage);
  for (const listener of listeners) {
    try { listener(usage); } catch { /* ignore */ }
  }
}

export function getProviderUsage(provider: string): ProviderUsage | null {
  return latest.get(provider) || null;
}

export function onProviderUsage(listener: (usage: ProviderUsage) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function windowLabel(mins: number | null | undefined, fallback: string): string {
  if (!mins || mins <= 0) return fallback;
  if (mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}

type CodexWindow = { usedPercent?: number; windowDurationMins?: number | null; resetsAt?: number | null } | null | undefined;

// codex RateLimitSnapshot: primary/secondary windows, usedPercent 0-100, resetsAt in seconds
export function codexUsageFromSnapshot(snapshot: unknown): ProviderUsage | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const s = snapshot as { primary?: CodexWindow; secondary?: CodexWindow; planType?: string | null };
  const windows: UsageWindow[] = [];
  for (const [w, fallback] of [[s.primary, 'primary'], [s.secondary, 'secondary']] as const) {
    if (!w || typeof w.usedPercent !== 'number') continue;
    windows.push({
      label: windowLabel(w.windowDurationMins, fallback),
      usedPercent: w.usedPercent,
      ...(w.resetsAt ? { resetsAt: w.resetsAt * 1000 } : {}),
    });
  }
  return { provider: 'codex', windows, ...(s.planType ? { plan: s.planType } : {}), updatedAt: Date.now() };
}

const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d opus',
  seven_day_sonnet: '7d sonnet',
  seven_day_overage_included: '7d incl. overage',
};

type ClaudeWindow = { utilization?: number; resetsAt?: number };

// claude rate_limit_event: per-window utilization 0-1 (the cli renders it as utilization*100),
// resetsAt in seconds. unifiedWindows is marked internal in the cli schema, so absent = no meter.
export function claudeUsageFromRateLimitInfo(info: unknown, previous: ProviderUsage | null): ProviderUsage | null {
  if (!info || typeof info !== 'object') return null;
  const unified = (info as { unifiedWindows?: Record<string, ClaudeWindow | undefined> }).unifiedWindows;
  if (!unified || typeof unified !== 'object') return null;
  const byLabel = new Map((previous?.windows || []).map(w => [w.label, w]));
  for (const [key, w] of Object.entries(unified)) {
    if (!w || typeof w.utilization !== 'number') continue;
    const label = CLAUDE_WINDOW_LABELS[key] || key;
    byLabel.set(label, {
      label,
      usedPercent: Math.round(w.utilization * 100),
      ...(w.resetsAt ? { resetsAt: w.resetsAt * 1000 } : {}),
    });
  }
  const now = Date.now();
  const windows = [...byLabel.values()].filter(w => !w.resetsAt || w.resetsAt > now);
  return { provider: 'claude', windows, updatedAt: now };
}
