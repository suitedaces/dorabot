import { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Save, Trash2, CircleSlash, FileText, ExternalLink } from 'lucide-react';
import type { Task, TaskLog, Goal, TaskPresentation } from './helpers';
import type { useGateway } from '../../hooks/useGateway';

type Props = {
  task: Task | null;
  presentation: TaskPresentation | null;
  goals: Goal[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateway: ReturnType<typeof useGateway>;
  onSave: (taskId: string, updates: { title: string; goalId: string; reason: string; result: string }) => void;
  onBlock: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onViewPlan: (task: Task) => void;
  onViewSession: (task: Task) => void;
  busy?: boolean;
};

export function TaskDetailSheet({
  task, presentation, goals, open, onOpenChange,
  gateway, onSave, onBlock, onDelete, onViewPlan, onViewSession, busy,
}: Props) {
  const [title, setTitle] = useState('');
  const [goalId, setGoalId] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState('');
  const [logs, setLogs] = useState<TaskLog[]>([]);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title || '');
    setGoalId(task.goalId || '');
    setReason(task.reason || '');
    setResult(task.result || '');
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!task || !open) { setLogs([]); return; }
    gateway.rpc('tasks.logs', { id: task.id, limit: 30 })
      .then(res => { if (Array.isArray(res)) setLogs(res as TaskLog[]); })
      .catch(() => setLogs([]));
  }, [task?.id, open, gateway.taskLogsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(() => {
    if (!task) return;
    onSave(task.id, { title: title.trim() || task.title, goalId, reason, result });
  }, [task, title, goalId, reason, result, onSave]);

  if (!task || !presentation) return null;

  const hasSession = !!(task.sessionId || task.sessionKey);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-md p-0">
        <SheetHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className={cn('h-2 w-2 rounded-full', presentation.dotClass)} />
            <span className="text-[10px] text-muted-foreground">{presentation.label}</span>
          </div>
          <SheetTitle className="text-sm font-medium">{task.title}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-6 space-y-5">
          <div className="space-y-3">
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="title"
              className="text-sm"
            />

            <Select
              value={goalId || '__none'}
              onValueChange={v => setGoalId(v === '__none' ? '' : v)}
            >
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="goal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">no goal</SelectItem>
                {goals.map(g => (
                  <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="notes"
              className="text-xs"
            />

            <Textarea
              value={result}
              onChange={e => setResult(e.target.value)}
              placeholder="result"
              className="min-h-[80px] text-xs"
            />
          </div>

          <Separator />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onViewPlan(task)}
            >
              <FileText className="mr-1.5 h-3 w-3" />
              View plan
            </Button>
            {hasSession && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onViewSession(task)}
              >
                <ExternalLink className="mr-1.5 h-3 w-3" />
                Open session
              </Button>
            )}
          </div>

          {task.result && (
            <>
              <Separator />
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">result</div>
                <div className="prose-chat text-xs">
                  <Markdown remarkPlugins={[remarkGfm]}>{task.result}</Markdown>
                </div>
              </div>
            </>
          )}

          <Separator />

          <div>
            <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">activity</div>
            <div className="space-y-1 max-h-44 overflow-auto">
              {logs.length === 0 && (
                <div className="text-[10px] text-muted-foreground">no activity yet</div>
              )}
              {logs.map(log => (
                <div key={log.id} className="text-[10px] text-muted-foreground">
                  <span className="text-muted-foreground/50">
                    {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {' '}
                  <span className="text-muted-foreground/70">{log.eventType}</span>
                  {' '}
                  <span className="text-foreground/70">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <SheetFooter className="flex-row items-center gap-2 border-t border-border px-6 py-4">
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={handleSave}
            disabled={busy}
          >
            <Save className="mr-1.5 h-3 w-3" />
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => onBlock(task.id)}
            disabled={busy}
          >
            <CircleSlash className="mr-1.5 h-3 w-3" />
            Block
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-destructive hover:text-destructive"
            onClick={() => onDelete(task.id)}
            disabled={busy}
          >
            <Trash2 className="mr-1.5 h-3 w-3" />
            Delete
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
