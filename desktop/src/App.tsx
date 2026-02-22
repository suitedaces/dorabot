import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { dorabotImg, whatsappImg, telegramImg } from './assets';
import { useGateway, type NotifiableEvent } from './hooks/useGateway';
import { useTabs, isChatTab } from './hooks/useTabs';
import type { Tab, TabType } from './hooks/useTabs';
import { useLayout } from './hooks/useLayout';
import { useTheme } from './hooks/useTheme';
import type { GroupId } from './hooks/useLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { EditorGroupPanel } from './components/EditorGroupPanel';
import { TabDragOverlay } from './components/TabBar';
import { FileExplorer } from './components/FileExplorer';
import { Progress } from './components/Progress';
import { OnboardingOverlay } from './components/Onboarding';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Toaster, toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MessageSquare, Radio, Zap, Brain, Settings2,
  Sparkles, LayoutGrid, Loader2, Star,
  Sun, Moon, Clock, FileSearch, Plug, Folder, FolderOpen, X,
  ShieldAlert, CalendarCheck, Target, FlaskConical, KeyRound
} from 'lucide-react';

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
  { id: 'goals', label: 'Goals', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { id: 'research', label: 'Research', icon: <FileSearch className="w-3.5 h-3.5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings2 className="w-3.5 h-3.5" /> },
];

const SECONDARY_NAV_ITEMS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'channels', label: 'Channels', icon: <Radio className="w-3.5 h-3.5" /> },
  { id: 'automation', label: 'Automations', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'extensions', label: 'Extensions', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { id: 'memory', label: 'Memory', icon: <Brain className="w-3.5 h-3.5" /> },
];

const ALL_NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...SECONDARY_NAV_ITEMS];

