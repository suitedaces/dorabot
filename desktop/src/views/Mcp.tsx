import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Plug, RefreshCw, Loader2, CheckCircle2, XCircle,
  AlertTriangle, Circle, Power, ExternalLink, Terminal, Globe,
} from 'lucide-react';

type McpServerConfig = {
  type?: 'stdio' | 'sse' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

type McpServerEntry = {
  name: string;
  config: McpServerConfig;
};

type McpServerStatus = {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverInfo?: { name: string; version: string };
  error?: string;
  tools?: { name: string; description?: string }[];
};

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

type AddForm = {
  name: string;
  type: 'http' | 'stdio';
  url: string;
  command: string;
  args: string;
  env: string;
};

const emptyForm: AddForm = { name: '', type: 'http', url: '', command: '', args: '', env: '' };

function statusIcon(status: string) {
  switch (status) {
    case 'connected': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case 'needs-auth': return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    case 'pending': return <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />;
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-destructive" />;
    case 'disabled': return <Circle className="w-3.5 h-3.5 text-muted-foreground" />;
    default: return <Circle className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'connected': return 'Connected';
    case 'needs-auth': return 'Needs Auth';
    case 'pending': return 'Connecting...';
    case 'failed': return 'Failed';
    case 'disabled': return 'Disabled';
    default: return status;
  }
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'connected': return 'default';
    case 'needs-auth': return 'outline';
    case 'failed': return 'destructive';
    default: return 'secondary';
  }
}

