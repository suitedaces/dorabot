import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronRight, Loader2, Maximize2, Minimize2, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration, useNow, useStickToBottom } from './hooks';

export type CardStatus = 'running' | 'ok' | 'error' | 'waiting' | 'stopped' | 'none';

export type CardAction = { icon: LucideIcon; label: string; onClick: () => void };

type CardProps = {
  icon: LucideIcon;
  verb: string;
  target?: string;
  facts?: ReactNode;
  status: CardStatus;
  startedAt?: number;
  endedAt?: number;
  actions?: CardAction[];
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
  dim?: boolean;
  subline?: ReactNode;
};

// one row for every tool: icon, verb, target, facts, status, time. the body is optional and
// only rendered while open.
export const ToolCard = memo(function ToolCard({ icon: Icon, verb, target, facts, status, startedAt, endedAt, actions, open, onToggle, children, dim, subline }: CardProps) {
  const lines = target ? target.split('\n') : [];
  const first = lines[0] ?? '';
  const more = lines.length - 1;
  const running = status === 'running';
  const now = useNow(running);
  const ms = startedAt ? (endedAt ?? (running ? now : undefined)) : undefined;
  const duration = startedAt && ms ? formatDuration(ms - startedAt) : '';
  const hasBody = !!children;

  return (
    <div className={cn('rounded-md min-w-0', open && hasBody && 'bg-[var(--stream-mid)]')}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={hasBody ? open : undefined}
        onClick={hasBody ? onToggle : undefined}
        onKeyDown={e => { if (hasBody && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } }}
        className={cn('group/row flex items-start gap-2 px-2 py-[5px] rounded-md text-xs min-w-0', hasBody && 'cursor-pointer hover:bg-secondary/50')}
      >
        <Icon className={cn('w-3.5 h-3.5 mt-[2px] shrink-0', status === 'error' ? 'text-destructive' : 'text-muted-foreground')} />
        <span className={cn('font-medium shrink-0', dim ? 'text-muted-foreground font-normal' : 'text-foreground')}>{verb}</span>
        <span className="text-muted-foreground text-[11.5px] min-w-0 flex-1 [overflow-wrap:anywhere] line-clamp-2" title={target}>
          {first}
          {more > 0 && <span className="ml-1.5 text-[10px] px-1 py-px rounded border border-border/60 whitespace-nowrap">+{more} line{more === 1 ? '' : 's'}</span>}
        </span>
        {facts && <span className="text-muted-foreground text-[11px] whitespace-nowrap tabular-nums shrink-0 mt-px">{facts}</span>}
        {actions && actions.length > 0 && (
          <span className="hidden group-hover/row:flex group-focus-within/row:flex items-center gap-0.5 shrink-0 -my-0.5" onClick={e => e.stopPropagation()}>
            {actions.map(a => <ActionButton key={a.label} action={a} />)}
          </span>
        )}
        <StatusIcon status={status} />
        <span className="text-muted-foreground text-[11px] w-11 text-right tabular-nums shrink-0 mt-px">{duration}</span>
        <ChevronRight className={cn('w-3 h-3 mt-[3px] shrink-0 text-muted-foreground/70 transition-transform', open && 'rotate-90', !hasBody && 'invisible')} />
      </div>
      {subline && <div className="pl-[30px] pr-2 -mt-0.5 pb-1 text-[11px] text-muted-foreground break-words">{subline}</div>}
      {open && hasBody && <div className="border-t border-border/40 min-w-0">{children}</div>}
    </div>
  );
});

