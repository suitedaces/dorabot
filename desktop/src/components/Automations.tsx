import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import type { CalendarItem } from '../../../src/calendar/scheduler';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { Plus, X, Play, Pause, Trash2, ChevronDown, ChevronRight, Clock, Zap } from 'lucide-react';

type AutomationsProps = {
  gateway: ReturnType<typeof useGateway>;
};

export function Automations({ gateway }: AutomationsProps) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({
    summary: '',
    message: '',
    type: 'reminder' as 'event' | 'todo' | 'reminder',
    dtstart: '',
    rrule: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const loadItems = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('cron.list');
      if (Array.isArray(result)) setItems(result);
      setLoading(false);
    } catch (err) {
      console.error('failed to load schedule:', err);
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const resetForm = () => {
    setNewItem({
      summary: '',
      message: '',
      type: 'reminder',
      dtstart: '',
      rrule: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    setShowAddForm(false);
  };

  const addItem = async () => {
    const data: Record<string, unknown> = {
      summary: newItem.summary || 'Unnamed',
      message: newItem.message,
      type: newItem.type,
      dtstart: newItem.dtstart ? new Date(newItem.dtstart).toISOString() : new Date().toISOString(),
      timezone: newItem.timezone,
      enabled: true,
    };

    if (newItem.rrule) {
      data.rrule = newItem.rrule;
    }

    if (newItem.type === 'reminder' && !newItem.rrule) {
      data.deleteAfterRun = true;
    }

    try {
      await gateway.rpc('cron.add', data);
      resetForm();
      setTimeout(loadItems, 100);
    } catch (err) {
      console.error('failed to add item:', err);
    }
  };

  const toggleItem = async (id: string) => {
    try {
      await gateway.rpc('cron.toggle', { id });
      setTimeout(loadItems, 100);
    } catch (err) {
      console.error('failed to toggle item:', err);
    }
  };

  const runItemNow = async (id: string) => {
    try {
      await gateway.rpc('cron.run', { id });
      setTimeout(loadItems, 500);
    } catch (err) {
      console.error('failed to run item:', err);
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await gateway.rpc('cron.remove', { id });
      setTimeout(loadItems, 100);
    } catch (err) {
      console.error('failed to delete item:', err);
    }
  };

  const formatSchedule = (item: CalendarItem) => {
    if (item.rrule) return item.rrule;
    return `at ${item.dtstart}`;
  };

  const formatTime = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const canSubmit = newItem.message && newItem.dtstart;

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Zap className="w-6 h-6 opacity-40" />
        <span className="text-sm">connecting...</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-semibold text-sm">Automations</span>
        <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
        <Button
          variant={showAddForm ? 'outline' : 'default'}
          size="sm"
          className="ml-auto h-6 text-[11px] px-2"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? <><X className="w-3 h-3 mr-1" />cancel</> : <><Plus className="w-3 h-3 mr-1" />new</>}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {showAddForm && (
            <Card className="border-primary/50">
              <CardContent className="p-4 space-y-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">summary</Label>
                  <Input
                    value={newItem.summary}
                    onChange={e => setNewItem({ ...newItem, summary: e.target.value })}
                    placeholder="daily standup reminder"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">message / task</Label>
                  <Textarea
                    value={newItem.message}
                    onChange={e => setNewItem({ ...newItem, message: e.target.value })}
                    placeholder="check project status and send update"
                    rows={3}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">type</Label>
                  <div className="flex gap-1.5">
                    {(['reminder', 'event', 'todo'] as const).map(type => (
                      <Button
                        key={type}
                        variant={newItem.type === type ? 'default' : 'outline'}
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={() => setNewItem({ ...newItem, type })}
                      >
                        {type}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">start date/time</Label>
                  <Input
                    type="datetime-local"
                    value={newItem.dtstart}
                    onChange={e => setNewItem({ ...newItem, dtstart: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>

                {newItem.type !== 'reminder' && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">recurrence (RRULE)</Label>
                    <Input
                      value={newItem.rrule}
                      onChange={e => setNewItem({ ...newItem, rrule: e.target.value })}
                      placeholder="FREQ=DAILY;BYHOUR=9;BYMINUTE=0"
                      className="h-8 text-xs font-mono"
                    />
                    <span className="text-[10px] text-muted-foreground">RFC 5545 RRULE — e.g. FREQ=WEEKLY;BYDAY=MO,FR</span>
                  </div>
                )}

                <Button
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={addItem}
                  disabled={!canSubmit}
                >
                  create automation
                </Button>
              </CardContent>
            </Card>
          )}

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Clock className="w-6 h-6 opacity-40" />
              <span className="text-sm">no automations yet</span>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(item => {
                const isExpanded = expandedItem === item.id;
                return (
                  <Collapsible key={item.id} open={isExpanded} onOpenChange={open => setExpandedItem(open ? item.id : null)}>
                    <Card className={cn('transition-colors', isExpanded && 'border-primary/50')}>
                      <CollapsibleTrigger className="w-full">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={item.enabled === false ? 'outline' : 'default'}
                              className={cn('text-[9px] h-4', item.enabled !== false && 'bg-success/15 text-success border-success/30')}
                            >
                              {item.enabled === false ? 'off' : item.type}
                            </Badge>
                            <span className="text-xs font-semibold flex-1 text-left">{item.summary}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">{formatSchedule(item)}</span>
                            {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                          </div>
                        </CardContent>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-3 pt-0 border-t border-border mt-1">
                          <div className="text-xs text-muted-foreground mt-2 mb-2 bg-secondary rounded p-2">
                            {item.message}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground mb-2">
                            {item.nextRunAt && <span>next: {formatTime(item.nextRunAt)}</span>}
                            {item.lastRunAt && <span>last: {formatTime(item.lastRunAt)}</span>}
                            <span>created: {formatTime(item.createdAt)}</span>
                            {item.deleteAfterRun && <Badge variant="outline" className="text-[8px] h-3 px-1">one-shot</Badge>}
                          </div>
                          <div className="flex gap-1.5">
                            <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={() => toggleItem(item.id)}>
                              {item.enabled === false ? <><Play className="w-3 h-3 mr-1" />enable</> : <><Pause className="w-3 h-3 mr-1" />disable</>}
                            </Button>
                            <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={() => runItemNow(item.id)}>
                              <Play className="w-3 h-3 mr-1" />run now
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="h-6 text-[11px] px-2">
                                  <Trash2 className="w-3 h-3 mr-1" />delete
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-sm">delete "{item.summary}"?</AlertDialogTitle>
                                  <AlertDialogDescription className="text-xs">this cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="h-7 text-xs">cancel</AlertDialogCancel>
                                  <AlertDialogAction className="h-7 text-xs" onClick={() => deleteItem(item.id)}>delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
