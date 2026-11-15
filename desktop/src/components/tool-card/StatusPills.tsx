import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, ListTodo, Activity, Square, SquareTerminal, X } from 'lucide-react';
import type { SdkBackgroundTask, TaskProgress } from '@/hooks/useGateway';
import { cn } from '@/lib/utils';

// a pill in the composer toolbar that opens a panel over the chat. the panel never takes
// layout space, and closes on click-away or escape.
function PillPanel({ label, children, title }: { label: ReactNode; children: ReactNode; title: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={cn('h-7 flex items-center gap-1.5 px-2 rounded-lg text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 whitespace-nowrap', open && 'bg-secondary/60 text-foreground')}
      >
        {label}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-50 w-[min(520px,calc(100vw-48px))] max-h-[min(60vh,520px)] overflow-auto rounded-xl border border-border shadow-2xl backdrop-blur-2xl bg-background">
          {/* both theme colors are translucent; stacked they read as solid in every palette */}
          <div className="bg-popover min-h-full">
          {children}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlanPill({ items }: { items: Array<{ content: string; status: string; activeForm: string }> }) {
  if (!items.length) return null;
  const done = items.filter(i => i.status === 'completed').length;
  const doing = items.find(i => i.status === 'in_progress');
  return (
    <PillPanel title={doing?.activeForm || 'plan'} label={<><ListTodo className="w-3.5 h-3.5" /><span className="tabular-nums">plan {done}/{items.length}</span></>}>
      <div className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border/50">{doing ? doing.activeForm : done === items.length ? 'all done' : 'plan'}</div>
      <div className="py-1.5">
        {items.map((t, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-0.5 text-[11.5px] leading-relaxed">
            <span className={cn('w-3.5 h-3.5 mt-[3px] rounded border shrink-0 flex items-center justify-center text-[9px]', t.status === 'completed' ? 'bg-success border-success text-background' : t.status === 'in_progress' ? 'border-primary' : 'border-border')}>{t.status === 'completed' ? '✓' : ''}</span>
            <span className={cn(t.status === 'completed' ? 'text-muted-foreground line-through' : t.status === 'in_progress' ? 'text-foreground font-medium' : 'text-foreground/80')}>{t.content}</span>
          </div>
        ))}
      </div>
    </PillPanel>
  );
}

const KIND: Record<string, { label: string; icon: typeof Bot }> = {
  local_agent: { label: 'agents', icon: Bot },
  local_bash: { label: 'commands', icon: SquareTerminal },
  monitor_ws: { label: 'watches', icon: Activity },
};

export function RunningPill({ tasks, progress, onStop, onJump }: {
  tasks: SdkBackgroundTask[];
  progress: Record<string, TaskProgress>;
  onStop: (taskId: string) => void;
  onJump: (toolUseId: string) => void;
}) {
  if (!tasks.length) return null;
  const groups = new Map<string, SdkBackgroundTask[]>();
  for (const t of tasks) {
    const k = KIND[t.taskType] ? t.taskType : 'other';
    groups.set(k, [...(groups.get(k) || []), t]);
  }
  return (
    <PillPanel title="background work in this chat" label={<><span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /><span className="tabular-nums">{tasks.length} running</span></>}>
      {[...groups.entries()].map(([kind, list]) => {
        const meta = KIND[kind] || { label: 'other', icon: Square };
        return (
          <div key={kind} className="py-1">
            <div className="flex items-center gap-1.5 px-3 py-1 text-[10.5px] text-muted-foreground"><meta.icon className="w-3 h-3" />{list.length} {meta.label}</div>
            {list.map(t => {
              const p = progress[t.taskId];
              return (
                <div key={t.taskId} className="group/task flex items-start gap-2 px-3 py-1 hover:bg-secondary/50">
                  <span className="w-1.5 h-1.5 mt-[7px] rounded-full bg-primary animate-pulse shrink-0" />
                  <button type="button" disabled={!p?.toolUseId} onClick={() => p?.toolUseId && onJump(p.toolUseId)} className="flex-1 min-w-0 text-left">
                    <div className="text-[11.5px] text-foreground break-words">{t.description}</div>
                    {p?.summary && <div className="text-[10.5px] text-muted-foreground break-words">now: {p.summary}</div>}
                  </button>
                  {p && p.toolCount > 0 && <span className="text-[10.5px] text-muted-foreground tabular-nums whitespace-nowrap mt-0.5">{p.toolCount} calls</span>}
                  <button type="button" title="stop" onClick={() => onStop(t.taskId)} className="p-0.5 mt-0.5 rounded text-muted-foreground opacity-0 group-hover/task:opacity-100 hover:text-destructive hover:bg-destructive/10">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </PillPanel>
  );
}
