import { memo, useMemo, useState, type ReactNode } from 'react';
import { Brain, ChevronRight, ExternalLink, GitPullRequest, Info, Loader2, Minimize2, RotateCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { ChatItem } from '@/hooks/useGateway';
import { cn } from '@/lib/utils';
import { formatDuration, useNow } from './hooks';
import { Md, ScrollBox, Tag, ToolCard } from './primitives';
import { describeTool, type Kind, type ToolCtx, type ToolItem } from './tools';

type ThinkingItem = Extract<ChatItem, { type: 'thinking' }>;
type NoticeItem = Extract<ChatItem, { type: 'notice' }>;
export type ActivityItem = ToolItem | ThinkingItem | NoticeItem;

export type DisplayItem =
  | { type: 'item'; item: ChatItem; index: number }
  | { type: 'activity'; items: ActivityItem[]; index: number; lastIndex: number };

const isActivity = (it: ChatItem): it is ActivityItem =>
  (it.type === 'tool_use' && !(it.name === 'AskUserQuestion' && it.output == null)) || it.type === 'thinking' || it.type === 'notice';

// back-to-back tool calls and thinking become one activity group; anything else breaks it.
// groups only ever grow at the end, so list indices stay stable while a turn streams.
export function buildDisplay(items: ChatItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'tool_use' && it.name === 'AskUserQuestion' && it.output == null) continue; // the question panel shows it
    if (isActivity(it)) {
      const last = out[out.length - 1];
      if (last && last.type === 'activity') { last.items.push(it); last.lastIndex = i; continue; }
      out.push({ type: 'activity', items: [it], index: i, lastIndex: i });
      continue;
    }
    out.push({ type: 'item', item: it, index: i });
  }
  return out;
}

export type ListCtx = Omit<ToolCtx, 'live' | 'depth' | 'renderNested'> & { liveId: string | null; thinkingTokens?: number };

const KIND_LABEL: Record<Kind, [string, string]> = {
  command: ['Ran 1 command', 'Ran % commands'],
  read: ['Read 1 file', 'Read % files'],
  edit: ['Edited 1 file', 'Edited % files'],
  write: ['Wrote 1 file', 'Wrote % files'],
  search: ['1 search', '% searches'],
  fetch: ['Fetched 1 page', 'Fetched % pages'],
  agent: ['1 agent', '% agents'],
  browser: ['1 browser action', '% browser actions'],
  plan: ['updated the plan', 'updated the plan'],
  other: ['1 other', '% other'],
};
const KIND_ORDER: Kind[] = ['agent', 'command', 'edit', 'write', 'read', 'search', 'fetch', 'browser', 'plan', 'other'];

// one tool row, open while it holds the live slot unless you opened or closed it yourself
export const ToolRow = memo(function ToolRow({ item, ctx }: { item: ToolItem; ctx: ToolCtx }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const spec = describeTool(item, ctx);
  const open = manual ?? ctx.live;
  const subline = spec.kind === 'agent' && spec.status === 'running'
    ? (ctx.progressByToolUse.get(item.id)?.summary ? `now: ${ctx.progressByToolUse.get(item.id)!.summary}` : undefined)
    : undefined;
  return (
    <div id={`tool-${item.id}`} className={item.withdrawn ? 'opacity-50' : undefined}>
      <ToolCard
        icon={spec.icon}
        verb={spec.verb}
        target={spec.target}
        facts={item.withdrawn ? <Tag tone="warn">withdrawn</Tag> : spec.facts}
        status={spec.status}
        startedAt={item.timestamp}
        endedAt={spec.endedAt ?? item.endedAt}
        actions={spec.actions}
        dim={spec.dim}
        subline={subline}
        open={open}
        onToggle={() => setManual(!open)}
      >
        {spec.body && open ? spec.body() : spec.body ? <span /> : null}
      </ToolCard>
    </div>
  );
});

const NOTICE_ICON = { refusal: ShieldAlert, retry: RotateCw, info: Info, error: TriangleAlert, compact: Minimize2, ship: GitPullRequest } as const;

