import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Eye, Play, RotateCcw, Wrench, ChevronDown, Pencil } from 'lucide-react';
import type { Task, TaskPresentation } from './helpers';
import { getStatusBadge } from './helpers';

type Props = {
  task: Task;
  presentation: TaskPresentation;
  goalTitle?: string;
  onClick: () => void;
  onStart?: (mode?: 'plan' | 'execute') => void;
  onWatch?: () => void;
  onUnblock?: () => void;
  busy?: boolean;
};

export function TaskRow({ task, presentation, goalTitle, onClick, onStart, onWatch, onUnblock, busy }: Props) {
  const badge = getStatusBadge(presentation.label);

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/20"
      onClick={onClick}
    >
      <Wrench className="h-3 w-3 shrink-0 text-muted-foreground/40" />

      <div className={cn('h-1.5 w-1.5 shrink-0 rounded-full', presentation.dotClass)} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs leading-snug">{task.title}</span>
          <span className={cn('inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium leading-none', badge.bg, badge.text)}>
            {presentation.label}
          </span>
        </div>
        {goalTitle && (
          <div className="mt-0.5 text-[10px] text-muted-foreground/40">{goalTitle}</div>
        )}
      </div>

      <div
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={e => e.stopPropagation()}
      >
        {presentation.action === 'start' && onStart && (
          <div className="flex items-center">
            <Button variant="ghost" size="sm" className="h-6 rounded-r-none text-[10px]" disabled={busy} onClick={() => onStart('execute')}>
              <Play className="mr-1 h-2.5 w-2.5" />
              Start
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-5 rounded-l-none border-l border-border/30 p-0" disabled={busy}>
                  <ChevronDown className="h-2.5 w-2.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onStart('plan')}>
                  <Pencil className="mr-2 h-3 w-3" /> Plan first
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onStart('execute')}>
                  <Play className="mr-2 h-3 w-3" /> Execute now
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {presentation.action === 'watch' && onWatch && (
          <Button variant="ghost" size="sm" className="h-6 text-[10px]" disabled={busy} onClick={onWatch}>
            <Eye className="mr-1 h-2.5 w-2.5" />
            Watch
          </Button>
        )}
        {presentation.action === 'unblock' && onUnblock && (
          <Button variant="ghost" size="sm" className="h-6 text-[10px]" disabled={busy} onClick={onUnblock}>
            <RotateCcw className="mr-1 h-2.5 w-2.5" />
            Unblock
          </Button>
        )}
      </div>
    </button>
  );
}
