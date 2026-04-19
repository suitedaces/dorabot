import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { dorabotImg, whatsappImg, telegramImg } from './assets';
import { useGateway, type NotifiableEvent } from './hooks/useGateway';
import { useTabs, isChatTab, isBrowserTab } from './hooks/useTabs';
import type { Tab, TabType } from './hooks/useTabs';
import { useLayout } from './hooks/useLayout';
import { useTheme } from './hooks/useTheme';
import type { GroupId } from './hooks/useLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { EditorGroupPanel } from './components/EditorGroupPanel';
import { TabDragOverlay } from './components/TabBar';
import { FileExplorer } from './components/FileExplorer';
import { OnboardingOverlay } from './components/Onboarding';
import { GlobalSearch } from './components/GlobalSearch';
import { SessionHistory } from './components/SessionHistory';
import { ShortcutHelp } from './components/ShortcutHelp';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Toaster, toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import {
  MessageSquare, Radio, Zap, Brain, Settings2,
  Sparkles, LayoutGrid, Loader2, Star, Bot,
  Clock, FileSearch, Plug, Folder, FolderOpen, X,
  ShieldAlert, CalendarCheck, Target, FlaskConical, KeyRound, GitBranch, Check, Palette, Play
} from 'lucide-react';
import { PALETTES } from './lib/palettes';
import type { Palette as PaletteId } from './lib/palettes';
import { ToastContainer } from './components/ToastContainer';

type SessionFilter = 'all' | 'desktop' | 'telegram' | 'whatsapp';
type UpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
};

const ONBOARDING_COMPLETED_KEY = 'dorabot:onboarding-completed';
const ONBOARDING_UNAUTH_SNOOZE_UNTIL_KEY = 'dorabot:onboarding-unauth-snooze-until';
const ONBOARDING_UNAUTH_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

// soft two-tone chime via web audio api
function playNotifSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(880, now);
    o1.connect(gain);
    o1.start(now);
    o1.stop(now + 0.15);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(1320, now + 0.12);
    o2.connect(gain);
    o2.start(now + 0.12);
    o2.stop(now + 0.5);

    o2.onended = () => ctx.close();
  } catch {}
}

const PRIMARY_NAV_ITEMS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: 'goals', label: 'Projects', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { id: 'research', label: 'Research', icon: <FileSearch className="w-3.5 h-3.5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings2 className="w-3.5 h-3.5" /> },
];

const SECONDARY_NAV_ITEMS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'channels', label: 'Channels', icon: <Radio className="w-3.5 h-3.5" /> },
  { id: 'automation', label: 'Automations', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'extensions', label: 'Extensions', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { id: 'agents', label: 'Agents', icon: <Bot className="w-3.5 h-3.5" /> },
  { id: 'memory', label: 'Memory', icon: <Brain className="w-3.5 h-3.5" /> },
];

const ALL_NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...SECONDARY_NAV_ITEMS];

type FsListEntry = { name: string; type: 'file' | 'directory' };
type QuickOpenFile = {
  path: string;
  rel: string;
  name: string;
  relLower: string;
  nameLower: string;
};

const QUICK_OPEN_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'release',
  '.next',
  '.turbo',
  '.cache',
  '.vite',
]);
const QUICK_OPEN_MAX_FILES = 8000;
const QUICK_OPEN_MAX_RESULTS = 120;
const MARKDOWN_PREVIEW_EVENT = 'dorabot:markdown-preview';

function joinPath(base: string, name: string): string {
  if (!base || base === '.') return `./${name}`;
  if (base.endsWith('/')) return `${base}${name}`;
  return `${base}/${name}`;
}