export default function App() {
  const [showFiles, setShowFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
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
  const { theme, toggle: toggleTheme } = useTheme();
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [sessionToDelete, setSessionToDelete] = useState<(typeof gw.sessions)[number] | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
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

  // keep dense side panes collapsed on smaller windows
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1200) {
        setShowFiles(false);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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
    if (gw.connectionState === 'connected' && gw.providerInfo && !onboardingCheckedRef.current) {
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
    if (gw.connectionState === 'disconnected') {
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
        case 'goals.update':
          if (!allowPing('goals.update')) break;
          toast('Goals updated', {
            icon: <Target className="w-4 h-4 text-orange-400" />,
            duration: 4000,
            action: {
              label: 'View',
              onClick: () => tabState.openTab({ id: 'view:goals', type: 'goals', label: 'Goals', closable: true }),
            },
          });
          if (!windowFocused) {
            notify('goals updated');
            playNotifSound();
          }
          break;
        case 'research.update':
          if (!allowPing('research.update')) break;
          toast('Research updated', {
            icon: <FlaskConical className="w-4 h-4 text-purple-400" />,
            duration: 4000,
            action: {
              label: 'View',
              onClick: () => tabState.openTab({ id: 'view:research', type: 'research', label: 'Research', closable: true }),
            },
          });
          if (!windowFocused) {
            notify('research updated');
            playNotifSound();
          }
          break;
        case 'auth.required':
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
  }, [gw.onNotifiableEventRef, notify, tabState]);

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
    const label = session?.senderName || session?.preview || sessionId.slice(8, 16);

    tabState.openChatTab({
      sessionId,
      sessionKey,
      chatId: cid,
      channel: ch,
      label,
    });
  }, [gw.sessions, tabState]);

  const handleConfirmDeleteSession = useCallback(async () => {
    if (!sessionToDelete || deletingSession) return;
    setDeletingSession(true);
    try {
      const sessionKey = `${sessionToDelete.channel || 'desktop'}:${sessionToDelete.chatType || 'dm'}:${sessionToDelete.chatId || sessionToDelete.id}`;

      const tabsToClose = tabState.tabs
        .filter(t => isChatTab(t) && (t.sessionId === sessionToDelete.id || t.sessionKey === sessionKey))
        .map(t => t.id);
      for (const tabId of tabsToClose) tabState.closeTab(tabId);

      const result = await gw.deleteSession(sessionToDelete.id);
      if (!result?.deleted) {
        throw new Error('Session was not deleted.');
      }

      // Drop in-memory routing for this chat so new traffic starts a fresh session.
      if (sessionToDelete.chatId) {
        try {
          await gw.rpc('sessions.reset', {
            channel: sessionToDelete.channel || 'desktop',
            chatId: sessionToDelete.chatId,
          });
        } catch {
          // best-effort cleanup only
        }
      }

      toast.success('Session closed', {
        description: `${sessionToDelete.senderName || sessionToDelete.chatId || sessionToDelete.id.slice(0, 8)} removed from history.`,
      });
      setSessionToDelete(null);
    } catch (err) {
      toast.error('Failed to close session', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeletingSession(false);
    }
  }, [sessionToDelete, deletingSession, tabState, gw]);

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
    } else {
      tabState.openViewTab(navId, ALL_NAV_ITEMS.find(n => n.id === navId)?.label || navId);
    }
    setSelectedFile(null);
  }, [tabState, gw.sessionStates]);

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
    toggleFiles: () => setShowFiles(f => !f),
    openSettings: () => handleNavClick('settings'),
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
    splitHorizontal: () => layout.splitHorizontal(),
    splitVertical: () => layout.splitVertical(),
    splitGrid: () => layout.splitGrid(),
    resetLayout: () => layout.resetToSingle(),
    focusGroupLeft: () => { focusInputOnGroupSwitch.current = true; layout.focusGroupDirection('left'); },
    focusGroupRight: () => { focusInputOnGroupSwitch.current = true; layout.focusGroupDirection('right'); },
    focusGroupUp: () => { focusInputOnGroupSwitch.current = true; layout.focusGroupDirection('up'); },
    focusGroupDown: () => { focusInputOnGroupSwitch.current = true; layout.focusGroupDirection('down'); },
  }), [tabState, gw, handleNavClick, layout]);

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
    const sourceGroupId = active.data.current?.sourceGroupId as GroupId | undefined;
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
      const targetGroupId = over.data.current?.groupId as GroupId;
      if (sourceGroupId && targetGroupId && sourceGroupId !== targetGroupId) {
        layout.moveTabToGroup(tabId, sourceGroupId, targetGroupId);
        syncAfterMove(tabId);
      }
      return;
    }

    // Dropped on a panel drop zone — split or move
    if (overId.startsWith('panel-split:')) {
      const targetGroupId = over.data.current?.panelGroupId as GroupId;
      const zone = over.data.current?.splitZone as string;
      if (!sourceGroupId || !targetGroupId || !zone) return;

      // Center zone = move tab to this group (no split)
      if (zone === 'center') {
        if (sourceGroupId !== targetGroupId) {
          layout.moveTabToGroup(tabId, sourceGroupId, targetGroupId);
          syncAfterMove(tabId);
        }
        return;
      }

      // Edge zones = split in that direction, move tab to new group
      if (zone === 'left' || zone === 'right') {
        layout.splitHorizontal();
        // After split, determine which group the tab should end up in
        // splitHorizontal: single→2-col (g0,g1), 2-row→2x2 (g0,g1,g2,g3)
        const newGroupId = layout.mode === 'single'
          ? (zone === 'right' ? 'g1' : 'g0') as GroupId
          : layout.mode === '2-row'
            ? (targetGroupId === 'g0'
              ? (zone === 'right' ? 'g1' : 'g0')
              : (zone === 'right' ? 'g3' : 'g2')) as GroupId
            : targetGroupId; // already 2-col or 2x2, can't split further
        if (newGroupId !== sourceGroupId) {
          setTimeout(() => layout.moveTabToGroup(tabId, sourceGroupId, newGroupId), 0);
        }
      } else {
        layout.splitVertical();
        const newGroupId = layout.mode === 'single'
          ? (zone === 'bottom' ? 'g1' : 'g0') as GroupId
          : layout.mode === '2-col'
            ? (targetGroupId === 'g0'
              ? (zone === 'bottom' ? 'g2' : 'g0')
              : (zone === 'bottom' ? 'g3' : 'g1')) as GroupId
            : targetGroupId;
        if (newGroupId !== sourceGroupId) {
          setTimeout(() => layout.moveTabToGroup(tabId, sourceGroupId, newGroupId), 0);
        }
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
    selectedFile,
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
    onClearSelectedFile: () => setSelectedFile(null),
    onSetupChat: (prompt: string) => {
      const created = tabState.newChatTab(groupId);
      setTimeout(() => gw.sendMessage(prompt, created.sessionKey, created.chatId), 0);
    },
    onNavClick: (navId: string) => handleNavClick(navId as TabType),
  }), [tabState, gw, selectedFile, selectedChannel, layout, handleNavClick, handleViewSession, draggingTab]);

  const renderLayout = () => {
    const { visibleGroups, mode, activeGroupId } = layout;

    if (mode === 'single') {
      return (
        <EditorGroupPanel
          group={visibleGroups[0]}
          isActive={true}
          {...groupPanelProps(visibleGroups[0].id)}
        />
      );
    }

    if (mode === '2-col') {
      return (
        <ResizablePanelGroup key="2-col" orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="50%" minSize="20%">
            <EditorGroupPanel
              group={visibleGroups[0]}
              isActive={activeGroupId === visibleGroups[0].id}
              {...groupPanelProps(visibleGroups[0].id)}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="50%" minSize="20%">
            <EditorGroupPanel
              group={visibleGroups[1]}
              isActive={activeGroupId === visibleGroups[1].id}
              {...groupPanelProps(visibleGroups[1].id)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }

    if (mode === '2-row') {
      return (
        <ResizablePanelGroup key="2-row" orientation="vertical" className="h-full">
          <ResizablePanel defaultSize="50%" minSize="20%">
            <EditorGroupPanel
              group={visibleGroups[0]}
              isActive={activeGroupId === visibleGroups[0].id}
              {...groupPanelProps(visibleGroups[0].id)}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="50%" minSize="20%">
            <EditorGroupPanel
              group={visibleGroups[1]}
              isActive={activeGroupId === visibleGroups[1].id}
              {...groupPanelProps(visibleGroups[1].id)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }

    // 2x2
    return (
      <ResizablePanelGroup key="2x2" orientation="horizontal" className="h-full">
        <ResizablePanel defaultSize="50%" minSize="20%">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="50%" minSize="20%">
              <EditorGroupPanel
                group={visibleGroups[0]}
                isActive={activeGroupId === visibleGroups[0].id}
                {...groupPanelProps(visibleGroups[0].id)}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="50%" minSize="20%">
              <EditorGroupPanel
                group={visibleGroups[2]}
                isActive={activeGroupId === visibleGroups[2].id}
                {...groupPanelProps(visibleGroups[2].id)}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50%" minSize="20%">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="50%" minSize="20%">
              <EditorGroupPanel
                group={visibleGroups[1]}
                isActive={activeGroupId === visibleGroups[1].id}
                {...groupPanelProps(visibleGroups[1].id)}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="50%" minSize="20%">
              <EditorGroupPanel
                group={visibleGroups[3]}
                isActive={activeGroupId === visibleGroups[3].id}
                {...groupPanelProps(visibleGroups[3].id)}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
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

      {/* titlebar — pure drag chrome */}
      <div className="h-11 bg-card glass border-b border-border flex items-center pl-[78px] pr-4 shrink-0" style={{ WebkitAppRegion: 'drag' } as any}>
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
        <button
          onClick={toggleTheme}
          className="ml-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {!layout.isMultiPane && (
          <button
            onClick={() => setShowFiles(v => !v)}
            className="ml-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title={showFiles ? 'Hide file explorer' : 'Show file explorer'}
            aria-label={showFiles ? 'Hide file explorer' : 'Show file explorer'}
          >
            {showFiles ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Update banner */}
      {updateState.status === 'available' && (
        <div className="shrink-0 px-4 py-1.5 bg-primary/10 border-b border-primary/20 flex items-center gap-2 text-xs">
          <span className="text-primary">Update {updateState.version} available</span>
          <button
            onClick={() => (window as any).electronAPI?.downloadUpdate?.()}
            className="ml-auto px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors"
          >
            Download
          </button>
          <button
            onClick={() => setUpdateState({ status: 'idle' })}
            className="text-muted-foreground hover:text-foreground text-[10px]"
          >
            Later
          </button>
        </div>
      )}
      {updateState.status === 'downloading' && (
        <div className="shrink-0 px-4 py-1.5 bg-primary/10 border-b border-primary/20 flex items-center gap-2 text-xs">
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
          <span className="text-primary">Downloading update... {updateState.percent != null ? `${updateState.percent}%` : ''}</span>
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

      {/* main layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* sidebar */}
        <ResizablePanel defaultSize="15%" minSize="10%" maxSize="25%" className="bg-card glass overflow-hidden">
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
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        className={`flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-[10px] transition-colors ${
                          isActive
                            ? 'bg-secondary text-foreground'
                            : isVisible
                            ? 'bg-secondary/60 text-foreground/80'
                            : 'text-muted-foreground hover:bg-secondary/50'
                        }`}
                        onClick={() => handleViewSession(s.id, s.channel, s.chatId, s.chatType)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleViewSession(s.id, s.channel, s.chatId, s.chatType);
                          }
                        }}
                        title={`${s.channel || 'desktop'} | ${s.messageCount} msgs | ${new Date(s.updatedAt).toLocaleString()}`}
                      >
                        <span className="w-3 h-3 shrink-0 flex items-center justify-center">{channelIcon(s.channel)}</span>
                        <span className="truncate flex-1 text-left">
                          {s.senderName || s.preview || s.chatId || s.id.slice(8, 16)}
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
                        <button
                          type="button"
                          className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-secondary/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={s.activeRun ? 'Cannot close while agent is running' : 'Close session'}
                          aria-label={s.activeRun ? 'Cannot close while agent is running' : 'Close session'}
                          disabled={!!s.activeRun}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (s.activeRun) return;
                            setSessionToDelete(s);
                          }}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
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

        {/* file explorer — only in single-pane mode */}
        {showFiles && !layout.isMultiPane && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="30%" minSize="15%" maxSize="45%" className="overflow-hidden flex flex-col">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="text-xs font-medium text-muted-foreground">Explorer</div>
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  onClick={() => setShowFiles(false)}
                  title="Hide file explorer"
                  aria-label="Hide file explorer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <Progress items={gw.progress} />
              <FileExplorer
                rpc={gw.rpc}
                connected={gw.connectionState === 'connected'}
                onFileClick={setSelectedFile}
                onFileChange={gw.onFileChange}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <AlertDialog
        open={!!sessionToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingSession) setSessionToDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Close this session?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              This will remove the session from saved history.
            </AlertDialogDescription>
            {sessionToDelete && (
              <div className="w-full rounded border border-border bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground">
                {sessionToDelete.senderName || sessionToDelete.chatId || sessionToDelete.id.slice(0, 12)}
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-7 text-xs" disabled={deletingSession}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-7 text-xs"
              variant="destructive"
              disabled={deletingSession}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDeleteSession();
              }}
            >
              {deletingSession ? 'Closing...' : 'Close session'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
