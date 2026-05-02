import { useState, useEffect, useCallback, useMemo } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Pencil, Sparkles, Save, ArrowLeft,
  Search, Terminal, KeyRound, CheckCircle2, XCircle,
  Package, User, Slash, Eye, Download, Star,
  FolderTree, ChevronRight, ExternalLink,
  Loader2, Globe, Compass, FolderOpen, File
} from 'lucide-react';

// ── types ──────────────────────────────────────────────────────────

type SkillFile = {
  relativePath: string;
  size: number;
};

type SkillInfo = {
  name: string;
  description: string;
  path: string;
  dir: string;
  userInvocable: boolean;
  metadata: { requires?: { bins?: string[]; env?: string[] } };
  eligibility: { eligible: boolean; reasons: string[] };
  builtIn: boolean;
  source: 'dorabot' | 'bundled' | 'claude' | 'project' | 'other';
  enabled: boolean;
  marketplaceSource: RegistrySource | null;
  files: SkillFile[];
};

type RegistrySource = 'community' | 'official';

type RegistrySkill = {
  name: string;
  description: string;
  repo: string;
  skillPath: string;
  source: RegistrySource;
  htmlUrl: string;
  installed: boolean;
  metadata?: { requires?: { bins?: string[]; env?: string[] } };
  stars?: number;
  installs?: number;
  category?: string;
  avatar?: string;
};

type SkillEnvStatus = {
  name: string;
  env: string[];
  values: Record<string, boolean>;
  storageBackend: 'keychain' | 'file';
};

type SkillForm = {
  name: string;
  description: string;
  userInvocable: boolean;
  bins: string;
  env: string;
  content: string;
};

const emptyForm: SkillForm = {
  name: '',
  description: '',
  userInvocable: true,
  bins: '',
  env: '',
  content: '',
};

const REGISTRY_URL = 'https://raw.githubusercontent.com/suitedaces/dorabot/main/skills-registry.json';

type Filter = 'all' | 'built-in' | 'custom';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

// ── main view ──────────────────────────────────────────────────────