export function McpView({ gateway }: Props) {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadServers = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('mcp.list');
      if (Array.isArray(result)) setServers(result);
      setLoading(false);
    } catch (err) {
      console.error('failed to load mcp servers:', err);
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  const loadStatuses = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('mcp.status');
      if (Array.isArray(result)) setStatuses(result);
    } catch {
      // status not available if no active run
    }
  }, [gateway.connectionState, gateway.rpc]);

  useEffect(() => {
    loadServers();
    loadStatuses();
  }, [loadServers, loadStatuses]);

  // Poll statuses while view is open
  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    const interval = setInterval(loadStatuses, 5000);
    return () => clearInterval(interval);
  }, [gateway.connectionState, loadStatuses]);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      let config: McpServerConfig;
      if (form.type === 'http') {
        if (!form.url.trim()) return;
        config = { type: 'http', url: form.url.trim() };
      } else {
        if (!form.command.trim()) return;
        config = {
          type: 'stdio',
          command: form.command.trim(),
          args: form.args.trim() ? form.args.split(/\s+/) : [],
          env: form.env.trim() ? Object.fromEntries(
            form.env.split('\n').filter(l => l.includes('=')).map(l => {
              const idx = l.indexOf('=');
              return [l.slice(0, idx), l.slice(idx + 1)];
            })
          ) : undefined,
        };
      }
      await gateway.rpc('mcp.add', { name: form.name.trim(), config });
      setForm(emptyForm);
      setShowAdd(false);
      await loadServers();
      // Give it a moment to connect then refresh status
      setTimeout(loadStatuses, 2000);
    } catch (err) {
      console.error('failed to add mcp server:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (name: string) => {
    try {
      await gateway.rpc('mcp.remove', { name });
      await loadServers();
      await loadStatuses();
    } catch (err) {
      console.error('failed to remove mcp server:', err);
    }
  };

  const handleReconnect = async (name: string) => {
    try {
      await gateway.rpc('mcp.reconnect', { name });
      setTimeout(loadStatuses, 2000);
    } catch (err) {
      console.error('failed to reconnect mcp server:', err);
    }
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await gateway.rpc('mcp.toggle', { name, enabled });
      setTimeout(loadStatuses, 1000);
    } catch (err) {
      console.error('failed to toggle mcp server:', err);
    }
  };

  const getStatus = (name: string): McpServerStatus | undefined =>
    statuses.find(s => s.name === name);

  const connected = gateway.connectionState === 'connected';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">MCP Servers</span>
          <Badge variant="secondary" className="text-[10px] h-4">
            {servers.length}
          </Badge>
        </div>
        <Button
          size="sm"
          className="h-7 text-[11px] gap-1"
          onClick={() => setShowAdd(true)}
          disabled={!connected}
        >
          <Plus className="w-3 h-3" />
          Add Server
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-3 max-w-lg">
          {/* add form */}
          {showAdd && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Add MCP Server</span>
                <button
                  className="text-muted-foreground hover:text-foreground text-xs"
                  onClick={() => { setShowAdd(false); setForm(emptyForm); }}
                >
                  cancel
                </button>
              </div>

              <div className="space-y-2">
                <div>
                  <Label className="text-[11px]">Name</Label>
                  <Input
                    className="h-8 text-xs mt-1"
                    placeholder="e.g. rube, notion, github"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>

                <div>
                  <Label className="text-[11px]">Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v: 'http' | 'stdio') => setForm(f => ({ ...f, type: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3 h-3" />
                          Remote URL
                        </div>
                      </SelectItem>
                      <SelectItem value="stdio">
                        <div className="flex items-center gap-1.5">
                          <Terminal className="w-3 h-3" />
                          Local Command
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.type === 'http' ? (
                  <div>
                    <Label className="text-[11px]">URL</Label>
                    <Input
                      className="h-8 text-xs mt-1"
                      placeholder="https://rube.app/mcp"
                      value={form.url}
                      onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <Label className="text-[11px]">Command</Label>
                      <Input
                        className="h-8 text-xs mt-1"
                        placeholder="npx"
                        value={form.command}
                        onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Arguments</Label>
                      <Input
                        className="h-8 text-xs mt-1"
                        placeholder="@modelcontextprotocol/server-postgres postgresql://..."
                        value={form.args}
                        onChange={e => setForm(f => ({ ...f, args: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Environment variables (one per line, KEY=VALUE)</Label>
                      <textarea
                        className="w-full h-16 rounded-md border border-input bg-background px-3 py-1.5 text-xs mt-1 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="API_TOKEN=sk-..."
                        value={form.env}
                        onChange={e => setForm(f => ({ ...f, env: e.target.value }))}
                      />
                    </div>
                  </>
                )}
              </div>

              <Button
                size="sm"
                className="h-7 text-[11px] w-full"
                onClick={handleAdd}
                disabled={saving || !form.name.trim() || (form.type === 'http' ? !form.url.trim() : !form.command.trim())}
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                Add Server
              </Button>
            </div>
          )}

          {/* loading */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* empty state */}
          {!loading && servers.length === 0 && !showAdd && (
            <div className="text-center py-12 space-y-3">
              <Plug className="w-8 h-8 text-muted-foreground mx-auto" />
              <div className="text-sm text-muted-foreground">No MCP servers configured</div>
              <div className="text-xs text-muted-foreground max-w-xs mx-auto">
                Add remote MCP servers like Rube (rube.app/mcp) or local servers to give your agent access to Gmail, Calendar, Notion, and 500+ more apps.
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1"
                onClick={() => setShowAdd(true)}
                disabled={!connected}
              >
                <Plus className="w-3 h-3" />
                Add your first server
              </Button>
            </div>
          )}

          {/* server list */}
          {servers.map(server => {
            const status = getStatus(server.name);
            const st = status?.status || 'pending';
            const tools = status?.tools || [];
            const isHttp = server.config.type === 'http' || server.config.type === 'sse';

            return (
              <div
                key={server.name}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <div className="p-3 space-y-2">
                  {/* top row: name + status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {statusIcon(st)}
                      <span className="text-xs font-semibold">{server.name}</span>
                      {status?.serverInfo && (
                        <span className="text-[10px] text-muted-foreground">
                          v{status.serverInfo.version}
                        </span>
                      )}
                    </div>
                    <Badge variant={statusBadgeVariant(st)} className="text-[10px] h-4">
                      {statusLabel(st)}
                    </Badge>
                  </div>

                  {/* config info */}
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {isHttp ? (
                      <span className="flex items-center gap-1">
                        <Globe className="w-3 h-3 shrink-0" />
                        {server.config.url}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Terminal className="w-3 h-3 shrink-0" />
                        {server.config.command} {server.config.args?.join(' ')}
                      </span>
                    )}
                  </div>

                  {/* tools count when connected */}
                  {st === 'connected' && tools.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {tools.length} tool{tools.length !== 1 ? 's' : ''} available
                    </div>
                  )}

                  {/* error message */}
                  {st === 'failed' && status?.error && (
                    <div className="text-[10px] text-destructive truncate">
                      {status.error}
                    </div>
                  )}

                  {/* actions */}
                  <div className="flex items-center gap-1.5 pt-1">
                    {st === 'needs-auth' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1"
                        onClick={() => handleReconnect(server.name)}
                      >
                        <ExternalLink className="w-3 h-3" />
                        Authenticate
                      </Button>
                    )}
                    {st === 'failed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1"
                        onClick={() => handleReconnect(server.name)}
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                      </Button>
                    )}
                    {st === 'disabled' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1"
                        onClick={() => handleToggle(server.name, true)}
                      >
                        <Power className="w-3 h-3" />
                        Enable
                      </Button>
                    )}
                    {st === 'connected' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] gap-1 text-muted-foreground"
                        onClick={() => handleToggle(server.name, false)}
                      >
                        <Power className="w-3 h-3" />
                        Disable
                      </Button>
                    )}

                    <div className="flex-1" />

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] text-destructive hover:text-destructive gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-sm">Remove {server.name}?</AlertDialogTitle>
                          <AlertDialogDescription className="text-xs">
                            This will disconnect and remove this MCP server. You can add it back later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="h-7 text-[11px]">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="h-7 text-[11px]"
                            onClick={() => handleRemove(server.name)}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                {/* expandable tools list */}
                {st === 'connected' && tools.length > 0 && (
                  <details className="border-t border-border">
                    <summary className="px-3 py-1.5 text-[10px] text-muted-foreground cursor-pointer hover:bg-secondary/30">
                      View tools ({tools.length})
                    </summary>
                    <div className="px-3 pb-2 space-y-0.5">
                      {tools.map(tool => (
                        <div key={tool.name} className="text-[10px] font-mono text-muted-foreground truncate">
                          {tool.name}
                          {tool.description && (
                            <span className="text-muted-foreground/60 ml-1.5 font-sans">
                              {tool.description.slice(0, 60)}{tool.description.length > 60 ? '...' : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
