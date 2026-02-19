import { useCallback, useEffect, useMemo, useState } from 'react';
import type { useGateway, TaskRun } from '../hooks/useGateway';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Eye,
  FileText,
  Flag,
  ListTodo,
  Loader2,
  Pause,
  PauseCircle,
  Play,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Target,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  XCircle,
} from 'lucide-react';

type GoalStatus = 'active' | 'paused' | 'done';
type TaskStatus = 'planning' | 'planned' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

type Goal = {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;
  tags?: string[];
  reason?: string;
  createdAt: string;
  updatedAt: string;
};

type Task = {
  id: string;
  goalId?: string;
  title: string;
  status: TaskStatus;
  plan?: string;
  planDocPath?: string;
  result?: string;
  reason?: string;
  sessionId?: string;
  sessionKey?: string;
  approvalRequestId?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type TaskLog = {
  id: number;
  taskId: string;
  eventType: string;
  message: string;
  createdAt: string;
};

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onViewSession?: (sessionId: string, channel?: string, chatId?: string, chatType?: string) => void;
};

const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  blocked: 1,
  planning: 2,
  planned: 3,
  done: 4,
  cancelled: 5,
};

const GOAL_BADGE: Record<GoalStatus, string> = {
  active: 'bg-primary/10 text-primary border-primary/30',
  paused: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  done: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
};