export const NoticeRow = memo(function NoticeRow({ item }: { item: NoticeItem }) {
  const [open, setOpen] = useState(false);
  const Icon = NOTICE_ICON[item.kind as keyof typeof NOTICE_ICON] || Info;
  const tone = item.level === 'error' ? 'text-destructive' : item.level === 'warning' ? 'text-warning' : 'text-muted-foreground';
  return (
    <div className="rounded-md min-w-0">
      <div
        role={item.detail ? 'button' : undefined}
        onClick={item.detail ? () => setOpen(v => !v) : undefined}
        className={cn('flex items-start gap-2 px-2 py-[5px] text-xs rounded-md', item.detail && 'cursor-pointer hover:bg-secondary/50')}
      >
        <Icon className={cn('w-3.5 h-3.5 mt-[2px] shrink-0', tone)} />
        <span className={cn('flex-1 min-w-0 [overflow-wrap:anywhere]', tone)}>{item.text}</span>
        {item.url && (
          <button type="button" onClick={e => { e.stopPropagation(); const api = (window as any).electronAPI; api?.openExternal ? api.openExternal(item.url) : window.open(item.url, '_blank'); }} className="flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground shrink-0">
            <ExternalLink className="w-3 h-3" />open
          </button>
        )}
        {item.detail && <ChevronRight className={cn('w-3 h-3 mt-[3px] shrink-0 text-muted-foreground/70 transition-transform', open && 'rotate-90')} />}
      </div>
      {open && item.detail && <div className="pl-[30px] pr-3 pb-2 text-[11px] text-muted-foreground whitespace-pre-wrap">{item.detail}</div>}
    </div>
  );
});

export const ThinkingRow = memo(function ThinkingRow({ item, tokens }: { item: ThinkingItem; tokens?: number }) {
  const [open, setOpen] = useState(false);
  const text = item.content?.trim() || '';
  if (!text && !item.streaming) return null;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const target = item.streaming ? sentences[sentences.length - 1] : sentences[0];
  return (
    <div className={item.withdrawn ? 'opacity-50' : undefined}>
    <ToolCard
      icon={Brain}
      verb={item.streaming ? 'Thinking' : 'Thought'}
      target={target}
      facts={item.streaming && tokens ? `~${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens` : undefined}
      status="none"
      dim
      open={open}
      onToggle={() => setOpen(v => !v)}
    >
      {text ? <ScrollBox follow={text} live={!!item.streaming && open}><Md text={text} className="text-muted-foreground" /></ScrollBox> : null}
    </ToolCard>
    </div>
  );
});

function ctxFor(base: ListCtx, item: ActivityItem, depth: number, renderNested: ToolCtx['renderNested']): ToolCtx {
  return { ...base, live: item.type === 'tool_use' && item.id === base.liveId, depth, renderNested };
}

function renderRow(item: ActivityItem, base: ListCtx, depth: number, renderNested: ToolCtx['renderNested'], key: string | number) {
  if (item.type === 'thinking') return <ThinkingRow key={key} item={item} tokens={item.streaming ? base.thinkingTokens : undefined} />;
  if (item.type === 'notice') return <NoticeRow key={key} item={item} />;
  return <ToolRow key={key} item={item} ctx={ctxFor(base, item, depth, renderNested)} />;
}

// nested calls inside a subagent: same rows, their own live slot (the newest call while it runs)
function makeNestedRenderer(base: ListCtx, parentRunning: boolean): NonNullable<ToolCtx['renderNested']> {
  const render = (items: ChatItem[], depth: number): ReactNode => {
    const tools = items.filter((it): it is ToolItem => it.type === 'tool_use');
    const lastId = parentRunning ? tools[tools.length - 1]?.id ?? null : null;
    const ctx: ListCtx = { ...base, liveId: lastId, turnRunning: parentRunning };
    return items.map((it, i) => {
      if (it.type === 'text') return <Md key={i} text={it.content} className="text-muted-foreground py-1" />;
      if (it.type !== 'tool_use' && it.type !== 'thinking') return null;
      // depth 3+ stays one row; its own card opens the transcript instead of nesting further
      return renderRow(it, ctx, depth, depth >= 2 ? undefined : render, i);
    });
  };
  return render;
}

