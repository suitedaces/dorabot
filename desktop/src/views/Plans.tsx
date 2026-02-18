import { useCallback, useEffect, useMemo, useState } from 'react';
import type { useGateway, PlanRun } from '../hooks/useGateway';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  Play, RotateCcw, Eye, GitBranch, GitPullRequest, GitMerge,
  Trash2, BarChart3, Loader2, GripVertical,
} from 'lucide-react';

type Plan = {
  id: string;
  title: string;
  description?: string;
  type: 'feature' | 'bug' | 'chore';
  status: 'plan' | 'in_progress' | 'done';
  runState: 'idle' | 'running' | 'failed';
  error?: string;
  result?: string;
  planDocPath: string;
  roadmapItemId?: string;
  sessionKey?: string;
  worktreePath?: string;
  branch?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  source: 'agent' | 'user' | 'roadmap';
  tags?: string[];
};

type PlanLog = {
  id: number;
  eventType: string;
  message: string;
  createdAt: string;
};

type WorktreeStats = {
  clean: boolean;
  staged: number;
  changed: number;
  untracked: number;
  ahead: number;
  behind: number;
  lastCommit: string;
};

type PlanStartResponse = {
  started: boolean;
  planId: string;
  sessionKey: string;
  sessionId: string;
  chatId: string;
  worktreePath?: string;
  branch?: string;
};

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onViewSession?: (sessionId: string, channel?: string, chatId?: string, chatType?: string) => void;
};

const COLUMNS: { id: Plan['status']; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
];

const TYPE_BADGE: Record<Plan['type'], string> = {
  feature: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  bug: 'bg-red-500/10 text-red-300 border-red-500/30',
  chore: 'bg-muted text-muted-foreground',
};

function parseSessionKey(sessionKey: string): { channel: string; chatType: string; chatId: string } | null {
  const [channel = 'desktop', chatType = 'dm', ...rest] = sessionKey.split(':');
  const chatId = rest.join(':');
  if (!chatId) return null;
  return { channel, chatType, chatId };
}

// ── Kanban Card ──

