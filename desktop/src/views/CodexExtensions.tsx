import { useCallback, useEffect, useMemo, useState } from 'react';
import type { useGateway, CodexAppServerSnapshot } from '../hooks/useGateway';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Plug,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

type CodexExtensionsTab = 'plugins' | 'skills' | 'apps' | 'mcp' | 'features';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object').map(item => item as JsonRecord) : [];
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}

function pluginLabel(plugin: JsonRecord): string {
  const iface = record(plugin.interface);
  return stringValue(iface.displayName) || stringValue(plugin.name) || stringValue(plugin.id) || 'plugin';
}

function pluginDescription(plugin: JsonRecord): string {
  const iface = record(plugin.interface);
  return stringValue(iface.shortDescription) || stringValue(iface.longDescription) || '';
}

function sourceLabel(source: unknown): string {
  const src = record(source);
  const type = stringValue(src.type, 'unknown');
  if (type === 'git') return stringValue(src.url, 'git');
  if (type === 'local') return stringValue(src.path, 'local');
  return type;
}

function authLabel(value: unknown): string {
  const raw = stringValue(value, 'unknown');
  if (raw === 'notLoggedIn') return 'needs auth';
  if (raw === 'bearerToken') return 'bearer token';
  if (raw === 'oAuth') return 'oauth';
  return raw;
}

