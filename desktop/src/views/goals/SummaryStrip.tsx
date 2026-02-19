import { cn } from '@/lib/utils';
import { Activity, ShieldCheck, Clock3, Pencil, CircleSlash, CheckCircle2, Ban } from 'lucide-react';
import type { Task } from './helpers';
import type { TaskRun } from '../../hooks/useGateway';

export type TaskFilter = 'running' | 'pending' | 'ready' | 'planning' | 'blocked' | 'denied' | 'done' | null;

type Props = {
  tasks: Task[];
  taskRuns: Record<string, TaskRun>;
  activeFilter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
};

type StatItem = {
  count: number;
  label: string;
  filter: TaskFilter;
  icon: React.ReactNode;
  className?: string;
};

export function SummaryStrip({ tasks, taskRuns, activeFilter, onFilterChange }: Props) {
  const running = tasks.filter(t =>
    t.status === 'in_progress' || taskRuns[t.id]?.status === 'started'
  ).length;
  const waiting = tasks.filter(t =>
    t.status === 'planned' && !t.approvalRequestId && !!t.approvedAt
  ).length;
  const planning = tasks.filter(t => t.status === 'planning').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const approval = tasks.filter(t => t.status === 'planned' && !!t.approvalRequestId).length;
  const denied = tasks.filter(t =>
    t.status === 'planned' && !!t.reason && /denied/i.test(t.reason)
  ).length;

  const items: StatItem[] = [];
  if (running > 0) items.push({ count: running, label: 'running', filter: 'running', icon: <Activity className="h-3 w-3" />, className: 'text-foreground' });
  if (approval > 0) items.push({ count: approval, label: 'pending', filter: 'pending', icon: <ShieldCheck className="h-3 w-3" />, className: 'text-primary' });
  if (waiting > 0) items.push({ count: waiting, label: 'ready', filter: 'ready', icon: <Clock3 className="h-3 w-3" /> });
  if (planning > 0) items.push({ count: planning, label: 'planning', filter: 'planning', icon: <Pencil className="h-3 w-3" /> });
  if (blocked > 0) items.push({ count: blocked, label: 'blocked', filter: 'blocked', icon: <CircleSlash className="h-3 w-3" />, className: 'text-destructive' });
  if (denied > 0) items.push({ count: denied, label: 'denied', filter: 'denied', icon: <Ban className="h-3 w-3" />, className: 'text-destructive' });
  items.push({ count: done, label: 'done', filter: 'done', icon: <CheckCircle2 className="h-3 w-3" /> });

  if (tasks.length === 0) {
    return <div className="text-xs text-muted-foreground">no tasks yet</div>;
  }

  return (
    <div className="flex items-center gap-4 text-xs">
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          onClick={() => onFilterChange(activeFilter === item.filter ? null : item.filter)}
          className={cn(
            'flex items-center gap-1.5 transition-opacity',
            activeFilter && activeFilter !== item.filter && 'opacity-30',
            activeFilter === item.filter && 'underline underline-offset-4',
            item.className || 'text-muted-foreground',
          )}
        >
          {item.icon}
          <span className="font-medium">{item.count}</span>
          <span className="opacity-70">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
