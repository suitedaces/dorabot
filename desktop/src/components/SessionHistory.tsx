import { useState, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { MessageSquare, Trash2, Radio, Clock, Search } from 'lucide-react';
import type { SessionInfo } from '../hooks/useGateway';

type Props = {
  sessions: SessionInfo[];
  onOpenSession: (session: SessionInfo) => void;
  onDeleteSession?: (sessionId: string) => void;
};

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'unknown';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'just now'; // future date (clock drift)
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function channelLabel(channel?: string): string {
  if (channel === 'telegram') return 'Telegram';
  if (channel === 'whatsapp') return 'WhatsApp';
  if (channel === 'calendar') return 'Schedule';
  return 'Desktop';
}

export function SessionHistory({ sessions, onOpenSession, onDeleteSession }: Props) {
  const [filter, setFilter] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!filter) return sessions;
    const q = filter.toLowerCase();
    return sessions.filter(s =>
      s.preview?.toLowerCase().includes(q)
      || s.id.toLowerCase().includes(q)
      || s.senderName?.toLowerCase().includes(q)
    );
  }, [sessions, filter]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: Array<{ label: string; sessions: SessionInfo[] }> = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const weekAgo = new Date(today.getTime() - 7 * 86_400_000);

    const todayGroup: SessionInfo[] = [];
    const yesterdayGroup: SessionInfo[] = [];
    const thisWeekGroup: SessionInfo[] = [];
    const olderGroup: SessionInfo[] = [];

    for (const s of filtered) {
      const d = new Date(s.updatedAt);
      if (isNaN(d.getTime())) { olderGroup.push(s); continue; }
      if (d >= today) todayGroup.push(s);
      else if (d >= yesterday) yesterdayGroup.push(s);
      else if (d >= weekAgo) thisWeekGroup.push(s);
      else olderGroup.push(s);
    }

    if (todayGroup.length) groups.push({ label: 'Today', sessions: todayGroup });
    if (yesterdayGroup.length) groups.push({ label: 'Yesterday', sessions: yesterdayGroup });
    if (thisWeekGroup.length) groups.push({ label: 'This Week', sessions: thisWeekGroup });
    if (olderGroup.length) groups.push({ label: 'Older', sessions: olderGroup });

    return groups;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-secondary/50">
          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {grouped.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {filter ? 'No matching sessions' : 'No sessions yet'}
            </div>
          )}
          {grouped.map(group => (
            <div key={group.label}>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {group.label}
              </div>
              {group.sessions.map(s => (
                <div
                  key={s.id}
                  className={cn(
                    'group flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors',
                    'hover:bg-secondary/60'
                  )}
                  onClick={() => onOpenSession(s)}
                >
                  <div className="shrink-0 mt-0.5">
                    {s.activeRun ? (
                      <Radio className="w-3.5 h-3.5 text-green-500 animate-pulse" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate">
                      {s.preview || s.id.slice(0, 20)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                      <span>{channelLabel(s.channel)}</span>
                      <span>{s.messageCount} msgs</span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {formatRelativeDate(s.updatedAt)}
                      </span>
                    </div>
                  </div>
                  {onDeleteSession && !s.activeRun && (
                    confirmDeleteId === s.id ? (
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="px-1.5 py-0.5 text-[10px] rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => { onDeleteSession(s.id); setConfirmDeleteId(null); }}
                        >
                          Delete
                        </button>
                        <button
                          className="px-1.5 py-0.5 text-[10px] rounded bg-secondary text-muted-foreground hover:bg-secondary/80"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(s.id);
                        }}
                        title="Delete session"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
