import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ChevronRight, MoreHorizontal, Plus, Pause, Play, Check, Trash2, Target } from 'lucide-react';
import { TaskRow } from './TaskRow';
import type { Goal, Task, TaskPresentation } from './helpers';
import { getGoalColor } from './helpers';

type Props = {
  goal: Goal;
  tasks: Task[];
  presentations: Map<string, TaskPresentation>;
  defaultOpen?: boolean;
  onTaskClick: (task: Task) => void;
  onStartTask: (taskId: string, mode?: 'plan' | 'execute') => void;
  onWatchTask: (task: Task) => void;
  onUnblockTask: (taskId: string) => void;
  onToggleGoalStatus: (goal: Goal) => void;
  onCompleteGoal: (goal: Goal) => void;
  onDeleteGoal: (goalId: string) => void;
  onCreateTask: (title: string, goalId: string) => void;
  busy?: string | null;
};

export function GoalSection({
  goal, tasks, presentations, defaultOpen = true,
  onTaskClick, onStartTask, onWatchTask, onUnblockTask,
  onToggleGoalStatus, onCompleteGoal, onDeleteGoal, onCreateTask, busy,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const isDismissed = (t: Task) =>
    t.status === 'done' || t.status === 'cancelled' ||
    (t.status === 'planned' && !!t.reason && /denied/i.test(t.reason));
  const activeTasks = tasks.filter(t => !isDismissed(t));
  const dismissedTasks = tasks.filter(t => isDismissed(t));
  const [showDismissed, setShowDismissed] = useState(false);

  const handleAddTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    onCreateTask(title, goal.id);
    setNewTitle('');
    setShowAdd(false);
  };

  return (
    <div className={cn('rounded-lg border border-border border-l-2', getGoalColor(goal.id).border)}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="group">
          {/* goal header — visually distinct from tasks */}
          <div className="flex items-start gap-3 px-4 py-3">
            <CollapsibleTrigger className="flex flex-1 items-start gap-3 text-left">
              <Target className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{goal.title}</span>
                  <ChevronRight className={cn(
                    'h-3 w-3 text-muted-foreground/50 transition-transform duration-200',
                    open && 'rotate-90',
                  )} />
                </div>
                {goal.description && (
                  <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{goal.description}</div>
                )}
                <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>{activeTasks.length} active{dismissedTasks.length > 0 ? ` · ${dismissedTasks.length} closed` : ''}</span>
                  {goal.status === 'paused' && (
                    <span className="text-amber-500">paused</span>
                  )}
                </div>
              </div>
            </CollapsibleTrigger>

            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setShowAdd(v => !v)}
                title="Add work item"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onToggleGoalStatus(goal)}>
                    {goal.status === 'paused' ? (
                      <><Play className="mr-2 h-3.5 w-3.5" /> Resume</>
                    ) : (
                      <><Pause className="mr-2 h-3.5 w-3.5" /> Pause</>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onCompleteGoal(goal)}>
                    <Check className="mr-2 h-3.5 w-3.5" /> Mark done
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onDeleteGoal(goal.id)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {showAdd && (
            <div className="flex items-center gap-2 border-t border-border/50 px-4 py-2">
              <Input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTask(); if (e.key === 'Escape') setShowAdd(false); }}
                placeholder="new work item"
                className="h-8 text-xs"
                autoFocus
              />
              <Button size="sm" className="h-8 text-xs" onClick={handleAddTask} disabled={!newTitle.trim()}>
                Add
              </Button>
            </div>
          )}
        </div>

        <CollapsibleContent>
          {(activeTasks.length > 0 || dismissedTasks.length > 0) && (
            <div className="border-t border-border/50">
              {activeTasks.length === 0 && dismissedTasks.length === 0 && (
                <div className="px-4 py-4 text-xs text-muted-foreground">no work items</div>
              )}

              {activeTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  presentation={presentations.get(task.id) || { label: '', dotClass: '', action: null }}
                  onClick={() => onTaskClick(task)}
                  onStart={(mode) => onStartTask(task.id, mode)}
                  onWatch={() => onWatchTask(task)}
                  onUnblock={() => onUnblockTask(task.id)}
                  busy={!!busy && busy.startsWith(`task:${task.id}:`)}
                />
              ))}

              {dismissedTasks.length > 0 && (
                <button
                  type="button"
                  className="w-full px-4 py-2 text-left text-[10px] text-muted-foreground transition-colors hover:bg-muted/20"
                  onClick={() => setShowDismissed(v => !v)}
                >
                  {showDismissed ? 'hide' : 'show'} {dismissedTasks.length} closed
                </button>
              )}

              {showDismissed && dismissedTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  presentation={presentations.get(task.id) || { label: 'done', dotClass: 'bg-muted-foreground/20', action: null }}
                  onClick={() => onTaskClick(task)}
                  onStart={(mode) => onStartTask(task.id, mode)}
                  onWatch={() => onWatchTask(task)}
                  onUnblock={() => onUnblockTask(task.id)}
                  busy={!!busy && busy.startsWith(`task:${task.id}:`)}
                />
              ))}
            </div>
          )}

          {activeTasks.length === 0 && dismissedTasks.length === 0 && (
            <div className="border-t border-border/50 px-4 py-4 text-xs text-muted-foreground">
              no work items yet
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
