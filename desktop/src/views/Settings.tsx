import { useCallback, useState, useEffect } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { ToolsView } from './Tools';
import { StatusView } from './Status';
import { useTheme } from '../hooks/useTheme';
import { ProviderSetup } from '@/components/ProviderSetup';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, Brain, Globe, Settings2, Box, Lock, FolderLock, X, Plus, Wrench, Activity, Sun, Check } from 'lucide-react';
import { PALETTES } from '../lib/palettes';
import type { Palette } from '../lib/palettes';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_MODEL, codexModelsForAuth } from '@/lib/modelCatalog';
import { useEditorPrefs } from '../hooks/useEditorPrefs';
import { FileCode } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

export function SettingsView({ gateway }: Props) {
  const [settingsTab, setSettingsTab] = useState<'config' | 'tools' | 'status'>('config');
  const { palette, setPalette } = useTheme();
  const { prefs: editorPrefs, update: updateEditorPrefs } = useEditorPrefs();
  const cfg = gateway.configData as Record<string, any> | null;
  const disabled = gateway.connectionState !== 'connected' || !cfg;

  const set = useCallback(async (key: string, value: unknown) => {
    try {
      await gateway.setConfig(key, value);
    } catch (err) {
      console.error(`failed to set ${key}:`, err);
    }
  }, [gateway.setConfig]);

  const approvalMode = cfg?.security?.approvalMode || 'approve-sensitive';
  const browserEnabled = cfg?.browser?.enabled ?? false;
  const browserHeadless = cfg?.browser?.headless ?? false;

  // sandbox
  const sandboxMode = cfg?.sandbox?.mode || 'off';
  const sandboxScope = cfg?.sandbox?.scope || 'session';
  const sandboxWorkspaceAccess = cfg?.sandbox?.workspaceAccess || 'rw';
  const sandboxNetworkEnabled = cfg?.sandbox?.network?.enabled ?? true;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0">
        {([
          { id: 'config' as const, label: 'Configuration', icon: Settings2 },
          { id: 'tools' as const, label: 'Tools', icon: Wrench },
          { id: 'status' as const, label: 'Status', icon: Activity },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setSettingsTab(tab.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors ${
              settingsTab === tab.id
                ? 'bg-secondary text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
        {disabled && <Badge variant="destructive" className="text-[9px] h-4 ml-auto">disconnected</Badge>}
      </div>

      {settingsTab === 'config' && <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4 max-w-2xl">

          {/* appearance */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Sun className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Appearance</span>
              </div>

              {/* color grid */}
              <div className="grid grid-cols-3 gap-2 mb-4" role="radiogroup" aria-label="Color palette">
                {PALETTES.map(p => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={palette === p.id}
                    aria-label={p.label}
                    onClick={() => setPalette(p.id)}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                      palette === p.id
                        ? 'border-primary ring-1 ring-primary/30 scale-[1.02]'
                        : 'border-transparent hover:border-border'
                    }`}
                  >
                    {/* swatch preview */}
                    <div className="h-12 flex flex-col" style={{ background: p.preview.bg }}>
                      <div className="flex-1 flex items-center px-2 gap-1">
                        <div className="w-6 h-1 rounded-full" style={{ background: p.preview.fg, opacity: 0.6 }} />
                        <div className="w-4 h-1 rounded-full" style={{ background: p.preview.fg, opacity: 0.3 }} />
                      </div>
                      <div className="h-1.5 flex">
                        <div className="flex-1" style={{ background: p.preview.accent }} />
                        <div className="flex-1" style={{ background: p.preview.accent2 }} />
                      </div>
                    </div>
                    <div className="px-2 py-1.5" style={{ background: p.preview.bg }}>
                      <span className="text-[9px] font-medium" style={{ color: p.preview.fg }}>
                        {p.label}
                      </span>
                    </div>
                    {palette === p.id && (
                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

            </CardContent>
          </Card>

          {/* anthropic provider */}
          <AnthropicCard gateway={gateway} disabled={disabled} />

          {/* openai provider */}
          <OpenAICard gateway={gateway} disabled={disabled} />

          {/* gateway approval — shared across providers */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Gateway Approval</span>
              </div>
              <SettingRow label="approval mode" description="gateway-level tool classification (all providers)">
                <Select value={approvalMode} onValueChange={v => set('security.approvalMode', v)} disabled={disabled}>
                  <SelectTrigger className="h-7 w-40 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approve-sensitive" className="text-[11px]">approve sensitive</SelectItem>
                    <SelectItem value="autonomous" className="text-[11px]">autonomous</SelectItem>
                    <SelectItem value="lockdown" className="text-[11px]">lockdown</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
            </CardContent>
          </Card>

          {/* sandbox */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Box className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Sandbox</span>
              </div>

              <div className="space-y-4">
                <SettingRow label="mode" description="which sessions run in sandbox">
                  <Select value={sandboxMode} onValueChange={v => set('sandbox.mode', v)} disabled={disabled}>
                    <SelectTrigger className="h-7 w-40 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off" className="text-[11px]">off</SelectItem>
                      <SelectItem value="non-main" className="text-[11px]">non-main only</SelectItem>
                      <SelectItem value="all" className="text-[11px]">all sessions</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>

                {sandboxMode !== 'off' && (
                  <>
                    <SettingRow label="scope" description="sandbox lifecycle">
                      <Select value={sandboxScope} onValueChange={v => set('sandbox.scope', v)} disabled={disabled}>
                        <SelectTrigger className="h-7 w-40 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="session" className="text-[11px]">per session</SelectItem>
                          <SelectItem value="agent" className="text-[11px]">per agent</SelectItem>
                          <SelectItem value="shared" className="text-[11px]">shared</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>

                    <SettingRow label="workspace access" description="how much the sandbox sees">
                      <Select value={sandboxWorkspaceAccess} onValueChange={v => set('sandbox.workspaceAccess', v)} disabled={disabled}>
                        <SelectTrigger className="h-7 w-40 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" className="text-[11px]">none (isolated)</SelectItem>
                          <SelectItem value="ro" className="text-[11px]">read-only</SelectItem>
                          <SelectItem value="rw" className="text-[11px]">read-write</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>

                    <SettingRow label="network" description="allow network access from sandbox">
                      <Switch
                        size="sm"
                        checked={sandboxNetworkEnabled}
                        onCheckedChange={v => set('sandbox.network.enabled', v)}
                        disabled={disabled}
                      />
                    </SettingRow>
                  </>
                )}

                {sandboxMode === 'non-main' && (
                  <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                    desktop runs unsandboxed, messaging channels (whatsapp/telegram) run in sandbox
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* tool policies */}
          <ToolPoliciesCard gateway={gateway} disabled={disabled} />

          {/* filesystem access */}
          <PathPoliciesCard gateway={gateway} disabled={disabled} />

          {/* agent */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Brain className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Agent</span>
              </div>

              <div className="space-y-4">
                {/* Autonomy */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Autonomy</div>
                    <div className="text-[10px] text-muted-foreground">Supervised requires approval for sensitive actions</div>
                  </div>
                  <Select
                    value={cfg?.autonomy || 'supervised'}
                    onValueChange={v => set('autonomy', v)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supervised">Supervised</SelectItem>
                      <SelectItem value="autonomous">Autonomous</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Reasoning Effort */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Reasoning Effort</div>
                    <div className="text-[10px] text-muted-foreground">How much the model thinks before responding</div>
                  </div>
                  <Select
                    value={cfg?.reasoningEffort || 'medium'}
                    onValueChange={v => set('reasoningEffort', v === 'medium' ? null : v)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minimal">Minimal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium (default)</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="max">Max</SelectItem>
                      <SelectItem value="xhigh">xhigh</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Max Budget */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Max Budget (USD)</div>
                    <div className="text-[10px] text-muted-foreground">Spending limit per session</div>
                  </div>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="unlimited"
                    className="w-[140px] h-7 text-xs"
                    value={cfg?.maxBudgetUsd ?? ''}
                    onChange={e => {
                      const v = e.target.value ? parseFloat(e.target.value) : null;
                      set('maxBudgetUsd', v);
                    }}
                    disabled={disabled}
                  />
                </div>

                {/* Extended Context (1M) */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Extended Context (1M)</div>
                    <div className="text-[10px] text-muted-foreground">Enable 1M token context window (Opus 4.7, Opus/Sonnet 4.6)</div>
                  </div>
                  <Switch
                    checked={cfg?.betas?.includes('context-1m-2025-08-07') ?? false}
                    onCheckedChange={(checked: boolean) => {
                      const current = cfg?.betas || [];
                      const next = checked
                        ? [...current.filter((b: string) => b !== 'context-1m-2025-08-07'), 'context-1m-2025-08-07']
                        : current.filter((b: string) => b !== 'context-1m-2025-08-07');
                      set('betas', next.length > 0 ? next : null);
                    }}
                    disabled={disabled}
                  />
                </div>

                {/* Progress Summaries */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Subagent Summaries</div>
                    <div className="text-[10px] text-muted-foreground">AI-generated progress updates for subagent tasks</div>
                  </div>
                  <Switch
                    checked={cfg?.agentProgressSummaries ?? true}
                    onCheckedChange={(checked: boolean) => set('agentProgressSummaries', checked)}
                    disabled={disabled}
                  />
                </div>

                {/* Settings Sources */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Load Project Instructions</div>
                    <div className="text-[10px] text-muted-foreground">Load CLAUDE.md and project settings into sessions</div>
                  </div>
                  <Switch
                    checked={cfg?.settingSources?.includes('project') ?? false}
                    onCheckedChange={(checked: boolean) => {
                      const current = cfg?.settingSources || [];
                      const next = checked
                        ? [...current.filter((s: string) => s !== 'project'), 'project']
                        : current.filter((s: string) => s !== 'project');
                      set('settingSources', next.length > 0 ? next : null);
                    }}
                    disabled={disabled}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* editor */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <FileCode className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Editor</span>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">Font Size</div>
                  <Select value={String(editorPrefs.fontSize)} onValueChange={v => updateEditorPrefs({ fontSize: Number(v) })}>
                    <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[11, 12, 13, 14, 15, 16, 18, 20].map(s => (
                        <SelectItem key={s} value={String(s)}>{s}px</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">Tab Size</div>
                  <Select value={String(editorPrefs.tabSize)} onValueChange={v => updateEditorPrefs({ tabSize: Number(v) })}>
                    <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[2, 4, 8].map(s => (
                        <SelectItem key={s} value={String(s)}>{s} spaces</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">Word Wrap</div>
                  <Switch checked={editorPrefs.wordWrap === 'on'} onCheckedChange={v => updateEditorPrefs({ wordWrap: v ? 'on' : 'off' })} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">Minimap</div>
                  <Switch checked={editorPrefs.minimap} onCheckedChange={v => updateEditorPrefs({ minimap: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">Line Numbers</div>
                  <Switch checked={editorPrefs.lineNumbers === 'on'} onCheckedChange={v => updateEditorPrefs({ lineNumbers: v ? 'on' : 'off' })} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* browser */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Globe className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Browser</span>
              </div>

              <div className="space-y-4">
                <SettingRow label="enabled" description="allow agent to control browser">
                  <Switch
                    size="sm"
                    checked={browserEnabled}
                    onCheckedChange={v => set('browser.enabled', v)}
                    disabled={disabled}
                  />
                </SettingRow>

                <SettingRow label="headless" description="run browser without visible window">
                  <Switch
                    size="sm"
                    checked={browserHeadless}
                    onCheckedChange={v => set('browser.headless', v)}
                    disabled={disabled}
                  />
                </SettingRow>
              </div>
            </CardContent>
          </Card>

          <div className="text-[10px] text-muted-foreground px-1">
            changes are saved to config and take effect on next agent run
          </div>
        </div>
      </ScrollArea>}

      {settingsTab === 'tools' && (
        <div className="flex-1 min-h-0">
          <ToolsView gateway={gateway} />
        </div>
      )}

      {settingsTab === 'status' && (
        <div className="flex-1 min-h-0">
          <StatusView gateway={gateway} />
        </div>
      )}
    </div>
  );
}

type ProviderAuthView = {
  authenticated: boolean;
  method?: string;
  identity?: string;
  error?: string;
  storageBackend?: 'keychain' | 'file';
  tokenHealth?: 'valid' | 'expiring' | 'expired';
  nextRefreshAt?: number;
  reconnectRequired?: boolean;
};

function fmtNextRefresh(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function AnthropicCard({ gateway, disabled }: { gateway: ReturnType<typeof useGateway>; disabled: boolean }) {
  const [showAuth, setShowAuth] = useState(false);
  const [authStatus, setAuthStatus] = useState<ProviderAuthView | null>(null);
  const cfg = gateway.configData as Record<string, any> | null;
  const currentModel = gateway.model || cfg?.model || DEFAULT_CLAUDE_MODEL;
  const permissionMode = cfg?.permissionMode || 'default';

  // Query auth independently
  useEffect(() => {
    gateway.getProviderAuth('claude').then(setAuthStatus).catch(() => {});
  }, [gateway.getProviderAuth]);

  // Sync from providerInfo when active
  const providerInfo = gateway.providerInfo;
  const providerName = cfg?.provider?.name || 'claude';
  useEffect(() => {
    if (providerName === 'claude' && providerInfo?.auth) setAuthStatus(providerInfo.auth);
  }, [providerName, providerInfo]);

  const authenticated = authStatus?.authenticated ?? false;
  const authMethod = authStatus?.method;
  const authIdentity = authStatus?.identity;
  const storageBackend = authStatus?.storageBackend || 'file';
  const tokenHealth = authStatus?.tokenHealth || (authenticated ? 'valid' : 'expired');

  const handleAuthSuccess = useCallback(() => {
    setShowAuth(false);
    gateway.getProviderAuth('claude').then(setAuthStatus).catch(() => {});
    if (providerName === 'claude') gateway.getProviderStatus();
  }, [gateway.getProviderAuth, gateway.getProviderStatus, providerName]);

  const set = useCallback(async (key: string, value: unknown) => {
    try { await gateway.setConfig(key, value); } catch (err) { console.error(`failed to set ${key}:`, err); }
  }, [gateway.setConfig]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <img src="./claude-icon.svg" alt="Anthropic" className="w-4 h-4" />
          <span className="text-xs font-semibold">Anthropic</span>
        </div>

        <div className="space-y-4">
          {/* auth status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                  authentication
                  {authenticated ? (
                    <Check className="w-3 h-3 text-success" />
                  ) : null}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {authenticated
                    ? `connected via ${authIdentity || (authMethod === 'oauth' ? 'Claude subscription' : 'API key')}`
                    : 'not authenticated'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  storage: {storageBackend} · token: {tokenHealth}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  next refresh: {fmtNextRefresh(authStatus?.nextRefreshAt)}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setShowAuth(!showAuth)}
              >
                {showAuth ? 'cancel' : authStatus?.reconnectRequired ? 'reconnect' : authenticated ? 'change' : 'set up'}
              </Button>
            </div>

            {showAuth && (
              <div className="border border-border rounded-lg p-3 bg-secondary/30">
                <ProviderSetup
                  provider="claude"
                  gateway={gateway}
                  onSuccess={handleAuthSuccess}
                  compact
                />
              </div>
            )}
          </div>

          {/* model selector */}
          <SettingRow label="model" description="default model for new chats">
            <Select value={currentModel} onValueChange={gateway.changeModel} disabled={disabled}>
              <SelectTrigger className="h-7 w-48 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLAUDE_MODELS.map(m => (
                  <SelectItem key={m.value} value={m.value} className="text-[11px]">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          {/* permission mode */}
          <SettingRow label="permission mode" description="how Claude Code SDK handles tool permissions">
            <Select value={permissionMode} onValueChange={v => set('permissionMode', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default" className="text-[11px]">default</SelectItem>
                <SelectItem value="acceptEdits" className="text-[11px]">accept edits</SelectItem>
                <SelectItem value="bypassPermissions" className="text-[11px]">bypass all</SelectItem>
                <SelectItem value="plan" className="text-[11px]">plan only</SelectItem>
                <SelectItem value="dontAsk" className="text-[11px]">don't ask</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          {permissionMode === 'bypassPermissions' && (
            <div className="text-[10px] text-warning bg-warning/10 rounded px-2 py-1.5">
              Claude Code auto-approves all tools
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OpenAICard({ gateway, disabled }: { gateway: ReturnType<typeof useGateway>; disabled: boolean }) {
  const [showAuth, setShowAuth] = useState(false);
  const [authStatus, setAuthStatus] = useState<ProviderAuthView | null>(null);
  const cfg = gateway.configData as Record<string, any> | null;
  const codexModel = cfg?.provider?.codex?.model || DEFAULT_CODEX_MODEL;
  const reasoningEffort = cfg?.reasoningEffort as string | null;
  const sandboxMode = cfg?.provider?.codex?.sandboxMode || 'danger-full-access';
  const approvalPolicy = cfg?.provider?.codex?.approvalPolicy || 'never';
  const webSearch = cfg?.provider?.codex?.webSearch || 'disabled';
  const mcpOauthCredentialsStore = cfg?.provider?.codex?.mcpOauthCredentialsStore || 'file';

  // Query auth independently
  useEffect(() => {
    gateway.getProviderAuth('codex').then(setAuthStatus).catch(() => {});
  }, [gateway.getProviderAuth]);

  // Sync from providerInfo when active
  const providerInfo = gateway.providerInfo;
  const providerName = cfg?.provider?.name || 'claude';
  useEffect(() => {
    if (providerName === 'codex' && providerInfo?.auth) setAuthStatus(providerInfo.auth);
  }, [providerName, providerInfo]);

  const authenticated = authStatus?.authenticated ?? false;
  const authMethod = authStatus?.method;
  const storageBackend = authStatus?.storageBackend || 'file';
  const tokenHealth = authStatus?.tokenHealth || (authenticated ? 'valid' : 'expired');
  const codexOptions = codexModelsForAuth(authMethod, codexModel);

  const handleAuthSuccess = useCallback(() => {
    setShowAuth(false);
    gateway.getProviderAuth('codex').then(setAuthStatus).catch(() => {});
    if (providerName === 'codex') gateway.getProviderStatus();
  }, [gateway.getProviderAuth, gateway.getProviderStatus, providerName]);

  const set = useCallback(async (key: string, value: unknown) => {
    try { await gateway.setConfig(key, value); } catch (err) { console.error(`failed to set ${key}:`, err); }
  }, [gateway.setConfig]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <img src="./openai-icon.svg" alt="OpenAI" className="w-4 h-4" />
          <span className="text-xs font-semibold">OpenAI</span>
        </div>

        <div className="space-y-4">
          {/* auth status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                  authentication
                  {authenticated ? (
                    <Check className="w-3 h-3 text-success" />
                  ) : null}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {authenticated
                    ? `connected via ${authMethod === 'oauth' ? 'ChatGPT subscription' : 'API key'}`
                    : 'not authenticated'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  storage: {storageBackend} · token: {tokenHealth}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  next refresh: {fmtNextRefresh(authStatus?.nextRefreshAt)}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setShowAuth(!showAuth)}
              >
                {showAuth ? 'cancel' : authStatus?.reconnectRequired ? 'reconnect' : authenticated ? 'change' : 'set up'}
              </Button>
            </div>

            {showAuth && (
              <div className="border border-border rounded-lg p-3 bg-secondary/30">
                <ProviderSetup
                  provider="codex"
                  gateway={gateway}
                  onSuccess={handleAuthSuccess}
                  compact
                />
              </div>
            )}
          </div>

          {/* model selector */}
          <SettingRow label="model" description="codex model for agent runs">
            <Select value={codexModel} onValueChange={v => set('provider.codex.model', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-52 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {codexOptions.map(m => (
                  <SelectItem key={m.value} value={m.value} className="text-[11px]">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          {/* reasoning effort */}
          <SettingRow label="reasoning effort" description="how much the model reasons before responding">
            <Select
              value={reasoningEffort || 'off'}
              onValueChange={v => set('reasoningEffort', v === 'off' ? null : v)}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off" className="text-[11px]">auto (default)</SelectItem>
                <SelectItem value="minimal" className="text-[11px]">minimal</SelectItem>
                <SelectItem value="low" className="text-[11px]">low</SelectItem>
                <SelectItem value="medium" className="text-[11px]">medium</SelectItem>
                <SelectItem value="high" className="text-[11px]">high</SelectItem>
                <SelectItem value="max" className="text-[11px]">max</SelectItem>
                <SelectItem value="xhigh" className="text-[11px]">xhigh</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          {/* sandbox */}
          <SettingRow label="sandbox" description="execution isolation for Codex agent">
            <Select value={sandboxMode} onValueChange={v => set('provider.codex.sandboxMode', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read-only" className="text-[11px]">read-only</SelectItem>
                <SelectItem value="workspace-write" className="text-[11px]">workspace write</SelectItem>
                <SelectItem value="danger-full-access" className="text-[11px]">full access</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          {/* approval */}
          <SettingRow label="approval" description="when Codex asks before acting">
            <Select value={approvalPolicy} onValueChange={v => set('provider.codex.approvalPolicy', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never" className="text-[11px]">never (auto)</SelectItem>
                <SelectItem value="on-request" className="text-[11px]">on request</SelectItem>
                <SelectItem value="on-failure" className="text-[11px]">on failure</SelectItem>
                <SelectItem value="untrusted" className="text-[11px]">untrusted</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          {/* web search */}
          <SettingRow label="web search" description="allow Codex to search the web">
            <Select value={webSearch} onValueChange={v => set('provider.codex.webSearch', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled" className="text-[11px]">disabled</SelectItem>
                <SelectItem value="cached" className="text-[11px]">cached</SelectItem>
                <SelectItem value="live" className="text-[11px]">live</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          {/* MCP OAuth credential storage */}
          <SettingRow label="MCP OAuth storage" description="where Codex stores MCP OAuth credentials">
            <Select value={mcpOauthCredentialsStore} onValueChange={v => set('provider.codex.mcpOauthCredentialsStore', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="file" className="text-[11px]">file (recommended)</SelectItem>
                <SelectItem value="auto" className="text-[11px]">auto</SelectItem>
                <SelectItem value="keyring" className="text-[11px]">keyring</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          {sandboxMode === 'danger-full-access' && approvalPolicy === 'never' && (
            <div className="text-[10px] text-warning bg-warning/10 rounded px-2 py-1.5">
              Codex has full system access with no approval — use caution
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex-1 min-w-[120px]">
        <div className="text-[11px] font-medium text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// available tools the agent can use
const TOOL_NAMES = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
  'WebFetch', 'WebSearch', 'Agent', 'AskUserQuestion', 'TodoWrite',
  'message', 'browser', 'screenshot',
  'schedule_reminder', 'schedule_recurring', 'schedule_cron',
  'list_reminders', 'cancel_reminder',
];

function ToolPoliciesCard({ gateway, disabled }: { gateway: ReturnType<typeof useGateway>; disabled: boolean }) {
  const [policies, setPolicies] = useState<{
    global: { allow?: string[]; deny?: string[] };
    whatsapp: { allow?: string[]; deny?: string[] };
    telegram: { allow?: string[]; deny?: string[] };
  } | null>(null);
  const [newDeny, setNewDeny] = useState('');

  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    gateway.getToolPolicies().then(setPolicies).catch(() => {});
  }, [gateway.connectionState]);

  const addDeny = async (target: 'global' | 'whatsapp' | 'telegram', tool: string) => {
    if (!policies || !tool.trim()) return;
    const current = policies[target]?.deny || [];
    if (current.includes(tool)) return;
    const newDenyList = [...current, tool.trim()];
    await gateway.setToolPolicy(target, policies[target]?.allow, newDenyList);
    setPolicies(prev => prev ? { ...prev, [target]: { ...prev[target], deny: newDenyList } } : prev);
  };

  const removeDeny = async (target: 'global' | 'whatsapp' | 'telegram', tool: string) => {
    if (!policies) return;
    const newDenyList = (policies[target]?.deny || []).filter(t => t !== tool);
    await gateway.setToolPolicy(target, policies[target]?.allow, newDenyList);
    setPolicies(prev => prev ? { ...prev, [target]: { ...prev[target], deny: newDenyList } } : prev);
  };

  const globalDeny = policies?.global?.deny || [];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold">Tool Policies</span>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-[11px] text-muted-foreground">globally denied tools</span>
            {globalDeny.length === 0 && (
              <div className="text-[10px] text-muted-foreground mt-1">no tools denied — all tools available</div>
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              {globalDeny.map(tool => (
                <Badge key={tool} variant="destructive" className="text-[10px] h-5 gap-1 cursor-pointer" onClick={() => removeDeny('global', tool)}>
                  {tool}
                  <X className="w-2.5 h-2.5" />
                </Badge>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              <Select value="" onValueChange={v => { addDeny('global', v); }} disabled={disabled}>
                <SelectTrigger className="h-7 text-[11px] flex-1">
                  <SelectValue placeholder="add tool to deny..." />
                </SelectTrigger>
                <SelectContent>
                  {TOOL_NAMES.filter(t => !globalDeny.includes(t)).map(t => (
                    <SelectItem key={t} value={t} className="text-[11px]">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
            per-channel tool restrictions are in each channel's security settings
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PathPoliciesCard({ gateway, disabled }: { gateway: ReturnType<typeof useGateway>; disabled: boolean }) {
  const [paths, setPaths] = useState<{
    global: { allowed: string[]; denied: string[]; alwaysDenied: string[] };
  } | null>(null);
  const [newAllowed, setNewAllowed] = useState('');
  const [newDenied, setNewDenied] = useState('');

  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    gateway.getPathPolicies().then(p => setPaths({ global: p.global })).catch(() => {});
  }, [gateway.connectionState]);

  const addAllowed = async () => {
    if (!paths || !newAllowed.trim()) return;
    const updated = [...paths.global.allowed, newAllowed.trim()];
    await gateway.setPathPolicy('global', updated, undefined);
    setPaths(prev => prev ? { global: { ...prev.global, allowed: updated } } : prev);
    setNewAllowed('');
  };

  const removeAllowed = async (p: string) => {
    if (!paths) return;
    const updated = paths.global.allowed.filter(x => x !== p);
    await gateway.setPathPolicy('global', updated, undefined);
    setPaths(prev => prev ? { global: { ...prev.global, allowed: updated } } : prev);
  };

  const addDenied = async () => {
    if (!paths || !newDenied.trim()) return;
    const updated = [...paths.global.denied, newDenied.trim()];
    await gateway.setPathPolicy('global', undefined, updated);
    setPaths(prev => prev ? { global: { ...prev.global, denied: updated } } : prev);
    setNewDenied('');
  };

  const removeDenied = async (p: string) => {
    if (!paths) return;
    const updated = paths.global.denied.filter(x => x !== p);
    await gateway.setPathPolicy('global', undefined, updated);
    setPaths(prev => prev ? { global: { ...prev.global, denied: updated } } : prev);
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <FolderLock className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold">Filesystem Access</span>
        </div>

        <div className="space-y-3">
          {/* allowed paths */}
          <div>
            <span className="text-[11px] text-muted-foreground">allowed paths</span>
            <div className="space-y-1 mt-1">
              {(paths?.global.allowed || []).map(p => (
                <div key={p} className="flex items-center gap-2 text-[11px] bg-secondary rounded px-2 py-1">
                  <code className="flex-1 text-foreground">{p}</code>
                  <button className="text-muted-foreground hover:text-destructive transition-colors" onClick={() => removeAllowed(p)}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              <Input
                placeholder="/path/to/allow"
                value={newAllowed}
                onChange={e => setNewAllowed(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addAllowed()}
                className="flex-1 h-7 text-[11px]"
                disabled={disabled}
              />
              <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={addAllowed} disabled={disabled || !newAllowed.trim()}>
                <Plus className="w-3 h-3 mr-1" />add
              </Button>
            </div>
          </div>

          {/* denied paths */}
          <div>
            <span className="text-[11px] text-muted-foreground">denied paths</span>
            <div className="space-y-1 mt-1">
              {(paths?.global.alwaysDenied || []).map(p => (
                <div key={p} className="flex items-center gap-2 text-[11px] bg-destructive/10 rounded px-2 py-1">
                  <code className="flex-1 text-muted-foreground">{p}</code>
                  <span className="text-[9px] text-muted-foreground">built-in</span>
                </div>
              ))}
              {(paths?.global.denied || []).map(p => (
                <div key={p} className="flex items-center gap-2 text-[11px] bg-secondary rounded px-2 py-1">
                  <code className="flex-1 text-foreground">{p}</code>
                  <button className="text-muted-foreground hover:text-destructive transition-colors" onClick={() => removeDenied(p)}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              <Input
                placeholder="/path/to/deny"
                value={newDenied}
                onChange={e => setNewDenied(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addDenied()}
                className="flex-1 h-7 text-[11px]"
                disabled={disabled}
              />
              <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={addDenied} disabled={disabled || !newDenied.trim()}>
                <Plus className="w-3 h-3 mr-1" />add
              </Button>
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
            per-channel path restrictions are in each channel's security settings
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