export function SkillsView({ gateway }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [registry, setRegistry] = useState<RegistrySkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'detail' | 'registry-detail'>('list');
  const [form, setForm] = useState<SkillForm>(emptyForm);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [selectedRegistrySkill, setSelectedRegistrySkill] = useState<RegistrySkill | null>(null);
  const [detailContent, setDetailContent] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'installed' | 'discover'>('installed');
  const [installing, setInstalling] = useState<string | null>(null);
  const [discoverSearch, setDiscoverSearch] = useState('');
  const [discoverSource, setDiscoverSource] = useState<'all' | RegistrySource>('all');
  const [discoverCategory, setDiscoverCategory] = useState<string>('all');
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSkillName, setSetupSkillName] = useState('');
  const [setupEnvNames, setSetupEnvNames] = useState<string[]>([]);
  const [setupEnvValues, setSetupEnvValues] = useState<Record<string, string>>({});
  const [setupConfigured, setSetupConfigured] = useState<Record<string, boolean>>({});
  const [setupStorageBackend, setSetupStorageBackend] = useState<'keychain' | 'file'>('file');

  const loadSkills = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('skills.list');
      if (Array.isArray(result)) setSkills(result);
      setLoading(false);
    } catch (err) {
      console.error('failed to load skills:', err);
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  const loadRegistry = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const [communityResult, officialResult] = await Promise.allSettled([
        fetch(REGISTRY_URL),
        gateway.rpc('skills.marketplace.list'),
      ]);

      const nextRegistry: RegistrySkill[] = [];

      if (communityResult.status === 'fulfilled' && communityResult.value.ok) {
        const data = await communityResult.value.json();
        if (Array.isArray(data)) {
          nextRegistry.push(...data.map((item) => ({
            ...item,
            source: 'community' as const,
            htmlUrl: `https://github.com/${item.repo}`,
            installed: false,
          } satisfies RegistrySkill)));
        }
      }

      if (officialResult.status === 'fulfilled' && Array.isArray(officialResult.value)) {
        nextRegistry.push(...officialResult.value as RegistrySkill[]);
      }

      nextRegistry.sort((a, b) => {
        if (a.source !== b.source) return a.source === 'community' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setRegistry(nextRegistry);
    } catch (err) {
      console.error('failed to load registry:', err);
    } finally {
      setRegistryLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  useEffect(() => { loadSkills(); }, [loadSkills]);
  useEffect(() => { loadRegistry(); }, [loadRegistry]);

  const installedNames = useMemo(() => new Set(skills.map(s => s.name)), [skills]);

  const filtered = useMemo(() => {
    let list = skills;
    if (filter === 'built-in') list = list.filter(s => s.builtIn);
    if (filter === 'custom') list = list.filter(s => !s.builtIn);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [skills, filter, search]);

  const counts = useMemo(() => ({
    all: skills.length,
    'built-in': skills.filter(s => s.builtIn).length,
    custom: skills.filter(s => !s.builtIn).length,
  }), [skills]);

  const discoverCounts = useMemo(() => ({
    all: registry.length,
    community: registry.filter(skill => skill.source === 'community').length,
    official: registry.filter(skill => skill.source === 'official').length,
  }), [registry]);

  const categories = useMemo(() => {
    const cats = new Set(
      registry
        .filter(skill => skill.source === 'community' && skill.category)
        .map(skill => skill.category as string),
    );
    return ['all', ...Array.from(cats).sort()];
  }, [registry]);

  const filteredRegistry = useMemo(() => {
    let list = registry;
    if (discoverSource !== 'all') list = list.filter(skill => skill.source === discoverSource);
    if (discoverSource !== 'official' && discoverCategory !== 'all') {
      list = list.filter(skill => skill.source !== 'community' || skill.category === discoverCategory);
    }
    if (discoverSearch) {
      const q = discoverSearch.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [discoverCategory, discoverSearch, discoverSource, registry]);

  const communityRegistry = useMemo(
    () => filteredRegistry.filter(skill => skill.source === 'community'),
    [filteredRegistry],
  );

  const officialRegistry = useMemo(
    () => filteredRegistry.filter(skill => skill.source === 'official'),
    [filteredRegistry],
  );

  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    setSetupLoading(false);
    setSetupSaving(false);
    setSetupError(null);
    setSetupSkillName('');
    setSetupEnvNames([]);
    setSetupEnvValues({});
    setSetupConfigured({});
    setSetupStorageBackend('file');
  }, []);

  const openSkillSetup = useCallback(async (skillName: string) => {
    setSetupSkillName(skillName);
    setSetupOpen(true);
    setSetupLoading(true);
    setSetupError(null);
    try {
      const result = await gateway.rpc('skills.env.status', { name: skillName }) as SkillEnvStatus;
      if (!result.env.length) {
        closeSetup();
        return;
      }
      setSetupEnvNames(result.env);
      setSetupConfigured(result.values || {});
      setSetupEnvValues(Object.fromEntries(result.env.map(name => [name, ''])));
      setSetupStorageBackend(result.storageBackend || 'file');
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'failed to load skill requirements');
    } finally {
      setSetupLoading(false);
    }
  }, [closeSetup, gateway.rpc]);

  const saveSkillSetup = useCallback(async () => {
    if (!setupSkillName) return;
    const missing = setupEnvNames.filter(name => !setupConfigured[name] && !setupEnvValues[name]?.trim());
    if (missing.length) return;

    const values = Object.fromEntries(
      Object.entries(setupEnvValues)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => [key, value.trim()]),
    );

    if (!Object.keys(values).length) {
      closeSetup();
      return;
    }

    setSetupSaving(true);
    setSetupError(null);
    try {
      const result = await gateway.rpc('skills.env.set', {
        name: setupSkillName,
        values,
      }) as SkillEnvStatus;
      setSetupConfigured(result.values || {});
      setSetupStorageBackend(result.storageBackend || 'file');
      await loadSkills();
      closeSetup();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'failed to save skill requirements');
    } finally {
      setSetupSaving(false);
    }
  }, [closeSetup, gateway.rpc, loadSkills, setupConfigured, setupEnvNames, setupEnvValues, setupSkillName]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingName(null);
    setMode('create');
  };

  const openDetail = async (skill: SkillInfo) => {
    setSelectedSkill(skill);
    try {
      const result = await gateway.rpc('skills.read', { name: skill.name }) as { raw: string };
      const raw = result.raw;
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      setDetailContent(fmMatch ? fmMatch[2].trim() : raw);
    } catch {
      setDetailContent('');
    }
    setMode('detail');
  };

  const openRegistryDetail = (skill: RegistrySkill) => {
    setSelectedRegistrySkill(skill);
    setMode('registry-detail');
  };

  const openEdit = (skill: SkillInfo) => {
    setForm({
      name: skill.name,
      description: skill.description,
      userInvocable: skill.userInvocable,
      bins: skill.metadata.requires?.bins?.join(', ') || '',
      env: skill.metadata.requires?.env?.join(', ') || '',
      content: detailContent,
    });
    setEditingName(skill.name);
    setMode('edit');
  };

  const openEditFromList = async (skill: SkillInfo) => {
    try {
      const result = await gateway.rpc('skills.read', { name: skill.name }) as { raw: string };
      const raw = result.raw;
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const body = fmMatch ? fmMatch[2].trim() : raw;
      setForm({
        name: skill.name,
        description: skill.description,
        userInvocable: skill.userInvocable,
        bins: skill.metadata.requires?.bins?.join(', ') || '',
        env: skill.metadata.requires?.env?.join(', ') || '',
        content: body,
      });
      setEditingName(skill.name);
      setSelectedSkill(skill);
      setMode('edit');
    } catch (err) {
      console.error('failed to read skill:', err);
    }
  };

  const saveSkill = async () => {
    setSaving(true);
    const bins = form.bins.split(',').map(s => s.trim()).filter(Boolean);
    const env = form.env.split(',').map(s => s.trim()).filter(Boolean);
    const metadata: Record<string, unknown> = {};
    if (bins.length || env.length) {
      metadata.requires = {} as Record<string, string[]>;
      if (bins.length) (metadata.requires as any).bins = bins;
      if (env.length) (metadata.requires as any).env = env;
    }

    try {
      await gateway.rpc('skills.create', {
        name: form.name,
        description: form.description,
        userInvocable: form.userInvocable,
        metadata: Object.keys(metadata).length ? metadata : undefined,
        content: form.content,
      });
      setMode('list');
      setForm(emptyForm);
      setEditingName(null);
      setSelectedSkill(null);
      await loadSkills();
    } catch (err) {
      console.error('failed to save skill:', err);
    } finally {
      setSaving(false);
    }
  };

  const deleteSkill = async (name: string) => {
    try {
      await gateway.rpc('skills.delete', { name });
      if (selectedSkill?.name === name) {
        setSelectedSkill(null);
        setMode('list');
      }
      await loadSkills();
    } catch (err) {
      console.error('failed to delete skill:', err);
    }
  };

  const setSkillEnabled = useCallback(async (name: string, enabled: boolean) => {
    try {
      await gateway.rpc('skills.setEnabled', { name, enabled });
      await loadSkills();
    } catch (err) {
      console.error('failed to update skill state:', err);
    }
  }, [gateway.rpc, loadSkills]);

  const installSkill = useCallback(async (regSkill: RegistrySkill) => {
    setInstalling(regSkill.name);
    try {
      const result = await gateway.rpc('skills.install', {
        repo: regSkill.repo,
        skillPath: regSkill.skillPath,
        name: regSkill.name,
        source: regSkill.source,
      }) as { name: string; skill?: { metadata?: { requires?: { env?: string[] } } } };
      await loadSkills();
      if (result.skill?.metadata?.requires?.env?.length) {
        await openSkillSetup(result.name);
      }
    } catch (err) {
      console.error('failed to install skill:', err);
    } finally {
      setInstalling(null);
    }
  }, [gateway.rpc, loadSkills, openSkillSetup]);

  const canSave = form.name && form.description && form.content;

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Sparkles className="w-6 h-6 opacity-40" />
        <span className="text-sm">connecting...</span>
      </div>
    );
  }

  // ── detail view (installed skill) ──────────────────────────────

  if (mode === 'detail' && selectedSkill) {
    return (
      <>
        <InstalledDetailView
          skill={selectedSkill}
          detailContent={detailContent}
          gateway={gateway}
          onBack={() => { setMode('list'); setSelectedSkill(null); }}
          onEdit={() => openEdit(selectedSkill)}
          onDelete={deleteSkill}
          onSetup={() => openSkillSetup(selectedSkill.name)}
          onToggleEnabled={enabled => setSkillEnabled(selectedSkill.name, enabled)}
        />
        <SkillSetupSheet
          open={setupOpen}
          loading={setupLoading}
          saving={setupSaving}
          error={setupError}
          skillName={setupSkillName}
          envNames={setupEnvNames}
          values={setupEnvValues}
          configured={setupConfigured}
          storageBackend={setupStorageBackend}
          onOpenChange={open => { if (!open) closeSetup(); }}
          onChangeValue={(name, value) => setSetupEnvValues(prev => ({ ...prev, [name]: value }))}
          onSave={saveSkillSetup}
        />
      </>
    );
  }

  // ── detail view (registry skill) ──────────────────────────────

  if (mode === 'registry-detail' && selectedRegistrySkill) {
    const isInstalled = installedNames.has(selectedRegistrySkill.name);
    return (
      <>
        <RegistryDetailView
          skill={selectedRegistrySkill}
          installed={isInstalled}
          installing={installing === selectedRegistrySkill.name}
          onBack={() => { setMode('list'); setSelectedRegistrySkill(null); }}
          onInstall={() => installSkill(selectedRegistrySkill)}
        />
        <SkillSetupSheet
          open={setupOpen}
          loading={setupLoading}
          saving={setupSaving}
          error={setupError}
          skillName={setupSkillName}
          envNames={setupEnvNames}
          values={setupEnvValues}
          configured={setupConfigured}
          storageBackend={setupStorageBackend}
          onOpenChange={open => { if (!open) closeSetup(); }}
          onChangeValue={(name, value) => setSetupEnvValues(prev => ({ ...prev, [name]: value }))}
          onSave={saveSkillSetup}
        />
      </>
    );
  }

  // ── create / edit form ─────────────────────────────────────────

  if (mode === 'create' || mode === 'edit') {
    const isBuiltIn = mode === 'edit' && selectedSkill?.builtIn;

    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => {
            setMode(selectedSkill ? 'detail' : 'list');
            setForm(emptyForm);
          }}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />back
          </Button>
          <span className="font-semibold text-sm">{mode === 'create' ? 'new skill' : isBuiltIn ? `viewing: ${editingName}` : `editing: ${editingName}`}</span>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5 max-w-2xl">
            <div className="space-y-3">
              <SectionHeader>identity</SectionHeader>
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">name</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-') })}
                    placeholder="my-skill"
                    className="h-8 text-xs font-mono"
                    disabled={mode === 'edit'}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">description</Label>
                  <Input
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="what this skill teaches the agent to do"
                    className="h-8 text-xs"
                    disabled={isBuiltIn}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <SectionHeader>settings</SectionHeader>
              <div className="flex items-center justify-between bg-secondary/30 rounded-lg px-3 py-2.5 border border-border">
                <div>
                  <div className="text-xs font-medium">user-invocable</div>
                  <div className="text-[10px] text-muted-foreground">users can trigger with /{form.name || 'name'}</div>
                </div>
                <Switch
                  checked={form.userInvocable}
                  onCheckedChange={v => setForm({ ...form, userInvocable: v })}
                  size="sm"
                  disabled={isBuiltIn}
                />
              </div>
            </div>

            <div className="space-y-3">
              <SectionHeader>requirements</SectionHeader>
              <div className="grid grid-cols-1 @sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Terminal className="w-3 h-3" />binaries
                  </Label>
                  <Input
                    value={form.bins}
                    onChange={e => setForm({ ...form, bins: e.target.value })}
                    placeholder="gh, curl, ffmpeg"
                    className="h-8 text-xs font-mono"
                    disabled={isBuiltIn}
                  />
                  <span className="text-[10px] text-muted-foreground">comma-separated, checked via `which`</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <KeyRound className="w-3 h-3" />env vars
                  </Label>
                  <Input
                    value={form.env}
                    onChange={e => setForm({ ...form, env: e.target.value })}
                    placeholder="GITHUB_TOKEN, API_KEY"
                    className="h-8 text-xs font-mono"
                    disabled={isBuiltIn}
                  />
                  <span className="text-[10px] text-muted-foreground">comma-separated</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <SectionHeader>content</SectionHeader>
              <Textarea
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                placeholder={"# My Skill\n\nInstructions for the agent when this skill is matched...\n\n## Examples\n\n- do this\n- then that"}
                rows={24}
                className="text-xs font-mono leading-relaxed resize-none"
                disabled={isBuiltIn}
              />
            </div>

            {!isBuiltIn && (
              <Button
                size="sm"
                className="w-full h-8 text-xs"
                onClick={saveSkill}
                disabled={!canSave || saving}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saving ? 'saving...' : mode === 'create' ? 'create skill' : 'save changes'}
              </Button>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── main tabbed view ───────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full min-h-0">
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'installed' | 'discover')} className="flex flex-col h-full min-h-0">
        <div className="px-4 pt-3 pb-0 shrink-0">
          <TabsList className="w-full h-9">
            <TabsTrigger value="installed" className="gap-1.5 text-xs">
              <Package className="w-3.5 h-3.5" />
              Installed
              <Badge variant="secondary" className="text-[9px] h-4 px-1.5 ml-0.5">{skills.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="discover" className="gap-1.5 text-xs">
              <Compass className="w-3.5 h-3.5" />
              Discover
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── installed tab ──────────────────────────────────────── */}
        <TabsContent value="installed" className="flex-1 min-h-0 flex flex-col m-0">
          <div className="px-4 py-2.5 shrink-0 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="search installed skills..."
                  className="h-7 text-xs pl-7 pr-2"
                />
              </div>
              <Button variant="default" size="sm" className="h-7 text-xs px-3 shrink-0" onClick={openCreate}>
                <Plus className="w-3.5 h-3.5 mr-1" />new
              </Button>
            </div>
            <div className="flex items-center bg-secondary/50 rounded-md p-0.5 w-fit">
              {(['all', 'built-in', 'custom'] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-2 py-1 rounded text-[11px] transition-colors',
                    filter === f
                      ? 'bg-background text-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {f} <span className="text-[10px] opacity-60">{counts[f]}</span>
                </button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            {loading ? (
              <div className="p-4 grid grid-cols-1 @md:grid-cols-2 gap-2">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                  <Sparkles className="w-5 h-5 opacity-50" />
                </div>
                {search ? (
                  <>
                    <span className="text-sm">no skills match "{search}"</span>
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSearch('')}>clear search</Button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium">no skills yet</span>
                    <span className="text-xs text-center max-w-xs">skills teach your agent new capabilities. create one or browse the discover tab.</span>
                    <div className="flex gap-2 mt-1">
                      <Button variant="outline" size="sm" className="text-xs" onClick={openCreate}>
                        <Plus className="w-3 h-3 mr-1" />create
                      </Button>
                      <Button variant="default" size="sm" className="text-xs" onClick={() => setActiveTab('discover')}>
                        <Compass className="w-3 h-3 mr-1" />discover
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {filter !== 'built-in' && filtered.filter(s => !s.builtIn).length > 0 && (
                  <InstalledSection
                    label="custom"
                    count={filtered.filter(s => !s.builtIn).length}
                    skills={filtered.filter(s => !s.builtIn)}
                    onClickSkill={openDetail}
                    onEditSkill={openEditFromList}
                    onDeleteSkill={deleteSkill}
                    onToggleEnabled={setSkillEnabled}
                  />
                )}
                {filter !== 'custom' && filtered.filter(s => s.builtIn).length > 0 && (
                  <InstalledSection
                    label="built-in"
                    count={filtered.filter(s => s.builtIn).length}
                    skills={filtered.filter(s => s.builtIn)}
                    onClickSkill={openDetail}
                    onEditSkill={openEditFromList}
                    onDeleteSkill={deleteSkill}
                    onToggleEnabled={setSkillEnabled}
                  />
                )}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* ── discover tab ───────────────────────────────────────── */}
        <TabsContent value="discover" className="flex-1 min-h-0 flex flex-col m-0">
          <div className="px-4 py-2.5 shrink-0 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={discoverSearch}
                onChange={e => setDiscoverSearch(e.target.value)}
                placeholder="search dorabot and official skills..."
                className="h-8 text-xs pl-8 pr-2"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/30 p-1 w-fit">
              {([
                ['all', discoverCounts.all],
                ['community', discoverCounts.community],
                ['official', discoverCounts.official],
              ] as const).map(([source, count]) => (
                <button
                  key={source}
                  onClick={() => {
                    setDiscoverSource(source);
                    if (source === 'official') setDiscoverCategory('all');
                  }}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] transition-colors',
                    discoverSource === source
                      ? 'bg-background text-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {source} <span className="text-[10px] opacity-60">{count}</span>
                </button>
              ))}
            </div>
            {discoverSource !== 'official' && categories.length > 1 && (
              <div className="flex items-center gap-1 flex-wrap">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setDiscoverCategory(cat)}
                    className={cn(
                      'px-2 py-1 rounded-md text-[11px] transition-colors border',
                      discoverCategory === cat
                        ? 'bg-primary text-primary-foreground border-primary font-medium'
                        : 'bg-secondary/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-secondary'
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
              dorabot owns install state, enable/disable, and secrets. community registry stays here; official curated skills from <span className="font-mono text-foreground">openai/skills</span> are an extra catalog and still install into <span className="font-mono text-foreground">~/.dorabot/skills</span>.
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            {registryLoading ? (
              <div className="p-4 grid grid-cols-1 @md:grid-cols-2 gap-3">
                {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}
              </div>
            ) : filteredRegistry.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Globe className="w-8 h-8 opacity-40" />
                <span className="text-sm">no skills found</span>
                {discoverSearch && (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setDiscoverSearch('')}>clear search</Button>
                )}
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {(discoverSource === 'all' ? [
                  { key: 'community', label: 'community', skills: communityRegistry },
                  { key: 'official', label: 'official curated', skills: officialRegistry },
                ] : [
                  { key: discoverSource, label: discoverSource === 'official' ? 'official curated' : 'community', skills: filteredRegistry },
                ]).map(section => section.skills.length > 0 && (
                  <div key={section.key} className="space-y-2">
                    {discoverSource === 'all' && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{section.label}</span>
                        <span className="text-[10px] text-muted-foreground">{section.skills.length}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 @md:grid-cols-2 gap-3">
                      {section.skills.map(skill => (
                        <RegistryCard
                          key={`${skill.source}:${skill.name}`}
                          skill={skill}
                          installed={installedNames.has(skill.name)}
                          installing={installing === skill.name}
                          onClick={() => openRegistryDetail(skill)}
                          onInstall={() => installSkill(skill)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
        </Tabs>
      </div>
      <SkillSetupSheet
        open={setupOpen}
        loading={setupLoading}
        saving={setupSaving}
        error={setupError}
        skillName={setupSkillName}
        envNames={setupEnvNames}
        values={setupEnvValues}
        configured={setupConfigured}
        storageBackend={setupStorageBackend}
        onOpenChange={open => { if (!open) closeSetup(); }}
        onChangeValue={(name, value) => setSetupEnvValues(prev => ({ ...prev, [name]: value }))}
        onSave={saveSkillSetup}
      />
    </>
  );
}

// ── installed skill card ─────────────────────────────────────────

function InstalledSection({ label, count, skills, onClickSkill, onEditSkill, onDeleteSkill, onToggleEnabled }: {
  label: string;
  count: number;
  skills: SkillInfo[];
  onClickSkill: (s: SkillInfo) => void;
  onEditSkill: (s: SkillInfo) => void;
  onDeleteSkill: (name: string) => void;
  onToggleEnabled: (name: string, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
      </div>
      <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
        {skills.map(skill => (
          <InstalledCard
            key={skill.name}
            skill={skill}
            onClick={() => onClickSkill(skill)}
            onEdit={() => onEditSkill(skill)}
            onDelete={() => onDeleteSkill(skill.name)}
            onToggleEnabled={enabled => onToggleEnabled(skill.name, enabled)}
          />
        ))}
      </div>
    </div>
  );
}

function InstalledCard({ skill, onClick, onEdit, onDelete, onToggleEnabled }: {
  skill: SkillInfo;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const fileCount = skill.files?.length || 0;

  return (
    <Card
      className="group cursor-pointer transition-all hover:border-primary/30 hover:shadow-sm py-3"
      onClick={onClick}
    >
      <CardContent className="space-y-2">
        <div className="flex items-start gap-2">
          <div className={cn(
            'w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors',
            skill.eligibility.eligible
              ? 'bg-primary/10 text-primary group-hover:bg-primary/15'
              : 'bg-muted text-muted-foreground'
          )}>
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold truncate">{skill.name}</span>
              {skill.marketplaceSource && (
                <Badge variant="outline" className="text-[8px] h-3.5 px-1.5">
                  {skill.marketplaceSource}
                </Badge>
              )}
              {!skill.enabled && (
                <Badge variant="secondary" className="text-[8px] h-3.5 px-1.5">
                  disabled
                </Badge>
              )}
              <div className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                skill.eligibility.eligible ? 'bg-success' : 'bg-destructive/60'
              )} />
            </div>
            {skill.userInvocable && (
              <span className="text-[10px] text-muted-foreground font-mono">/{skill.name}</span>
            )}
            {!skill.userInvocable && (
              <span className="text-[10px] text-muted-foreground">{formatInstalledSource(skill)}</span>
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{skill.description}</p>

        <div className="flex items-center gap-1 flex-wrap">
          {fileCount > 0 && (
            <span className="text-[9px] font-mono bg-secondary rounded px-1.5 py-0.5 text-muted-foreground flex items-center gap-0.5">
              <FolderTree className="w-2.5 h-2.5" />{fileCount} files
            </span>
          )}
          {skill.metadata.requires?.bins?.map(b => (
            <span key={b} className="text-[9px] font-mono bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">{b}</span>
          ))}
          {skill.metadata.requires?.env?.map(e => (
            <span key={e} className="text-[9px] font-mono bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">{e}</span>
          ))}
          <span className="flex-1" />
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-1.5 py-1">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {skill.enabled ? 'on' : 'off'}
              </span>
              <Switch
                checked={skill.enabled}
                onCheckedChange={onToggleEnabled}
                size="sm"
                aria-label={`toggle ${skill.name}`}
              />
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
              <button
                onClick={onEdit}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title={skill.builtIn ? 'view' : 'edit'}
              >
                <Pencil className="w-3 h-3" />
              </button>
              {!skill.builtIn && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-sm">delete "{skill.name}"?</AlertDialogTitle>
                      <AlertDialogDescription className="text-xs">removes from ~/.dorabot/skills/. cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="h-7 text-xs">cancel</AlertDialogCancel>
                      <AlertDialogAction className="h-7 text-xs" onClick={onDelete}>delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── registry (discover) card ─────────────────────────────────────

function RegistryCard({ skill, installed, installing, onClick, onInstall }: {
  skill: RegistrySkill;
  installed: boolean;
  installing: boolean;
  onClick: () => void;
  onInstall: () => void;
}) {
  const isOfficial = skill.source === 'official';

  return (
    <Card
      className="group cursor-pointer transition-all hover:border-primary/30 hover:shadow-sm py-3"
      onClick={onClick}
    >
      <CardContent className="space-y-2.5">
        <div className="flex items-start gap-2.5">
          {isOfficial ? (
            <div className="w-8 h-8 rounded-md shrink-0 bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
          ) : (
            <img
              src={skill.avatar?.startsWith('https://') ? skill.avatar : ''}
              alt=""
              className="w-8 h-8 rounded-md shrink-0 bg-muted"
              loading="lazy"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold truncate">{skill.name}</span>
              <Badge variant="outline" className="text-[8px] h-3.5 px-1.5">
                {isOfficial ? 'official' : 'community'}
              </Badge>
              {installed && (
                <Badge variant="secondary" className="text-[8px] h-3.5 px-1">installed</Badge>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              {isOfficial ? skill.skillPath : skill.repo}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{skill.description}</p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 flex-wrap">
            {isOfficial ? (
              <>
                {skill.metadata?.requires?.bins?.map(bin => (
                  <Badge key={bin} variant="outline" className="text-[8px] h-3.5 px-1.5 font-normal">{bin}</Badge>
                ))}
                {skill.metadata?.requires?.env?.map(env => (
                  <Badge key={env} variant="outline" className="text-[8px] h-3.5 px-1.5 font-normal">{env}</Badge>
                ))}
              </>
            ) : (
              <>
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Star className="w-3 h-3" />{formatCount(skill.stars || 0)}
                </span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Download className="w-3 h-3" />{formatCount(skill.installs || 0)}
                </span>
                {skill.category && (
                  <Badge variant="outline" className="text-[8px] h-3.5 px-1.5 font-normal">{skill.category}</Badge>
                )}
              </>
            )}
          </div>
          <div onClick={e => e.stopPropagation()}>
            {installed ? (
              <Badge variant="secondary" className="text-[10px] h-5 px-2">
                <CheckCircle2 className="w-3 h-3 mr-0.5" />installed
              </Badge>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="h-6 text-[10px] px-2.5"
                onClick={onInstall}
                disabled={installing}
              >
                {installing ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" />installing...</>
                ) : (
                  <><Download className="w-3 h-3 mr-1" />install</>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── installed detail view ────────────────────────────────────────

function InstalledDetailView({ skill, detailContent, gateway, onBack, onEdit, onDelete, onSetup, onToggleEnabled }: {
  skill: SkillInfo;
  detailContent: string;
  gateway: ReturnType<typeof useGateway>;
  onBack: () => void;
  onEdit: () => void;
  onDelete: (name: string) => void;
  onSetup: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const hasReqs = skill.metadata.requires?.bins?.length || skill.metadata.requires?.env?.length;
  const hasFiles = skill.files && skill.files.length > 0;
  const hasEnvReqs = Boolean(skill.metadata.requires?.env?.length);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />skills
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2 py-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {skill.enabled ? 'enabled' : 'disabled'}
            </span>
            <Switch
              checked={skill.enabled}
              onCheckedChange={onToggleEnabled}
              size="sm"
              aria-label={`toggle ${skill.name}`}
            />
          </div>
          {hasEnvReqs && (
            <Button variant="outline" size="sm" className="h-7 text-xs px-3" onClick={onSetup}>
              <KeyRound className="w-3 h-3 mr-1.5" />set up
            </Button>
          )}
          {!skill.builtIn && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs px-3" onClick={onEdit}>
                <Pencil className="w-3 h-3 mr-1.5" />edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-sm">delete "{skill.name}"?</AlertDialogTitle>
                    <AlertDialogDescription className="text-xs">removes from ~/.dorabot/skills/. cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="h-7 text-xs">cancel</AlertDialogCancel>
                    <AlertDialogAction className="h-7 text-xs" onClick={() => onDelete(skill.name)}>delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {skill.builtIn && (
            <Button variant="outline" size="sm" className="h-7 text-xs px-3" onClick={onEdit}>
              <Eye className="w-3 h-3 mr-1.5" />view source
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 max-w-2xl space-y-5">
          {/* header */}
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                skill.eligibility.eligible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              )}>
                <Sparkles className="w-4.5 h-4.5" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight">{skill.name}</h2>
                {skill.userInvocable && (
                  <span className="text-[11px] text-muted-foreground font-mono">/{skill.name}</span>
                )}
                {!skill.userInvocable && (
                  <span className="text-[11px] text-muted-foreground">{formatInstalledSource(skill)}</span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mt-2">{skill.description}</p>
          </div>

          {/* meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <MetaItem
              icon={skill.eligibility.eligible ? CheckCircle2 : XCircle}
              label="status"
              value={skill.eligibility.eligible ? 'ready' : 'unavailable'}
              className={skill.eligibility.eligible ? 'text-success' : 'text-destructive'}
            />
            <MetaItem
              icon={skill.builtIn ? Package : User}
              label="source"
              value={formatInstalledSource(skill)}
            />
            <MetaItem
              icon={Slash}
              label="invocable"
              value={skill.userInvocable ? 'yes' : 'no'}
            />
            <MetaItem
              icon={FolderTree}
              label="files"
              value={`${(skill.files?.length || 0) + 1}`}
              mono
            />
            <MetaItem
              icon={Package}
              label="state"
              value={skill.enabled ? 'enabled' : 'disabled'}
            />
          </div>

          {/* eligibility issues */}
          {!skill.eligibility.eligible && skill.eligibility.reasons.length > 0 && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-1">
              <span className="text-[11px] font-medium text-destructive">missing requirements</span>
              {skill.eligibility.reasons.map((r, i) => (
                <div key={i} className="text-[11px] text-destructive/80">{r}</div>
              ))}
            </div>
          )}

          {/* requirements */}
          {hasReqs && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">requirements</span>
                {hasEnvReqs && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onSetup}>
                    manage keys
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {skill.metadata.requires?.bins?.map(b => (
                  <span key={b} className="inline-flex items-center gap-1 text-[11px] font-mono bg-secondary rounded-md px-2 py-1 border border-border">
                    <Terminal className="w-3 h-3 text-muted-foreground" />{b}
                  </span>
                ))}
                {skill.metadata.requires?.env?.map(e => (
                  <span key={e} className="inline-flex items-center gap-1 text-[11px] font-mono bg-secondary rounded-md px-2 py-1 border border-border">
                    <KeyRound className="w-3 h-3 text-muted-foreground" />{e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* file tree */}
          {hasFiles && (
            <FileTreeView skill={skill} gateway={gateway} />
          )}

          {/* content preview */}
          {detailContent && (
            <div className="space-y-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">SKILL.md</span>
              <pre className="text-[11px] font-mono leading-relaxed bg-secondary/50 rounded-lg p-3 border border-border overflow-x-auto whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">
                {detailContent}
              </pre>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── registry detail view ─────────────────────────────────────────

function RegistryDetailView({ skill, installed, installing, onBack, onInstall }: {
  skill: RegistrySkill;
  installed: boolean;
  installing: boolean;
  onBack: () => void;
  onInstall: () => void;
}) {
  const isOfficial = skill.source === 'official';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />discover
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 max-w-2xl space-y-5">
          {/* header */}
          <div className="flex items-start gap-3">
            {isOfficial ? (
              <div className="w-12 h-12 rounded-lg shrink-0 bg-primary/10 text-primary flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
            ) : (
              <img
                src={skill.avatar?.startsWith('https://') ? skill.avatar : ''}
                alt=""
                className="w-12 h-12 rounded-lg shrink-0 bg-muted"
                loading="lazy"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold leading-tight">{skill.name}</h2>
                <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                  {isOfficial ? 'official curated' : 'community'}
                </Badge>
              </div>
              <a
                href={skill.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground font-mono hover:text-foreground inline-flex items-center gap-0.5 mt-0.5"
                onClick={e => e.stopPropagation()}
              >
                {isOfficial ? skill.skillPath : skill.repo}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
              <p className="text-xs text-muted-foreground leading-relaxed mt-2">{skill.description}</p>
            </div>
          </div>

          {!isOfficial && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-secondary/30 rounded-lg px-3 py-2 border border-border text-center">
                <div className="text-[10px] text-muted-foreground">stars</div>
                <div className="text-sm font-semibold flex items-center justify-center gap-1">
                  <Star className="w-3.5 h-3.5 text-yellow-500" />{formatCount(skill.stars || 0)}
                </div>
              </div>
              <div className="bg-secondary/30 rounded-lg px-3 py-2 border border-border text-center">
                <div className="text-[10px] text-muted-foreground">installs</div>
                <div className="text-sm font-semibold flex items-center justify-center gap-1">
                  <Download className="w-3.5 h-3.5 text-primary" />{formatCount(skill.installs || 0)}
                </div>
              </div>
              <div className="bg-secondary/30 rounded-lg px-3 py-2 border border-border text-center">
                <div className="text-[10px] text-muted-foreground">category</div>
                <div className="text-sm font-semibold">{skill.category || 'general'}</div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-secondary/30 px-3 py-3 space-y-1.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">source</div>
            <div className="text-[11px] font-mono">{skill.repo}</div>
            <div className="text-[11px] font-mono text-muted-foreground">{skill.skillPath}</div>
          </div>

          {!!(skill.metadata?.requires?.bins?.length || skill.metadata?.requires?.env?.length) && (
            <div className="space-y-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">requirements</span>
              <div className="flex flex-wrap gap-1.5">
                {skill.metadata?.requires?.bins?.map(bin => (
                  <span key={bin} className="inline-flex items-center gap-1 text-[11px] font-mono bg-secondary rounded-md px-2 py-1 border border-border">
                    <Terminal className="w-3 h-3 text-muted-foreground" />{bin}
                  </span>
                ))}
                {skill.metadata?.requires?.env?.map(env => (
                  <span key={env} className="inline-flex items-center gap-1 text-[11px] font-mono bg-secondary rounded-md px-2 py-1 border border-border">
                    <KeyRound className="w-3 h-3 text-muted-foreground" />{env}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* install action */}
          <div className="flex gap-2">
            {installed ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 text-success" />
                already installed
              </div>
            ) : (
              <Button className="h-9 text-xs px-4" onClick={onInstall} disabled={installing}>
                {installing ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />installing skill...</>
                ) : (
                  <><Download className="w-3.5 h-3.5 mr-1.5" />install to ~/.dorabot/skills/</>
                )}
              </Button>
            )}
          </div>

          <Separator />

          <div className="rounded-lg border border-border bg-secondary/20 px-3 py-3 text-[11px] text-muted-foreground">
            {isOfficial
              ? <>official curated skills use the Codex marketplace helper flow, but dorabot still installs and manages them in <span className="font-mono text-foreground">~/.dorabot/skills</span>.</>
              : <>community skills install directly into <span className="font-mono text-foreground">~/.dorabot/skills</span> and stay fully managed by dorabot.</>}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function SkillSetupSheet({
  open,
  loading,
  saving,
  error,
  skillName,
  envNames,
  values,
  configured,
  storageBackend,
  onOpenChange,
  onChangeValue,
  onSave,
}: {
  open: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  skillName: string;
  envNames: string[];
  values: Record<string, string>;
  configured: Record<string, boolean>;
  storageBackend: 'keychain' | 'file';
  onOpenChange: (open: boolean) => void;
  onChangeValue: (name: string, value: string) => void;
  onSave: () => void;
}) {
  const missing = envNames.filter(name => !configured[name]);
  const canSave = missing.every(name => values[name]?.trim());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader className="space-y-2">
          <SheetTitle className="text-sm">skill setup</SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            {skillName
              ? `${skillName} needs these env vars before dorabot can use it.`
              : 'configure required env vars for this skill.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              loading requirements...
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-secondary/30 px-3 py-3 text-[11px] text-muted-foreground">
                stored in {storageBackend === 'keychain' ? 'your system keychain' : '~/.dorabot/.skill-env.json'}
              </div>

              {envNames.map(name => {
                const ready = configured[name];
                return (
                  <div key={name} className="rounded-xl border border-border bg-secondary/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold font-mono">{name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {ready ? 'already configured. leave blank to keep it.' : 'required to unlock this skill.'}
                        </div>
                      </div>
                      <Badge variant={ready ? 'secondary' : 'outline'} className="h-5 text-[9px] px-2">
                        {ready ? 'saved' : 'missing'}
                      </Badge>
                    </div>
                    <Input
                      type="password"
                      value={values[name] || ''}
                      onChange={e => onChangeValue(name, e.target.value)}
                      placeholder={ready ? 'replace secret' : 'paste secret'}
                      className="h-8 text-[11px] font-mono"
                      disabled={saving}
                    />
                  </div>
                );
              })}

              {error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <SheetFooter className="border-t border-border">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={saving}>
            close
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={onSave} disabled={loading || saving || !canSave}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 mr-1.5" />}
            {saving ? 'saving...' : 'save keys'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── file tree component ──────────────────────────────────────────

function FileTreeView({ skill, gateway }: {
  skill: SkillInfo;
  gateway: ReturnType<typeof useGateway>;
}) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileCache, setFileCache] = useState<Record<string, { content: string; loading: boolean }>>({});

  const tree = useMemo(() => buildTree(skill.files || []), [skill.files]);

  const loadFile = async (filePath: string) => {
    if (expandedFile === filePath) {
      setExpandedFile(null);
      return;
    }
    setExpandedFile(filePath);
    // skip fetch if already cached
    if (fileCache[filePath] && !fileCache[filePath].loading) return;
    setFileCache(prev => ({ ...prev, [filePath]: { content: '', loading: true } }));
    try {
      const result = await gateway.rpc('skills.readFile', { name: skill.name, filePath }) as { content: string };
      setFileCache(prev => ({ ...prev, [filePath]: { content: result.content, loading: false } }));
    } catch {
      setFileCache(prev => ({ ...prev, [filePath]: { content: '(failed to load)', loading: false } }));
    }
  };

  const currentFile = expandedFile ? fileCache[expandedFile] : null;

  return (
    <div className="space-y-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">files</span>
      <div className="border border-border rounded-lg overflow-hidden">
        <TreeNode node={tree} depth={0} expandedFile={expandedFile} fileContent={currentFile?.content || ''} loadingFile={currentFile?.loading || false} onClickFile={loadFile} />
      </div>
    </div>
  );
}

type TreeNodeData = {
  name: string;
  isDir: boolean;
  path: string;
  size?: number;
  children: TreeNodeData[];
};

function buildTree(files: SkillFile[]): TreeNodeData {
  const root: TreeNodeData = { name: '', isDir: true, path: '', children: [] };

  for (const file of files) {
    const parts = file.relativePath.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      if (isLast) {
        current.children.push({ name, isDir: false, path, size: file.size, children: [] });
      } else {
        let dir = current.children.find(c => c.name === name && c.isDir);
        if (!dir) {
          dir = { name, isDir: true, path, children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  // sort: dirs first, then alphabetical
  const sortChildren = (node: TreeNodeData) => {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  };
  sortChildren(root);

  return root;
}

function TreeNode({ node, depth, expandedFile, fileContent, loadingFile, onClickFile }: {
  node: TreeNodeData;
  depth: number;
  expandedFile: string | null;
  fileContent: string;
  loadingFile: boolean;
  onClickFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const children = node.children;

  if (depth === 0) {
    return (
      <div className="divide-y divide-border">
        {children.map(child => (
          <TreeNode key={child.path} node={child} depth={1} expandedFile={expandedFile} fileContent={fileContent} loadingFile={loadingFile} onClickFile={onClickFile} />
        ))}
      </div>
    );
  }

  if (node.isDir) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-secondary/50 transition-colors text-left" style={{ paddingLeft: `${depth * 16 + 12}px` }}>
          <ChevronRight className={cn('w-3 h-3 text-muted-foreground transition-transform shrink-0', open && 'rotate-90')} />
          <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium truncate">{node.name}</span>
          <span className="text-[9px] text-muted-foreground ml-auto">{node.children.length}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {children.map(child => (
            <TreeNode key={child.path} node={child} depth={depth + 1} expandedFile={expandedFile} fileContent={fileContent} loadingFile={loadingFile} onClickFile={onClickFile} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  const isExpanded = expandedFile === node.path;

  return (
    <div>
      <button
        className={cn(
          'flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-secondary/50 transition-colors text-left',
          isExpanded && 'bg-secondary/50'
        )}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => onClickFile(node.path)}
      >
        <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-mono truncate">{node.name}</span>
        {node.size !== undefined && (
          <span className="text-[9px] text-muted-foreground ml-auto shrink-0">{formatBytes(node.size)}</span>
        )}
      </button>
      {isExpanded && (
        <div className="border-t border-border bg-secondary/30">
          {loadingFile ? (
            <div className="p-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />loading...
            </div>
          ) : (
            <pre className="text-[10px] font-mono leading-relaxed p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
              {fileContent}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── shared components ────────────────────────────────────────────

function MetaItem({ icon: Icon, label, value, className, mono }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 bg-secondary/30 rounded-lg px-3 py-2 border border-border">
      <Icon className={cn('w-3.5 h-3.5 shrink-0 text-muted-foreground', className)} />
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className={cn('text-xs truncate', mono && 'font-mono text-[11px]', className)}>{value}</div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ── utils ────────────────────────────────────────────────────────

function formatInstalledSource(skill: SkillInfo): string {
  if (skill.marketplaceSource === 'official') return 'official curated';
  if (skill.marketplaceSource === 'community') return 'community';
  switch (skill.source) {
    case 'dorabot': return 'manual';
    case 'bundled': return 'bundled';
    case 'claude': return 'claude import';
    case 'project': return 'project';
    default: return 'external';
  }
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
