import { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { useGateway } from '../hooks/useGateway';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileSearch, ExternalLink, Tag, Clock, Trash2, ChevronRight } from 'lucide-react';

type ResearchItem = {
  id: string;
  topic: string;
  title: string;
  filePath: string;
  status: 'active' | 'completed' | 'archived';
  sources?: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

type ResearchItemWithContent = ResearchItem & { content: string };

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

export function ResearchView({ gateway }: Props) {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<ResearchItemWithContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'archived'>('all');

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
  }, [gateway]);

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
    gateway.rpc('research.read', { id: selectedId }).then((result: any) => {
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
  }, [selectedId, gateway]);

  // re-fetch content when research updates (agent wrote new content)
  useEffect(() => {
    if (!selectedId || gateway.connectionState !== 'connected') return;
    gateway.rpc('research.read', { id: selectedId }).then((result: any) => {
      setSelectedContent(result as ResearchItemWithContent);
    }).catch(() => {});
  }, [gateway.researchVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);

  const grouped = filtered.reduce<Record<string, ResearchItem[]>>((acc, item) => {
    const topic = item.topic || 'uncategorized';
    if (!acc[topic]) acc[topic] = [];
    acc[topic].push(item);
    return acc;
  }, {});

  const handleDelete = async (itemId: string) => {
    await gateway.rpc('research.delete', { id: itemId });
    if (selectedId === itemId) {
      setSelectedId(null);
      setSelectedContent(null);
    }
  };

  const handleStatusChange = async (itemId: string, status: string) => {
    await gateway.rpc('research.update', { id: itemId, status });
  };

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        not connected
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        loading research...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* sidebar */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col min-h-0">
        <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2">
          <FileSearch className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Research</span>
          <span className="text-[10px] text-muted-foreground ml-auto">{items.length}</span>
        </div>

        <div className="shrink-0 px-3 py-1.5 border-b border-border flex gap-1">
          {(['all', 'active', 'completed', 'archived'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                filter === f
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {Object.keys(grouped).length === 0 ? (
            <div className="px-3 py-8 text-center text-muted-foreground text-xs">
              no research yet
              <p className="text-[10px] mt-1 opacity-60">the agent will add research during pulse or when asked</p>
            </div>
          ) : (
            <div className="py-1">
              {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([topic, topicItems]) => (
                <TopicGroup
                  key={topic}
                  topic={topic}
                  items={topicItems}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* content */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {selectedContent ? (
          <>
            <div className="shrink-0 px-4 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium truncate flex-1">{selectedContent.title}</h2>
                <StatusBadge status={selectedContent.status} onChange={(s) => handleStatusChange(selectedContent.id, s)} />
                <button
                  onClick={() => handleDelete(selectedContent.id)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Tag className="w-3 h-3" />
                  {selectedContent.topic}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(selectedContent.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                {selectedContent.tags?.map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 rounded bg-secondary text-[10px]">{tag}</span>
                ))}
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="px-6 py-4 max-w-3xl">
                <div className="prose-chat">
                  <Markdown remarkPlugins={[remarkGfm]}>{selectedContent.content}</Markdown>
                </div>

                {selectedContent.sources && selectedContent.sources.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-border">
                    <h3 className="text-xs font-medium text-muted-foreground mb-2">Sources</h3>
                    <div className="space-y-1">
                      {selectedContent.sources.map((src, i) => (
                        <a
                          key={i}
                          href={src}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">{src}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </>
        ) : contentLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            loading...
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            {items.length > 0 ? 'select a research item' : 'no research yet — ask the agent to research something'}
          </div>
        )}
      </div>
    </div>
  );
}

function TopicGroup({ topic, items, selectedId, onSelect }: {
  topic: string;
  items: ResearchItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 w-full px-3 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="truncate">{topic}</span>
        <span className="ml-auto text-[9px] opacity-60">{items.length}</span>
      </button>
      {expanded && items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`flex items-center gap-1.5 w-full pl-7 pr-3 py-1 text-[11px] transition-colors ${
            selectedId === item.id
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
          }`}
        >
          <span className="truncate flex-1 text-left">{item.title}</span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            item.status === 'active' ? 'bg-primary' :
            item.status === 'completed' ? 'bg-success' :
            'bg-muted-foreground/30'
          }`} />
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ status, onChange }: { status: string; onChange: (s: string) => void }) {
  const colors: Record<string, string> = {
    active: 'bg-primary/15 text-primary',
    completed: 'bg-success/15 text-success',
    archived: 'bg-muted-foreground/15 text-muted-foreground',
  };

  const nextStatus: Record<string, string> = {
    active: 'completed',
    completed: 'archived',
    archived: 'active',
  };

  return (
    <button
      onClick={() => onChange(nextStatus[status] || 'active')}
      className={`text-[10px] px-2 py-0.5 rounded-full ${colors[status] || colors.active} transition-colors hover:opacity-80`}
      title={`click to change to ${nextStatus[status]}`}
    >
      {status}
    </button>
  );
}
