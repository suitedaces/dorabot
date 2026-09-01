import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextUsage } from '@/hooks/useGateway';

// deferred rows are out-of-window tool schemas the SDK excludes from usage math,
// and these two are window accounting rather than content — none belong in the
// "what is my conversation costing" list.
const NON_CONTENT = new Set(['Free space', 'Autocompact buffer']);

const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

function ring(pct: number) {
  if (pct >= 90) return 'stroke-red-500';
  if (pct >= 70) return 'stroke-amber-500';
  return 'stroke-muted-foreground';
}

type Props = {
  getContextUsage: (sessionKey: string, detail?: 'summary' | 'full') => Promise<ContextUsage>;
  sessionKey: string | undefined;
  isRunning: boolean;
};

/**
 * Context window indicator. The underlying RPC reads the live CLI process, so it
 * only answers while a run is active — we poll during a run and keep showing the
 * last good reading once it ends rather than blanking out.
 */
export function ContextWheel({ getContextUsage, sessionKey, isRunning }: Props) {
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!sessionKey || inFlight.current) return;
    inFlight.current = true;
    try {
      setUsage(await getContextUsage(sessionKey, 'summary'));
    } catch {
      // expected between runs ("no active run for that session") — keep last reading
    } finally {
      inFlight.current = false;
    }
  }, [getContextUsage, sessionKey]);

  // drop a stale reading when switching sessions
  useEffect(() => { setUsage(null); }, [sessionKey]);

  useEffect(() => {
    if (!isRunning) return;
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [isRunning, refresh]);

  if (!usage) return null;

  const pct = Math.min(usage.percentage, 100);
  const rows = usage.categories
    .filter(c => !c.isDeferred && !NON_CONTENT.has(c.name) && c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  const mcp = usage.mcpTools ?? [];
  const byServer = new Map<string, number>();
  for (const t of mcp) byServer.set(t.serverName, (byServer.get(t.serverName) ?? 0) + t.tokens);
  const servers = [...byServer.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="relative ml-1" onMouseEnter={() => { setOpen(true); refresh(); }} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="h-8 w-8 p-0 rounded-lg inline-flex items-center justify-center hover:bg-accent transition-colors"
        aria-label={`Context ${usage.percentage}% used`}
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4 -rotate-90">
          <circle cx="10" cy="10" r="7" fill="none" strokeWidth="3" className="stroke-border" />
          <circle
            cx="10" cy="10" r="7" fill="none" strokeWidth="3" strokeLinecap="round"
            className={ring(usage.percentage)}
            strokeDasharray={`${(pct / 100) * 2 * Math.PI * 7} ${2 * Math.PI * 7}`}
          />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border bg-popover text-popover-foreground shadow-lg p-3 z-50 text-[11px]">
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-medium">context</span>
            <span className="text-muted-foreground">
              {fmt(usage.totalTokens)} / {fmt(usage.rawMaxTokens)} ({usage.percentage}%)
            </span>
          </div>

          <div className="h-1 rounded-full bg-border overflow-hidden mb-2">
            <div
              className={`h-full ${usage.percentage >= 90 ? 'bg-red-500' : usage.percentage >= 70 ? 'bg-amber-500' : 'bg-muted-foreground'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {rows.map(c => (
            <div key={c.name} className="flex justify-between py-0.5 text-muted-foreground">
              <span className="truncate pr-2">{c.name}</span>
              <span className="tabular-nums shrink-0">{fmt(c.tokens)}</span>
            </div>
          ))}

          {servers.length > 0 && (
            <div className="mt-2 pt-2 border-t">
              <div className="text-muted-foreground/70 mb-1">mcp servers ({mcp.length} tools)</div>
              {servers.map(([name, tokens]) => (
                <div key={name} className="flex justify-between py-0.5 text-muted-foreground">
                  <span className="truncate pr-2">{name}</span>
                  <span className="tabular-nums shrink-0">{fmt(tokens)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 pt-2 border-t text-muted-foreground/60">
            {usage.model} · {isRunning ? 'live' : 'last reading'}
          </div>
        </div>
      )}
    </div>
  );
}