export const ActivityGroup = memo(function ActivityGroup({ items, base, active }: { items: ActivityItem[]; base: ListCtx; active: boolean }) {
  const visible = items.filter(it => it.type !== 'thinking' || it.content?.trim() || it.streaming);
  const [manual, setManual] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<'all' | 'failed' | Kind>('all');
  const nested = useMemo(() => makeNestedRenderer(base, base.turnRunning), [base]);
  const specs = useMemo(() => {
    const m = new Map<string, ReturnType<typeof describeTool>>();
    for (const it of visible) if (it.type === 'tool_use') m.set(it.id, describeTool(it, ctxFor(base, it, 0, undefined)));
    return m;
  }, [visible, base]);

  const now = useNow(active);
  if (visible.length === 0) return null;
  if (visible.length === 1) return renderRow(visible[0], base, 0, nested, 0);

  const counts = new Map<Kind, number>();
  let failed = 0;
  for (const s of specs.values()) {
    counts.set(s.kind, (counts.get(s.kind) || 0) + 1);
    if (s.status === 'error') failed++;
  }
  const parts: ReactNode[] = [];
  if (failed) parts.push(<span key="f" className="text-destructive">{failed} failed</span>);
  for (const k of KIND_ORDER) {
    const n = counts.get(k);
    if (!n) continue;
    const [one, many] = KIND_LABEL[k];
    parts.push(<span key={k} className="text-foreground font-medium">{(n === 1 ? one : many).replace('%', String(n))}</span>);
  }
  const agentsRunning = [...specs.values()].filter(s => s.kind === 'agent' && s.status === 'running').length;
  if (agentsRunning) parts.push(<span key="ar" className="text-primary">{agentsRunning} running</span>);

  const notices = visible.filter((it): it is NoticeItem => it.type === 'notice');
  const stops = notices.filter(n => n.kind === 'refusal').length;
  if (stops) parts.unshift(<span key="s" className="text-warning">{stops} safety stop{stops === 1 ? '' : 's'}</span>);
  const first = visible[0].timestamp;
  const lastEnd = Math.max(...visible.map(it => (it.type === 'tool_use' ? it.endedAt ?? it.timestamp : it.timestamp)));
  const duration = formatDuration((active ? now : lastEnd) - first);
  const open = manual ?? active;
  const showFilters = visible.length > 20;
  const shown = filter === 'all' ? visible : visible.filter(it => {
    if (it.type !== 'tool_use') return false;
    const s = specs.get(it.id)!;
    return filter === 'failed' ? s.status === 'error' : s.kind === filter;
  });

  return (
    <div className="rounded-lg border border-border/50 bg-[var(--stream-base)] min-w-0">
      <button type="button" data-activity-group onClick={() => setManual(!open)} aria-expanded={open} className="w-full flex items-start gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-secondary/40 rounded-lg">
        {active ? <Loader2 className="w-3.5 h-3.5 mt-[2px] animate-spin text-muted-foreground shrink-0" /> : <ChevronRight className={cn('w-3.5 h-3.5 mt-[2px] text-muted-foreground shrink-0 transition-transform', open && 'rotate-90')} />}
        <span className="flex-1 min-w-0 leading-relaxed text-muted-foreground">
          {active && <span className="compacting-sheen font-medium mr-2">Working</span>}
          {parts.map((p, i) => <span key={i}>{i > 0 && <span className="mx-1.5 text-muted-foreground/50">·</span>}{p}</span>)}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 mt-px">{duration}</span>
      </button>
      {open && (
        <div className="border-t border-border/40 p-1 flex flex-col gap-px min-w-0">
          {showFilters && (
            <div className="flex flex-wrap gap-1 px-1.5 py-1">
              {(['all', ...(failed ? ['failed'] : []), ...KIND_ORDER.filter(k => counts.get(k))] as Array<'all' | 'failed' | Kind>).map(f => (
                <button key={f} type="button" onClick={() => setFilter(f)} className={cn('text-[10.5px] px-2 py-0.5 rounded-full border border-border/60', filter === f ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground', f === 'failed' && 'text-destructive')}>
                  {f === 'all' ? `All ${visible.length}` : f === 'failed' ? `Failed ${failed}` : `${f} ${counts.get(f)}`}
                </button>
              ))}
            </div>
          )}
          {shown.map((it, i) => renderRow(it, base, 0, nested, it.type === 'tool_use' ? it.id : `t${i}`))}
        </div>
      )}
    </div>
  );
});