// icon only; the label is the tooltip. copy actions flash a check so you know it worked.
function ActionButton({ action: a }: { action: CardAction }) {
  const [done, setDone] = useState(false);
  const Icon = done ? Check : a.icon;
  return (
    <button
      type="button"
      title={a.label}
      aria-label={a.label}
      onClick={() => {
        a.onClick();
        if (a.label.startsWith('copy')) { setDone(true); setTimeout(() => setDone(false), 1000); }
      }}
      className={cn('w-[22px] h-[22px] flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary', done && 'text-success hover:text-success')}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function StatusIcon({ status }: { status: CardStatus }) {
  const cls = 'w-3.5 h-3.5 shrink-0 mt-[2px]';
  if (status === 'running') return <Loader2 className={cn(cls, 'animate-spin text-muted-foreground')} />;
  if (status === 'ok') return <Check className={cn(cls, 'text-success')} />;
  if (status === 'error') return <X className={cn(cls, 'text-destructive')} />;
  return <span className={cls} />;
}

export function Tag({ tone = 'muted', children }: { tone?: 'muted' | 'run' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  const tones = {
    muted: 'text-muted-foreground bg-secondary/60',
    run: 'text-primary bg-primary/10',
    ok: 'text-success bg-success/10',
    warn: 'text-warning bg-warning/10',
    bad: 'text-destructive bg-destructive/10',
  };
  return <span className={cn('text-[10px] px-1.5 py-px rounded whitespace-nowrap', tones[tone])}>{children}</span>;
}

export function DiffStat({ add, del }: { add: number; del: number }) {
  return <span><span className="text-success">+{add}</span> <span className="text-destructive">−{del}</span></span>;
}

// a scrolling box. while live it has a fixed height (so the chat does not jump) and follows
// the newest content; otherwise it caps at the same height. "expand" removes the cap.
export function ScrollBox({ live, follow, children, className }: { live?: boolean; follow: unknown; children: ReactNode; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { ref, onScroll, detached, resume } = useStickToBottom<HTMLDivElement>(follow, !!live);
  return (
    <div className="relative group/box">
      <div
        ref={ref}
        onScroll={onScroll}
        className={cn('overflow-auto bg-[var(--stream-deep)] rounded-b-md', expanded ? 'max-h-none' : live ? 'h-[220px]' : 'max-h-[220px]', className)}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        title={expanded ? 'shrink' : 'show all'}
        className="absolute top-1.5 right-2 p-1 rounded bg-background/80 text-muted-foreground hover:text-foreground opacity-0 group-hover/box:opacity-100 transition-opacity"
      >
        {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
      </button>
      {detached && (
        <button type="button" onClick={resume} className="absolute bottom-2 right-3 text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground shadow">
          follow ↓
        </button>
      )}
    </div>
  );
}

const WINDOW_LINES = 4000;
const LINE_PX = 18;

// plain text, never cut. past a few thousand lines it draws only the visible ones.
export const TextBlock = memo(function TextBlock({ text, tone }: { text: string; tone?: 'error' }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const cls = cn('px-3 py-2 font-mono text-[11px] whitespace-pre-wrap break-words', tone === 'error' ? 'text-destructive/90' : 'text-muted-foreground');
  if (lines.length <= WINDOW_LINES) return <pre className={cn(cls, 'leading-[18px] m-0')}>{text}</pre>;
  return <WindowedLines lines={lines} className={cls} />;
});

function WindowedLines({ lines, className }: { lines: string[]; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const from = Math.max(0, Math.floor(top / LINE_PX) - 50);
  const to = Math.min(lines.length, from + 200);
  return (
    <div ref={ref} onScroll={e => setTop((e.target as HTMLDivElement).scrollTop)} className="max-h-[600px] overflow-auto">
      <div style={{ height: lines.length * LINE_PX, position: 'relative' }} className={className}>
        <div style={{ position: 'absolute', top: from * LINE_PX, left: 12, right: 12 }}>
          {lines.slice(from, to).map((l, i) => <div key={from + i} className="whitespace-pre overflow-hidden" style={{ height: LINE_PX, lineHeight: `${LINE_PX}px` }}>{l || ' '}</div>)}
        </div>
      </div>
    </div>
  );
}

export function Md({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('prose-chat text-xs px-3 py-2 min-w-0', className)}>
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// the site's own favicon (no third-party favicon service), letter tile if it has none
export function Favicon({ url }: { url: string }) {
  const host = hostOf(url);
  const [failed, setFailed] = useState(false);
  const hue = [...host].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  if (failed || !/^https?:/.test(url)) {
    return (
      <span className="w-4 h-4 rounded shrink-0 inline-flex items-center justify-center text-[9px] font-bold text-black/80" style={{ background: `oklch(0.78 0.11 ${hue})` }}>
        {(host[0] || '?').toUpperCase()}
      </span>
    );
  }
  let origin = '';
  try { origin = new URL(url).origin; } catch { /* letter tile above */ }
  return <img src={`${origin}/favicon.ico`} alt="" className="w-4 h-4 rounded shrink-0" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function KeyValues({ entries }: { entries: Array<[string, ReactNode]> }) {
  if (!entries.length) return null;
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-3 py-2 text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="text-muted-foreground">{k}</span>
          <span className="text-foreground break-words min-w-0">{v}</span>
        </div>
      ))}
    </div>
  );
}