function KanbanCard({ plan, run, onClick, overlay }: {
  plan: Plan;
  run?: PlanRun;
  onClick: () => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: plan.id });

  const style = transform
    ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` }
    : undefined;

  const isRunning = plan.runState === 'running' || run?.status === 'started';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        'rounded-md border border-border bg-card px-2.5 py-2 cursor-pointer select-none transition-shadow',
        isDragging && !overlay && 'opacity-40',
        overlay && 'shadow-xl rotate-1',
        'hover:border-primary/40 hover:shadow-sm',
      )}
      onClick={!overlay ? onClick : undefined}
    >
      <div className="flex items-start gap-1.5 mb-1">
        <div
          {...listeners}
          className="mt-0.5 cursor-grab text-muted-foreground/40 hover:text-muted-foreground shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3 w-3" />
        </div>
        <span className="flex-1 text-[11px] font-medium leading-tight line-clamp-2">{plan.title}</span>
        {isRunning && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0 mt-0.5" />}
      </div>

      {plan.description && (
        <p className="text-[10px] text-muted-foreground line-clamp-2 mb-1.5 ml-4">{plan.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-1 ml-4">
        <Badge className={`text-[9px] h-4 border px-1 ${TYPE_BADGE[plan.type]}`}>{plan.type}</Badge>
        {plan.runState === 'failed' && (
          <Badge className="text-[9px] h-4 border px-1 bg-destructive/10 text-destructive border-destructive/30">failed</Badge>
        )}
        {plan.branch && (
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
            <GitBranch className="h-2.5 w-2.5" />{plan.branch.replace(/^.*\//, '')}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Kanban Column ──

function KanbanColumn({ id, label, plans, runs, onCardClick }: {
  id: Plan['status'];
  label: string;
  plans: Plan[];
  runs: Record<string, PlanRun>;
  onCardClick: (plan: Plan) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col min-w-[220px] w-[220px] shrink-0 rounded-lg border border-border bg-secondary/20 transition-colors',
        isOver && 'border-primary/50 bg-primary/5',
      )}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold">{label}</span>
        <Badge variant="outline" className="text-[9px] h-4 ml-auto">{plans.length}</Badge>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {plans.length === 0 && (
            <div className="text-[10px] text-muted-foreground text-center py-6 opacity-40">empty</div>
          )}
          {plans.map((plan) => (
            <KanbanCard
              key={plan.id}
              plan={plan}
              run={runs[plan.id]}
              onClick={() => onCardClick(plan)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Main View ──

export function PlansView({ gateway, onViewSession }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [logs, setLogs] = useState<PlanLog[]>([]);
  const [doc, setDoc] = useState<string | null>(null);
  const [stats, setStats] = useState<WorktreeStats | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byStatus = useMemo(() => {
    const map: Record<Plan['status'], Plan[]> = { plan: [], in_progress: [], done: [] };
    for (const p of plans) map[p.status]?.push(p);
    return map;
  }, [plans]);

  const planById = useMemo(() => {
    const map: Record<string, Plan> = {};
    for (const p of plans) map[p.id] = p;
    return map;
  }, [plans]);

  const activePlan = activeId ? planById[activeId] : null;

  const load = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const res = await gateway.rpc('plans.list');
      if (Array.isArray(res)) setPlans(res as Plan[]);
    } catch (err) {
      console.error('failed to load plans:', err);
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading) load(); }, [gateway.plansVersion]); // eslint-disable-line

  useEffect(() => {
    if (!selectedPlan) return;
    const updated = plans.find((p) => p.id === selectedPlan.id);
    if (updated) setSelectedPlan(updated);
  }, [plans]); // eslint-disable-line

  const openDetail = useCallback(async (plan: Plan) => {
    setSelectedPlan(plan);
    setLogs([]);
    setDoc(null);
    setStats(null);
    try {
      const [logsRes, docRes] = await Promise.all([
        gateway.rpc('plans.logs', { id: plan.id, limit: 20 }),
        plan.planDocPath ? gateway.rpc('fs.read', { path: plan.planDocPath }).catch(() => null) : Promise.resolve(null),
      ]);
      if (Array.isArray(logsRes)) setLogs(logsRes as PlanLog[]);
      const content = (docRes as { content?: string } | null)?.content;
      if (typeof content === 'string') setDoc(content);
    } catch {}
  }, [gateway]);

  const closeDetail = () => setSelectedPlan(null);

  const monitorPlan = useCallback((plan: Plan) => {
    if (!onViewSession || !plan.sessionKey) return;
    const parsed = parseSessionKey(plan.sessionKey);
    if (!parsed) return;
    const session = gateway.sessions.find((s) =>
      (s.channel || 'desktop') === parsed.channel
      && (s.chatType || 'dm') === parsed.chatType
      && s.chatId === parsed.chatId
    );
    if (!session) return;
    onViewSession(session.id, parsed.channel, parsed.chatId, parsed.chatType);
  }, [gateway.sessions, onViewSession]);

  const startPlan = useCallback(async (plan: Plan) => {
    setBusyPlanId(plan.id);
    try {
      const res = await gateway.rpc('plans.start', { id: plan.id }) as PlanStartResponse;
      if (res?.sessionId && onViewSession) {
        onViewSession(res.sessionId, 'desktop', res.chatId, 'dm');
      }
      await load();
    } catch (err) {
      console.error('failed to start plan:', err);
    } finally {
      setBusyPlanId(null);
    }
  }, [gateway, load, onViewSession]);

  const runWorktreeAction = useCallback(async (plan: Plan, action: 'stats' | 'merge' | 'push' | 'remove') => {
    setBusyPlanId(plan.id);
    try {
      if (action === 'stats') {
        const s = await gateway.rpc('worktree.stats', { planId: plan.id }) as WorktreeStats;
        if (s) setStats(s);
      } else if (action === 'merge') {
        await gateway.rpc('worktree.merge', { planId: plan.id });
      } else if (action === 'push') {
        await gateway.rpc('worktree.push_pr', { planId: plan.id });
      } else if (action === 'remove') {
        await gateway.rpc('worktree.remove', { planId: plan.id });
      }
      await load();
    } catch (err) {
      console.error(`worktree ${action} failed:`, err);
    } finally {
      setBusyPlanId(null);
    }
  }, [gateway, load]);

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  }, []);

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const newStatus = over.id as Plan['status'];
    const plan = planById[active.id as string];
    if (!plan || plan.status === newStatus) return;

    setPlans((prev) => prev.map((p) => p.id === plan.id ? { ...p, status: newStatus } : p));
    try {
      await gateway.rpc('plans.update', { id: plan.id, status: newStatus });
    } catch (err) {
      console.error('failed to update plan status:', err);
      await load();
    }
  }, [planById, gateway, load]);

  if (gateway.connectionState !== 'connected') {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">connecting...</div>;
  }

  if (loading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3">
          <Skeleton className="h-40 w-[220px]" />
          <Skeleton className="h-40 w-[220px]" />
          <Skeleton className="h-40 w-[220px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 shrink-0">
        <div className="text-sm font-semibold">Plans</div>
        <Badge variant="outline" className="text-[10px]">{plans.length}</Badge>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 min-h-0 overflow-x-auto">
          <div className="flex gap-3 p-4 h-full">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                plans={byStatus[col.id]}
                runs={gateway.planRuns}
                onCardClick={openDetail}
              />
            ))}
            {plans.length === 0 && (
              <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">
                No plans yet. Create ideas in the Ideas tab, then generate plans from there.
              </div>
            )}
          </div>
        </div>

        <DragOverlay>
          {activePlan && (
            <KanbanCard
              plan={activePlan}
              run={gateway.planRuns[activePlan.id]}
              onClick={() => {}}
              overlay
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* detail modal */}
      <Dialog open={Boolean(selectedPlan)} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
          {selectedPlan && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm flex items-center gap-2">
                  <span className="truncate">{selectedPlan.title}</span>
                  <Badge className={`text-[9px] h-4 border px-1 shrink-0 ${TYPE_BADGE[selectedPlan.type]}`}>{selectedPlan.type}</Badge>
                </DialogTitle>
              </DialogHeader>

              <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
                <div className="space-y-3 text-[11px] pb-1">
                  {/* actions */}
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPlan.status === 'plan' && (
                      <Button size="sm" className="h-7 px-2.5 text-[10px]" onClick={() => startPlan(selectedPlan)} disabled={busyPlanId === selectedPlan.id}>
                        <Play className="mr-1 h-3 w-3" />Start
                      </Button>
                    )}
                    {selectedPlan.runState === 'failed' && (
                      <Button size="sm" variant="outline" className="h-7 px-2.5 text-[10px]" onClick={() => startPlan(selectedPlan)} disabled={busyPlanId === selectedPlan.id}>
                        <RotateCcw className="mr-1 h-3 w-3" />Retry
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-[10px]" onClick={() => monitorPlan(selectedPlan)} disabled={!selectedPlan.sessionKey}>
                      <Eye className="mr-1 h-3 w-3" />Monitor
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-[10px]" onClick={() => runWorktreeAction(selectedPlan, 'stats')} disabled={busyPlanId === selectedPlan.id}>
                      <BarChart3 className="mr-1 h-3 w-3" />Stats
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-[10px]" onClick={() => runWorktreeAction(selectedPlan, 'merge')} disabled={!selectedPlan.branch || busyPlanId === selectedPlan.id}>
                      <GitMerge className="mr-1 h-3 w-3" />Merge
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-[10px]" onClick={() => runWorktreeAction(selectedPlan, 'push')} disabled={!selectedPlan.worktreePath || busyPlanId === selectedPlan.id}>
                      <GitPullRequest className="mr-1 h-3 w-3" />Push PR
                    </Button>
                    <Button size="sm" variant="destructive" className="h-7 px-2.5 text-[10px]" onClick={() => runWorktreeAction(selectedPlan, 'remove')} disabled={!selectedPlan.worktreePath || busyPlanId === selectedPlan.id}>
                      <Trash2 className="mr-1 h-3 w-3" />Remove
                    </Button>
                  </div>

                  <Separator />

                  {/* meta */}
                  <div className="space-y-1.5 text-muted-foreground border border-border rounded-md p-2.5">
                    <div>run: <span className={selectedPlan.runState === 'failed' ? 'text-destructive' : 'text-foreground'}>{selectedPlan.runState}</span></div>
                    <div>updated: {new Date(selectedPlan.updatedAt).toLocaleString()}</div>
                    {selectedPlan.branch && (
                      <div className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3 shrink-0" />
                        <span className="break-all">{selectedPlan.branch}</span>
                      </div>
                    )}
                    {selectedPlan.worktreePath && <div className="break-all text-[10px]">{selectedPlan.worktreePath}</div>}
                    {selectedPlan.error && <div className="text-destructive break-words">error: {selectedPlan.error}</div>}
                    {selectedPlan.result && <div className="break-words">result: {selectedPlan.result}</div>}
                    {stats && (
                      <div>{stats.clean ? 'clean' : 'dirty'} · staged {stats.staged} · changed {stats.changed} · untracked {stats.untracked} · ahead {stats.ahead}</div>
                    )}
                  </div>

                  {/* plan.md */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">plan.md</div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] bg-secondary/40 rounded p-2.5">
                      {doc ?? 'no plan.md'}
                    </pre>
                  </div>

                  {/* logs */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">recent logs</div>
                    <div className="space-y-0.5 max-h-40 overflow-auto">
                      {logs.length === 0 && <div className="text-muted-foreground">no logs</div>}
                      {logs.map((log) => (
                        <div key={log.id} className="text-[10px]">
                          <span className="text-foreground/60">[{new Date(log.createdAt).toLocaleTimeString()}]</span>{' '}
                          <span className="uppercase text-foreground/80">{log.eventType}</span>{' '}
                          <span className="text-foreground/70">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