const TASK_BADGE: Record<TaskStatus, string> = {
  planning: 'bg-muted text-muted-foreground border-border',
  planned: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  in_progress: 'bg-sky-500/10 text-sky-500 border-sky-500/30',
  done: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  blocked: 'bg-destructive/10 text-destructive border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

function parseSessionKey(sessionKey?: string): { channel: string; chatType: string; chatId: string } | null {
  if (!sessionKey) return null;
  const [channel = 'desktop', chatType = 'dm', ...rest] = sessionKey.split(':');
  const chatId = rest.join(':');
  if (!chatId) return null;
  return { channel, chatType, chatId };
}

function statusIcon(status: TaskStatus) {
  switch (status) {
    case 'in_progress':
      return <PlayCircle className="h-4 w-4 text-sky-500" />;
    case 'planned':
      return <ShieldCheck className="h-4 w-4 text-amber-500" />;
    case 'planning':
      return <Clock3 className="h-4 w-4 text-muted-foreground" />;
    case 'done':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'blocked':
      return <PauseCircle className="h-4 w-4 text-destructive" />;
    case 'cancelled':
      return <XCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err || 'unknown error');
}

export function GoalsView({ gateway, onViewSession }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskLogs, setTaskLogs] = useState<TaskLog[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const [taskDraft, setTaskDraft] = useState<{
    title: string;
    goalId: string;
    reason: string;
    result: string;
  }>({
    title: '',
    goalId: '',
    reason: '',
    result: '',
  });

  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  const [planPath, setPlanPath] = useState('');
  const [planContent, setPlanContent] = useState('');
  const [planDraft, setPlanDraft] = useState('');
  const [planMode, setPlanMode] = useState<'preview' | 'edit'>('preview');
  const [planLoading, setPlanLoading] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);

  const reportError = useCallback((title: string, err: unknown) => {
    const description = errorText(err);
    setError(`${title}: ${description}`);
    toast.error(title, { description });
  }, []);

  const load = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const [goalsRes, tasksRes] = await Promise.all([
        gateway.rpc('goals.list'),
        gateway.rpc('tasks.list'),
      ]);
      if (Array.isArray(goalsRes)) setGoals(goalsRes as Goal[]);
      if (Array.isArray(tasksRes)) setTasks(tasksRes as Task[]);
      setError(null);
    } catch (err) {
      reportError('Failed to load goals and tasks', err);
    } finally {
      setLoading(false);
    }
  }, [gateway, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading) return;
    void load();
  }, [gateway.goalsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const taskRuns = gateway.taskRuns as Record<string, TaskRun>;

  const goalsById = useMemo(() => new Map(goals.map(goal => [goal.id, goal])), [goals]);

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find(task => task.id === selectedTaskId) || null : null),
    [selectedTaskId, tasks],
  );

  useEffect(() => {
    if (!selectedTask) {
      setTaskLogs([]);
      return;
    }

    setTaskDraft({
      title: selectedTask.title || '',
      goalId: selectedTask.goalId || '',
      reason: selectedTask.reason || '',
      result: selectedTask.result || '',
    });
  }, [selectedTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskLogs([]);
      return;
    }

    gateway.rpc('tasks.logs', { id: selectedTaskId, limit: 30 })
      .then((res) => {
        if (Array.isArray(res)) setTaskLogs(res as TaskLog[]);
      })
      .catch(() => {
        setTaskLogs([]);
      });
  }, [selectedTaskId, gateway.taskLogsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeGoals = useMemo(
    () => goals.filter(goal => goal.status !== 'done').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [goals],
  );

  const doneGoals = useMemo(
    () => goals.filter(goal => goal.status === 'done').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [goals],
  );

  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      if (selectedGoalId === 'all') return true;
      if (selectedGoalId === 'orphans') return !task.goalId;
      return task.goalId === selectedGoalId;
    });
    return filtered.sort((a, b) => {
      const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (order !== 0) return order;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [tasks, selectedGoalId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    if (visibleTasks.some(task => task.id === selectedTaskId)) return;
    setSelectedTaskId(null);
  }, [selectedTaskId, visibleTasks]);

  const createGoal = useCallback(async () => {
    const title = goalTitle.trim();
    if (!title) return;
    setSaving('goal:create');
    try {
      await gateway.rpc('goals.add', {
        title,
        description: goalDescription.trim() || undefined,
      });
      setGoalTitle('');
      setGoalDescription('');
      setError(null);
      await load();
    } catch (err) {
      reportError('Failed to create goal', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, goalDescription, goalTitle, load, reportError]);

  const updateGoalStatus = useCallback(async (goal: Goal, status: GoalStatus) => {
    setSaving(`goal:${goal.id}`);
    try {
      await gateway.rpc('goals.update', { id: goal.id, status });
      setError(null);
      await load();
    } catch (err) {
      reportError('Failed to update goal', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, reportError]);

  const deleteGoal = useCallback(async (goalId: string) => {
    setSaving(`goal:delete:${goalId}`);
    try {
      await gateway.rpc('goals.delete', { id: goalId });
      if (selectedGoalId === goalId) setSelectedGoalId('all');
      setError(null);
      await load();
    } catch (err) {
      reportError('Failed to delete goal', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, reportError, selectedGoalId]);

  const createTask = useCallback(async () => {
    const title = taskTitle.trim();
    if (!title) return;
    setSaving('task:create');
    try {
      await gateway.rpc('tasks.add', {
        title,
        status: 'planning',
        goalId: selectedGoalId !== 'all' && selectedGoalId !== 'orphans' ? selectedGoalId : undefined,
      });
      setTaskTitle('');
      setError(null);
      await load();
    } catch (err) {
      reportError('Failed to create task', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, reportError, selectedGoalId, taskTitle]);

  const updateTaskStatus = useCallback(async (taskId: string, status: TaskStatus) => {
    setSaving(`task:${taskId}:status`);
    try {
      await gateway.rpc('tasks.update', { id: taskId, status });
      setError(null);
      await load();
    } catch (err) {
      reportError('Failed to update task status', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, reportError]);

  const startTask = useCallback(async (taskId: string) => {
    setSaving(`task:${taskId}:start`);
    try {
      const res = await gateway.rpc('tasks.start', { id: taskId }) as { sessionId?: string; chatId?: string } | null;
      if (res?.sessionId && onViewSession) {
        onViewSession(res.sessionId, 'desktop', res.chatId, 'dm');
      }
      setError(null);
      await load();
    } catch (err) {
      reportError('Failed to start task', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, onViewSession, reportError]);

  const approveTask = useCallback(async (task: Task) => {
    setSaving(`task:${task.id}:approve`);
    try {
      await gateway.rpc('tasks.approve', task.approvalRequestId
        ? { requestId: task.approvalRequestId, taskId: task.id }
        : { taskId: task.id });
      setError(null);
      toast.success(`Task #${task.id} approved`);
      await load();
    } catch (err) {
      reportError('Failed to approve task', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, reportError]);

  const denyTask = useCallback(async (task: Task) => {
    setSaving(`task:${task.id}:deny`);
    try {
      await gateway.rpc('tasks.deny', task.approvalRequestId
        ? { requestId: task.approvalRequestId, taskId: task.id, reason: 'denied by user' }
        : { taskId: task.id, reason: 'denied by user' });
      setError(null);
      toast.error(`Task #${task.id} denied`);
      await load();
    } catch (err) {
      reportError('Failed to deny task', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, reportError]);

  const saveTask = useCallback(async () => {
    if (!selectedTask) return;
    setSaving(`task:${selectedTask.id}:save`);
    try {
      await gateway.rpc('tasks.update', {
        id: selectedTask.id,
        title: taskDraft.title.trim() || selectedTask.title,
        goalId: taskDraft.goalId || '',
        reason: taskDraft.reason || '',
        result: taskDraft.result || '',
      });
      setError(null);
      await load();
    } catch (err) {
      reportError('Failed to save task', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, reportError, selectedTask, taskDraft]);

  const deleteTask = useCallback(async (taskId: string) => {
    setSaving(`task:${taskId}:delete`);
    try {
      await gateway.rpc('tasks.delete', { id: taskId });
      if (selectedTaskId === taskId) setSelectedTaskId(null);
      setError(null);
      await load();
    } catch (err) {
      reportError('Failed to delete task', err);
    } finally {
      setSaving(null);
    }
  }, [gateway, load, reportError, selectedTaskId]);

  const monitorTask = useCallback((task: Task) => {
    if (!onViewSession) return;
    if (task.sessionId) {
      onViewSession(task.sessionId, 'desktop', `task-${task.id}`, 'dm');
      return;
    }
    const parsed = parseSessionKey(task.sessionKey);
    if (!parsed) return;
    const session = gateway.sessions.find(s =>
      (s.channel || 'desktop') === parsed.channel
      && (s.chatType || 'dm') === parsed.chatType
      && s.chatId === parsed.chatId,
    );
    if (!session?.id) return;
    onViewSession(session.id, parsed.channel, parsed.chatId, parsed.chatType);
  }, [gateway.sessions, onViewSession]);

  const openPlan = useCallback(async (task: Task) => {
    setPlanTaskId(task.id);
    setPlanMode('preview');
    setPlanLoading(true);
    setPlanPath(task.planDocPath || 'PLAN.md');
    try {
      const res = await gateway.rpc('tasks.plan.read', { id: task.id }) as { path?: string; content?: string } | null;
      const content = res?.content || task.plan || '';
      setPlanContent(content);
      setPlanDraft(content);
      setPlanPath(res?.path || task.planDocPath || 'PLAN.md');
      setError(null);
    } catch (err) {
      const fallback = task.plan || '';
      setPlanContent(fallback);
      setPlanDraft(fallback);
      reportError('Failed to load PLAN.md', err);
    } finally {
      setPlanLoading(false);
    }
  }, [gateway, reportError]);

  const savePlan = useCallback(async () => {
    if (!planTaskId) return;
    setPlanSaving(true);
    try {
      const res = await gateway.rpc('tasks.plan.write', { id: planTaskId, content: planDraft }) as { path?: string; content?: string } | null;
      setPlanContent(res?.content || planDraft);
      setPlanDraft(res?.content || planDraft);
      setPlanPath(res?.path || planPath);
      setPlanMode('preview');
      setError(null);
      await load();
      toast.success('PLAN.md saved');
    } catch (err) {
      reportError('Failed to save PLAN.md', err);
    } finally {
      setPlanSaving(false);
    }
  }, [gateway, load, planDraft, planPath, planTaskId, reportError]);

  if (gateway.connectionState !== 'connected') {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Connecting to gateway...</div>;
  }

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <div className="h-8 w-56 animate-pulse rounded bg-muted/40" />
        <div className="h-40 animate-pulse rounded-lg bg-muted/20" />
        <div className="h-40 animate-pulse rounded-lg bg-muted/20" />
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col xl:flex-row">
        <div className="flex min-h-0 flex-col border-b border-border xl:w-[300px] xl:border-r xl:border-b-0">
          <div className="space-y-3 border-b border-border p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <div className="text-sm font-semibold">Goals</div>
              <Badge variant="outline">{goals.length}</Badge>
            </div>
            <Input
              value={goalTitle}
              onChange={e => setGoalTitle(e.target.value)}
              placeholder="New goal"
              className="h-9"
            />
            <Textarea
              value={goalDescription}
              onChange={e => setGoalDescription(e.target.value)}
              placeholder="Why this goal matters"
              className="min-h-[86px]"
            />
            <Button className="w-full" onClick={createGoal} disabled={saving === 'goal:create' || !goalTitle.trim()}>
              Add Goal
            </Button>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-2 p-3">
              <button
                type="button"
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  selectedGoalId === 'all' ? 'border-primary/40 bg-primary/10' : 'border-border bg-card hover:bg-accent',
                )}
                onClick={() => setSelectedGoalId('all')}
              >
                <div className="flex items-center justify-between">
                  <span>All Tasks</span>
                  <Badge variant="outline">{tasks.length}</Badge>
                </div>
              </button>

              <button
                type="button"
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  selectedGoalId === 'orphans' ? 'border-primary/40 bg-primary/10' : 'border-border bg-card hover:bg-accent',
                )}
                onClick={() => setSelectedGoalId('orphans')}
              >
                <div className="flex items-center justify-between">
                  <span>Orphan Tasks</span>
                  <Badge variant="outline">{tasks.filter(task => !task.goalId).length}</Badge>
                </div>
              </button>

              <Separator className="my-2" />

              {activeGoals.map((goal) => {
                return (
                  <div
                    key={goal.id}
                    className={cn(
                      'rounded-md border border-border bg-card transition-colors',
                      selectedGoalId === goal.id && 'border-primary/40 bg-primary/5',
                    )}
                  >
                    <div className="flex items-start gap-2 p-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setSelectedGoalId(goal.id)}
                      >
                        <div className="text-sm font-medium leading-snug break-words">{goal.title}</div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge className={cn('border', GOAL_BADGE[goal.status])}>{goal.status}</Badge>
                        </div>
                      </button>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="h-7 w-7"
                          title={goal.status === 'paused' ? 'Resume goal' : 'Pause goal'}
                          aria-label={goal.status === 'paused' ? 'Resume goal' : 'Pause goal'}
                          onClick={() => void updateGoalStatus(goal, goal.status === 'paused' ? 'active' : 'paused')}
                        >
                          {goal.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="h-7 w-7"
                          title={goal.status === 'done' ? 'Reopen goal' : 'Mark goal done'}
                          aria-label={goal.status === 'done' ? 'Reopen goal' : 'Mark goal done'}
                          onClick={() => void updateGoalStatus(goal, goal.status === 'done' ? 'active' : 'done')}
                        >
                          {goal.status === 'done' ? <RefreshCw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="h-7 w-7 text-destructive"
                          title="Delete goal"
                          aria-label="Delete goal"
                          onClick={() => void deleteGoal(goal.id)}
                          disabled={saving === `goal:delete:${goal.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {doneGoals.length > 0 && (
                <>
                  <Separator className="my-2" />
                  <div className="text-xs font-medium text-muted-foreground">Completed goals</div>
                  {doneGoals.map((goal) => (
                    <button
                      key={goal.id}
                      type="button"
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        selectedGoalId === goal.id ? 'border-primary/40 bg-primary/10' : 'border-border bg-card hover:bg-accent',
                      )}
                      onClick={() => setSelectedGoalId(goal.id)}
                    >
                      {goal.title}
                    </button>
                  ))}
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-b border-border xl:border-b-0 xl:border-r">
          <div className="space-y-3 border-b border-border p-4">
            <div className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-primary" />
              <div className="text-sm font-semibold">
                {selectedGoalId === 'all'
                  ? 'All Tasks'
                  : selectedGoalId === 'orphans'
                    ? 'Orphan Tasks'
                    : goalsById.get(selectedGoalId)?.title || 'Tasks'}
              </div>
              <Badge variant="outline">{visibleTasks.length}</Badge>
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void createTask(); }}
                placeholder="New task"
                className="h-9"
              />
              <Button className="h-9" onClick={createTask} disabled={saving === 'task:create' || !taskTitle.trim()}>
                Add
              </Button>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              </div>
            )}
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-2 p-3">
              {visibleTasks.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">No tasks yet</div>
              )}

              {visibleTasks.map((task) => {
                const running = taskRuns[task.id]?.status === 'started';
                const busy = !!saving && saving.startsWith(`task:${task.id}:`);
                const canMonitor = !!onViewSession && !!(task.sessionId || task.sessionKey);
                const denied = task.status === 'planned' && !task.approvalRequestId && !!task.reason && /denied/i.test(task.reason);

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'rounded-md border border-border bg-card transition-colors',
                      selectedTaskId === task.id && 'border-primary/40 bg-primary/5',
                    )}
                  >
                    <div className="flex items-start gap-3 p-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <div className="mt-0.5">{statusIcon(task.status)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-snug break-words">{task.title}</div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <Badge className={cn('border', TASK_BADGE[task.status])}>{task.status.replace('_', ' ')}</Badge>
                            {task.approvalRequestId && <span title="Awaiting approval"><ShieldCheck className="h-3.5 w-3.5 text-amber-500" /></span>}
                            {task.status === 'planned' && !task.approvalRequestId && !!task.approvedAt && <span title="Approved"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /></span>}
                            {denied && <span title="Denied"><XCircle className="h-3.5 w-3.5 text-destructive" /></span>}
                            {running && <span title="Running"><Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" /></span>}
                          </div>
                          {task.reason && (task.status === 'blocked' || denied) && (
                            <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{task.reason}</div>
                          )}
                        </div>
                      </button>

                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button
                          size="icon-xs"
                          variant="outline"
                          className="h-7 w-7"
                          title="Open plan"
                          aria-label="Open plan"
                          onClick={() => void openPlan(task)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>

                        {task.status === 'planning' && (
                          <Button
                            size="icon-xs"
                            className="h-7 w-7"
                            title="Send for approval"
                            aria-label="Send for approval"
                            disabled={busy}
                            onClick={() => void updateTaskStatus(task.id, 'planned')}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {task.status === 'planned' && task.approvalRequestId && (
                          <>
                            <Button
                              size="icon-xs"
                              className="h-7 w-7"
                              title="Approve"
                              aria-label="Approve"
                              disabled={busy}
                              onClick={() => void approveTask(task)}
                            >
                              <ThumbsUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="outline"
                              className="h-7 w-7"
                              title="Deny"
                              aria-label="Deny"
                              disabled={busy}
                              onClick={() => void denyTask(task)}
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}

                        {task.status === 'planned' && !task.approvalRequestId && (
                          <Button
                            size="icon-xs"
                            className="h-7 w-7"
                            title="Start task"
                            aria-label="Start task"
                            disabled={busy}
                            onClick={() => void startTask(task.id)}
                          >
                            <PlayCircle className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {task.status === 'in_progress' && (
                          <Button
                            size="icon-xs"
                            variant="outline"
                            className="h-7 w-7"
                            title="Mark done"
                            aria-label="Mark done"
                            disabled={busy}
                            onClick={() => void updateTaskStatus(task.id, 'done')}
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {task.status === 'blocked' && (
                          <Button
                            size="icon-xs"
                            variant="outline"
                            className="h-7 w-7"
                            title="Resume planning"
                            aria-label="Resume planning"
                            disabled={busy}
                            onClick={() => void updateTaskStatus(task.id, 'planning')}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {canMonitor && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Monitor run"
                            aria-label="Monitor run"
                            onClick={() => monitorTask(task)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-col xl:w-[380px]">
          <div className="border-b border-border p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Flag className="h-4 w-4 text-primary" />
              Task Details
            </div>
          </div>

          {!selectedTask && (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              Select a task to edit metadata, view logs, and manage the plan markdown.
            </div>
          )}

          {selectedTask && (
            <>
              <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-4 p-4">
                  <Input
                    value={taskDraft.title}
                    onChange={e => setTaskDraft(draft => ({ ...draft, title: e.target.value }))}
                    placeholder="Task title"
                  />

                  <Select
                    value={taskDraft.goalId || '__none'}
                    onValueChange={(value) => setTaskDraft(draft => ({ ...draft, goalId: value === '__none' ? '' : value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Goal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No goal</SelectItem>
                      {goals.map(goal => (
                        <SelectItem key={goal.id} value={goal.id}>{goal.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-2">
                    <Badge className={cn('border', TASK_BADGE[selectedTask.status])}>
                      {selectedTask.status.replace('_', ' ')}
                    </Badge>
                    {selectedTask.approvalRequestId && (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                        approval pending
                      </Badge>
                    )}
                    {taskRuns[selectedTask.id]?.status === 'started' && (
                      <Badge variant="outline" className="border-sky-500/40 text-sky-600">
                        running
                      </Badge>
                    )}
                  </div>

                  <Input
                    value={taskDraft.reason}
                    onChange={e => setTaskDraft(draft => ({ ...draft, reason: e.target.value }))}
                    placeholder="Reason"
                  />

                  <Textarea
                    value={taskDraft.result}
                    onChange={e => setTaskDraft(draft => ({ ...draft, result: e.target.value }))}
                    placeholder="Result markdown"
                    className="min-h-[120px]"
                  />

                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4 text-primary" />
                      PLAN.md
                    </div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Keep implementation plans in markdown files, not short inline notes.
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void openPlan(selectedTask)}>
                      <Eye className="mr-1 h-3.5 w-3.5" />
                      Open Plan Modal
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">Recent activity</div>
                    <div className="max-h-44 space-y-1 overflow-auto rounded-md border border-border bg-muted/10 p-2">
                      {taskLogs.length === 0 && (
                        <div className="text-xs text-muted-foreground">No logs yet</div>
                      )}
                      {taskLogs.map((log) => (
                        <div key={log.id} className="text-xs">
                          <span className="mr-1 text-muted-foreground/70">
                            {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="mr-1 text-muted-foreground/70">{log.eventType}:</span>
                          <span>{log.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>

              <div className="flex items-center gap-2 border-t border-border p-4">
                <Button
                  onClick={() => void saveTask()}
                  disabled={saving === `task:${selectedTask.id}:save`}
                >
                  Save
                </Button>

                <Button
                  variant="outline"
                  onClick={() => void updateTaskStatus(selectedTask.id, 'blocked')}
                  disabled={saving === `task:${selectedTask.id}:status`}
                >
                  <CircleSlash className="mr-1 h-3.5 w-3.5" />
                  Block
                </Button>

                <Button
                  variant="destructive"
                  onClick={() => void deleteTask(selectedTask.id)}
                  disabled={saving === `task:${selectedTask.id}:delete`}
                >
                  Delete
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={!!planTaskId} onOpenChange={(open) => { if (!open) setPlanTaskId(null); }}>
        <DialogContent className="h-[85vh] max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Task Plan
            </DialogTitle>
            <div className="text-xs text-muted-foreground">{planPath || 'PLAN.md'}</div>
          </DialogHeader>

          <div className="flex items-center justify-between border-b border-border px-6 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {planLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {planLoading ? 'Loading PLAN.md...' : 'Markdown plan file'}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={planMode === 'preview' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPlanMode('preview')}
                disabled={planLoading}
              >
                <Eye className="mr-1 h-3.5 w-3.5" />
                Preview
              </Button>
              <Button
                variant={planMode === 'edit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPlanMode('edit')}
                disabled={planLoading}
              >
                <FileText className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
              <Button size="sm" onClick={() => void savePlan()} disabled={planLoading || planSaving || planMode !== 'edit'}>
                {planSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {planLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>
            ) : planMode === 'preview' ? (
              <div className="markdown-viewer p-6 text-sm">
                <Markdown remarkPlugins={[remarkGfm]}>{planContent || '_Empty PLAN.md_'}</Markdown>
              </div>
            ) : (
              <div className="h-full p-6">
                <Textarea
                  value={planDraft}
                  onChange={e => setPlanDraft(e.target.value)}
                  className="h-full min-h-[60vh] font-mono text-sm"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
