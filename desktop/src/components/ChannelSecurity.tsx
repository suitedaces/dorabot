import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, X, Plus, RotateCw } from 'lucide-react';

type Props = {
  channel: 'whatsapp' | 'telegram';
  gateway: ReturnType<typeof useGateway>;
};

export function ChannelSecurity({ channel, gateway }: Props) {
  const [senders, setSenders] = useState<string[]>([]);
  const [dmPolicy, setDmPolicy] = useState<string>('open');
  const [groupPolicy, setGroupPolicy] = useState<string>('open');
  const [newSender, setNewSender] = useState('');
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sendersResult, configResult] = await Promise.all([
        gateway.getSecuritySenders(),
        gateway.rpc('config.get') as Promise<any>,
      ]);
      setSenders(sendersResult[channel] || []);
      const ch = configResult?.channels?.[channel];
      if (ch?.dmPolicy) setDmPolicy(ch.dmPolicy);
      if (ch?.groupPolicy) setGroupPolicy(ch.groupPolicy);
    } catch (err) {
      console.error('failed to load security config:', err);
    }
  }, [channel, gateway]);

  useEffect(() => { load(); }, [load]);

  const handleAddSender = async () => {
    const id = newSender.trim();
    if (!id) return;
    await gateway.addSender(channel, id);
    setNewSender('');
    await load();
  };

  const handleRemoveSender = async (id: string) => {
    await gateway.removeSender(channel, id);
    await load();
  };

  const handleDmPolicy = async (value: string) => {
    setDmPolicy(value);
    await gateway.setChannelPolicy(`channels.${channel}.dmPolicy`, value);
  };

  const handleGroupPolicy = async (value: string) => {
    setGroupPolicy(value);
    await gateway.setChannelPolicy(`channels.${channel}.groupPolicy`, value);
  };

  const handleRestart = async () => {
    await gateway.restartChannel(channel);
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className="mb-3">
        <CollapsibleTrigger className="w-full">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">security</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {senders.length > 0 ? `${senders.length} allowed` : 'open to all'}
                </span>
                {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
              </div>
            </div>
          </CardContent>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0 border-t border-border mt-1 space-y-3">
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] text-muted-foreground w-20">dm policy</span>
              <Select value={dmPolicy} onValueChange={handleDmPolicy}>
                <SelectTrigger className="h-7 text-[11px] w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open" className="text-[11px]">open</SelectItem>
                  <SelectItem value="allowlist" className="text-[11px]">allowlist</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground w-20">group policy</span>
              <Select value={groupPolicy} onValueChange={handleGroupPolicy}>
                <SelectTrigger className="h-7 text-[11px] w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open" className="text-[11px]">open</SelectItem>
                  <SelectItem value="allowlist" className="text-[11px]">allowlist</SelectItem>
                  <SelectItem value="disabled" className="text-[11px]">disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <span className="text-[11px] text-muted-foreground">allowed senders</span>
              {senders.length === 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  no sender restrictions — anyone can message
                </div>
              )}
              <div className="space-y-1 mt-1">
                {senders.map(id => (
                  <div key={id} className="flex items-center gap-2 text-[11px] bg-secondary rounded px-2 py-1">
                    <code className="flex-1 text-foreground">{id}</code>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => handleRemoveSender(id)}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 mt-2">
                <Input
                  placeholder="sender id"
                  value={newSender}
                  onChange={e => setNewSender(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddSender()}
                  className="flex-1 h-7 text-[11px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2"
                  onClick={handleAddSender}
                  disabled={!newSender.trim()}
                >
                  <Plus className="w-3 h-3 mr-1" />add
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={handleRestart}>
                <RotateCw className="w-3 h-3 mr-1" />restart channel
              </Button>
              <span className="text-[10px] text-muted-foreground">
                policy changes apply after restart
              </span>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
