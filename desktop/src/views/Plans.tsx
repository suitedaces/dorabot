import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { useGateway, PlanRun } from '../hooks/useGateway';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  useDndContext,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  Play, RotateCcw, Eye, GitBranch,
  Loader2, GripVertical,
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
  ideaId?: string;
  sessionKey?: string;
  worktreePath?: string;
  branch?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  source: 'agent' | 'user' | 'idea';
  tags?: string[];
};

type PlanLog = {
  id: number;
  eventType: string;
  message: string;
  createdAt: string;
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

const COLUMNS: { id: Plan['status']; label: string; accent: string; dot: string }[] = [
  { id: 'plan',        label: 'Plan',        accent: 'border-l-amber-500',   dot: 'bg-amber-500' },
  { id: 'in_progress', label: 'In Progress', accent: 'border-l-sky-500',     dot: 'bg-sky-500' },
  { id: 'done',        label: 'Done',        accent: 'border-l-emerald-500', dot: 'bg-emerald-500' },
];

const TYPE_BADGE: Record<Plan['type'], string> = {
  feature: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  bug: 'bg-red-500/10 text-red-300 border-red-500/30',
  chore: 'bg-muted text-muted-foreground',
};

const RUN_BADGE: Record<Plan['runState'], string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30',
};

function parseSessionKey(sessionKey: string): { channel: string; chatType: string; chatId: string } | null {
  const [channel = 'desktop', chatType = 'dm', ...rest] = sessionKey.split(':');
  const chatId = rest.join(':');
  if (!chatId) return null;
  return { channel, chatType, chatId };
}

// ── Card ──

