import { useCallback, useEffect, useMemo, useState } from 'react';
import type { useGateway, TaskRun } from '../hooks/useGateway';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Loader2, Wrench, Target, Sparkles } from 'lucide-react';
import type { Goal, Task, GoalStatus, TaskStatus } from './goals/helpers';
import { getTaskPresentation, sortTasks, parseSessionKey, errorText } from './goals/helpers';
import { ApprovalBanner } from './goals/ApprovalBanner';
import { SummaryStrip, type TaskFilter } from './goals/SummaryStrip';
import { GoalSection } from './goals/GoalSection';
import { GoalCreationTrigger, GoalCreationForm } from './goals/GoalCreation';
import { TaskDetailSheet } from './goals/TaskDetailSheet';
import { PlanDialog } from './goals/PlanDialog';
import { TaskRow } from './goals/TaskRow';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onViewSession?: (sessionId: string, channel?: string, chatId?: string, chatType?: string) => void;
  onSetupChat?: (prompt: string) => void;
};

export function GoalsView({ gateway, onViewSession, onSetupChat }: Props) {
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [planTask, setPlanTask] = useState<Task | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>(null);
  const [showGoalForm, setShowGoalForm] = useState(false);

  const taskRuns = gateway.taskRuns as Record<string, TaskRun>;

  const load = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const [goalsRes, tasksRes] = await Promise.all([
        gateway.rpc('goals.list'),
        gateway.rpc('tasks.list'),
      ]);
      if (Array.isArray(goalsRes)) setGoals(goalsRes as Goal[]);
      if (Array.isArray(tasksRes)) setTasks(tasksRes as Task[]);
    } catch (err) {
      toast.error('failed to load', { description: errorText(err) });
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!loading) void load(); }, [gateway.goalsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const goalsById = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);

  const presentations = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getTaskPresentation>>();
    for (const t of tasks) map.set(t.id, getTaskPresentation(t, taskRuns));
    return map;
  }, [tasks, taskRuns]);

  const matchesFilter = useCallback((t: Task): boolean => {
    if (!taskFilter) return true;
    switch (taskFilter) {
      case 'running': return t.status === 'in_progress' || taskRuns[t.id]?.status === 'started';
      case 'pending': return t.status === 'planned' && !!t.approvalRequestId;
      case 'ready': return t.status === 'planned' && !t.approvalRequestId && !!t.approvedAt;
      case 'planning': return t.status === 'planning';
      case 'blocked': return t.status === 'blocked';
      case 'denied': return t.status === 'planned' && !!t.reason && /denied/i.test(t.reason);
      case 'done': return t.status === 'done';
      default: return true;
    }
  }, [taskFilter, taskRuns]);

  const pendingApproval = useMemo(
    () => tasks.filter(t => t.status === 'planned' && !!t.approvalRequestId),
    [tasks],
  );

  const activeGoals = useMemo(
    () => goals.filter(g => g.status !== 'done').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [goals],
  );

  const doneGoals = useMemo(
    () => goals.filter(g => g.status === 'done'),
    [goals],
  );

  const filteredTasks = useMemo(
    () => tasks.filter(matchesFilter),
    [tasks, matchesFilter],
  );

  const orphanTasks = useMemo(
    () => sortTasks(filteredTasks.filter(t => !t.goalId)),
    [filteredTasks],
  );

  const tasksByGoal = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const g of goals) map.set(g.id, []);
    for (const t of filteredTasks) {
      if (t.goalId && map.has(t.goalId)) map.get(t.goalId)!.push(t);
    }
    for (const [id, arr] of map) map.set(id, sortTasks(arr));
    return map;
  }, [goals, filteredTasks]);

  // actions
  const wrap = useCallback(async (key: string, fn: () => Promise<void>) => {
    setSaving(key);
    try { await fn(); await load(); }
    catch (err) { toast.error(errorText(err)); }
    finally { setSaving(null); }
  }, [load]);

  const approveTask = useCallback((task: Task) => {
    void wrap(`task:${task.id}:approve`, async () => {
      await gateway.rpc('tasks.approve', task.approvalRequestId
        ? { requestId: task.approvalRequestId, taskId: task.id }
        : { taskId: task.id });
    });
  }, [gateway, wrap]);

  const denyTask = useCallback((task: Task, reason?: string) => {
    void wrap(`task:${task.id}:deny`, async () => {
      await gateway.rpc('tasks.deny', task.approvalRequestId
        ? { requestId: task.approvalRequestId, taskId: task.id, reason: reason || 'denied by user' }
        : { taskId: task.id, reason: reason || 'denied by user' });
    });
  }, [gateway, wrap]);

  const startTask = useCallback((taskId: string, mode?: 'plan' | 'execute') => {
    void wrap(`task:${taskId}:start`, async () => {
      const res = await gateway.rpc('tasks.start', { id: taskId, mode: mode || 'execute' }) as { sessionId?: string; chatId?: string } | null;
      if (res?.sessionId && onViewSession) {
        onViewSession(res.sessionId, 'desktop', res.chatId, 'dm');
      }
    });
  }, [gateway, wrap, onViewSession]);

  const watchTask = useCallback((task: Task) => {
    if (!onViewSession) return;
    if (task.sessionId) {
      const parsed = task.sessionKey ? parseSessionKey(task.sessionKey) : null;
      onViewSession(task.sessionId, parsed?.channel || 'desktop', parsed?.chatId || task.sessionId, parsed?.chatType || 'dm');
      return;
    }
    const parsed = parseSessionKey(task.sessionKey);
    if (!parsed) return;
    const session = gateway.sessions.find((s: any) =>
      (s.channel || 'desktop') === parsed.channel
      && (s.chatType || 'dm') === parsed.chatType
      && s.chatId === parsed.chatId,
    );
    if (session?.id) onViewSession(session.id, parsed.channel, parsed.chatId, parsed.chatType);
  }, [gateway.sessions, onViewSession]);

  const unblockTask = useCallback((taskId: string) => {
    void wrap(`task:${taskId}:status`, async () => {
      await gateway.rpc('tasks.update', { id: taskId, status: 'planning' });
    });
  }, [gateway, wrap]);

  const saveTask = useCallback((taskId: string, updates: { title: string; goalId: string; reason: string; result: string }) => {
    void wrap(`task:${taskId}:save`, async () => {
      await gateway.rpc('tasks.update', { id: taskId, ...updates });
    });
  }, [gateway, wrap]);

  const blockTask = useCallback((taskId: string) => {
    void wrap(`task:${taskId}:status`, async () => {
      await gateway.rpc('tasks.update', { id: taskId, status: 'blocked' });
    });
  }, [gateway, wrap]);

  const deleteTask = useCallback((taskId: string) => {
    void wrap(`task:${taskId}:delete`, async () => {
      await gateway.rpc('tasks.delete', { id: taskId });
      if (selectedTask?.id === taskId) { setSelectedTask(null); setSheetOpen(false); }
    });
  }, [gateway, wrap, selectedTask]);

  const toggleGoalStatus = useCallback((goal: Goal) => {
    const next: GoalStatus = goal.status === 'paused' ? 'active' : 'paused';
    void wrap(`goal:${goal.id}`, async () => {
      await gateway.rpc('goals.update', { id: goal.id, status: next });
    });
  }, [gateway, wrap]);

  const completeGoal = useCallback((goal: Goal) => {
    void wrap(`goal:${goal.id}`, async () => {
      await gateway.rpc('goals.update', { id: goal.id, status: 'done' as GoalStatus });
    });
  }, [gateway, wrap]);

  const deleteGoal = useCallback((goalId: string) => {
    void wrap(`goal:delete:${goalId}`, async () => {
      await gateway.rpc('goals.delete', { id: goalId });
    });
  }, [gateway, wrap]);

  const createGoal = useCallback((title: string, description?: string) => {
    void wrap('goal:create', async () => {
      await gateway.rpc('goals.add', { title, description });
    });
  }, [gateway, wrap]);

  const createTask = useCallback((title: string, goalId: string) => {
    void wrap('task:create', async () => {
      await gateway.rpc('tasks.add', { title, status: 'planning' as TaskStatus, goalId: goalId || undefined });
    });
  }, [gateway, wrap]);

  const openTaskDetail = useCallback((task: Task) => {
    setSelectedTask(task);
    setSheetOpen(true);
  }, []);

  const openPlan = useCallback((task: Task) => {
    setPlanTask(task);
    setPlanOpen(true);
  }, []);

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        connecting...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        loading...
      </div>
    );
  }

  const isEmpty = goals.length === 0 && tasks.length === 0;

  if (isEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <Target className="h-8 w-8 text-muted-foreground/30" />
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">no goals yet</div>
          <div className="text-[11px] text-muted-foreground/60">goals help you track what the agent is working toward</div>
        </div>
        <div className="flex items-center gap-3">
          {onSetupChat && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onSetupChat('create goals for me based on my history, ask me questions')}
            >
              <Sparkles className="mr-1.5 h-3 w-3" />
              generate goals
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          <ApprovalBanner
            tasks={pendingApproval}
            goalsById={goalsById}
            onApprove={approveTask}
            onDeny={denyTask}
            onViewPlan={openPlan}
            busy={saving}
          />

          <SummaryStrip tasks={tasks} taskRuns={taskRuns} activeFilter={taskFilter} onFilterChange={setTaskFilter} />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Goals</span>
              <GoalCreationTrigger onClick={() => setShowGoalForm(v => !v)} />
            </div>
            {taskFilter && (
              <button
                type="button"
                onClick={() => setTaskFilter(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                showing {taskFilter} only — clear
              </button>
            )}
          </div>

          {showGoalForm && (
            <GoalCreationForm
              onCreate={createGoal}
              busy={saving === 'goal:create'}
              onClose={() => setShowGoalForm(false)}
            />
          )}

          {activeGoals.map(goal => (
            <GoalSection
              key={goal.id}
              goal={goal}
              tasks={tasksByGoal.get(goal.id) || []}
              presentations={presentations}
              onTaskClick={openTaskDetail}
              onStartTask={startTask}
              onWatchTask={watchTask}
              onUnblockTask={unblockTask}
              onToggleGoalStatus={toggleGoalStatus}
              onCompleteGoal={completeGoal}
              onDeleteGoal={deleteGoal}
              onCreateTask={createTask}
              busy={saving}
            />
          ))}

          {orphanTasks.length > 0 && (
            <div className="rounded-lg border border-dashed border-border/60 bg-card">
              <div className="flex items-center gap-2 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Wrench className="h-3 w-3" />
                work items without a goal
              </div>
              <div className="border-t border-border/30">
                {orphanTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    presentation={presentations.get(task.id) || { label: '', dotClass: '', action: null }}
                    onClick={() => openTaskDetail(task)}
                    onStart={(mode) => startTask(task.id, mode)}
                    onWatch={() => watchTask(task)}
                    onUnblock={() => unblockTask(task.id)}
                    busy={!!saving && saving.startsWith(`task:${task.id}:`)}
                  />
                ))}
              </div>
            </div>
          )}

          {doneGoals.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="mb-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  completed goals
                </div>
                {doneGoals.map(goal => (
                  <GoalSection
                    key={goal.id}
                    goal={goal}
                    tasks={tasksByGoal.get(goal.id) || []}
                    presentations={presentations}
                    defaultOpen={false}
                    onTaskClick={openTaskDetail}
                    onStartTask={startTask}
                    onWatchTask={watchTask}
                    onUnblockTask={unblockTask}
                    onToggleGoalStatus={toggleGoalStatus}
                    onCompleteGoal={completeGoal}
                    onDeleteGoal={deleteGoal}
                    onCreateTask={createTask}
                    busy={saving}
                  />
                ))}
              </div>
            </>
          )}

        </div>
      </ScrollArea>

      <TaskDetailSheet
        task={selectedTask}
        presentation={selectedTask ? presentations.get(selectedTask.id) || null : null}
        goals={goals}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        gateway={gateway}
        onSave={saveTask}
        onBlock={blockTask}
        onDelete={deleteTask}
        onViewPlan={openPlan}
        onViewSession={watchTask}
        busy={!!saving && !!selectedTask && saving.startsWith(`task:${selectedTask.id}:`)}
      />

      <PlanDialog
        task={planTask}
        open={planOpen}
        onOpenChange={setPlanOpen}
        gateway={gateway}
        onSaved={load}
      />
    </>
  );
}
