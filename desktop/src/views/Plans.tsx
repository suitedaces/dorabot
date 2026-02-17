import { useCallback, useEffect, useMemo, useState } from 'react';
import type { useGateway, PlanRun } from '../hooks/useGateway';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, Loader2, Play, RotateCcw, Eye, GitBranch, GitPullRequest, GitMerge, Trash2, BarChart3 } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onViewSession?: (sessionId: string, channel?: string, chatId?: string, chatType?: string) => void;
};

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

type RoadmapItem = {
  id: string;
  title: string;
  lane: 'now' | 'next' | 'later';
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

type WorktreeStats = {
  clean: boolean;
  staged: number;
  changed: number;
  untracked: number;
  ahead: number;
  behind: number;
  lastCommit: string;
};

const TYPE_BADGE: Record<Plan['type'], string> = {
  feature: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  bug: 'bg-red-500/10 text-red-300 border-red-500/30',
  chore: 'bg-muted text-muted-foreground',
};

const STATUS_BADGE: Record<Plan['status'], string> = {
  plan: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  in_progress: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  done: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
};

function formatLastUpdated(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function parseSessionKey(sessionKey: string): { channel: string; chatType: string; chatId: string } | null {
  const [channel = 'desktop', chatType = 'dm', ...rest] = sessionKey.split(':');
  const chatId = rest.join(':');
  if (!chatId) return null;
  return { channel, chatType, chatId };
}

export function PlansView({ gateway, onViewSession }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [logsByPlan, setLogsByPlan] = useState<Record<string, PlanLog[]>>({});
  const [docByPlan, setDocByPlan] = useState<Record<string, string>>({});
  const [statsByPlan, setStatsByPlan] = useState<Record<string, WorktreeStats>>({});
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  const roadmapById = useMemo(() => {
    const map: Record<string, RoadmapItem> = {};
    for (const item of roadmapItems) map[item.id] = item;
    return map;
  }, [roadmapItems]);

  const runForPlan = useCallback((planId: string): PlanRun | undefined => {
    return gateway.planRuns[planId];
  }, [gateway.planRuns]);

  const load = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const [plansRes, roadmapRes] = await Promise.all([
        gateway.rpc('plans.list'),
        gateway.rpc('roadmap.list').catch(() => []),
      ]);
      if (Array.isArray(plansRes)) setPlans(plansRes as Plan[]);
      if (Array.isArray(roadmapRes)) setRoadmapItems(roadmapRes as RoadmapItem[]);
    } catch (err) {
      console.error('failed to load plans:', err);
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!loading) load();
  }, [gateway.plansVersion, gateway.roadmapVersion, load, loading]);

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
        const stats = await gateway.rpc('worktree.stats', { planId: plan.id }) as WorktreeStats;
        if (stats) setStatsByPlan(prev => ({ ...prev, [plan.id]: stats }));
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

  const toggleExpanded = useCallback(async (plan: Plan) => {
    const isOpen = expanded[plan.id];
    setExpanded(prev => ({ ...prev, [plan.id]: !isOpen }));
    if (isOpen) return;

    try {
      const [logsRes, docRes] = await Promise.all([
        gateway.rpc('plans.logs', { id: plan.id, limit: 20 }),
        plan.planDocPath ? gateway.rpc('fs.read', { path: plan.planDocPath }).catch(() => null) : Promise.resolve(null),
      ]);
      if (Array.isArray(logsRes)) {
        setLogsByPlan(prev => ({ ...prev, [plan.id]: logsRes as PlanLog[] }));
      }
      const doc = (docRes as { content?: string } | null)?.content;
      if (typeof doc === 'string') {
        setDocByPlan(prev => ({ ...prev, [plan.id]: doc }));
      }
    } catch (err) {
      console.error('failed loading plan detail:', err);
    }
  }, [expanded, gateway]);

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        connecting...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Plans</div>
        <Badge variant="outline" className="text-[10px]">{plans.length}</Badge>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 py-2">
          <div className="grid grid-cols-[24px_2fr_90px_120px_100px_120px_170px_260px] items-center gap-2 border-b border-border px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <div />
            <div>Title</div>
            <div>Type</div>
            <div>Roadmap</div>
            <div>Status</div>
            <div>Progress</div>
            <div>Last Updated</div>
            <div>Actions</div>
          </div>

          {plans.map((plan) => {
            const isBusy = busyPlanId === plan.id;
            const run = runForPlan(plan.id);
            const isExpanded = Boolean(expanded[plan.id]);
            const roadmap = plan.roadmapItemId ? roadmapById[plan.roadmapItemId] : undefined;
            const progressLabel = plan.runState === 'running'
              ? 'running'
              : plan.runState === 'failed'
                ? 'failed'
                : plan.status === 'done'
                  ? 'completed'
                  : 'idle';

            return (
              <div key={plan.id} className="border-b border-border/60">
                <div className="grid grid-cols-[24px_2fr_90px_120px_100px_120px_170px_260px] items-center gap-2 px-2 py-2 text-xs">
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => toggleExpanded(plan)}
                    title={isExpanded ? 'collapse' : 'expand'}
                  >
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>

                  <div className="min-w-0">
                    <div className="truncate font-medium">{plan.title}</div>
                    {plan.description && <div className="truncate text-[11px] text-muted-foreground">{plan.description}</div>}
                  </div>

                  <div>
                    <Badge className={`text-[10px] h-5 border ${TYPE_BADGE[plan.type]}`}>{plan.type}</Badge>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    {roadmap ? `${roadmap.title} (${roadmap.lane})` : '—'}
                  </div>

                  <div>
                    <Badge className={`text-[10px] h-5 border ${STATUS_BADGE[plan.status]}`}>
                      {plan.status === 'in_progress' ? 'in progress' : plan.status}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1 text-[11px]">
                    {plan.runState === 'running' || run?.status === 'started' ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : null}
                    <span className={plan.runState === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                      {progressLabel}
                    </span>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    {formatLastUpdated(plan.updatedAt)}
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {plan.status === 'plan' && (
                      <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => startPlan(plan)} disabled={isBusy}>
                        <Play className="mr-1 h-3 w-3" />Start
                      </Button>
                    )}
                    {plan.runState === 'failed' && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => startPlan(plan)} disabled={isBusy}>
                        <RotateCcw className="mr-1 h-3 w-3" />Retry
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => monitorPlan(plan)} disabled={!plan.sessionKey}>
                      <Eye className="mr-1 h-3 w-3" />Monitor
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => runWorktreeAction(plan, 'stats')} disabled={isBusy}>
                      <BarChart3 className="mr-1 h-3 w-3" />Stats
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => runWorktreeAction(plan, 'merge')} disabled={!plan.branch || isBusy}>
                      <GitMerge className="mr-1 h-3 w-3" />Merge
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => runWorktreeAction(plan, 'push')} disabled={!plan.worktreePath || isBusy}>
                      <GitPullRequest className="mr-1 h-3 w-3" />Push PR
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => runWorktreeAction(plan, 'remove')} disabled={!plan.worktreePath || isBusy}>
                      <Trash2 className="mr-1 h-3 w-3" />Remove
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="grid grid-cols-1 gap-3 px-9 pb-3 text-[11px] text-muted-foreground">
                    <div className="rounded-md border border-border bg-background p-2">
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-foreground/70">plan.md</div>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px]">{docByPlan[plan.id] || 'No plan.md content available.'}</pre>
                    </div>

                    <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                      <div className="rounded-md border border-border bg-background p-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-foreground/70">Recent Logs</div>
                        <div className="max-h-40 overflow-auto space-y-1">
                          {(logsByPlan[plan.id] || []).length === 0 && <div className="text-[10px]">No logs yet.</div>}
                          {(logsByPlan[plan.id] || []).map((log) => (
                            <div key={log.id} className="text-[10px]">
                              <span className="text-foreground/80">[{new Date(log.createdAt).toLocaleTimeString()}]</span>{' '}
                              <span className="uppercase">{log.eventType}</span>{' '}
                              <span>{log.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-md border border-border bg-background p-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-foreground/70">Run Details</div>
                        <div className="space-y-1 text-[10px]">
                          <div>Status: {plan.status}</div>
                          <div>Run state: {plan.runState}</div>
                          <div>Updated: {new Date(plan.updatedAt).toLocaleString()}</div>
                          {plan.worktreePath && (
                            <div className="flex items-start gap-1">
                              <GitBranch className="h-3 w-3 mt-0.5" />
                              <span className="break-all">{plan.worktreePath}</span>
                            </div>
                          )}
                          {plan.branch && <div>Branch: {plan.branch}</div>}
                          {plan.error && <div className="text-destructive">Error: {plan.error}</div>}
                          {plan.result && <div className="break-words">Result: {plan.result}</div>}
                          {statsByPlan[plan.id] && (
                            <div>
                              Worktree: {statsByPlan[plan.id].clean ? 'clean' : 'dirty'} (staged {statsByPlan[plan.id].staged}, changed {statsByPlan[plan.id].changed}, untracked {statsByPlan[plan.id].untracked}, ahead {statsByPlan[plan.id].ahead}, behind {statsByPlan[plan.id].behind})
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {plans.length === 0 && (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              No plans yet. Create ideas in Roadmap, then generate plans from there.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