export function CodexExtensionsView({ gateway }: Props) {
  const [activeTab, setActiveTab] = useState<CodexExtensionsTab>('plugins');
  const [snapshot, setSnapshot] = useState<CodexAppServerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [pluginDetail, setPluginDetail] = useState<unknown>(null);
  const [marketplaceSource, setMarketplaceSource] = useState('');
  const [marketplaceRef, setMarketplaceRef] = useState('');
  const [marketplaceSparsePaths, setMarketplaceSparsePaths] = useState('');
  const [resourcePreview, setResourcePreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    setLoading(true);
    setError(null);
    try {
      const next = await gateway.getCodexAppServerSnapshot();
      setSnapshot(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.getCodexAppServerSnapshot]);

  useEffect(() => { void load(); }, [load]);

  const rpc = useCallback(async (method: string, params?: Record<string, unknown>, reload = true) => {
    setAction(method);
    setError(null);
    setLastResult(null);
    try {
      const result = await gateway.codexAppServerRpc(method, params);
      setLastResult(prettyJson(result));
      if (reload) await load();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setAction(null);
    }
  }, [gateway.codexAppServerRpc, load]);

  const pluginsPayload = record(snapshot?.plugins);
  const marketplaces = useMemo(() => list(pluginsPayload.marketplaces), [pluginsPayload.marketplaces]);
  const marketplaceErrors = useMemo(() => list(pluginsPayload.marketplaceLoadErrors), [pluginsPayload.marketplaceLoadErrors]);
  const featuredPluginIds = useMemo(
    () => Array.isArray(pluginsPayload.featuredPluginIds) ? pluginsPayload.featuredPluginIds.map(String) : [],
    [pluginsPayload.featuredPluginIds],
  );

  const skillGroups = useMemo(() => list(snapshot?.skills), [snapshot?.skills]);
  const codexSkills = useMemo(() => skillGroups.flatMap(group => {
    const cwd = stringValue(group.cwd, 'global');
    return list(group.skills).map(skill => ({ cwd, skill }));
  }), [skillGroups]);

  const apps = useMemo(() => list(snapshot?.apps), [snapshot?.apps]);
  const mcpServers = useMemo(() => list(snapshot?.mcpServers), [snapshot?.mcpServers]);
  const experimentalFeatures = useMemo(() => list(snapshot?.experimentalFeatures), [snapshot?.experimentalFeatures]);

  const addMarketplace = useCallback(async () => {
    const source = marketplaceSource.trim();
    if (!source) return;
    const sparsePaths = marketplaceSparsePaths
      .split(',')
      .map(path => path.trim())
      .filter(Boolean);
    await rpc('marketplace/add', {
      source,
      refName: marketplaceRef.trim() || null,
      sparsePaths: sparsePaths.length ? sparsePaths : null,
    });
    setMarketplaceSource('');
    setMarketplaceRef('');
    setMarketplaceSparsePaths('');
  }, [marketplaceRef, marketplaceSource, marketplaceSparsePaths, rpc]);

  const readPlugin = useCallback(async (marketplace: JsonRecord, plugin: JsonRecord) => {
    const result = await rpc('plugin/read', {
      marketplacePath: marketplace.path || null,
      remoteMarketplaceName: marketplace.path ? null : marketplace.name,
      pluginName: plugin.name,
    }, false);
    setPluginDetail(result);
  }, [rpc]);

  const installPlugin = useCallback(async (marketplace: JsonRecord, plugin: JsonRecord) => {
    await rpc('plugin/install', {
      marketplacePath: marketplace.path || null,
      remoteMarketplaceName: marketplace.path ? null : marketplace.name,
      pluginName: plugin.name,
    });
  }, [rpc]);

  const toggleSkill = useCallback(async (skill: JsonRecord, enabled: boolean) => {
    await rpc('skills/config/write', {
      path: skill.path || null,
      name: skill.path ? null : skill.name,
      enabled,
    });
  }, [rpc]);

  const toggleApp = useCallback(async (app: JsonRecord, enabled: boolean) => {
    const id = stringValue(app.id);
    if (!id) return;
    await rpc('config/value/write', {
      keyPath: `apps.${id}.enabled`,
      value: enabled,
      mergeStrategy: 'upsert',
    });
  }, [rpc]);

  const readResource = useCallback(async (server: string, uri: string) => {
    const result = await rpc('mcpServer/resource/read', { server, uri }, false);
    setResourcePreview(prettyJson(result));
  }, [rpc]);

  const startOauth = useCallback(async (server: string) => {
    const result = await rpc('mcpServer/oauth/login', { name: server }, false);
    const authUrl = stringValue(record(result).authorizationUrl) || stringValue(record(result).authUrl);
    if (authUrl) window.open(authUrl, '_blank', 'noopener,noreferrer');
  }, [rpc]);

  const connected = gateway.connectionState === 'connected';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Codex Extensions</span>
          {snapshot && (
            <Badge variant="secondary" className="text-[10px] h-4">
              {marketplaces.reduce((count, marketplace) => count + list(marketplace.plugins).length, 0)} plugins
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={load} disabled={!connected || loading}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          refresh
        </Button>
      </div>

      {(error || lastResult) && (
        <div className={cn('px-4 py-2 border-b text-[11px]', error ? 'text-destructive bg-destructive/5' : 'text-muted-foreground bg-secondary/20')}>
          {error || lastResult}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as CodexExtensionsTab)} className="flex-1 min-h-0 flex flex-col">
        <TabsList className="shrink-0 grid grid-cols-5 w-full h-9 rounded-none border-b border-border bg-card">
          <TabsTrigger value="plugins" className="rounded-none gap-1.5 text-[11px]"><Package className="w-3.5 h-3.5" />Plugins</TabsTrigger>
          <TabsTrigger value="skills" className="rounded-none gap-1.5 text-[11px]"><Sparkles className="w-3.5 h-3.5" />Skills</TabsTrigger>
          <TabsTrigger value="apps" className="rounded-none gap-1.5 text-[11px]"><ExternalLink className="w-3.5 h-3.5" />Apps</TabsTrigger>
          <TabsTrigger value="mcp" className="rounded-none gap-1.5 text-[11px]"><Plug className="w-3.5 h-3.5" />MCP</TabsTrigger>
          <TabsTrigger value="features" className="rounded-none gap-1.5 text-[11px]"><Settings2 className="w-3.5 h-3.5" />Flags</TabsTrigger>
        </TabsList>

        <TabsContent value="plugins" className="m-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4 max-w-5xl">
              <div className="rounded border border-border bg-card p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold">marketplaces</div>
                    <div className="text-[10px] text-muted-foreground">add, upgrade, remove, install, uninstall, and inspect Codex plugins</div>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={!!action} onClick={() => rpc('marketplace/upgrade', {})}>
                    upgrade all
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_180px_auto] gap-2">
                  <Input className="h-8 text-xs" value={marketplaceSource} onChange={e => setMarketplaceSource(e.target.value)} placeholder="github-org/repo or marketplace source" />
                  <Input className="h-8 text-xs" value={marketplaceRef} onChange={e => setMarketplaceRef(e.target.value)} placeholder="ref" />
                  <Input className="h-8 text-xs" value={marketplaceSparsePaths} onChange={e => setMarketplaceSparsePaths(e.target.value)} placeholder="sparse paths, comma-separated" />
                  <Button size="sm" className="h-8 text-[11px]" disabled={!!action || !marketplaceSource.trim()} onClick={addMarketplace}>
                    add
                  </Button>
                </div>
              </div>

              {marketplaceErrors.length > 0 && (
                <div className="rounded border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                  {marketplaceErrors.map((item, index) => (
                    <div key={index} className="flex gap-2 text-[11px] text-destructive">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {stringValue(item.marketplacePath)} {stringValue(item.message)}
                    </div>
                  ))}
                </div>
              )}

              {loading && <LoadingLine />}
              {!loading && marketplaces.length === 0 && <EmptyLine text="no Codex marketplaces returned by app-server" />}

              {marketplaces.map(marketplace => (
                <div key={stringValue(marketplace.name)} className="rounded border border-border bg-card overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{stringValue(record(marketplace.interface).displayName) || stringValue(marketplace.name)}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">{stringValue(marketplace.path) || 'remote catalog'}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" className="h-6 text-[10px]" disabled={!!action} onClick={() => rpc('marketplace/upgrade', { marketplaceName: marketplace.name })}>upgrade</Button>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" disabled={!!action} onClick={() => rpc('marketplace/remove', { marketplaceName: marketplace.name })}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {list(marketplace.plugins).map(plugin => {
                      const id = stringValue(plugin.id) || `${stringValue(marketplace.name)}:${stringValue(plugin.name)}`;
                      const installed = boolValue(plugin.installed);
                      const installPolicy = stringValue(plugin.installPolicy);
                      const isFeatured = featuredPluginIds.includes(id);
                      return (
                        <div key={id} className="px-3 py-2 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium truncate">{pluginLabel(plugin)}</span>
                              {isFeatured && <Badge variant="secondary" className="h-4 text-[9px]">featured</Badge>}
                              {installed && <Badge variant="default" className="h-4 text-[9px]">installed</Badge>}
                              {!boolValue(plugin.enabled) && <Badge variant="outline" className="h-4 text-[9px]">disabled</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">{pluginDescription(plugin) || sourceLabel(plugin.source)}</div>
                          </div>
                          <Button variant="outline" size="sm" className="h-6 text-[10px]" disabled={!!action} onClick={() => readPlugin(marketplace, plugin)}>read</Button>
                          {installed ? (
                            <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" disabled={!!action} onClick={() => rpc('plugin/uninstall', { pluginId: id })}>uninstall</Button>
                          ) : (
                            <Button variant="outline" size="sm" className="h-6 text-[10px]" disabled={!!action || installPolicy !== 'AVAILABLE'} onClick={() => installPlugin(marketplace, plugin)}>
                              <Download className="w-3 h-3 mr-1" />install
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {pluginDetail !== null && (
                <div className="space-y-2">
                  <Label className="text-[11px]">plugin detail</Label>
                  <Textarea className="min-h-48 text-[11px] font-mono" value={prettyJson(pluginDetail)} readOnly />
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="skills" className="m-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3 max-w-4xl">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold">Codex native skills</div>
                <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={!!action} onClick={() => rpc('skills/list', { forceReload: true }, true)}>
                  force reload
                </Button>
              </div>
              {loading && <LoadingLine />}
              {!loading && codexSkills.length === 0 && <EmptyLine text="no Codex skills found for this workspace" />}
              {codexSkills.map(({ cwd, skill }) => (
                <div key={`${cwd}:${stringValue(skill.path) || stringValue(skill.name)}`} className="rounded border border-border bg-card px-3 py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{stringValue(record(skill.interface).displayName) || stringValue(skill.name)}</span>
                      {boolValue(skill.enabled) ? <Badge className="h-4 text-[9px]">enabled</Badge> : <Badge variant="outline" className="h-4 text-[9px]">disabled</Badge>}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{stringValue(skill.description) || stringValue(skill.shortDescription)}</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{stringValue(skill.path) || cwd}</div>
                  </div>
                  <Switch size="sm" checked={boolValue(skill.enabled)} disabled={!!action} onCheckedChange={enabled => toggleSkill(skill, enabled)} />
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="apps" className="m-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3 max-w-4xl">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold">Codex apps/connectors</div>
                <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={!!action} onClick={() => rpc('app/list', { limit: 100, forceRefetch: true })}>
                  force refetch
                </Button>
              </div>
              {loading && <LoadingLine />}
              {!loading && apps.length === 0 && <EmptyLine text="no Codex apps returned by app-server" />}
              {apps.map(app => {
                const installUrl = stringValue(app.installUrl);
                return (
                  <div key={stringValue(app.id)} className="rounded border border-border bg-card px-3 py-2 flex items-center gap-3">
                    {stringValue(app.logoUrl) && <img src={stringValue(app.logoUrl)} alt="" className="w-7 h-7 rounded" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">{stringValue(app.name) || stringValue(app.id)}</span>
                        {boolValue(app.isAccessible) ? <Badge className="h-4 text-[9px]">accessible</Badge> : <Badge variant="outline" className="h-4 text-[9px]">not accessible</Badge>}
                        {boolValue(app.isEnabled) && <Badge variant="secondary" className="h-4 text-[9px]">enabled</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">{stringValue(app.description)}</div>
                      {Array.isArray(app.pluginDisplayNames) && app.pluginDisplayNames.length > 0 && (
                        <div className="text-[10px] text-muted-foreground truncate">from {app.pluginDisplayNames.map(String).join(', ')}</div>
                      )}
                    </div>
                    {installUrl && (
                      <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => window.open(installUrl, '_blank', 'noopener,noreferrer')}>
                        open
                      </Button>
                    )}
                    <Switch size="sm" checked={boolValue(app.isEnabled)} disabled={!!action} onCheckedChange={enabled => toggleApp(app, enabled)} />
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="mcp" className="m-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3 max-w-5xl">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold">Codex MCP inventory</div>
                  <div className="text-[10px] text-muted-foreground">status, tools, resources, OAuth, and config reload from app-server</div>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={!!action} onClick={() => rpc('config/mcpServer/reload', undefined)}>
                  reload config
                </Button>
              </div>
              {loading && <LoadingLine />}
              {!loading && mcpServers.length === 0 && <EmptyLine text="no Codex MCP servers initialized" />}
              {mcpServers.map(server => {
                const name = stringValue(server.name);
                const tools = Object.values(record(server.tools)).filter(Boolean) as JsonRecord[];
                const resources = list(server.resources);
                return (
                  <div key={name} className="rounded border border-border bg-card overflow-hidden">
                    <div className="px-3 py-2 flex items-center gap-3 border-b border-border">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold">{name}</span>
                          <Badge variant="secondary" className="h-4 text-[9px]">{authLabel(server.authStatus)}</Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground">{tools.length} tools · {resources.length} resources</div>
                      </div>
                      {stringValue(server.authStatus) === 'notLoggedIn' && (
                        <Button variant="outline" size="sm" className="h-6 text-[10px]" disabled={!!action} onClick={() => startOauth(name)}>
                          oauth login
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
                      <div className="p-3 space-y-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase">tools</div>
                        {tools.slice(0, 12).map(tool => (
                          <div key={stringValue(tool.name)} className="text-[10px] font-mono text-muted-foreground truncate">
                            {stringValue(tool.name)}
                            {stringValue(tool.description) && <span className="font-sans ml-1.5 opacity-70">{stringValue(tool.description).slice(0, 80)}</span>}
                          </div>
                        ))}
                        {tools.length > 12 && <div className="text-[10px] text-muted-foreground">+{tools.length - 12} more</div>}
                      </div>
                      <div className="p-3 space-y-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase">resources</div>
                        {resources.slice(0, 10).map(resource => (
                          <button key={stringValue(resource.uri)} className="block w-full text-left text-[10px] font-mono text-muted-foreground truncate hover:text-foreground" onClick={() => readResource(name, stringValue(resource.uri))}>
                            {stringValue(resource.name) || stringValue(resource.uri)}
                          </button>
                        ))}
                        {resources.length > 10 && <div className="text-[10px] text-muted-foreground">+{resources.length - 10} more</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {resourcePreview && (
                <div className="space-y-2">
                  <Label className="text-[11px]">resource preview</Label>
                  <Textarea className="min-h-40 text-[11px] font-mono" value={resourcePreview} readOnly />
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="features" className="m-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4 max-w-4xl">
              <div className="rounded border border-border bg-card p-3 space-y-2">
                <div className="text-xs font-semibold">app-server state</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-muted-foreground">
                  <Metric label="models" value={snapshot?.models.length || 0} />
                  <Metric label="apps" value={apps.length} />
                  <Metric label="mcp" value={mcpServers.length} />
                  <Metric label="features" value={experimentalFeatures.length} />
                </div>
                <details>
                  <summary className="text-[10px] text-muted-foreground cursor-pointer">rate limits and requirements</summary>
                  <Textarea className="mt-2 min-h-40 text-[11px] font-mono" value={prettyJson({ rateLimits: snapshot?.rateLimits, configRequirements: snapshot?.configRequirements })} readOnly />
                </details>
              </div>
              {loading && <LoadingLine />}
              {!loading && experimentalFeatures.length === 0 && <EmptyLine text="no experimental features returned by app-server" />}
              {experimentalFeatures.map(feature => {
                const name = stringValue(feature.name);
                return (
                  <div key={name} className="rounded border border-border bg-card px-3 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">{stringValue(feature.displayName) || name}</span>
                        <Badge variant="secondary" className="h-4 text-[9px]">{stringValue(feature.stage)}</Badge>
                        {boolValue(feature.defaultEnabled) && <Badge variant="outline" className="h-4 text-[9px]">default</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">{stringValue(feature.description) || name}</div>
                    </div>
                    <Switch
                      size="sm"
                      checked={boolValue(feature.enabled)}
                      disabled={!!action}
                      onCheckedChange={enabled => rpc('experimentalFeature/enablement/set', { enablement: { [name]: enabled } })}
                    />
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LoadingLine() {
  return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />loading Codex app-server...</div>;
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">{text}</div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-secondary/20 px-2 py-1.5">
      <div className="text-[13px] text-foreground font-semibold">{value}</div>
      <div>{label}</div>
    </div>
  );
}
