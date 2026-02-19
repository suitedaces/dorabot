import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ShieldCheck, FileText, Check, X } from 'lucide-react';
import type { Task, Goal } from './helpers';

type Props = {
  tasks: Task[];
  goalsById: Map<string, Goal>;
  onApprove: (task: Task) => void;
  onDeny: (task: Task, reason?: string) => void;
  onViewPlan: (task: Task) => void;
  busy?: string | null;
};

export function ApprovalBanner({ tasks, goalsById, onApprove, onDeny, onViewPlan, busy }: Props) {
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');

  if (tasks.length === 0) return null;

  const handleDeny = (task: Task) => {
    if (denyingId === task.id) {
      onDeny(task, denyReason.trim() || undefined);
      setDenyingId(null);
      setDenyReason('');
    } else {
      setDenyingId(task.id);
      setDenyReason('');
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card glass">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          tasks needing your approval
        </div>
      </div>

      <div className="divide-y divide-border/50">
        {tasks.map(task => {
          const goal = task.goalId ? goalsById.get(task.goalId) : null;
          const isBusy = !!busy && (busy === `task:${task.id}:approve` || busy === `task:${task.id}:deny`);

          return (
            <div key={task.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {goal && (
                    <div className="text-[10px] text-muted-foreground">{goal.title}</div>
                  )}
                  <div className="text-sm font-medium">{task.title}</div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-primary"
                    onClick={() => onViewPlan(task)}
                  >
                    <FileText className="mr-1 h-3 w-3" />
                    Plan
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={isBusy}
                    onClick={() => handleDeny(task)}
                    title="Deny"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500"
                    disabled={isBusy}
                    onClick={() => onApprove(task)}
                    title="Approve"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {denyingId === task.id && (
                <div className="mt-2 flex items-end gap-2">
                  <Textarea
                    value={denyReason}
                    onChange={e => setDenyReason(e.target.value)}
                    placeholder="reason (optional)"
                    className="min-h-[60px] text-xs"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setDenyingId(null); setDenyReason(''); }
                      if (e.key === 'Enter' && e.metaKey) { onDeny(task, denyReason.trim() || undefined); setDenyingId(null); setDenyReason(''); }
                    }}
                  />
                  <div className="flex flex-col gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={isBusy}
                      onClick={() => { onDeny(task, denyReason.trim() || undefined); setDenyingId(null); setDenyReason(''); }}
                    >
                      Send
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => { setDenyingId(null); setDenyReason(''); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
