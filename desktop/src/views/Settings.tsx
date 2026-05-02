import { useCallback, useState, useEffect } from 'react';
import type { useGateway, CodexModelCatalog, CodexAppServerSnapshot } from '../hooks/useGateway';
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
import { Textarea } from '@/components/ui/textarea';
import { Shield, Brain, Globe, Settings2, Box, Lock, FolderLock, X, Plus, Wrench, Activity, Sun, Check } from 'lucide-react';
import { PALETTES } from '../lib/palettes';
import type { Palette } from '../lib/palettes';
import {
  CLAUDE_AGENT_SDK_REASONING_EFFORTS,
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_MODEL,
  codexModelsForAuth,
  codexReasoningEffortOptions,
  reasoningEffortIsSupported,
} from '@/lib/modelCatalog';
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
  const providerName = cfg?.provider?.name || 'claude';
  const agentReasoningOptions = providerName === 'codex'
    ? codexReasoningEffortOptions()
    : CLAUDE_AGENT_SDK_REASONING_EFFORTS;
  const agentReasoningEffort = reasoningEffortIsSupported(agentReasoningOptions, cfg?.reasoningEffort)
    ? cfg?.reasoningEffort
    : 'off';

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
                    value={agentReasoningEffort}
                    onValueChange={v => set('reasoningEffort', v === 'off' ? null : v)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">auto (default)</SelectItem>
                      {agentReasoningOptions.map(effort => (
                        <SelectItem key={effort.value} value={effort.value}>
                          {effort.label}{effort.description ? ` (${effort.description})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Thinking Display (Opus 4.7 adaptive thinking) */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">Thinking Display</div>
                    <div className="text-[10px] text-muted-foreground">Show reasoning summaries (Opus 4.7, adaptive thinking only)</div>
                  </div>
                  <Select
                    value={cfg?.thinkingDisplay || 'omitted'}
                    onValueChange={v => set('thinkingDisplay', v === 'omitted' ? null : v)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="omitted">Hidden (default)</SelectItem>
                      <SelectItem value="summarized">Summarized</SelectItem>
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
  accountEmail?: string;
  planType?: string;
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
  const [codexCatalog, setCodexCatalog] = useState<CodexModelCatalog | null>(null);
  const [codexCatalogError, setCodexCatalogError] = useState<string | null>(null);
  const [codexSnapshot, setCodexSnapshot] = useState<CodexAppServerSnapshot | null>(null);
  const [codexSnapshotError, setCodexSnapshotError] = useState<string | null>(null);
  const [codexSnapshotLoading, setCodexSnapshotLoading] = useState(false);
  const cfg = gateway.configData as Record<string, any> | null;
  const codexModel = cfg?.provider?.codex?.model || DEFAULT_CODEX_MODEL;
  const reasoningEffort = cfg?.reasoningEffort as string | null;
  const sandboxMode = cfg?.provider?.codex?.sandboxMode || 'danger-full-access';
  const approvalPolicy = cfg?.provider?.codex?.approvalPolicy || 'never';
  const networkAccess = cfg?.provider?.codex?.networkAccess ?? true;
  const webSearch = cfg?.provider?.codex?.webSearch || 'disabled';
  const mcpOauthCredentialsStore = cfg?.provider?.codex?.mcpOauthCredentialsStore || 'file';
  const codexCliConfig = cfg?.provider?.codex?.config && typeof cfg.provider.codex.config === 'object'
    ? cfg.provider.codex.config as Record<string, any>
    : {};
  const serviceTier = typeof codexCliConfig.service_tier === 'string' ? codexCliConfig.service_tier : 'auto';
  const reasoningSummary = typeof codexCliConfig.model_reasoning_summary === 'string' ? codexCliConfig.model_reasoning_summary : 'auto';
  const modelVerbosity = typeof codexCliConfig.model_verbosity === 'string' ? codexCliConfig.model_verbosity : 'auto';
  const memoriesEnabled = Boolean(codexCliConfig.features && typeof codexCliConfig.features === 'object' && codexCliConfig.features.memories === true);
  const rawReasoningEnabled = codexCliConfig.show_raw_agent_reasoning === true;
  const skipGitRepoCheck = cfg?.provider?.codex?.skipGitRepoCheck ?? true;
  const baseUrl = cfg?.provider?.codex?.baseUrl || '';
  const additionalDirectories = Array.isArray(cfg?.provider?.codex?.additionalDirectories)
    ? cfg.provider.codex.additionalDirectories.join(', ')
    : '';
  const codexConfigKey = JSON.stringify(cfg?.provider?.codex?.config || null);
  const [baseUrlDraft, setBaseUrlDraft] = useState<string>(baseUrl);
  const [additionalDirsDraft, setAdditionalDirsDraft] = useState<string>(additionalDirectories);
  const [codexConfigDraft, setCodexConfigDraft] = useState<string>('');
  const [codexConfigError, setCodexConfigError] = useState<string | null>(null);
  const [codexConfigSyncing, setCodexConfigSyncing] = useState(false);
  const [codexConfigWriteStatus, setCodexConfigWriteStatus] = useState<string | null>(null);

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
  const codexOptions = codexModelsForAuth(authMethod, codexModel, codexCatalog?.models);
  const selectedCodexOption = codexOptions.find(option => option.value === codexModel) || null;
  const codexReasoningOptions = codexReasoningEffortOptions(selectedCodexOption);
  const codexReasoningEffort = reasoningEffortIsSupported(codexReasoningOptions, reasoningEffort)
    ? reasoningEffort
    : 'off';
  const account = codexCatalog?.account;
  const planType = account?.planType || authStatus?.planType;

  const handleAuthSuccess = useCallback(() => {
    setShowAuth(false);
    gateway.getProviderAuth('codex').then(setAuthStatus).catch(() => {});
    gateway.getCodexModels().then((catalog) => {
      setCodexCatalog(catalog);
      setCodexCatalogError(null);
    }).catch((err) => setCodexCatalogError(err instanceof Error ? err.message : String(err)));
    if (providerName === 'codex') gateway.getProviderStatus();
  }, [gateway.getProviderAuth, gateway.getCodexModels, gateway.getProviderStatus, providerName]);

  const set = useCallback(async (key: string, value: unknown) => {
    try { await gateway.setConfig(key, value); } catch (err) { console.error(`failed to set ${key}:`, err); }
  }, [gateway.setConfig]);

  useEffect(() => setBaseUrlDraft(baseUrl), [baseUrl]);
  useEffect(() => setAdditionalDirsDraft(additionalDirectories), [additionalDirectories]);
  useEffect(() => {
    if (!authenticated || gateway.connectionState !== 'connected') return;
    let cancelled = false;
    gateway.getCodexModels()
      .then((catalog) => {
        if (cancelled) return;
        setCodexCatalog(catalog);
        setCodexCatalogError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setCodexCatalogError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [authenticated, gateway.connectionState, gateway.getCodexModels]);
  useEffect(() => {
    const parsed = codexConfigKey ? JSON.parse(codexConfigKey) : null;
    setCodexConfigDraft(parsed ? JSON.stringify(parsed, null, 2) : '');
    setCodexConfigError(null);
  }, [codexConfigKey]);

  const commitBaseUrl = useCallback(() => {
    const value = baseUrlDraft.trim();
    set('provider.codex.baseUrl', value || null);
  }, [baseUrlDraft, set]);

  const commitAdditionalDirectories = useCallback(() => {
    const dirs = additionalDirsDraft
      .split(',')
      .map(dir => dir.trim())
      .filter(Boolean);
    set('provider.codex.additionalDirectories', dirs.length > 0 ? dirs : null);
  }, [additionalDirsDraft, set]);

  const commitCodexConfig = useCallback(() => {
    const raw = codexConfigDraft.trim();
    if (!raw) {
      setCodexConfigError(null);
      set('provider.codex.config', null);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setCodexConfigError('must be a JSON object');
        return;
      }
      setCodexConfigError(null);
      set('provider.codex.config', parsed);
    } catch (err) {
      setCodexConfigError(err instanceof Error ? err.message : 'invalid JSON');
    }
  }, [codexConfigDraft, set]);

  const pullCodexSnapshot = useCallback(async () => {
    setCodexSnapshotLoading(true);
    try {
      const snapshot = await gateway.getCodexAppServerSnapshot();
      setCodexSnapshot(snapshot);
      setCodexSnapshotError(null);
      setCodexCatalog(snapshot);
      setCodexConfigDraft(snapshot.config ? JSON.stringify(snapshot.config, null, 2) : '');
      setCodexConfigError(null);
    } catch (err) {
      setCodexSnapshotError(err instanceof Error ? err.message : String(err));
    } finally {
      setCodexSnapshotLoading(false);
    }
  }, [gateway.getCodexAppServerSnapshot]);

  const writeCodexConfigToHome = useCallback(async () => {
    const raw = codexConfigDraft.trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setCodexConfigError('must be a JSON object');
        return;
      }
      setCodexConfigError(null);
      setCodexConfigWriteStatus(null);
      setCodexConfigSyncing(true);
      const edits = Object.entries(parsed as Record<string, unknown>).map(([keyPath, value]) => ({
        keyPath,
        value,
        mergeStrategy: 'replace',
      }));
      await gateway.codexAppServerRpc('config/batchWrite', { edits });
      setCodexConfigWriteStatus('wrote .codex config');
      await pullCodexSnapshot();
    } catch (err) {
      setCodexConfigError(err instanceof Error ? err.message : 'failed to write .codex config');
    } finally {
      setCodexConfigSyncing(false);
    }
  }, [codexConfigDraft, gateway.codexAppServerRpc, pullCodexSnapshot]);

  const updateCodexCliConfig = useCallback((updater: (draft: Record<string, any>) => void) => {
    const next = JSON.parse(JSON.stringify(codexCliConfig || {})) as Record<string, any>;
    updater(next);
    const compact = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
    set('provider.codex.config', Object.keys(compact).length > 0 ? compact : null);
  }, [codexCliConfig, set]);

  const setCodexCliConfigKey = useCallback((key: string, value: unknown) => {
    updateCodexCliConfig((draft) => {
      if (value === null || value === undefined || value === 'auto') {
        delete draft[key];
      } else {
        draft[key] = value;
      }
    });
  }, [updateCodexCliConfig]);

  const setCodexFeature = useCallback((feature: string, enabled: boolean) => {
    updateCodexCliConfig((draft) => {
      const features = draft.features && typeof draft.features === 'object' && !Array.isArray(draft.features)
        ? { ...draft.features }
        : {};
      if (enabled) {
        features[feature] = true;
      } else {
        delete features[feature];
      }
      if (Object.keys(features).length > 0) {
        draft.features = features;
      } else {
        delete draft.features;
      }
    });
  }, [updateCodexCliConfig]);

  const selectCodexModel = useCallback(async (model: string) => {
    await set('provider.codex.model', model);
    const option = codexOptions.find(candidate => candidate.value === model) || null;
    const efforts = codexReasoningEffortOptions(option);
    if (reasoningEffort && !reasoningEffortIsSupported(efforts, reasoningEffort)) {
      await set('reasoningEffort', null);
    }
  }, [codexOptions, reasoningEffort, set]);

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
                {authenticated && (
                  <div className="text-[10px] text-muted-foreground">
                    {authMethod === 'oauth'
                      ? `tier: ${planType || 'unknown'}${account?.email ? ` · ${account.email}` : ''}`
                      : 'tier: API project limits'}
                  </div>
                )}
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
            <Select value={codexModel} onValueChange={selectCodexModel} disabled={disabled}>
              <SelectTrigger className="h-7 w-52 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="min-w-72">
                {codexOptions.map(m => (
                  <SelectItem key={m.value} value={m.value} className="text-[11px]">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="flex items-center gap-1.5">
                        {m.label}
                        {m.isDefault && <span className="text-[9px] text-primary">default</span>}
                        {m.researchPreview && <span className="text-[9px] text-amber-500">preview</span>}
                        {m.deprecated && <span className="text-[9px] text-muted-foreground">legacy</span>}
                      </span>
                      {m.description && <span className="text-[10px] text-muted-foreground truncate">{m.description}</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <div className="text-[10px] text-muted-foreground -mt-2">
            {codexCatalog
              ? `models from Codex app-server${planType ? ` for ${planType}` : ''}`
              : codexCatalogError
                ? `using fallback model list: ${codexCatalogError}`
                : 'loading Codex model catalog...'}
          </div>

          <div className="flex items-center justify-between gap-3 rounded border border-border bg-secondary/20 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-foreground">Codex app-server</div>
              <div className="text-[10px] text-muted-foreground truncate">
                {codexSnapshot
                  ? `${codexSnapshot.models.length} models · ${codexSnapshot.experimentalFeatures.length} features · ${codexSnapshot.skills.length} skill roots · ${codexSnapshot.apps.length} apps · ${codexSnapshot.mcpServers.length} MCP servers`
                  : codexSnapshotError || 'pull live config, skills, plugins, apps, MCP status, and limits from .codex/'}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 shrink-0"
              onClick={pullCodexSnapshot}
              disabled={disabled || codexSnapshotLoading}
            >
              {codexSnapshotLoading ? 'pulling...' : 'pull from .codex'}
            </Button>
          </div>

          {codexSnapshot && (
            <details className="rounded border border-border bg-card px-3 py-2">
              <summary className="text-[11px] font-medium text-foreground cursor-pointer">
                live config, limits, and admin requirements
              </summary>
              <Textarea
                className="mt-2 min-h-48 text-[11px] font-mono"
                value={JSON.stringify({
                  account: codexSnapshot.account,
                  rateLimits: codexSnapshot.rateLimits,
                  configRequirements: codexSnapshot.configRequirements,
                  configOrigins: codexSnapshot.configOrigins,
                  configLayers: codexSnapshot.configLayers,
                }, null, 2)}
                readOnly
              />
            </details>
          )}

          {/* reasoning effort */}
          <SettingRow label="reasoning effort" description="how much the model reasons before responding">
            <Select
              value={codexReasoningEffort}
              onValueChange={v => set('reasoningEffort', v === 'off' ? null : v)}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off" className="text-[11px]">auto (default)</SelectItem>
                {codexReasoningOptions.map(effort => (
                  <SelectItem key={effort.value} value={effort.value} className="text-[11px]">
                    {effort.label}{effort.description ? ` (${effort.description})` : ''}
                  </SelectItem>
                ))}
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

          <SettingRow label="network" description="allow network access from Codex">
            <Switch
              size="sm"
              checked={networkAccess}
              onCheckedChange={v => set('provider.codex.networkAccess', v)}
              disabled={disabled}
            />
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

          <SettingRow label="service tier" description="Codex service_tier preference">
            <Select value={serviceTier} onValueChange={v => setCodexCliConfigKey('service_tier', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-[11px]">auto</SelectItem>
                <SelectItem value="flex" className="text-[11px]">flex</SelectItem>
                <SelectItem value="fast" className="text-[11px]">fast</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="reasoning summary" description="model_reasoning_summary config">
            <Select value={reasoningSummary} onValueChange={v => setCodexCliConfigKey('model_reasoning_summary', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-[11px]">auto</SelectItem>
                <SelectItem value="none" className="text-[11px]">none</SelectItem>
                <SelectItem value="concise" className="text-[11px]">concise</SelectItem>
                <SelectItem value="detailed" className="text-[11px]">detailed</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="verbosity" description="model_verbosity config">
            <Select value={modelVerbosity} onValueChange={v => setCodexCliConfigKey('model_verbosity', v)} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-[11px]">auto</SelectItem>
                <SelectItem value="low" className="text-[11px]">low</SelectItem>
                <SelectItem value="medium" className="text-[11px]">medium</SelectItem>
                <SelectItem value="high" className="text-[11px]">high</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Codex memories" description="enable Codex native memories feature">
            <Switch
              size="sm"
              checked={memoriesEnabled}
              onCheckedChange={v => setCodexFeature('memories', v)}
              disabled={disabled}
            />
          </SettingRow>

          <SettingRow label="raw reasoning" description="show_raw_agent_reasoning config">
            <Switch
              size="sm"
              checked={rawReasoningEnabled}
              onCheckedChange={v => setCodexCliConfigKey('show_raw_agent_reasoning', v ? true : null)}
              disabled={disabled}
            />
          </SettingRow>

          <SettingRow label="skip git check" description="allow Codex in non-git working directories">
            <Switch
              size="sm"
              checked={skipGitRepoCheck}
              onCheckedChange={v => set('provider.codex.skipGitRepoCheck', v)}
              disabled={disabled}
            />
          </SettingRow>

          <SettingRow label="additional dirs" description="extra readable/writable roots, comma-separated">
            <Input
              className="h-7 w-72 text-[11px]"
              value={additionalDirsDraft}
              onChange={e => setAdditionalDirsDraft(e.target.value)}
              onBlur={commitAdditionalDirectories}
              placeholder="/Users/me/other-project"
              disabled={disabled}
            />
          </SettingRow>

          <SettingRow label="base URL" description="optional OpenAI-compatible API endpoint">
            <Input
              className="h-7 w-72 text-[11px]"
              value={baseUrlDraft}
              onChange={e => setBaseUrlDraft(e.target.value)}
              onBlur={commitBaseUrl}
              placeholder="https://api.openai.com/v1"
              disabled={disabled}
            />
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

          <div className="space-y-1">
            <SettingRow label="CLI config" description="raw Codex --config overrides as JSON">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={commitCodexConfig}
                  disabled={disabled}
                >
                  apply
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={writeCodexConfigToHome}
                  disabled={disabled || codexConfigSyncing}
                >
                  {codexConfigSyncing ? 'writing...' : 'write .codex'}
                </Button>
              </div>
            </SettingRow>
            <Textarea
              className="min-h-24 text-[11px] font-mono"
              value={codexConfigDraft}
              onChange={e => setCodexConfigDraft(e.target.value)}
              onBlur={commitCodexConfig}
              placeholder={'{\n  "show_raw_agent_reasoning": false\n}'}
              disabled={disabled}
            />
            {codexConfigError && (
              <div className="text-[10px] text-destructive">{codexConfigError}</div>
            )}
            {codexConfigWriteStatus && (
              <div className="text-[10px] text-muted-foreground">{codexConfigWriteStatus}</div>
            )}
          </div>

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
  'schedule', 'list_schedule', 'update_schedule', 'cancel_schedule',
  'projects_view', 'projects_add', 'projects_update', 'projects_delete',
  'tasks_view', 'tasks_add', 'tasks_update', 'tasks_done', 'tasks_delete',
  'research_view', 'research_add', 'research_update', 'research_delete',
  'memory_search', 'memory_read',
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
