import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { useGateway } from '../hooks/useGateway';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Sparkles, Plus, Wand2, Loader2, Trash2, GripVertical } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

type RoadmapItem = {
  id: string;
  title: string;
  description?: string;
  lane: 'now' | 'next' | 'later' | 'done';
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

const LANES: Array<{ id: RoadmapItem['lane']; label: string; accent: string; dot: string }> = [
  { id: 'now',   label: 'Now',   accent: 'border-l-amber-500',  dot: 'bg-amber-500' },
  { id: 'next',  label: 'Next',  accent: 'border-l-sky-500',    dot: 'bg-sky-500' },
  { id: 'later', label: 'Later', accent: 'border-l-border',     dot: 'bg-muted-foreground' },
  { id: 'done',  label: 'Done',  accent: 'border-l-emerald-500', dot: 'bg-emerald-500' },
];

function DraggableCard({ item, lane, selected, onClick }: {
  item: RoadmapItem;
  lane: typeof LANES[number];
  selected: RoadmapItem | null;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <button
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-md border border-border bg-card px-3 py-2 transition-colors',
        'hover:bg-accent hover:border-accent-foreground/20',
        'border-l-2',
        lane.accent,
        selected?.id === item.id && 'ring-1 ring-primary',
        isDragging && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-1.5">
        <span {...listeners} {...attributes} className="mt-0.5 cursor-grab text-muted-foreground/50 hover:text-muted-foreground shrink-0">
          <GripVertical className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium leading-snug line-clamp-2 mb-1">{item.title}</div>
          {item.outcome && (
            <div className="text-[10px] text-muted-foreground line-clamp-1 mb-1.5">{item.outcome}</div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.impact && (
              <span className="text-[9px] text-muted-foreground border border-border rounded px-1 py-0.5 leading-none truncate max-w-[80px]">{item.impact}</span>
            )}
            {item.effort && (
              <span className="text-[9px] text-muted-foreground border border-border rounded px-1 py-0.5 leading-none truncate max-w-[80px]">{item.effort}</span>
            )}
            {item.linkedPlanIds?.length > 0 && (
              <span className="text-[9px] text-muted-foreground ml-auto">{item.linkedPlanIds.length} plan{item.linkedPlanIds.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function DroppableLane({ lane, children }: { lane: typeof LANES[number]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
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

export function RoadmapView({ gateway }: Props) {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<RoadmapItem | null>(null);
  const [draft, setDraft] = useState<Partial<RoadmapItem>>({});
  const [newIdea, setNewIdea] = useState({ title: '', lane: 'next' as RoadmapItem['lane'], impact: '', effort: '', outcome: '', problem: '' });
  const [addSaving, setAddSaving] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const isBusy = (id: string) => busyIds.has(id);
  const setBusy = (id: string, v: boolean) =>
    setBusyIds(prev => { const s = new Set(prev); v ? s.add(id) : s.delete(id); return s; });

  const load = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const res = await gateway.rpc('ideas.list');
      if (Array.isArray(res)) {
        setItems((res as RoadmapItem[]).slice().sort((a, b) =>
          a.lane !== b.lane ? a.lane.localeCompare(b.lane) : (a.sortOrder || 0) - (b.sortOrder || 0)
        ));
      }
    } catch (err) {
      console.error('failed to load ideas:', err);
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  useEffect(() => { load(); }, [load]);

  const prevVersion = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (prevVersion.current !== undefined && prevVersion.current !== gateway.roadmapVersion) {
      load();
    }
    prevVersion.current = gateway.roadmapVersion;
  }, [gateway.roadmapVersion, load]);

  useEffect(() => {
    if (!selected) return;
    const updated = items.find(i => i.id === selected.id);
    if (updated) { setSelected(updated); setDraft(updated); }
  }, [items]); // eslint-disable-line

  const grouped = useMemo(() => {
    const map: Record<RoadmapItem['lane'], RoadmapItem[]> = { now: [], next: [], later: [], done: [] };
    for (const item of items) map[item.lane].push(item);
    return map;
  }, [items]);

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const newLane = over.id as RoadmapItem['lane'];
    const item = itemById.get(active.id as string);
    if (!item || item.lane === newLane) return;
    // optimistic
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, lane: newLane } : i));
    try {
      await gateway.rpc('ideas.update', { id: item.id, lane: newLane });
    } catch (err) {
      console.error('failed to move idea:', err);
      await load();
    }
  };

  const openDetail = (item: RoadmapItem) => {
    setSelected(item);
    setDraft({ ...item });
  };

  const closeDetail = () => setSelected(null);

  const addIdea = useCallback(async () => {
    if (!newIdea.title.trim()) return;
    setAddSaving(true);
    try {
      await gateway.rpc('ideas.add', {
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
      console.error('failed to add idea:', err);
    } finally {
      setAddSaving(false);
    }
  }, [gateway, load, newIdea]);

  const saveItem = useCallback(async () => {
    if (!selected) return;
    setBusy(selected.id, true);
    try {
      await gateway.rpc('ideas.update', { id: selected.id, ...draft });
      const updated = { ...selected, ...draft, updatedAt: new Date().toISOString() } as RoadmapItem;
      setSelected(updated);
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    } catch (err) {
      console.error('failed to save idea:', err);
    } finally {
      setBusy(selected.id, false);
    }
  }, [selected, draft, gateway]);

  const deleteItem = useCallback(async (item: RoadmapItem) => {
    setBusy(item.id, true);
    try {
      await gateway.rpc('ideas.delete', { id: item.id });
      setItems(prev => prev.filter(i => i.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
    } catch (err) {
      console.error('failed to delete idea:', err);
    } finally {
      setBusy(item.id, false);
    }
  }, [gateway, selected]);

  const createPlan = useCallback(async (item: RoadmapItem) => {
    setBusy(item.id, true);
    try {
      await gateway.rpc('ideas.create_plan', { roadmapItemId: item.id });
      await load();
    } catch (err) {
      console.error('failed to create plan:', err);
    } finally {
      setBusy(item.id, false);
    }
  }, [gateway, load]);

  const refineWithAi = useCallback(async () => {
    if (!selected) return;
    const prompt = [
      'Refine this idea into a sharper statement with clear problem, outcome, audience, and risks.',
      `Title: ${selected.title}`,
      `Problem: ${selected.problem || selected.description || ''}`,
      `Outcome: ${selected.outcome || ''}`,
      `Audience: ${selected.audience || ''}`,
      '',
      'Return concise bullet points I can copy into the fields.',
    ].join('\n');
    try {
      await gateway.rpc('chat.send', { prompt, chatId: `idea-refine-${selected.id}` });
    } catch (err) {
      console.error('failed to refine:', err);
    }
  }, [selected, gateway]);

  if (gateway.connectionState !== 'connected') {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">connecting...</div>;
  }

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-8 w-48 rounded bg-muted/40 animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map(n => <div key={n} className="h-48 rounded-lg bg-muted/20 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 shrink-0">
        <div className="text-sm font-semibold">Ideas</div>
        <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
        <Button size="sm" className="ml-auto h-7 text-[11px]" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />Add
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-4 gap-3 p-3">
            {LANES.map((lane) => (
              <DroppableLane key={lane.id} lane={lane}>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', lane.dot)} />
                  <span className="text-[11px] font-semibold">{lane.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{grouped[lane.id].length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                  {grouped[lane.id].map((item) => (
                    <DraggableCard key={item.id} item={item} lane={lane} selected={selected} onClick={() => openDetail(item)} />
                  ))}
                  {grouped[lane.id].length === 0 && (
                    <div className="py-8 text-center text-[10px] text-muted-foreground/50">empty</div>
                  )}
                </div>
              </DroppableLane>
            ))}
          </div>
          <DragOverlay>
            {activeId && itemById.get(activeId) ? (
              <div className="rounded-md border border-border bg-card px-3 py-2 shadow-lg opacity-90 max-w-[250px]">
                <div className="text-[11px] font-medium leading-snug line-clamp-2">{itemById.get(activeId)!.title}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </ScrollArea>

      {/* detail modal */}
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm flex items-center gap-2">
                  <span className="truncate">{selected.title}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{selected.lane}</Badge>
                </DialogTitle>
              </DialogHeader>

              <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
                <div className="space-y-3 pb-1">
                  {/* actions */}
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" className="h-7 px-2.5 text-[10px]" onClick={() => createPlan(selected)} disabled={isBusy(selected.id)}>
                      {isBusy(selected.id) ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                      Create Plan
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-[10px]" onClick={refineWithAi}>
                      <Wand2 className="mr-1 h-3 w-3" />Refine with AI
                    </Button>
                    <Button size="sm" variant="destructive" className="h-7 px-2.5 text-[10px] ml-auto" onClick={() => deleteItem(selected)} disabled={isBusy(selected.id)}>
                      <Trash2 className="mr-1 h-3 w-3" />Delete
                    </Button>
                  </div>

                  <Separator />

                  {/* lane */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Lane</Label>
                    <div className="flex gap-1">
                      {LANES.map(l => (
                        <button
                          key={l.id}
                          onClick={() => setDraft(d => ({ ...d, lane: l.id }))}
                          className={cn(
                            'flex-1 rounded px-2 py-1 text-[11px] border transition-colors',
                            draft.lane === l.id
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border text-muted-foreground hover:border-foreground/30',
                          )}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* title */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Title</Label>
                    <Input
                      value={draft.title ?? ''}
                      onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>

                  {/* impact / effort */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Impact</Label>
                      <Input value={draft.impact ?? ''} onChange={e => setDraft(d => ({ ...d, impact: e.target.value }))} className="h-8 text-xs" placeholder="low / med / high" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Effort</Label>
                      <Input value={draft.effort ?? ''} onChange={e => setDraft(d => ({ ...d, effort: e.target.value }))} className="h-8 text-xs" placeholder="low / med / high" />
                    </div>
                  </div>

                  {/* text fields */}
                  {([
                    ['Problem', 'problem'],
                    ['Outcome', 'outcome'],
                    ['Audience', 'audience'],
                    ['Risks', 'risks'],
                    ['Notes', 'notes'],
                  ] as [string, keyof RoadmapItem][]).map(([label, key]) => (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
                      <Textarea
                        rows={2}
                        value={(draft[key] as string) ?? ''}
                        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                        className="text-xs resize-none"
                      />
                    </div>
                  ))}

                  {selected.linkedPlanIds?.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      linked plans: {selected.linkedPlanIds.join(', ')}
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="pt-2 border-t border-border -mx-6 px-6">
                <Button size="sm" className="w-full h-8 text-xs" onClick={saveItem} disabled={isBusy(selected.id)}>
                  {isBusy(selected.id) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  Save Changes
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Add Idea</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[11px]">Title</Label>
              <Input
                autoFocus
                value={newIdea.title}
                onChange={e => setNewIdea(p => ({ ...p, title: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addIdea()}
                className="h-8 text-xs"
                placeholder="What's the idea?"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Lane</Label>
              <div className="flex gap-1">
                {LANES.map(l => (
                  <button
                    key={l.id}
                    onClick={() => setNewIdea(p => ({ ...p, lane: l.id }))}
                    className={cn(
                      'flex-1 rounded px-2 py-1.5 text-[11px] border transition-colors',
                      newIdea.lane === l.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:border-foreground/30',
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Impact</Label>
                <Input value={newIdea.impact} onChange={e => setNewIdea(p => ({ ...p, impact: e.target.value }))} className="h-8 text-xs" placeholder="low / med / high" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Effort</Label>
                <Input value={newIdea.effort} onChange={e => setNewIdea(p => ({ ...p, effort: e.target.value }))} className="h-8 text-xs" placeholder="low / med / high" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Problem</Label>
              <Textarea value={newIdea.problem} onChange={e => setNewIdea(p => ({ ...p, problem: e.target.value }))} rows={2} className="text-xs resize-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Outcome</Label>
              <Textarea value={newIdea.outcome} onChange={e => setNewIdea(p => ({ ...p, outcome: e.target.value }))} rows={2} className="text-xs resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" onClick={addIdea} disabled={!newIdea.title.trim() || addSaving}>
                {addSaving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
