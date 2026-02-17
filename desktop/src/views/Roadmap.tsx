import { useCallback, useEffect, useMemo, useState } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Plus, Wand2, ArrowRightCircle, Loader2 } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

type RoadmapItem = {
  id: string;
  title: string;
  description?: string;
  lane: 'now' | 'next' | 'later';
  impact?: string;
  effort?: string;
  problem?: string;
  outcome?: string;
  audience?: string;
  risks?: string;
  notes?: string;
  tags?: string[];
  linkedPlanIds: string[];
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
};

const LANES: Array<{ id: RoadmapItem['lane']; label: string }> = [
  { id: 'now', label: 'Now' },
  { id: 'next', label: 'Next' },
  { id: 'later', label: 'Later' },
];

export function RoadmapView({ gateway }: Props) {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<RoadmapItem | null>(null);
  const [newIdea, setNewIdea] = useState({
    title: '',
    lane: 'next' as RoadmapItem['lane'],
    impact: '',
    effort: '',
    outcome: '',
    problem: '',
  });

  const load = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const res = await gateway.rpc('roadmap.list');
      if (Array.isArray(res)) {
        setItems((res as RoadmapItem[]).slice().sort((a, b) => {
          if (a.lane !== b.lane) return a.lane.localeCompare(b.lane);
          return (a.sortOrder || 0) - (b.sortOrder || 0);
        }));
      }
    } catch (err) {
      console.error('failed to load roadmap:', err);
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!loading) load();
  }, [gateway.roadmapVersion, load, loading]);

  const grouped = useMemo(() => {
    const map: Record<RoadmapItem['lane'], RoadmapItem[]> = { now: [], next: [], later: [] };
    for (const item of items) map[item.lane].push(item);
    return map;
  }, [items]);

  const addIdea = useCallback(async () => {
    if (!newIdea.title.trim()) return;
    setSaving(true);
    try {
      await gateway.rpc('roadmap.add', {
        title: newIdea.title.trim(),
        lane: newIdea.lane,
        impact: newIdea.impact || undefined,
        effort: newIdea.effort || undefined,
        problem: newIdea.problem || undefined,
        outcome: newIdea.outcome || undefined,
      });
      setAddOpen(false);
      setNewIdea({ title: '', lane: 'next', impact: '', effort: '', outcome: '', problem: '' });
      await load();
    } catch (err) {
      console.error('failed to add roadmap idea:', err);
    } finally {
      setSaving(false);
    }
  }, [gateway, load, newIdea]);

  const updateItem = useCallback(async (patch: Partial<RoadmapItem>) => {
    if (!detailItem) return;
    setSaving(true);
    try {
      await gateway.rpc('roadmap.update', {
        id: detailItem.id,
        ...patch,
      });
      const updated = { ...detailItem, ...patch, updatedAt: new Date().toISOString() };
      setDetailItem(updated);
      setItems(prev => prev.map(item => item.id === updated.id ? updated : item));
    } catch (err) {
      console.error('failed to update roadmap item:', err);
    } finally {
      setSaving(false);
    }
  }, [detailItem, gateway]);

  const createPlan = useCallback(async (item: RoadmapItem) => {
    setSaving(true);
    try {
      await gateway.rpc('roadmap.create_plan', { roadmapItemId: item.id });
      await load();
    } catch (err) {
      console.error('failed to create plan:', err);
    } finally {
      setSaving(false);
    }
  }, [gateway, load]);

  const refineWithAi = useCallback(async () => {
    const openItem = detailItem || items[0];
    if (!openItem) return;
    const prompt = [
      'Refine this roadmap idea into a sharper statement with clear problem, outcome, audience, and risks.',
      `Title: ${openItem.title}`,
      `Problem: ${openItem.problem || openItem.description || ''}`,
      `Outcome: ${openItem.outcome || ''}`,
      `Audience: ${openItem.audience || ''}`,
      '',
      'Return concise bullet points I can copy into roadmap fields.',
    ].join('\n');
    try {
      await gateway.rpc('chat.send', { prompt, chatId: `roadmap-refine-${openItem.id}` });
    } catch (err) {
      console.error('failed to send refine prompt:', err);
    }
  }, [detailItem, gateway, items]);

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        connecting...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-8 w-64 rounded bg-muted/40" />
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
          <div className="h-64 rounded bg-muted/30" />
          <div className="h-64 rounded bg-muted/30" />
          <div className="h-64 rounded bg-muted/30" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Ideas</div>
        <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
        <Button size="sm" className="ml-auto h-7 text-[11px]" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />Add Idea
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={refineWithAi} disabled={items.length === 0}>
          <Wand2 className="mr-1 h-3.5 w-3.5" />Refine with AI
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => detailItem && createPlan(detailItem)}
          disabled={!detailItem || saving}
        >
          {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRightCircle className="mr-1 h-3.5 w-3.5" />}
          Generate Plan
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0 p-3">
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
          {LANES.map((lane) => (
            <div key={lane.id} className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="text-xs font-semibold">{lane.label}</span>
                <Badge variant="outline" className="ml-auto text-[10px]">{grouped[lane.id].length}</Badge>
              </div>
              <div className="space-y-2 p-2">
                {grouped[lane.id].map((item) => (
                  <Card key={item.id} className="border-border/60">
                    <CardContent className="p-2.5">
                      <div className="space-y-2">
                        <div className="text-xs font-medium leading-tight">{item.title}</div>
                        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                          {item.impact ? <Badge variant="outline" className="h-4 text-[9px]">impact {item.impact}</Badge> : null}
                          {item.effort ? <Badge variant="outline" className="h-4 text-[9px]">effort {item.effort}</Badge> : null}
                          <Badge variant="outline" className="h-4 text-[9px]">
                            plans {item.linkedPlanIds?.length || 0}
                          </Badge>
                        </div>
                        {item.outcome && (
                          <div className="line-clamp-2 text-[11px] text-muted-foreground">{item.outcome}</div>
                        )}
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setDetailItem(item)}>
                            Open
                          </Button>
                          <Button size="sm" className="h-6 text-[10px]" onClick={() => createPlan(item)} disabled={saving}>
                            <Sparkles className="mr-1 h-3 w-3" />Create Plan
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {grouped[lane.id].length === 0 && (
                  <div className="py-8 text-center text-[11px] text-muted-foreground/70">No ideas in {lane.label.toLowerCase()}.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Roadmap Idea</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[11px]">Title</Label>
              <Input
                value={newIdea.title}
                onChange={(e) => setNewIdea(prev => ({ ...prev, title: e.target.value }))}
                className="h-8 text-xs"
                placeholder="Idea title"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {LANES.map((lane) => (
                <Button
                  key={lane.id}
                  size="sm"
                  variant={newIdea.lane === lane.id ? 'default' : 'outline'}
                  className="h-7 text-[11px]"
                  onClick={() => setNewIdea(prev => ({ ...prev, lane: lane.id }))}
                >
                  {lane.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Impact</Label>
                <Input value={newIdea.impact} onChange={(e) => setNewIdea(prev => ({ ...prev, impact: e.target.value }))} className="h-8 text-xs" placeholder="low / med / high" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Effort</Label>
                <Input value={newIdea.effort} onChange={(e) => setNewIdea(prev => ({ ...prev, effort: e.target.value }))} className="h-8 text-xs" placeholder="low / med / high" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Problem</Label>
              <Textarea value={newIdea.problem} onChange={(e) => setNewIdea(prev => ({ ...prev, problem: e.target.value }))} rows={2} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Outcome</Label>
              <Textarea value={newIdea.outcome} onChange={(e) => setNewIdea(prev => ({ ...prev, outcome: e.target.value }))} rows={2} className="text-xs" />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" onClick={addIdea} disabled={!newIdea.title.trim() || saving}>
                {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Add Idea
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(detailItem)}
        onOpenChange={(open) => {
          if (!open) setDetailItem(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {detailItem && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span>{detailItem.title}</span>
                  <Badge variant="outline" className="text-[10px]">{detailItem.lane}</Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Impact</Label>
                    <Input value={detailItem.impact || ''} onChange={(e) => setDetailItem(prev => prev ? { ...prev, impact: e.target.value } : prev)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Effort</Label>
                    <Input value={detailItem.effort || ''} onChange={(e) => setDetailItem(prev => prev ? { ...prev, effort: e.target.value } : prev)} className="h-8 text-xs" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Problem</Label>
                  <Textarea rows={2} value={detailItem.problem || ''} onChange={(e) => setDetailItem(prev => prev ? { ...prev, problem: e.target.value } : prev)} className="text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Outcome</Label>
                  <Textarea rows={2} value={detailItem.outcome || ''} onChange={(e) => setDetailItem(prev => prev ? { ...prev, outcome: e.target.value } : prev)} className="text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Audience</Label>
                  <Input value={detailItem.audience || ''} onChange={(e) => setDetailItem(prev => prev ? { ...prev, audience: e.target.value } : prev)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Risks</Label>
                  <Textarea rows={2} value={detailItem.risks || ''} onChange={(e) => setDetailItem(prev => prev ? { ...prev, risks: e.target.value } : prev)} className="text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Notes</Label>
                  <Textarea rows={2} value={detailItem.notes || ''} onChange={(e) => setDetailItem(prev => prev ? { ...prev, notes: e.target.value } : prev)} className="text-xs" />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Linked plans: {detailItem.linkedPlanIds?.length ? detailItem.linkedPlanIds.join(', ') : 'none'}
                </div>
                <div className="flex justify-between gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => createPlan(detailItem)} disabled={saving}>
                    <Sparkles className="mr-1 h-3.5 w-3.5" />Create Plan
                  </Button>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDetailItem(null)}>Close</Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => updateItem(detailItem)}
                      disabled={saving}
                    >
                      {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

