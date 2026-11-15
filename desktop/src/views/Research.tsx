import { onResearchFocus, takePendingResearch } from '@/lib/research-focus';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import {
  FileSearch, ExternalLink, Tag, Clock, Trash2,
  ChevronLeft, ChevronRight, BookOpen, Loader2, Search,
  Plus, Pencil, Check, X, Archive, RotateCcw,
  LayoutList, Table2,
} from 'lucide-react';

// ── types ────────────────────────────────────────────────────────

type ResearchItem = {
  id: string;
  topic: string;
  title: string;
  filePath: string;
  status: 'active' | 'completed' | 'archived';
  sources?: string[];
  tags?: string[];
  preview?: string;
  createdAt: string;
  updatedAt: string;
};

type ResearchItemWithContent = ResearchItem & { content: string };

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string; next: string; icon: typeof Check }> = {
  active: { label: 'Active', dot: 'bg-blue-400', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', next: 'completed', icon: Check },
  completed: { label: 'Done', dot: 'bg-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', next: 'archived', icon: Archive },
  archived: { label: 'Archived', dot: 'bg-zinc-500', badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20', next: 'active', icon: RotateCcw },
};

type FilterType = 'all' | 'active' | 'completed' | 'archived';
type ViewMode = 'list' | 'table';

// ── main view ────────────────────────────────────────────────────

export function ResearchView({ gateway }: Props) {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(() => takePendingResearch());
  const [selectedContent, setSelectedContent] = useState<ResearchItemWithContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: ResearchItem } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(new Set());
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => onResearchFocus(id => { takePendingResearch(); setSelectedId(id); }), []);

  const loadItems = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('research.list') as ResearchItem[];
      setItems(result || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { loadItems(); }, [gateway.researchVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // fetch content when selection changes
  useEffect(() => {
    if (!selectedId || gateway.connectionState !== 'connected') {
      setSelectedContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    gateway.rpc('research.read', { id: selectedId }).then((result: unknown) => {
      if (!cancelled) {
        setSelectedContent(result as ResearchItemWithContent);
        setContentLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setSelectedContent(null);
        setContentLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedId, gateway.connectionState, gateway.rpc]);

  // re-fetch content when research updates
  useEffect(() => {
    if (!selectedId || gateway.connectionState !== 'connected') return;
    gateway.rpc('research.read', { id: selectedId }).then((result: unknown) => {
      setSelectedContent(result as ResearchItemWithContent);
    }).catch(() => {});
  }, [gateway.researchVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let result = filter === 'all' ? items : items.filter(i => i.status === filter);
    if (selectedTopic) {
      result = result.filter(i => i.topic === selectedTopic);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.title.toLowerCase().includes(q)
        || i.topic.toLowerCase().includes(q)
        || i.tags?.some(t => t.toLowerCase().includes(q))
        || i.preview?.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [items, filter, search, selectedTopic]);

  // group by topic
  const grouped = useMemo(() => {
    const map = new Map<string, ResearchItem[]>();
    for (const item of filtered) {
      const topic = item.topic || 'uncategorized';
      if (!map.has(topic)) map.set(topic, []);
      map.get(topic)!.push(item);
    }
    // sort topics: most items first
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  // all flat items for keyboard nav
  const flatItems = useMemo(() => {
    if (viewMode === 'table') return filtered;
    const result: ResearchItem[] = [];
    for (const [topic, topicItems] of grouped) {
      if (!collapsedTopics.has(topic)) {
        result.push(...topicItems);
      }
    }
    return result;
  }, [grouped, collapsedTopics, filtered, viewMode]);

  const topics = useMemo(() => {
    const map = new Map<string, number>();
    const source = filter === 'all' ? items : items.filter(i => i.status === filter);
    for (const item of source) {
      const t = item.topic || 'uncategorized';
      map.set(t, (map.get(t) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, filter]);

  const filterCounts = useMemo(() => ({
    all: items.length,
    active: items.filter(i => i.status === 'active').length,
    completed: items.filter(i => i.status === 'completed').length,
    archived: items.filter(i => i.status === 'archived').length,
  }), [items]);

  const handleCreate = async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('research.add', {
        topic: selectedTopic || 'uncategorized',
        title: 'Untitled',
        content: '',
      }) as ResearchItem;
      await loadItems();
      setSelectedId(result.id);
      setEditing(true);
    } catch {}
  };

  const handleDelete = async (itemId: string) => {
    await gateway.rpc('research.delete', { id: itemId });
    if (selectedId === itemId) {
      setSelectedId(null);
      setSelectedContent(null);
      setEditing(false);
    }
    await loadItems();
  };

  const handleStatusChange = async (itemId: string, status: string) => {
    await gateway.rpc('research.update', { id: itemId, status });
    await loadItems();
    if (selectedId === itemId) {
      const result = await gateway.rpc('research.read', { id: itemId }) as ResearchItemWithContent;
      setSelectedContent(result);
    }
  };

  const handleSave = async (itemId: string, updates: { title?: string; topic?: string; content?: string; tags?: string[] }) => {
    await gateway.rpc('research.update', { id: itemId, ...updates });
    const result = await gateway.rpc('research.read', { id: itemId }) as ResearchItemWithContent;
    setSelectedContent(result);
    await loadItems();
    setEditing(false);
  };

  const handleBack = useCallback(() => {
    setSelectedId(null);
    setSelectedContent(null);
    setEditing(false);
  }, []);

  const toggleTopic = (topic: string) => {
    setCollapsedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  // keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowLeft' || e.key === '[')) {
        if (selectedId) { e.preventDefault(); handleBack(); return; }
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // skip when tiptap editor is focused
      if ((e.target as HTMLElement)?.closest('.tiptap-editor')) return;

      if (!selectedId) {
        if (e.key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusIndex(i => Math.min(i + 1, flatItems.length - 1));
        } else if (e.key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (flatItems[focusIndex]) setSelectedId(flatItems[focusIndex].id);
        } else if (e.key === 'x') {
          e.preventDefault();
          const item = flatItems[focusIndex];
          if (item) {
            const cfg = STATUS_CONFIG[item.status];
            if (cfg) handleStatusChange(item.id, cfg.next);
          }
        } else if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          handleCreate();
        }
      }
      if (selectedId) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (editing) setEditing(false);
          else handleBack();
        } else if (e.key === 'e' && !editing) {
          e.preventDefault();
          setEditing(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, flatItems, focusIndex, editing, handleBack]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  useEffect(() => {
    if (focusIndex >= flatItems.length) setFocusIndex(Math.max(0, flatItems.length - 1));
  }, [flatItems.length, focusIndex]);

  if (gateway.connectionState !== 'connected') {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-xs">not connected</div>;
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-xs"><Loader2 className="mr-2 h-4 w-4 animate-spin" />loading...</div>;
  }

  // detail view
  if (selectedId) {
    if (contentLoading || !selectedContent) {
      return <div className="flex items-center justify-center h-full text-muted-foreground text-xs"><Loader2 className="mr-2 h-4 w-4 animate-spin" />loading...</div>;
    }
    return (
      <DetailView
        item={selectedContent}
        editing={editing}
        onEdit={() => setEditing(true)}
        onCancelEdit={() => setEditing(false)}
        onBack={handleBack}
        onDelete={handleDelete}
        onStatusChange={handleStatusChange}
        onSave={handleSave}
      />
    );
  }

  // list view
  return (
    <div className="flex h-full" ref={listRef}>
      {/* topic sidebar */}
      {topics.length > 1 && (
        <div className="w-44 shrink-0 border-r border-border/40 flex flex-col">
          <div className="px-3 pt-3 pb-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Topics</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-1.5 pb-2">
              <button
                onClick={() => setSelectedTopic(null)}
                className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                  !selectedTopic ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                }`}
              >
                <span>All</span>
                <span className="text-[10px] opacity-50">{filtered.length}</span>
              </button>
              {topics.map(([topic, count]) => (
                <button
                  key={topic}
                  onClick={() => setSelectedTopic(selectedTopic === topic ? null : topic)}
                  className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                    selectedTopic === topic ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                  }`}
                >
                  <span className="truncate capitalize">{topic.replace(/-/g, ' ')}</span>
                  <span className="text-[10px] opacity-50 ml-1">{count}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* header */}
        <div className="shrink-0 px-4 py-2.5 border-b border-border/40">
          <div className="flex items-center gap-2 mb-2">
            <FileSearch className="w-3.5 h-3.5 text-muted-foreground/60" />
            <span className="text-[13px] font-semibold text-foreground">Research</span>
            <span className="text-[10px] text-muted-foreground/40">{filtered.length}</span>
            <div className="ml-auto flex items-center gap-1.5">
              {/* view toggle */}
              <div className="flex bg-secondary/40 rounded p-0.5">
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1 rounded transition-colors ${viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/50 hover:text-muted-foreground'}`}
                  title="List view"
                >
                  <LayoutList className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1 rounded transition-colors ${viewMode === 'table' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/50 hover:text-muted-foreground'}`}
                  title="Table view"
                >
                  <Table2 className="w-3 h-3" />
                </button>
              </div>
              <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 px-2" onClick={handleCreate}>
                <Plus className="w-3 h-3" />
                New
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 bg-secondary/40 rounded p-0.5">
              {(['all', 'active', 'completed', 'archived'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                    filter === f
                      ? 'bg-background text-foreground font-medium shadow-sm'
                      : 'text-muted-foreground/60 hover:text-foreground'
                  }`}
                >
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                  {filterCounts[f] > 0 && <span className="ml-1 text-[9px] opacity-40">{filterCounts[f]}</span>}
                </button>
              ))}
            </div>
            <div className="relative flex-1 max-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full h-6 pl-7 pr-2 text-[11px] bg-transparent border border-border/40 rounded outline-none focus:border-primary/40 transition-colors placeholder:text-muted-foreground/30"
              />
            </div>
          </div>
        </div>

        {/* content area */}
        <ScrollArea className="flex-1 min-h-0">
          {items.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="h-5 w-5 text-muted-foreground/20 mb-2" />
              <div className="text-[11px] text-muted-foreground/50">No results</div>
            </div>
          ) : viewMode === 'table' ? (
            <TableView
              items={filtered}
              focusIndex={focusIndex}
              onSelect={(id) => setSelectedId(id)}
              onFocus={(i) => setFocusIndex(i)}
              onStatusChange={handleStatusChange}
              onContextMenu={(e, item) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, item });
              }}
            />
          ) : selectedTopic ? (
            // single topic: flat list
            <div className="py-1">
              {filtered.map((item, i) => (
                <ResearchRow
                  key={item.id}
                  item={item}
                  focused={i === focusIndex}
                  onSelect={() => setSelectedId(item.id)}
                  onFocus={() => setFocusIndex(i)}
                  onStatusChange={handleStatusChange}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, item });
                  }}
                />
              ))}
            </div>
          ) : (
            // grouped by topic
            <div className="py-1">
              {grouped.map(([topic, topicItems]) => {
                const collapsed = collapsedTopics.has(topic);
                let itemFocusOffset = 0;
                for (const [t, tItems] of grouped) {
                  if (t === topic) break;
                  if (!collapsedTopics.has(t)) itemFocusOffset += tItems.length;
                }

                return (
                  <div key={topic} className="mb-1">
                    {/* topic header */}
                    <button
                      onClick={() => toggleTopic(topic)}
                      className="flex items-center gap-2 w-full px-4 py-1.5 text-left hover:bg-secondary/30 transition-colors group"
                    >
                      <ChevronRight className={`w-3 h-3 text-muted-foreground/40 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
                      <span className="text-[11px] font-medium text-muted-foreground capitalize">{topic.replace(/-/g, ' ')}</span>
                      <span className="text-[10px] text-muted-foreground/30">{topicItems.length}</span>
                    </button>
                    {/* items */}
                    {!collapsed && topicItems.map((item, i) => (
                      <ResearchRow
                        key={item.id}
                        item={item}
                        focused={itemFocusOffset + i === focusIndex}
                        compact
                        onSelect={() => setSelectedId(item.id)}
                        onFocus={() => setFocusIndex(itemFocusOffset + i)}
                        onStatusChange={handleStatusChange}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, item });
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* keyboard hints */}
        <div className="shrink-0 px-4 py-1 border-t border-border/30 flex items-center gap-3 text-[9px] text-muted-foreground/30">
          <span><kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> nav</span>
          <span><kbd className="font-mono">Enter</kbd> open</span>
          <span><kbd className="font-mono">x</kbd> status</span>
          <span><kbd className="font-mono">Cmd+N</kbd> new</span>
        </div>
      </div>

      {/* context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onOpen={() => setSelectedId(contextMenu.item.id)}
        />
      )}
    </div>
  );
}

// ── empty state ──────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <BookOpen className="h-6 w-6 text-muted-foreground/20 mb-3" />
      <div className="text-[12px] text-muted-foreground/60 mb-1">No research yet</div>
      <div className="text-[10px] text-muted-foreground/30 max-w-[240px] mb-4">
        Research is collected during agent work, or create your own.
      </div>
      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={onCreate}>
        <Plus className="w-3 h-3" />
        New
      </Button>
    </div>
  );
}

// ── row ──────────────────────────────────────────────────────────

function ResearchRow({ item, focused, compact, onSelect, onFocus, onStatusChange, onContextMenu }: {
  item: ResearchItem;
  focused: boolean;
  compact?: boolean;
  onSelect: () => void;
  onFocus: () => void;
  onStatusChange: (id: string, status: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.active;
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focused && ref.current) ref.current.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  return (
    <button
      ref={ref}
      onClick={onSelect}
      onMouseEnter={onFocus}
      onContextMenu={onContextMenu}
      className={`flex items-center gap-2.5 w-full text-left transition-colors group ${
        compact ? 'px-4 pl-9 py-1.5' : 'px-4 py-2.5'
      } ${focused ? 'bg-secondary/50' : 'hover:bg-secondary/20'}`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onStatusChange(item.id, cfg.next); }}
        className={`w-2 h-2 rounded-full shrink-0 ring-2 ring-transparent hover:ring-primary/30 transition-all ${cfg.dot}`}
        title={`Mark as ${cfg.next}`}
      />
      <span className={`${compact ? 'text-[12px]' : 'text-[13px]'} text-foreground truncate flex-1`}>{item.title}</span>
      {!compact && item.tags && item.tags.length > 0 && (
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5 font-normal">{item.tags[0]}</Badge>
      )}
      <span className="text-[10px] text-muted-foreground/25 w-12 text-right shrink-0">{formatDate(item.updatedAt)}</span>
    </button>
  );
}

// ── table view ───────────────────────────────────────────────────

function TableView({ items, focusIndex, onSelect, onFocus, onStatusChange, onContextMenu }: {
  items: ResearchItem[];
  focusIndex: number;
  onSelect: (id: string) => void;
  onFocus: (i: number) => void;
  onStatusChange: (id: string, status: string) => void;
  onContextMenu: (e: React.MouseEvent, item: ResearchItem) => void;
}) {
  return (
    <div className="text-[11px] overflow-x-auto">
      {/* header row */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/30 text-muted-foreground/40 text-[10px] font-medium uppercase tracking-wider min-w-[400px]">
        <span className="w-4" />
        <span className="flex-1">Title</span>
        <span className="w-28 hidden @md:block">Topic</span>
        <span className="w-16">Status</span>
        <span className="w-24 hidden @lg:block">Tags</span>
        <span className="w-16 text-right">Updated</span>
      </div>
      {/* rows */}
      {items.map((item, i) => {
        const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.active;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            onMouseEnter={() => onFocus(i)}
            onContextMenu={(e) => onContextMenu(e, item)}
            className={`flex items-center gap-2 w-full px-4 py-1.5 text-left transition-colors min-w-[400px] ${
              i === focusIndex ? 'bg-secondary/50' : 'hover:bg-secondary/20'
            }`}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onStatusChange(item.id, cfg.next); }}
              className={`w-2 h-2 rounded-full shrink-0 ring-2 ring-transparent hover:ring-primary/30 transition-all ${cfg.dot}`}
            />
            <span className="flex-1 truncate text-foreground">{item.title}</span>
            <span className="w-28 truncate text-muted-foreground/50 capitalize hidden @md:block">{item.topic.replace(/-/g, ' ')}</span>
            <span className="w-16">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${cfg.badge}`}>{cfg.label}</span>
            </span>
            <span className="w-24 truncate text-muted-foreground/40 hidden @lg:block">{item.tags?.join(', ') || ''}</span>
            <span className="w-16 text-right text-muted-foreground/30">{formatDate(item.updatedAt)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── context menu ─────────────────────────────────────────────────

function ContextMenu({ x, y, item, onStatusChange, onDelete, onOpen }: {
  x: number; y: number;
  item: ResearchItem;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onOpen: () => void;
}) {
  const cfg = STATUS_CONFIG[item.status];
  return (
    <div
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[140px] text-[11px]"
      style={{ left: x, top: y }}
    >
      <button onClick={onOpen} className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-secondary/50 transition-colors text-left">
        <BookOpen className="w-3 h-3 text-muted-foreground" />
        Open
      </button>
      <button
        onClick={() => onStatusChange(item.id, cfg?.next || 'active')}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-secondary/50 transition-colors text-left"
      >
        <cfg.icon className="w-3 h-3 text-muted-foreground" />
        Mark as {cfg?.next || 'active'}
      </button>
      <div className="border-t border-border/30 my-1" />
      <button
        onClick={() => onDelete(item.id)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-destructive/10 text-destructive transition-colors text-left"
      >
        <Trash2 className="w-3 h-3" />
        Delete
      </button>
    </div>
  );
}

// ── detail view ──────────────────────────────────────────────────

function DetailView({ item, editing, onEdit, onCancelEdit, onBack, onDelete, onStatusChange, onSave }: {
  item: ResearchItemWithContent;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onBack: () => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onSave: (id: string, updates: { title?: string; topic?: string; content?: string; tags?: string[] }) => Promise<void>;
}) {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.active;
  const [saving, setSaving] = useState(false);

  const [editTitle, setEditTitle] = useState(item.title);
  const [editTopic, setEditTopic] = useState(item.topic);
  const [editContent, setEditContent] = useState(item.content);
  const [editTags, setEditTags] = useState(item.tags?.join(', ') || '');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditTitle(item.title);
    setEditTopic(item.topic);
    setEditContent(item.content);
    setEditTags(item.tags?.join(', ') || '');
  }, [item]);

  useEffect(() => {
    if (editing && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editing]);

  const handleSave = async () => {
    setSaving(true);
    const tags = editTags.split(',').map(t => t.trim()).filter(Boolean);
    await onSave(item.id, {
      title: editTitle || 'Untitled',
      topic: editTopic || 'uncategorized',
      content: editContent,
      tags: tags.length > 0 ? tags : undefined,
    });
    setSaving(false);
  };

  const handleCancel = () => {
    setEditTitle(item.title);
    setEditTopic(item.topic);
    setEditContent(item.content);
    setEditTags(item.tags?.join(', ') || '');
    onCancelEdit();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* breadcrumb bar */}
      <div className="shrink-0 px-4 py-2 border-b border-border/40 flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
          Back
        </button>
        <span className="text-muted-foreground/15 text-[11px]">/</span>
        {editing ? (
          <input
            value={editTopic}
            onChange={e => setEditTopic(e.target.value)}
            className="text-[11px] text-muted-foreground bg-transparent border-b border-dashed border-muted-foreground/20 outline-none focus:border-primary/40 px-1 py-0.5 w-36"
            placeholder="topic"
          />
        ) : (
          <span className="text-[11px] text-muted-foreground/60 capitalize">{item.topic.replace(/-/g, ' ')}</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-1 px-2 text-muted-foreground" onClick={handleCancel} disabled={saving}>
                <X className="w-2.5 h-2.5" /> Cancel
              </Button>
              <Button variant="default" size="sm" className="h-5 text-[10px] gap-1 px-2" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />} Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-1 px-2 text-muted-foreground" onClick={onEdit}>
                <Pencil className="w-2.5 h-2.5" /> Edit
              </Button>
              <button
                onClick={() => onDelete(item.id)}
                className="p-1 rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="mx-auto max-w-3xl px-8 py-6">
          {/* title */}
          {editing ? (
            <input
              ref={titleRef}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="w-full text-lg font-semibold text-foreground bg-transparent outline-none pb-1 mb-3 border-b border-transparent focus:border-border/30"
              placeholder="Untitled"
            />
          ) : (
            <h1 className="text-lg font-semibold text-foreground leading-snug mb-3">{item.title}</h1>
          )}

          {/* meta row */}
          <div className="flex flex-wrap items-center gap-2 mb-5 text-[11px]">
            <button
              onClick={() => onStatusChange(item.id, cfg.next)}
              className={`px-2 py-0.5 rounded-full border transition-colors hover:opacity-80 cursor-pointer font-medium ${cfg.badge}`}
              title={`Mark as ${cfg.next}`}
            >
              {cfg.label}
            </button>

            <span className="text-muted-foreground/30">|</span>

            <span className="flex items-center gap-1 text-muted-foreground/50">
              <Clock className="w-3 h-3" />
              {new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>

            {editing ? (
              <>
                <span className="text-muted-foreground/30">|</span>
                <div className="flex items-center gap-1">
                  <Tag className="w-3 h-3 text-muted-foreground/50" />
                  <input
                    value={editTags}
                    onChange={e => setEditTags(e.target.value)}
                    className="text-[11px] bg-transparent border-b border-dashed border-muted-foreground/20 outline-none focus:border-primary/40 px-1 py-0.5 w-44"
                    placeholder="tags, comma separated"
                  />
                </div>
              </>
            ) : (
              item.tags?.map(tag => (
                <Badge key={tag} variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5 font-normal">{tag}</Badge>
              ))
            )}

            {item.sources && item.sources.length > 0 && !editing && (
              <>
                <span className="text-muted-foreground/30">|</span>
                <span className="flex items-center gap-1 text-muted-foreground/50">
                  <ExternalLink className="w-3 h-3" />
                  {item.sources.length} source{item.sources.length !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>

          {/* divider */}
          <div className="border-t border-border/30 mb-5" />

          {/* content - WYSIWYG or read-only */}
          {editing ? (
            <MarkdownEditor
              content={editContent}
              onChange={setEditContent}
              editable
              autoFocus={false}
              placeholder="Start writing..."
              className="min-h-[300px] tiptap-wrapper"
            />
          ) : (
            <MarkdownEditor
              content={item.content}
              editable={false}
              className="tiptap-wrapper"
            />
          )}

          {/* sources */}
          {!editing && item.sources && item.sources.length > 0 && (
            <div className="mt-8 pt-5 border-t border-border/30">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-2">
                Sources
              </h3>
              <div className="grid gap-1.5">
                {item.sources.map((src, i) => (
                  <a
                    key={i}
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-secondary/20 border border-border/20 hover:bg-secondary/40 transition-colors group text-[11px]"
                  >
                    <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary shrink-0 transition-colors" />
                    <span className="text-muted-foreground/60 group-hover:text-foreground truncate transition-colors">
                      {extractDomain(src)}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="h-12" />
        </div>
      </ScrollArea>

      {/* keyboard hints */}
      <div className="shrink-0 px-4 py-1 border-t border-border/30 flex items-center gap-3 text-[9px] text-muted-foreground/30">
        <span><kbd className="font-mono">Cmd+Left</kbd> back</span>
        <span><kbd className="font-mono">e</kbd> edit</span>
        <span><kbd className="font-mono">Esc</kbd> {editing ? 'cancel' : 'back'}</span>
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1d';
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