function DraggableCard({ plan, run, column, selected, onClick }: {
  plan: Plan;
  run?: PlanRun;
  column: typeof COLUMNS[number];
  selected: Plan | null;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: plan.id });
  const isRunning = plan.runState === 'running' || run?.status === 'started';

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-md border border-border bg-card px-4 py-3 transition-colors cursor-grab active:cursor-grabbing',
        'hover:bg-accent hover:border-accent-foreground/20',
        'border-l-2',
        column.accent,
        selected?.id === plan.id && 'ring-1 ring-primary',
        isDragging && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-muted-foreground/50 shrink-0">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium leading-snug mb-1.5">{plan.title}</div>
          {plan.description && (
            <div className="text-[11px] text-muted-foreground line-clamp-2 mb-2">{plan.description}</div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`text-[10px] h-5 border px-1.5 ${TYPE_BADGE[plan.type]}`}>{plan.type}</Badge>
            {plan.runState === 'failed' && (
              <Badge className="text-[10px] h-5 border px-1.5 bg-destructive/10 text-destructive border-destructive/30">failed</Badge>
            )}
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
            {plan.branch && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground ml-auto">
                <GitBranch className="h-3 w-3" />{plan.branch.replace(/^.*\//, '')}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Column ──

function DroppableColumn({ column, children }: { column: typeof COLUMNS[number]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col min-h-0 rounded-lg border border-border bg-secondary/10 transition-colors',
        isOver && 'bg-primary/5 border-primary/30',
      )}
    >
      {children}
    </div>
  );
}

// ── Drag Overlay ──

function PlanDragOverlay({ activePlan, planRuns }: { activePlan: Plan | undefined; planRuns: Record<string, PlanRun> }) {
  const { activeNodeRect } = useDndContext();
  if (!activePlan) return <DragOverlay dropAnimation={null} />;
  const col = COLUMNS.find(c => c.id === activePlan.status);
  const isRunning = activePlan.runState === 'running' || planRuns[activePlan.id]?.status === 'started';
  return (
    <DragOverlay dropAnimation={null}>
      <div
        className={cn(
          'rounded-md border border-border bg-card px-4 py-3 shadow-xl cursor-grabbing border-l-2',
          col?.accent,
        )}
        style={activeNodeRect ? { width: activeNodeRect.width } : undefined}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-muted-foreground/50 shrink-0">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium leading-snug mb-1.5">{activePlan.title}</div>
            {activePlan.description && (
              <div className="text-[11px] text-muted-foreground line-clamp-2 mb-2">{activePlan.description}</div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`text-[10px] h-5 border px-1.5 ${TYPE_BADGE[activePlan.type]}`}>{activePlan.type}</Badge>
              {activePlan.runState === 'failed' && (
                <Badge className="text-[10px] h-5 border px-1.5 bg-destructive/10 text-destructive border-destructive/30">failed</Badge>
              )}
              {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              {activePlan.branch && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground ml-auto">
                  <GitBranch className="h-3 w-3" />{activePlan.branch.replace(/^.*\//, '')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </DragOverlay>
  );
}

// ── Main View ──

export function PlansView({ gateway, onViewSession }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [logs, setLogs] = useState<PlanLog[]>([]);
  const [doc, setDoc] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byStatus = useMemo(() => {
    const map: Record<Plan['status'], Plan[]> = { plan: [], in_progress: [], done: [] };
    for (const p of plans) map[p.status]?.push(p);
    return map;
  }, [plans]);

  const planById = useMemo(() => new Map(plans.map(p => [p.id, p])), [plans]);
  const activePlan = activeId ? planById.get(activeId) : null;

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

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  }, []);

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const newStatus = over.id as Plan['status'];
    const plan = planById.get(active.id as string);
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
      <div className="p-4 space-y-3">
        <div className="h-8 w-48 rounded bg-muted/40 animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(n => <div key={n} className="h-48 rounded-lg bg-muted/20 animate-pulse" />)}
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
        <ScrollArea className="flex-1 min-h-0">
          <div className="grid grid-cols-3 gap-3 p-3">
            {COLUMNS.map((col) => (
              <DroppableColumn key={col.id} column={col}>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', col.dot)} />
                  <span className="text-[11px] font-semibold">{col.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{byStatus[col.id].length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                  {byStatus[col.id].map((plan) => (
                    <DraggableCard
                      key={plan.id}
                      plan={plan}
                      run={gateway.planRuns[plan.id]}
                      column={col}
                      selected={selectedPlan}
                      onClick={() => openDetail(plan)}
                    />
                  ))}
                  {byStatus[col.id].length === 0 && (
                    <div className="py-8 text-center text-[10px] text-muted-foreground/50">empty</div>
                  )}
                </div>
              </DroppableColumn>
            ))}
          </div>

          {plans.length === 0 && (
            <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
              No plans yet. Create ideas in the Ideas tab, then generate plans from there.
            </div>
          )}
        </ScrollArea>

        {createPortal(
          <PlanDragOverlay activePlan={activePlan ?? undefined} planRuns={gateway.planRuns} />,
          document.body,
        )}
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
                  <Badge className={cn('text-[9px] h-4 border px-1.5 shrink-0 ml-auto', RUN_BADGE[selectedPlan.runState])}>
                    {selectedPlan.runState === 'running' && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}
                    {selectedPlan.runState}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
                <div className="space-y-4 pb-1">
                  {/* actions */}
                  <div className="flex items-center gap-1.5">
                    {selectedPlan.status === 'plan' && (
                      <Button size="sm" className="h-7 px-2.5 text-[10px]" onClick={() => startPlan(selectedPlan)} disabled={busyPlanId === selectedPlan.id}>
                        {busyPlanId === selectedPlan.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                        Start
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
                  </div>

                  <Separator />

                  {/* meta */}
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[11px]">
                    <span className="text-muted-foreground">status</span>
                    <span>{selectedPlan.status.replace('_', ' ')}</span>

                    <span className="text-muted-foreground">updated</span>
                    <span>{new Date(selectedPlan.updatedAt).toLocaleString()}</span>

                    {selectedPlan.branch && (
                      <>
                        <span className="text-muted-foreground">branch</span>
                        <span className="flex items-center gap-1">
                          <GitBranch className="h-3 w-3 shrink-0" />
                          <span className="break-all">{selectedPlan.branch}</span>
                        </span>
                      </>
                    )}

                    {selectedPlan.error && (
                      <>
                        <span className="text-muted-foreground">error</span>
                        <span className="text-destructive break-words">{selectedPlan.error}</span>
                      </>
                    )}

                    {selectedPlan.result && (
                      <>
                        <span className="text-muted-foreground">result</span>
                        <span className="break-words">{selectedPlan.result}</span>
                      </>
                    )}
                  </div>

                  {/* plan doc */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">plan document</div>
                    <div className="rounded-md border border-border bg-secondary/30 overflow-hidden">
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] p-3 leading-relaxed">
                        {doc ?? 'no plan document'}
                      </pre>
                    </div>
                  </div>

                  {/* logs */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">activity</div>
                    <div className="space-y-1 max-h-40 overflow-auto">
                      {logs.length === 0 && <div className="text-[10px] text-muted-foreground/50 py-2">no activity yet</div>}
                      {logs.map((log) => (
                        <div key={log.id} className="flex items-baseline gap-2 text-[10px]">
                          <span className="text-muted-foreground/50 shrink-0 tabular-nums">
                            {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-muted-foreground/70 uppercase text-[9px] shrink-0 w-16">{log.eventType}</span>
                          <span className="text-foreground/70 min-w-0">{log.message}</span>
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