function toRelativePath(path: string, root: string): string {
  if (root === '.' || !root) return path.replace(/^\.\//, '');
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function scoreQuickOpen(file: QuickOpenFile, queryLower: string): number {
  if (!queryLower) return 0;
  const { relLower, nameLower } = file;
  if (nameLower === queryLower) return 0;
  if (nameLower.startsWith(queryLower)) return 10 + nameLower.length / 1000;

  const slashIndex = relLower.indexOf(`/${queryLower}`);
  if (slashIndex >= 0) return 20 + slashIndex / 1000;

  const containsIndex = relLower.indexOf(queryLower);
  if (containsIndex >= 0) return 30 + containsIndex / 1000;

  // Fuzzy subsequence match
  let cursor = -1;
  let distance = 0;
  for (const ch of queryLower) {
    const idx = relLower.indexOf(ch, cursor + 1);
    if (idx < 0) return Number.POSITIVE_INFINITY;
    distance += idx - cursor;
    cursor = idx;
  }
  return 300 + distance;
}

function PalettePicker({ palette, onPalette }: {
  palette: PaletteId;
  onPalette: (p: PaletteId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <button
        onClick={() => setOpen(v => !v)}
        className="ml-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        title="Color palette"
      >
        <Palette className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-popover p-2 shadow-lg max-h-80 overflow-y-auto">
          <div className="grid grid-cols-4 gap-1.5 mb-2">
            {PALETTES.map(p => (
              <button
                key={p.id}
                onClick={() => { onPalette(p.id); }}
                className={cn(
                  'relative rounded-md overflow-hidden border transition-all',
                  palette === p.id
                    ? 'border-primary ring-1 ring-primary/30'
                    : 'border-transparent hover:border-border',
                )}
              >
                <div className="h-8 flex flex-col" style={{ background: p.preview.bg }}>
                  <div className="flex-1 flex items-center px-1.5 gap-0.5">
                    <div className="w-4 h-0.5 rounded-full" style={{ background: p.preview.fg, opacity: 0.5 }} />
                    <div className="w-3 h-0.5 rounded-full" style={{ background: p.preview.fg, opacity: 0.25 }} />
                  </div>
                  <div className="h-1 flex">
                    <div className="flex-1" style={{ background: p.preview.accent }} />
                    <div className="flex-1" style={{ background: p.preview.accent2 }} />
                  </div>
                </div>
                <div className="px-1.5 py-0.5" style={{ background: p.preview.bg }}>
                  <span className="text-[8px] font-medium leading-none" style={{ color: p.preview.fg }}>{p.label}</span>
                </div>
                {palette === p.id && (
                  <div className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-2 h-2 text-primary-foreground" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [showFiles, setShowFiles] = useState(() => localStorage.getItem('dorabot:showFiles') === 'true');
  const [sidebarView, setSidebarView] = useState<'files' | 'git' | 'history'>(() => (localStorage.getItem('dorabot:sidebarView') as 'files' | 'git' | 'history') || 'files');
  const filesPanelSize = useRef(localStorage.getItem('dorabot:filesPanelSize') || '30%');
  const filesPanelRef = useRef<PanelImperativeHandle | null>(null);
  const fileExplorerStateRef = useRef<{ viewRoot: string; expanded: string[]; selectedPath: string | null }>(
    (() => {
      try {
        const raw = localStorage.getItem('dorabot:explorerState');
        if (raw) return JSON.parse(raw) as { viewRoot: string; expanded: string[]; selectedPath: string | null };
      } catch { /* ignore */ }
      return { viewRoot: '', expanded: [], selectedPath: null };
    })()
  );
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [selectedChannel, setSelectedChannel] = useState<'whatsapp' | 'telegram'>('whatsapp');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingCheckedRef = useRef(false);
  const onboardingCompletedRef = useRef(localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true');
  const focusInputOnGroupSwitch = useRef(false);
  const notifCooldownRef = useRef<Record<string, number>>({});
  const gw = useGateway();
  const layout = useLayout();
  const tabState = useTabs(gw, layout);
  const [starCount, setStarCount] = useState<number | null>(null);
  const [draggingTab, setDraggingTab] = useState<Tab | null>(null);
  const { palette, setPalette } = useTheme();
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [quickOpenRoot, setQuickOpenRoot] = useState('');
  const [quickOpenQuery, setQuickOpenQuery] = useState('');
  const [quickOpenFiles, setQuickOpenFiles] = useState<QuickOpenFile[]>([]);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [quickOpenError, setQuickOpenError] = useState<string | null>(null);
  const [quickOpenSelected, setQuickOpenSelected] = useState(0);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renamingSessionValue, setRenamingSessionValue] = useState('');
  const quickOpenCacheRef = useRef<{ root: string; files: QuickOpenFile[] } | null>(null);
  const quickOpenRequestRef = useRef(0);
  const quickOpenInputRef = useRef<HTMLInputElement>(null);
  const codexReauthTimersRef = useRef<Record<string, { poll: number; timeout: number }>>({});
  const notify = useCallback((body: string) => {
    const api = (window as any).electronAPI;
    if (api?.notify) {
      api.notify('dorabot', body);
      return;
    }
    try {
      const icon = new URL(dorabotImg, window.location.href).toString();
      new Notification('dorabot', { body, icon });
    } catch {}
  }, []);
  const openExternal = useCallback((url: string) => {
    (window as any).electronAPI?.openExternal?.(url) || window.open(url, '_blank');
  }, []);
  const clearCodexReauth = useCallback((loginId: string) => {
    const timers = codexReauthTimersRef.current[loginId];
    if (!timers) return;
    window.clearInterval(timers.poll);
    window.clearTimeout(timers.timeout);
    delete codexReauthTimersRef.current[loginId];
  }, []);
  const startCodexReauth = useCallback((authUrl: string, loginId: string) => {
    if (codexReauthTimersRef.current[loginId]) return;
    openExternal(authUrl);
    const poll = window.setInterval(async () => {
      try {
        const res = await gw.completeOAuth('codex', loginId);
        if (res.authenticated) {
          clearCodexReauth(loginId);
          toast.success('Codex re-authenticated', { duration: 4000 });
        }
      } catch {
        // still waiting for the browser flow to finish
      }
    }, 2000);
    const timeout = window.setTimeout(() => {
      clearCodexReauth(loginId);
      toast.error('Codex re-authentication timed out', {
        duration: 10000,
        action: {
          label: 'Settings',
          onClick: () => tabState.openTab({ id: 'view:settings', type: 'settings', label: 'Settings', closable: true }),
        },
      });
    }, 120_000);
    codexReauthTimersRef.current[loginId] = { poll, timeout };
  }, [clearCodexReauth, gw, openExternal, tabState]);

  useEffect(() => () => {
    for (const loginId of Object.keys(codexReauthTimersRef.current)) {
      clearCodexReauth(loginId);
    }
  }, [clearCodexReauth]);

  // Auto-update listener
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onUpdateStatus) return;
    const cleanup = api.onUpdateStatus((status: any) => {
      switch (status.event) {
        case 'checking':
          setUpdateState({ status: 'checking' });
          break;
        case 'available':
          setUpdateState({ status: 'available', version: status.version });
          break;
        case 'not-available':
          setUpdateState({ status: 'idle' });
          break;
        case 'downloading':
          setUpdateState(prev => ({ ...prev, status: 'downloading', percent: status.percent }));
          break;
        case 'downloaded':
          setUpdateState({ status: 'downloaded', version: status.version });
          break;
        case 'error':
          setUpdateState({ status: 'error', message: status.message });
          // Auto-dismiss error after 10s
          setTimeout(() => setUpdateState(prev => prev.status === 'error' ? { status: 'idle' } : prev), 10000);
          break;
      }
    });
    return cleanup;
  }, []);

  // Persist sidebar state
  useEffect(() => { localStorage.setItem('dorabot:showFiles', String(showFiles)); }, [showFiles]);
  useEffect(() => { localStorage.setItem('dorabot:sidebarView', sidebarView); }, [sidebarView]);

  // Toggle file explorer via the library's imperative API.
  // onResize is the single source of truth for showFiles — no sync effects needed.
  const toggleFileExplorer = useCallback(() => {
    const panel = filesPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      const saved = parseFloat(filesPanelSize.current);
      panel.resize(saved > 0 ? `${saved}%` : '15%');
    } else {
      panel.collapse();
    }
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Sync gateway active session whenever the focused group or its active tab changes
  useEffect(() => {
    const group = layout.groups.find(g => g.id === layout.activeGroupId);
    if (group?.activeTabId) {
      const tab = tabState.tabs.find(t => t.id === group.activeTabId);
      if (tab && isChatTab(tab)) {
        gw.setActiveSession(tab.sessionKey, tab.chatId);
      }
    }
    // Auto-focus chat input after keyboard-triggered group switch
    if (focusInputOnGroupSwitch.current) {
      focusInputOnGroupSwitch.current = false;
      const groupEl = document.querySelector<HTMLElement>(`[data-group-id="${layout.activeGroupId}"]`);
      const ta = groupEl?.querySelector<HTMLTextAreaElement>('.chat-input-area textarea')
        || document.querySelector<HTMLTextAreaElement>('.chat-input-area textarea');
      ta?.focus();
    }
  }, [layout.activeGroupId, layout.groups, tabState.tabs, gw]);

  useEffect(() => {
    const fetchStars = () => {
      fetch('https://api.github.com/repos/suitedaces/dorabot')
        .then(r => r.json())
        .then(data => { if (typeof data.stargazers_count === 'number') setStarCount(data.stargazers_count); })
        .catch(() => {});
    };
    fetchStars();
    const interval = setInterval(fetchStars, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Check provider auth on connect - show onboarding if not completed yet
  useEffect(() => {
    // Treat 'connected' and 'degraded' the same for auth checks.
    // In degraded mode, auth is still available via HTTP fallback.
    const isUsable = gw.connectionState === 'connected' || gw.connectionState === 'degraded';
    if (isUsable && gw.providerInfo && !onboardingCheckedRef.current) {
      onboardingCheckedRef.current = true;
      const now = Date.now();
      const unauthSnoozeUntil = Number(localStorage.getItem(ONBOARDING_UNAUTH_SNOOZE_UNTIL_KEY) || '0');
      const unauthSnoozed = Number.isFinite(unauthSnoozeUntil) && unauthSnoozeUntil > now;
      if (!unauthSnoozed && unauthSnoozeUntil > 0) {
        localStorage.removeItem(ONBOARDING_UNAUTH_SNOOZE_UNTIL_KEY);
      }

      // Show onboarding if never completed, or if auth is missing and not recently snoozed.
      if (!onboardingCompletedRef.current) {
        setShowOnboarding(true);
      } else if (!gw.providerInfo.auth.authenticated && !unauthSnoozed) {
        setShowOnboarding(true);
      }
    }
    // Only reset onboarding check on full disconnect (not degraded) and only if never completed.
    // Transient disconnects and degraded mode should not re-prompt completed users.
    if (gw.connectionState === 'disconnected' && !onboardingCompletedRef.current) {
      onboardingCheckedRef.current = false;
    }
  }, [gw.connectionState, gw.providerInfo]);


  // subscribe to notifiable gateway events for toasts + OS notifications
  useEffect(() => {
    gw.onNotifiableEventRef.current = (event: NotifiableEvent) => {
      const windowFocused = document.hasFocus();
      const now = Date.now();
      const allowPing = (key: string, cooldownMs = 4000) => {
        const last = notifCooldownRef.current[key] || 0;
        if (now - last < cooldownMs) return false;
        notifCooldownRef.current[key] = now;
        return true;
      };

      switch (event.type) {
        case 'agent.result': {
          if (!windowFocused) {
            notify('agent finished');
            (window as any).electronAPI?.dockBounce?.('informational');
            playNotifSound();
          }
          break;
        }
        case 'tool_approval':
          toast.warning(`Approve: ${event.toolName}`, {
            description: 'Agent is waiting for your approval to proceed.',
            icon: <ShieldAlert className="w-4 h-4 text-amber-400" />,
            duration: 10000,
          });
          if (!windowFocused) {
            notify(`approve tool: ${event.toolName}`);
          }
          (window as any).electronAPI?.dockBounce?.('critical');
          playNotifSound();
          break;
        case 'pulse.started':
          toast('Checking in...', {
            icon: <Play className="w-4 h-4 text-green-400" />,
            duration: 4000,
          });
          if (!windowFocused) {
            notify('checking in...');
          }
          break;
        case 'schedule.started':
          toast(`Working on "${event.summary}"`, {
            icon: <Play className="w-4 h-4 text-blue-400" />,
            duration: 5000,
          });
          if (!windowFocused) {
            notify(`working on: ${event.summary}`);
            playNotifSound();
          }
          break;
        case 'calendar':
          toast(event.summary, {
            icon: <CalendarCheck className="w-4 h-4 text-blue-400" />,
            duration: 5000,
          });
          if (!windowFocused) {
            notify(`calendar: ${event.summary}`);
            playNotifSound();
          }
          break;
        case 'projects.update':
          if (!allowPing('projects.update')) break;
          toast(event.message || 'Projects updated', {
            icon: <Target className="w-4 h-4 text-orange-400" />,
            duration: 4000,
            action: {
              label: 'View',
              onClick: () => tabState.openTab({ id: 'view:goals', type: 'goals', label: 'Projects', closable: true }),
            },
          });
          if (!windowFocused) {
            notify(event.message || 'projects updated');
            playNotifSound();
          }
          break;
        case 'research.update':
          if (!allowPing('research.update')) break;
          toast(event.message || 'Research updated', {
            icon: <FlaskConical className="w-4 h-4 text-purple-400" />,
            duration: 4000,
            action: {
              label: 'View',
              onClick: () => tabState.openTab({ id: 'view:research', type: 'research', label: 'Research', closable: true }),
            },
          });
          if (!windowFocused) {
            notify(event.message || 'research updated');
            playNotifSound();
          }
          break;
        case 'auth.required':
          if (!allowPing(`auth.required:${event.provider}`, 300_000)) break;
          toast.error(`${event.provider} auth required`, {
            description: event.reason,
            icon: <KeyRound className="w-4 h-4 text-red-400" />,
            duration: 8000,
            action: {
              label: 'Settings',
              onClick: () => tabState.openTab({ id: 'view:settings', type: 'settings', label: 'Settings', closable: true }),
            },
          });
          if (!windowFocused) {
            notify(`${event.provider} auth required`);
            playNotifSound();
          }
          break;
        case 'auth.reauth':
          if (!allowPing(`auth.reauth:${event.provider}`, 300_000)) break;
          if (event.provider === 'codex' && event.loginId) {
            startCodexReauth(event.authUrl, event.loginId);
            toast.error('Codex session expired, reopening sign-in', {
              icon: <KeyRound className="w-4 h-4 text-red-400" />,
              duration: 10000,
              action: {
                label: 'Settings',
                onClick: () => tabState.openTab({ id: 'view:settings', type: 'settings', label: 'Settings', closable: true }),
              },
            });
          } else {
            toast.error(`${event.provider} session expired`, {
              icon: <KeyRound className="w-4 h-4 text-red-400" />,
              duration: 15000,
              action: {
                label: 'Re-authenticate',
                onClick: () => {
                  tabState.openTab({ id: 'view:settings', type: 'settings', label: 'Settings', closable: true });
                  openExternal(event.authUrl);
                },
              },
            });
          }
          if (!windowFocused) {
            notify(`${event.provider} session expired`);
            playNotifSound();
          }
          break;
        case 'channel.message': {
          const preview = event.body.length > 80 ? event.body.slice(0, 80) + '...' : event.body;
          const sender = event.senderName || event.senderId;
          const channelLabel = event.channel.charAt(0).toUpperCase() + event.channel.slice(1);
          const channelIcon = event.channel === 'telegram'
            ? <img src={telegramImg} className="w-4 h-4" alt="" />
            : event.channel === 'whatsapp'
              ? <img src={whatsappImg} className="w-4 h-4" alt="" />
              : <MessageSquare className="w-4 h-4 text-muted-foreground" />;
          toast(`${sender}`, {
            description: preview,
            icon: channelIcon,
            duration: 5000,
            action: {
              label: 'Open',
              onClick: () => {
                const sessionKey = `${event.channel}:dm:${event.chatId}`;
                tabState.openChatTab({
                  sessionKey,
                  chatId: event.chatId,
                  channel: event.channel,
                  label: `${channelLabel} - ${sender}`,
                });
              },
            },
          });
          playNotifSound();
          break;
        }
      }
    };
    return () => { gw.onNotifiableEventRef.current = null; };
  }, [gw.onNotifiableEventRef, notify, openExternal, startCodexReauth, tabState]);

  const filteredSessions = useMemo(() => {
    if (sessionFilter === 'all') return gw.sessions;
    return gw.sessions.filter(s => (s.channel || 'desktop') === sessionFilter);
  }, [gw.sessions, sessionFilter]);

  // Track which sessions are visible across all panes (for sidebar highlighting)
  const visibleSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of layout.visibleGroups) {
      if (group.activeTabId) {
        const tab = tabState.tabs.find(t => t.id === group.activeTabId);
        if (tab && isChatTab(tab) && tab.sessionId) {
          ids.add(tab.sessionId);
        }
      }
    }
    return ids;
  }, [layout.visibleGroups, tabState.tabs]);

  const unreadBySessionId = useMemo(() => {
    const byId: Record<string, number> = {};
    for (const tab of tabState.tabs) {
      if (!isChatTab(tab)) continue;
      const unread = tabState.unreadBySession[tab.sessionKey] || 0;
      if (unread <= 0) continue;

      let sid = tab.sessionId;
      if (!sid) {
        const [channel = 'desktop', chatType = 'dm', ...rest] = tab.sessionKey.split(':');
        const chatId = rest.join(':') || tab.chatId;
        sid = gw.sessions.find(s =>
          (s.channel || 'desktop') === channel &&
          (s.chatType || 'dm') === chatType &&
          s.chatId === chatId,
        )?.id;
      }
      if (!sid) continue;
      byId[sid] = Math.max(byId[sid] || 0, unread);
    }
    return byId;
  }, [tabState.tabs, tabState.unreadBySession, gw.sessions]);

  const handleViewSession = useCallback((sessionId: string, channel?: string, chatId?: string, chatType?: string) => {
    const ch = channel || 'desktop';
    const ct = chatType || 'dm';
    const cid = chatId || sessionId;
    const sessionKey = `${ch}:${ct}:${cid}`;
    const session = gw.sessions.find(s => s.id === sessionId);
    const label = session?.name || session?.senderName || session?.preview || sessionId.slice(8, 16);

    tabState.openChatTab({
      sessionId,
      sessionKey,
      chatId: cid,
      channel: ch,
      label,
    });
  }, [gw.sessions, tabState]);

  const handleNavClick = useCallback((navId: TabType) => {
    if (navId === 'chat') {
      // Task nav should open a fresh chat unless a blank draft chat already exists.
      const existingDraftChat = tabState.tabs.find((t) => {
        if (!isChatTab(t)) return false;
        if (t.label !== 'new task') return false;
        if (t.sessionId) return false;
        const itemCount = gw.sessionStates[t.sessionKey]?.chatItems.length ?? 0;
        return itemCount === 0;
      });
      if (existingDraftChat) {
        tabState.focusTab(existingDraftChat.id);
      } else {
        tabState.newChatTab();
      }
    } else if (navId !== 'file' && navId !== 'diff' && navId !== 'terminal' && navId !== 'task' && navId !== 'pr' && navId !== 'browser') {
      tabState.openViewTab(navId, ALL_NAV_ITEMS.find(n => n.id === navId)?.label || navId);
    }
  }, [tabState, gw.sessionStates]);

  const resolveQuickOpenRoot = useCallback(() => {
    const explorerRoot = fileExplorerStateRef.current.viewRoot;
    if (explorerRoot) return explorerRoot;

    const active = tabState.activeTab;
    if (active && 'filePath' in active && active.filePath) {
      const idx = active.filePath.lastIndexOf('/');
      if (idx > 0) return active.filePath.slice(0, idx);
    }

    const anyFileTab = tabState.tabs.find((t): t is Tab & { filePath: string } => 'filePath' in t);
    if (anyFileTab?.filePath) {
      const idx = anyFileTab.filePath.lastIndexOf('/');
      if (idx > 0) return anyFileTab.filePath.slice(0, idx);
    }

    return '.';
  }, [tabState.activeTab, tabState.tabs]);

  const buildQuickOpenIndex = useCallback(async (rootPath: string): Promise<QuickOpenFile[]> => {
    const files: QuickOpenFile[] = [];
    const stack = [rootPath];
    const visited = new Set<string>();

    while (stack.length > 0 && files.length < QUICK_OPEN_MAX_FILES) {
      const dir = stack.pop() as string;
      if (visited.has(dir)) continue;
      visited.add(dir);

      let entries: FsListEntry[];
      try {
        entries = await gw.rpc('fs.list', { path: dir }, 15000) as FsListEntry[];
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = joinPath(dir, entry.name);
        if (entry.type === 'directory') {
          if (QUICK_OPEN_IGNORED_DIRS.has(entry.name)) continue;
          stack.push(fullPath);
          continue;
        }

        const rel = toRelativePath(fullPath, rootPath);
        files.push({
          path: fullPath,
          rel,
          name: entry.name,
          relLower: rel.toLowerCase(),
          nameLower: entry.name.toLowerCase(),
        });
        if (files.length >= QUICK_OPEN_MAX_FILES) break;
      }
    }

    files.sort((a, b) => a.rel.localeCompare(b.rel));
    return files;
  }, [gw.rpc]);

  const openQuickOpen = useCallback(() => {
    const rootPath = resolveQuickOpenRoot();
    setQuickOpenRoot(rootPath);
    setQuickOpenOpen(true);
    setQuickOpenQuery('');
    setQuickOpenSelected(0);
    setQuickOpenError(null);

    const cached = quickOpenCacheRef.current;
    if (cached && cached.root === rootPath) {
      setQuickOpenFiles(cached.files);
      setQuickOpenLoading(false);
      return;
    }

    setQuickOpenLoading(true);
    const reqId = ++quickOpenRequestRef.current;

    void buildQuickOpenIndex(rootPath)
      .then((files) => {
        if (quickOpenRequestRef.current !== reqId) return;
        quickOpenCacheRef.current = { root: rootPath, files };
        setQuickOpenFiles(files);
        if (files.length >= QUICK_OPEN_MAX_FILES) {
          toast.message(`Quick open indexed first ${QUICK_OPEN_MAX_FILES.toLocaleString()} files`);
        }
      })
      .catch((err) => {
        if (quickOpenRequestRef.current !== reqId) return;
        setQuickOpenError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (quickOpenRequestRef.current !== reqId) return;
        setQuickOpenLoading(false);
      });
  }, [buildQuickOpenIndex, resolveQuickOpenRoot]);

  const quickOpenResults = useMemo(() => {
    const q = quickOpenQuery.trim().toLowerCase();
    if (!q) return quickOpenFiles.slice(0, QUICK_OPEN_MAX_RESULTS);
    return quickOpenFiles
      .map((file) => ({ file, score: scoreQuickOpen(file, q) }))
      .filter(item => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score || a.file.rel.length - b.file.rel.length)
      .slice(0, QUICK_OPEN_MAX_RESULTS)
      .map(item => item.file);
  }, [quickOpenFiles, quickOpenQuery]);

  useEffect(() => {
    if (!quickOpenOpen) return;
    const id = requestAnimationFrame(() => quickOpenInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [quickOpenOpen]);

  useEffect(() => {
    setQuickOpenSelected((prev) => {
      if (quickOpenResults.length === 0) return 0;
      return Math.min(prev, quickOpenResults.length - 1);
    });
  }, [quickOpenResults]);

  const openQuickOpenFile = useCallback((file?: QuickOpenFile) => {
    if (!file) return;
    tabState.openFileTab(file.path);
    setQuickOpenOpen(false);
    setQuickOpenQuery('');
  }, [tabState]);

  // --- Keyboard shortcuts ---
  const shortcutActions = useMemo(() => ({
    newTab: () => tabState.newChatTab(),
    closeTab: () => {
      const group = layout.groups.find(g => g.id === layout.activeGroupId);
      const tabId = group?.activeTabId || tabState.activeTabId;
      if (tabId) tabState.closeTab(tabId);
    },
    nextTab: () => tabState.nextTab(),
    prevTab: () => tabState.prevTab(),
    focusTabByIndex: (i: number) => tabState.focusTabByIndex(i),
    openQuickOpen: () => openQuickOpen(),
    openGlobalSearch: () => setShowGlobalSearch(true),
    openShortcutHelp: () => setShowShortcutHelp(p => !p),
    previewMarkdown: () => {
      const tab = tabState.activeTab;
      if (!tab || tab.type !== 'file' || !tab.filePath.toLowerCase().endsWith('.md')) return;
      window.dispatchEvent(new CustomEvent(MARKDOWN_PREVIEW_EVENT, { detail: { filePath: tab.filePath } }));
    },
    toggleFiles: toggleFileExplorer,
    openSettings: () => handleNavClick('settings'),
    openTerminal: () => tabState.openTerminalTab(),
    openBrowser: () => tabState.openBrowserTab(),
    focusInput: () => {
      const group = layout.groups.find(g => g.id === layout.activeGroupId);
      const groupEl = document.querySelector<HTMLElement>(`[data-group-id="${layout.activeGroupId}"]`);
      const ta = groupEl?.querySelector<HTMLTextAreaElement>('.chat-input-area textarea')
        || document.querySelector<HTMLTextAreaElement>('.chat-input-area textarea');
      ta?.focus();
      // Sync gateway so messages route to the focused group's session
      if (group?.activeTabId) {
        const tab = tabState.tabs.find(t => t.id === group.activeTabId);
        if (tab && isChatTab(tab)) {
          gw.setActiveSession(tab.sessionKey, tab.chatId);
        }
      }
    },
    abortAgent: () => gw.abortAgent(),
    splitHorizontal: () => layout.addColumn(),
    splitVertical: () => layout.addRow(),
    splitGrid: () => layout.splitGrid(),
    resetLayout: () => layout.resetToSingle(),
    focusGroupLeft: () => { focusInputOnGroupSwitch.current = true; layout.focusGroupDirection('left'); },
    focusGroupRight: () => { focusInputOnGroupSwitch.current = true; layout.focusGroupDirection('right'); },
    focusGroupUp: () => { focusInputOnGroupSwitch.current = true; layout.focusGroupDirection('up'); },
    focusGroupDown: () => { focusInputOnGroupSwitch.current = true; layout.focusGroupDirection('down'); },
  }), [tabState, gw, handleNavClick, layout, openQuickOpen]);

  const isAgentRunning = useMemo(() => {
    const tab = tabState.activeTab;
    if (!tab || !isChatTab(tab)) return false;
    const status = gw.sessionStates[tab.sessionKey]?.agentStatus;
    return !!status && status !== 'idle';
  }, [tabState.activeTab, gw.sessionStates]);

  useKeyboardShortcuts(shortcutActions, { isAgentRunning });

  // Cmd+W via Electron IPC (before-input-event blocks DOM keydown, so main process sends IPC instead)
  useEffect(() => {
    const cleanup = (window as any).electronAPI?.onCloseTab?.(() => {
      shortcutActions.closeTab();
    });
    return () => cleanup?.();
  }, [shortcutActions]);

  // Agent → UI sync: when the agent creates a browser tab via the browser tool,
  // surface it as a UI tab. If the agent acts on an existing pageId, focus
  // that tab. Refs keep the subscription stable across tab list changes.
  const tabsRef = useRef(tabState.tabs);
  useEffect(() => { tabsRef.current = tabState.tabs; }, [tabState.tabs]);
  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api) return;
    const unsubCreated = api.onTabCreated?.((summary) => {
      if (summary.origin !== 'agent') return;
      const existing = tabsRef.current.find(t => isBrowserTab(t) && t.pageId === summary.pageId);
      if (existing) {
        tabState.focusTab(existing.id);
        return;
      }
      const label = summary.title?.trim() || undefined;
      tabState.adoptBrowserTab(summary.pageId, summary.url || undefined, label);
    });
    const unsubActivity = api.onTabAgentActivity?.((payload) => {
      const existing = tabsRef.current.find(t => isBrowserTab(t) && t.pageId === payload.pageId);
      if (existing && existing.id !== tabState.activeTabId) {
        tabState.focusTab(existing.id);
      }
    });
    return () => {
      unsubCreated?.();
      unsubActivity?.();
    };
  }, [tabState]);

  // --- Drag and drop ---
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const tabId = event.active.data.current?.tabId as string | undefined;
    if (tabId) {
      const tab = tabState.tabs.find(t => t.id === tabId);
      if (tab) setDraggingTab(tab);
    }
  }, [tabState.tabs]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggingTab(null);
    const { active, over } = event;
    if (!over) return;

    const tabId = active.data.current?.tabId as string;
    const sourceGroupId = active.data.current?.sourceGroupId as string | undefined;
    if (!tabId) return;

    const overId = over.id as string;

    // Helper: sync gateway after moving a tab
    const syncAfterMove = (tid: string) => {
      const tab = tabState.tabs.find(t => t.id === tid);
      if (tab && isChatTab(tab)) {
        gw.setActiveSession(tab.sessionKey, tab.chatId);
      }
    };

    // Dropped on a group's tab bar — move tab to that group
    if (overId.startsWith('group-drop:')) {
      const targetGroupId = over.data.current?.groupId as string;
      if (sourceGroupId && targetGroupId && sourceGroupId !== targetGroupId) {
        layout.moveTabToGroup(tabId, sourceGroupId, targetGroupId);
        syncAfterMove(tabId);
      }
      return;
    }

    // Dropped on a panel drop zone — split or move
    if (overId.startsWith('panel-split:')) {
      const targetPaneId = over.data.current?.panelGroupId as string;
      const zone = over.data.current?.splitZone as string;
      if (!sourceGroupId || !targetPaneId || !zone) return;

      // Center zone = move tab to this pane (no split)
      if (zone === 'center') {
        if (sourceGroupId !== targetPaneId) {
          layout.moveTabToGroup(tabId, sourceGroupId, targetPaneId);
          syncAfterMove(tabId);
        }
        return;
      }

      // Edge zones: create a new pane via column/row insertion, then move tab
      let newPaneId: string;
      if (zone === 'left' || zone === 'right') {
        newPaneId = layout.addColumnAt(targetPaneId, zone as 'left' | 'right');
      } else {
        newPaneId = layout.addRowAt(targetPaneId, zone as 'top' | 'bottom');
      }
      if (newPaneId && newPaneId !== sourceGroupId) {
        setTimeout(() => layout.moveTabToGroup(tabId, sourceGroupId, newPaneId), 0);
      }
      return;
    }
  }, [layout, tabState]);

  const channelIcon = (ch?: string) => {
    if (ch === 'whatsapp') return <img src={whatsappImg} className="w-3 h-3" alt="W" />;
    if (ch === 'telegram') return <img src={telegramImg} className="w-3 h-3" alt="T" />;
    return <MessageSquare className="w-3 h-3 opacity-50" />;
  };

  const activeNavId = tabState.activeTab?.type || 'chat';

  const statusDotColor = gw.connectionState === 'connected'
    ? 'bg-success'
    : gw.connectionState === 'degraded'
    ? 'bg-warning'
    : gw.connectionState === 'connecting'
    ? 'bg-warning'
    : 'bg-destructive';

  const activeSessionState = tabState.activeTab && isChatTab(tabState.activeTab)
    ? gw.sessionStates[tabState.activeTab.sessionKey]
    : null;

  // Shared props for EditorGroupPanel
  const groupPanelProps = useCallback((groupId: GroupId) => ({
    tabs: tabState.tabs,
    isMultiPane: layout.isMultiPane,
    isDragging: !!draggingTab,
    gateway: gw,
    tabState,
    selectedChannel,
    onFocusGroup: () => {
      layout.focusGroup(groupId);
      // Sync gateway immediately so messages route to the right session
      const group = layout.groups.find(g => g.id === groupId);
      if (group?.activeTabId) {
        const tab = tabState.tabs.find(t => t.id === group.activeTabId);
        if (tab && isChatTab(tab)) {
          gw.setActiveSession(tab.sessionKey, tab.chatId);
        }
      }
    },
    onNavigateSettings: () => handleNavClick('settings'),
    onViewSession: handleViewSession,
    onSwitchChannel: setSelectedChannel,
    onSetupChat: (prompt: string) => {
      const created = tabState.newChatTab(groupId);
      setTimeout(() => gw.sendMessage(prompt, created.sessionKey, created.chatId), 0);
    },
    onNewTerminal: () => {
      layout.focusGroup(groupId);
      tabState.openTerminalTab(undefined, groupId);
    },
    onNewBrowser: () => {
      layout.focusGroup(groupId);
      tabState.openBrowserTab(undefined, groupId);
    },
    onNavClick: (navId: string) => handleNavClick(navId as TabType),
    onSplitRight: () => layout.addColumnAt(groupId, 'right'),
    onSplitDown: () => layout.addRowAt(groupId, 'bottom'),
  }), [tabState, gw, selectedChannel, layout, handleNavClick, handleViewSession, draggingTab]);

  const renderLayout = () => {
    const { columns, columnSizes, activeGroupId } = layout;

    // Single pane: no resizable wrapper needed
    if (columns.length === 1 && columns[0].panes.length === 1) {
      const pane = columns[0].panes[0];
      return (
        <EditorGroupPanel
          group={pane}
          isActive={true}
          {...groupPanelProps(pane.id)}
        />
      );
    }

    const renderColumn = (col: typeof columns[0]) => {
      if (col.panes.length === 1) {
        const pane = col.panes[0];
        return (
          <EditorGroupPanel
            group={pane}
            isActive={activeGroupId === pane.id}
            {...groupPanelProps(pane.id)}
          />
        );
      }
      return (
        <ResizablePanelGroup orientation="vertical" key={col.id}>
          {col.panes.map((pane, pi) => (
            <ResizablePanel key={pane.id} defaultSize={`${col.sizes[pi]}%`} minSize="20%">
              <EditorGroupPanel
                group={pane}
                isActive={activeGroupId === pane.id}
                {...groupPanelProps(pane.id)}
              />
            </ResizablePanel>
          )).flatMap((el, i, arr) =>
            i < arr.length - 1 ? [el, <ResizableHandle key={`h-${col.id}-${i}`} withHandle />] : [el]
          )}
        </ResizablePanelGroup>
      );
    };

    // Single column with multiple rows
    if (columns.length === 1) {
      return renderColumn(columns[0]);
    }

    // Multiple columns
    return (
      <ResizablePanelGroup key={`cols-${columns.length}`} orientation="horizontal" className="h-full">
        {columns.map((col, ci) => (
          <ResizablePanel key={col.id} defaultSize={`${columnSizes[ci]}%`} minSize="20%">
            {renderColumn(col)}
          </ResizablePanel>
        )).flatMap((el, i, arr) =>
          i < arr.length - 1 ? [el, <ResizableHandle key={`hcol-${i}`} withHandle />] : [el]
        )}
      </ResizablePanelGroup>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Toaster
        position="top-right"
        offset={{ top: 48, right: 12 }}
        gap={6}
        toastOptions={{
          className: 'font-mono text-xs !rounded-lg !shadow-lg',
          style: {
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
            backdropFilter: 'blur(12px)',
            padding: '10px 14px',
          },
        }}
      />

      {showOnboarding && (
        <OnboardingOverlay
          gateway={gw}
          onComplete={(launchOnboard, profileData) => {
            setShowOnboarding(false);
            localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
            onboardingCompletedRef.current = true;
            const isAuthenticated = !!gw.providerInfo?.auth?.authenticated;
            if (isAuthenticated) {
              localStorage.removeItem(ONBOARDING_UNAUTH_SNOOZE_UNTIL_KEY);
            } else {
              localStorage.setItem(
                ONBOARDING_UNAUTH_SNOOZE_UNTIL_KEY,
                String(Date.now() + ONBOARDING_UNAUTH_SNOOZE_MS),
              );
            }
            if (launchOnboard) {
              const created = tabState.newChatTab();
              // Pass profile context so the onboard skill doesn't re-ask name/timezone
              const context = profileData?.name
                ? `onboard (my name is ${profileData.name}, timezone: ${profileData.timezone || 'auto'})`
                : 'onboard';
              setTimeout(() => gw.sendMessage(context, created.sessionKey, created.chatId), 200);
            }
          }}
        />
      )}

      {quickOpenOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/35 backdrop-blur-[1px] flex items-start justify-center pt-20 px-4"
          onMouseDown={() => setQuickOpenOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-popover shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-3 py-2">
              <input
                ref={quickOpenInputRef}
                value={quickOpenQuery}
                onChange={(e) => setQuickOpenQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setQuickOpenSelected((v) => Math.min(v + 1, Math.max(quickOpenResults.length - 1, 0)));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setQuickOpenSelected((v) => Math.max(v - 1, 0));
                    return;
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    openQuickOpenFile(quickOpenResults[quickOpenSelected]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuickOpenOpen(false);
                  }
                }}
                placeholder="Type a file name..."
                className="w-full h-8 px-2 rounded-md bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/40"
              />
              <div className="mt-1 text-[10px] text-muted-foreground truncate">
                root: {quickOpenRoot || '.'}
              </div>
            </div>

            <div className="max-h-[420px] overflow-auto p-1">
              {quickOpenLoading && (
                <div className="px-2 py-4 text-[11px] text-muted-foreground">Indexing files...</div>
              )}
              {!quickOpenLoading && quickOpenError && (
                <div className="px-2 py-4 text-[11px] text-destructive">Quick open failed: {quickOpenError}</div>
              )}
              {!quickOpenLoading && !quickOpenError && quickOpenResults.length === 0 && (
                <div className="px-2 py-4 text-[11px] text-muted-foreground">
                  {quickOpenQuery.trim() ? 'No matches' : 'No files indexed'}
                </div>
              )}
              {!quickOpenLoading && !quickOpenError && quickOpenResults.map((file, idx) => (
                <button
                  key={file.path}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded-md transition-colors',
                    idx === quickOpenSelected
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                  )}
                  onMouseEnter={() => setQuickOpenSelected(idx)}
                  onClick={() => openQuickOpenFile(file)}
                >
                  <div className="text-[11px] truncate">{file.name}</div>
                  <div className="text-[10px] truncate opacity-80">{file.rel}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ShortcutHelp open={showShortcutHelp} onClose={() => setShowShortcutHelp(false)} />

      <GlobalSearch
        open={showGlobalSearch}
        onClose={() => setShowGlobalSearch(false)}
        rpc={gw.rpc}
        viewRoot={fileExplorerStateRef.current.viewRoot || ''}
        onOpenFile={(path) => { tabState.openFileTab(path); setShowGlobalSearch(false); }}
        onOpenSession={(sessionId, channel, chatId) => {
          handleViewSession(sessionId, channel || undefined, chatId || undefined);
          setShowGlobalSearch(false);
        }}
      />

      {/* titlebar — pure drag chrome */}
      <div className="h-11 bg-card border-b border-border flex items-center pl-[78px] pr-4 shrink-0" style={{ WebkitAppRegion: 'drag' } as any}>
        <img src={dorabotImg} alt="dorabot" className="h-8 mr-1 dorabot-alive" style={{ imageRendering: 'pixelated' }} />
        <span className="text-base text-muted-foreground font-medium">dorabot</span>
        <a
          href="https://github.com/suitedaces/dorabot"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          {starCount !== null && (
            <span className="flex items-center gap-0.5">
              <Star className="w-3 h-3 fill-current" />
              {starCount}
            </span>
          )}
        </a>
        <PalettePicker palette={palette} onPalette={setPalette} />
        <button
          onClick={toggleFileExplorer}
          className="ml-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          title={showFiles ? 'Hide file explorer' : 'Show file explorer'}
          aria-label={showFiles ? 'Hide file explorer' : 'Show file explorer'}
        >
          {showFiles ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
        </button>
      </div>

      {/* Update banner */}
      {(updateState.status === 'available' || updateState.status === 'downloading') && (
        <div className="shrink-0 px-4 py-1.5 bg-primary/10 border-b border-primary/20 flex items-center gap-2 text-xs">
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
          <span className="text-primary">
            {updateState.status === 'downloading' && updateState.percent != null
              ? `Downloading update... ${updateState.percent}%`
              : `Downloading update ${updateState.version ?? ''}...`}
          </span>
        </div>
      )}
      {updateState.status === 'downloaded' && (
        <div className="shrink-0 px-4 py-1.5 bg-success/10 border-b border-success/20 flex items-center gap-2 text-xs">
          <span className="text-success">Update {updateState.version} ready</span>
          <button
            onClick={() => (window as any).electronAPI?.installUpdate?.()}
            className="ml-auto px-2 py-0.5 rounded bg-success text-success-foreground text-[10px] font-medium hover:bg-success/90 transition-colors"
          >
            Restart to update
          </button>
          <button
            onClick={() => setUpdateState({ status: 'idle' })}
            className="text-muted-foreground hover:text-foreground text-[10px]"
          >
            Later
          </button>
        </div>
      )}
      {updateState.status === 'error' && (
        <div className="shrink-0 px-4 py-1.5 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2 text-xs">
          <span className="text-destructive">Update failed: {updateState.message}</span>
          <button
            onClick={() => (window as any).electronAPI?.checkForUpdate?.()}
            className="ml-auto px-2 py-0.5 rounded bg-destructive/20 text-destructive text-[10px] font-medium hover:bg-destructive/30 transition-colors"
          >
            Retry
          </button>
          <button
            onClick={() => setUpdateState({ status: 'idle' })}
            className="text-muted-foreground hover:text-foreground text-[10px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* main layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* sidebar */}
        <ResizablePanel defaultSize="12%" minSize="8%" maxSize="22%" className="bg-card overflow-hidden">
          <div className="flex flex-col h-full min-h-0">
            <div className="shrink-0 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2.5 pt-3 pb-1">views</div>
              {PRIMARY_NAV_ITEMS.map(item => (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                        activeNavId === item.id
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                      }`}
                      onClick={() => handleNavClick(item.id)}
                    >
                      {item.icon}
                      {item.label}
                      {item.id === 'chat' && gw.backgroundRuns.some(r => r.status === 'running') && (
                        <Loader2 className="w-3 h-3 ml-auto animate-spin text-muted-foreground" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-[10px]">{item.label}</TooltipContent>
                </Tooltip>
              ))}

              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2.5 pt-3 pb-1">advanced</div>
              {SECONDARY_NAV_ITEMS.map(item => (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                        activeNavId === item.id
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                      }`}
                      onClick={() => handleNavClick(item.id)}
                    >
                      {item.icon}
                      {item.label}
                      {item.id === 'chat' && gw.backgroundRuns.some(r => r.status === 'running') && (
                        <Loader2 className="w-3 h-3 ml-auto animate-spin text-muted-foreground" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-[10px]">{item.label}</TooltipContent>
                </Tooltip>
              ))}

            </div>

            {/* sessions */}
            {gw.sessions.length > 0 && (
              <>
                <Separator />
                <div className="shrink-0 px-2 pt-1">
                  <div className="flex items-center px-2.5 py-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">sessions</span>
                    <select
                      value={sessionFilter}
                      onChange={e => setSessionFilter(e.target.value as SessionFilter)}
                      className="ml-auto text-[9px] bg-secondary text-muted-foreground border border-border rounded px-1 py-0.5"
                    >
                      <option value="all">all</option>
                      <option value="desktop">desktop</option>
                      <option value="telegram">telegram</option>
                      <option value="whatsapp">whatsapp</option>
                    </select>
                  </div>
                </div>
                <ScrollArea className="flex-1 min-h-0 px-2 pb-2">
                  {filteredSessions.slice(0, 30).map(s => {
                    const isActive = tabState.activeTab && isChatTab(tabState.activeTab) && tabState.activeTab.sessionId === s.id;
                    const isVisible = !isActive && visibleSessionIds.has(s.id);
                    const unread = unreadBySessionId[s.id] || 0;
                    const isRenaming = renamingSessionId === s.id;
                    const commitRename = () => {
                      const name = renamingSessionValue.trim();
                      setRenamingSessionId(null);
                      if (!name || name === (s.name || '')) return;
                      gw.renameSession(s.id, name).then(() => {
                        toast.success('Renamed');
                        gw.refreshSessions();
                      }).catch(err => toast.error(String(err)));
                      const matchingTab = tabState.tabs.find(t => isChatTab(t) && (t as any).sessionId === s.id);
                      if (matchingTab) tabState.updateTabLabel(matchingTab.id, name);
                    };
                    if (isRenaming) {
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-[10px] ${
                            isActive ? 'bg-secondary' : 'bg-secondary/60'
                          }`}
                        >
                          <span className="w-3 h-3 shrink-0 flex items-center justify-center">{channelIcon(s.channel)}</span>
                          <input
                            autoFocus
                            value={renamingSessionValue}
                            onChange={(e) => setRenamingSessionValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                              else if (e.key === 'Escape') { e.preventDefault(); setRenamingSessionId(null); }
                            }}
                            className="flex-1 bg-background/70 border border-border rounded px-1 py-0 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      );
                    }
                    return (
                      <button
                        key={s.id}
                        className={`flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-[10px] transition-colors group ${
                          isActive
                            ? 'bg-secondary text-foreground'
                            : isVisible
                            ? 'bg-secondary/60 text-foreground/80'
                            : 'text-muted-foreground hover:bg-secondary/50'
                        }`}
                        onClick={() => handleViewSession(s.id, s.channel, s.chatId, s.chatType)}
                        onDoubleClick={(e) => { e.preventDefault(); setRenamingSessionValue(s.name || s.preview || ''); setRenamingSessionId(s.id); }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          const actions = [
                            { label: 'Fork session', action: () => gw.forkSession(s.id).then(r => { toast.success(`Forked → ${r.sessionId.slice(0, 12)}...`); gw.refreshSessions(); }).catch(err => toast.error(String(err))) },
                            { label: 'Rename', action: () => { setRenamingSessionValue(s.name || s.preview || ''); setRenamingSessionId(s.id); } },
                            { label: 'Tag', action: () => { const tag = prompt('Tag (empty to clear):'); gw.tagSession(s.id, tag || null).then(() => { toast.success(tag ? `Tagged: ${tag}` : 'Tag cleared'); gw.refreshSessions(); }).catch(err => toast.error(String(err))); } },
                          ];
                          // Simple popover via native context menu workaround using toast actions
                          const menu = document.createElement('div');
                          menu.className = 'fixed z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[140px]';
                          menu.style.left = `${e.clientX}px`;
                          menu.style.top = `${e.clientY}px`;
                          for (const a of actions) {
                            const btn = document.createElement('button');
                            btn.className = 'w-full px-3 py-1 text-[11px] text-left hover:bg-secondary transition-colors';
                            btn.textContent = a.label;
                            btn.onclick = () => { menu.remove(); a.action(); };
                            menu.appendChild(btn);
                          }
                          document.body.appendChild(menu);
                          const dismiss = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('mousedown', dismiss); } };
                          setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
                        }}
                        title={`${s.channel || 'desktop'} | ${s.messageCount} msgs | ${new Date(s.updatedAt).toLocaleString()}\nRight-click for fork/rename/tag`}
                      >
                        <span className="w-3 h-3 shrink-0 flex items-center justify-center">{channelIcon(s.channel)}</span>
                        <span className="truncate flex-1 text-left">
                          {s.name || s.senderName || s.preview || s.chatId || s.id.slice(8, 16)}
                        </span>
                        {unread > 0 && !s.activeRun && (
                          <span className="text-[9px] bg-primary text-primary-foreground rounded-full px-1.5 min-w-[16px] text-center">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                        {s.activeRun ? (
                          <Loader2 className="w-3 h-3 shrink-0 animate-spin text-primary" />
                        ) : (
                          <span className="text-[9px] text-muted-foreground shrink-0">
                            {new Date(s.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </ScrollArea>
              </>
            )}

            {/* pulse / scheduled runs indicator */}
            {gw.calendarRuns.length > 0 && (
              <>
                <Separator className="shrink-0" />
                <button
                  className="shrink-0 flex items-center gap-2 px-3 py-1.5 w-full text-left hover:bg-secondary/50 transition-colors"
                  onClick={() => { gw.markCalendarRunsSeen(); handleNavClick('automation'); }}
                >
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground truncate flex-1">
                    {gw.calendarRuns[0].summary}
                  </span>
                  {(() => {
                    const unseen = gw.calendarRuns.filter(r => !r.seen).length;
                    return unseen > 0 ? (
                      <span className="text-[9px] bg-primary text-primary-foreground rounded-full px-1.5 min-w-[16px] text-center">
                        {unseen}
                      </span>
                    ) : null;
                  })()}
                </button>
              </>
            )}

            {/* status at sidebar bottom */}
            <Separator className="shrink-0" />
            <div className="shrink-0 px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${statusDotColor}`} />
                <span className="text-[10px] text-muted-foreground">{gw.connectionState}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {activeSessionState?.agentStatus || 'idle'}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {activeSessionState?.sessionId ? `session: ${activeSessionState.sessionId.slice(0, 8)}` : 'no session'}
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* main content — layout-aware, wrapped in DndContext */}
        <ResizablePanel defaultSize={layout.isMultiPane ? "85%" : (showFiles ? "55%" : "85%")} minSize="30%" className="overflow-hidden min-w-0">
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="relative h-full">
              {renderLayout()}
            </div>
            <DragOverlay dropAnimation={null}>
              {draggingTab && <TabDragOverlay tab={draggingTab} />}
            </DragOverlay>
          </DndContext>
        </ResizablePanel>

        {/* file explorer — always rendered, collapsed when hidden to avoid layout redistribution */}
        <ResizableHandle withHandle disabled={!showFiles} className={cn(!showFiles && 'invisible')} />
        <ResizablePanel
          panelRef={filesPanelRef}
          collapsible
          collapsedSize="0%"
          defaultSize={showFiles ? filesPanelSize.current : "0%"}
          minSize="15%"
          maxSize="45%"
          className="overflow-hidden flex flex-col"
          onResize={(size) => {
            // onResize is the single source of truth for showFiles.
            // The library owns panel state; we derive React state from it.
            const pct = typeof size === 'object' ? size.asPercentage : parseFloat(String(size));
            if (pct < 1) {
              setShowFiles(false);
              return;
            }
            setShowFiles(true);
            filesPanelSize.current = `${pct}%`;
            localStorage.setItem('dorabot:filesPanelSize', `${pct}%`);
          }}
        >
          {showFiles && (
            <>
              <div className="flex items-center border-b border-border px-1.5 py-1.5 gap-0.5 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={cn(
                        'rounded p-1.5 transition-colors',
                        sidebarView === 'files'
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                      )}
                      onClick={() => setSidebarView('files')}
                      title="File Explorer"
                    >
                      <Folder className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">Explorer</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={cn(
                        'rounded p-1.5 transition-colors',
                        sidebarView === 'git'
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                      )}
                      onClick={() => setSidebarView('git')}
                      title="Source Control"
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">Source Control</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={cn(
                        'rounded p-1.5 transition-colors',
                        sidebarView === 'history'
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                      )}
                      onClick={() => setSidebarView('history')}
                      title="Session History"
                    >
                      <Clock className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">History</TooltipContent>
                </Tooltip>
                <span className="flex-1" />
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  onClick={() => setShowFiles(false)}
                  title="Hide panel"
                  aria-label="Hide panel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {sidebarView === 'history' ? (
                <SessionHistory
                  sessions={gw.sessions}
                  onOpenSession={(session) => {
                    // Build correct sessionKey from session metadata (works for desktop, telegram, whatsapp)
                    const channel = session.channel || 'desktop';
                    const chatType = session.chatType || 'dm';
                    const chatId = session.chatId || session.id;
                    const sk = `${channel}:${chatType}:${chatId}`;
                    // Check if already open in a tab
                    const existing = tabState.tabs.find(t =>
                      isChatTab(t) && ((t as any).sessionId === session.id || t.sessionKey === sk)
                    );
                    if (existing) {
                      tabState.focusTab(existing.id);
                      return;
                    }
                    // Open new chat tab and load session
                    const tab = {
                      id: `chat:${sk}`,
                      type: 'chat' as const,
                      label: session.name || session.preview || session.id.slice(0, 12),
                      closable: true as const,
                      chatId,
                      sessionKey: sk,
                      sessionId: session.id,
                      channel,
                    };
                    tabState.openSessionTab(tab);
                  }}
                  onDeleteSession={async (sessionId) => {
                    await gw.rpc('sessions.delete', { sessionId });
                    gw.refreshSessions();
                    // Close the tab if this session is currently open
                    const openTab = tabState.tabs.find(t =>
                      isChatTab(t) && (t as any).sessionId === sessionId
                    );
                    if (openTab) tabState.closeTab(openTab.id);
                  }}
                />
              ) : (
                <FileExplorer
                  rpc={gw.rpc}
                  connected={gw.connectionState === 'connected' || gw.connectionState === 'degraded'}
                  onFileClick={(path) => tabState.openFileTab(path)}
                  onOpenDiff={(opts) => tabState.openDiffTab(opts)}
                  onOpenPr={(repoRoot, prNumber, title) => tabState.openPrTab(repoRoot, prNumber, title)}
                  onFileChange={gw.onFileChange}
                  onOpenTerminal={(cwd) => tabState.openTerminalTab(cwd)}
                  mode={sidebarView as 'files' | 'git'}
                  initialViewRoot={fileExplorerStateRef.current.viewRoot || undefined}
                  initialExpanded={fileExplorerStateRef.current.expanded}
                  initialSelectedPath={fileExplorerStateRef.current.selectedPath}
                  onStateChange={(s) => {
                    fileExplorerStateRef.current = s;
                    try { localStorage.setItem('dorabot:explorerState', JSON.stringify(s)); } catch { /* quota */ }
                  }}
                />
              )}
            </>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
      <ToastContainer />
    </TooltipProvider>
  );
}
