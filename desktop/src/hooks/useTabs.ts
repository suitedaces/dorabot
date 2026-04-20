import { useState, useCallback, useEffect, useRef } from 'react';
import type { useGateway } from './useGateway';
import type { useLayout, GroupId } from './useLayout';

export type TabType = 'chat' | 'channels' | 'goals' | 'automation' | 'extensions' | 'agents' | 'memory' | 'research' | 'settings' | 'file' | 'diff' | 'terminal' | 'task' | 'pr' | 'browser';

export type ChatTab = {
  id: string;
  type: 'chat';
  label: string;
  closable: true;
  sessionKey: string;
  chatId: string;
  channel?: string;
  sessionId?: string;
};

export type FileTab = {
  id: string;
  type: 'file';
  label: string;
  closable: true;
  filePath: string;
};

export type DiffTab = {
  id: string;
  type: 'diff';
  label: string;
  closable: true;
  filePath: string;
  oldContent: string;
  newContent: string;
  isImage?: boolean;
};

export type TerminalTab = {
  id: string;
  type: 'terminal';
  label: string;
  closable: true;
  shellId: string;
  cwd?: string;
};

export type TaskTab = {
  id: string;
  type: 'task';
  label: string;
  closable: true;
  taskId: string;
};

export type PrTab = {
  id: string;
  type: 'pr';
  label: string;
  closable: true;
  repoRoot: string;
  prNumber: number;
};

export type BrowserTab = {
  id: string;
  type: 'browser';
  label: string;
  closable: true;
  /** Assigned by BrowserController once the WebContentsView is created. */
  pageId?: string;
  url?: string;
};

export type ViewTab = {
  id: string;
  type: Exclude<TabType, 'chat' | 'file' | 'diff' | 'terminal' | 'task' | 'pr' | 'browser'>;
  label: string;
  closable: true;
};

export type Tab = ChatTab | ViewTab | FileTab | DiffTab | TerminalTab | TaskTab | PrTab | BrowserTab;

export function isChatTab(tab: Tab): tab is ChatTab {
  return tab.type === 'chat';
}

export function isFileTab(tab: Tab): tab is FileTab {
  return tab.type === 'file';
}

export function isDiffTab(tab: Tab): tab is DiffTab {
  return tab.type === 'diff';
}

export function isTerminalTab(tab: Tab): tab is TerminalTab {
  return tab.type === 'terminal';
}

export function isTaskTab(tab: Tab): tab is TaskTab {
  return tab.type === 'task';
}

export function isPrTab(tab: Tab): tab is PrTab {
  return tab.type === 'pr';
}

export function isBrowserTab(tab: Tab): tab is BrowserTab {
  return tab.type === 'browser';
}

const TABS_STORAGE_KEY = 'dorabot:tabs';
const ACTIVE_TAB_STORAGE_KEY = 'dorabot:activeTabId';

function makeDefaultChatTab(): ChatTab {
  const chatId = crypto.randomUUID();
  return {
    id: `chat:${chatId}`,
    type: 'chat',
    label: 'new task',
    closable: true,
    sessionKey: `desktop:dm:${chatId}`,
    chatId,
  };
}

function loadTabsFromStorage(): Tab[] {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Tab[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed
      // Terminal tabs are kept; TerminalView re-spawns/reclaims the shell on mount.
      // Browser tabs drop their stale pageId — BrowserView recreates the WebContentsView on mount.
      .map((tab) => {
        if ((tab as any).type === 'plans' || (tab as any).type === 'ideas' || (tab as any).type === 'roadmap') {
          return {
            ...(tab as any),
            id: 'view:goals',
            type: 'goals',
            label: 'Projects',
          } as Tab;
        }
        // Migrate old "Goals" label
        if ((tab as any).type === 'goals' && (tab as any).label === 'Goals') {
          return { ...tab, label: 'Projects' } as Tab;
        }
        if ((tab as any).type === 'browser') {
          const { pageId, ...rest } = tab as BrowserTab;
          return rest as Tab;
        }
        return tab;
      });
  } catch {
    return [];
  }
}

function loadActiveTabIdFromStorage(): string | null {
  const value = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  if (value === 'view:plans' || value === 'view:ideas' || value === 'view:roadmap') return 'view:goals';
  return value;
}

export function useTabs(gw: ReturnType<typeof useGateway>, layout: ReturnType<typeof useLayout>) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const stored = loadTabsFromStorage();
    return stored.length > 0 ? stored : [makeDefaultChatTab()];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const stored = loadActiveTabIdFromStorage();
    const loadedTabs = loadTabsFromStorage();
    if (stored && loadedTabs.some(t => t.id === stored)) return stored;
    return loadedTabs[0]?.id || tabs[0]?.id || '';
  });

  const initializedRef = useRef(false);
  const migratedRef = useRef(false);
  const closingRef = useRef(0);
  const subscribedSessionKeysRef = useRef<Set<string>>(new Set());
  const streamCountRef = useRef<Record<string, number>>({});
  const [unreadBySession, setUnreadBySession] = useState<Record<string, number>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());

  const setTabDirty = useCallback((tabId: string, dirty: boolean) => {
    setDirtyTabs(prev => {
      const next = new Set(prev);
      if (dirty) next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  }, []);

  // Migrate: if layout groups are empty but we have tabs, put them all in g0
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;

    const firstPane = layout.groups[0];
    const allGroupTabIds = layout.groups.flatMap(g => g.tabIds);
    if (firstPane && allGroupTabIds.length === 0 && tabs.length > 0) {
      // Old state: tabs exist but no group assignments
      for (const tab of tabs) {
        layout.addTabToGroup(tab.id, firstPane.id);
      }
      const active = tabs.find(t => t.id === activeTabId) || tabs[0];
      if (active) {
        layout.setGroupActiveTab(firstPane.id, active.id);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On first connect, register all chat tabs with the gateway
  useEffect(() => {
    if (gw.connectionState !== 'connected' || initializedRef.current) return;
    initializedRef.current = true;

    const openSessionKeys = new Set<string>();
    for (const tab of tabs) {
      if (!isChatTab(tab)) continue;
      openSessionKeys.add(tab.sessionKey);
      gw.trackSession(tab.sessionKey);
      if (tab.sessionId) gw.loadSessionIntoMap(tab.sessionId, tab.sessionKey, tab.chatId);
    }
    subscribedSessionKeysRef.current = openSessionKeys;

    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && isChatTab(activeTab)) {
      gw.setActiveSession(activeTab.sessionKey, activeTab.chatId);
    }
  }, [gw.connectionState, tabs, gw, activeTabId]);

  useEffect(() => {
    if (gw.connectionState === 'disconnected') {
      initializedRef.current = false;
      subscribedSessionKeysRef.current.clear();
    }
  }, [gw.connectionState]);

  // Keep subscriptions aligned with all currently open chat tabs.
  useEffect(() => {
    if (gw.connectionState !== 'connected') return;

    const openSessionKeys = new Set<string>();
    for (const tab of tabs) {
      if (!isChatTab(tab)) continue;
      openSessionKeys.add(tab.sessionKey);
    }

    const prev = subscribedSessionKeysRef.current;
    for (const sk of openSessionKeys) {
      if (!prev.has(sk)) gw.trackSession(sk);
    }
    for (const sk of prev) {
      if (!openSessionKeys.has(sk)) gw.untrackSession(sk);
    }
    subscribedSessionKeysRef.current = openSessionKeys;
  }, [gw.connectionState, tabs, gw]);

  // Recover chat tabs that were persisted without sessionId (e.g. refresh mid-run).
  // Once sessions.list arrives, map by sessionKey/chatId and hydrate history.
  useEffect(() => {
    if (gw.connectionState !== 'connected' || gw.sessions.length === 0) return;

    const recoveries: Array<{ tabId: string; sessionId: string; sessionKey: string; chatId: string }> = [];
    for (const tab of tabs) {
      if (!isChatTab(tab) || tab.sessionId) continue;
      const [channel = 'desktop', chatType = 'dm', ...rest] = tab.sessionKey.split(':');
      const chatId = rest.join(':') || tab.chatId;
      const match = gw.sessions.find(s =>
        (s.channel || 'desktop') === channel &&
        (s.chatType || 'dm') === chatType &&
        s.chatId === chatId
      );
      if (match?.id) {
        recoveries.push({ tabId: tab.id, sessionId: match.id, sessionKey: tab.sessionKey, chatId: tab.chatId });
      }
    }

    if (recoveries.length === 0) return;

    setTabs(prev => prev.map(tab => {
      if (!isChatTab(tab) || tab.sessionId) return tab;
      const found = recoveries.find(r => r.tabId === tab.id);
      return found ? { ...tab, sessionId: found.sessionId } : tab;
    }));

    for (const r of recoveries) {
      gw.loadSessionIntoMap(r.sessionId, r.sessionKey, r.chatId);
    }
  }, [gw.connectionState, gw.sessions, gw, tabs]);

  // Listen for sessionId changes from gateway
  useEffect(() => {
    gw.onSessionIdChangeRef.current = (sessionKey: string, sessionId: string) => {
      setTabs(prev => prev.map(tab => {
        if (isChatTab(tab) && tab.sessionKey === sessionKey && !tab.sessionId) {
          return { ...tab, sessionId };
        }
        return tab;
      }));
    };
    return () => {
      gw.onSessionIdChangeRef.current = null;
    };
  }, [gw.onSessionIdChangeRef]);

  // Update tab label with first message preview
  useEffect(() => {
    gw.onFirstMessageRef.current = (sessionKey: string, preview: string) => {
      setTabs(prev => prev.map(tab => {
        if (isChatTab(tab) && tab.sessionKey === sessionKey && tab.label === 'new task') {
          return { ...tab, label: preview };
        }
        return tab;
      }));
    };
    return () => {
      gw.onFirstMessageRef.current = null;
    };
  }, [gw.onFirstMessageRef]);

  // Persist tabs
  useEffect(() => {
    // Strip large content from diff/terminal tabs before persisting
    const serializable = tabs.map(t => {
      if (t.type === 'diff') return { ...t, oldContent: '', newContent: '' };
      if (t.type === 'terminal') return { ...t }; // shellId preserved; TerminalView reclaims on mount
      return t;
    });
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(serializable));
    } catch { /* quota exceeded, ignore */ }
  }, [tabs]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
  }, [activeTabId]);

  // Invariant: always have at least one tab, and the active group should have
  // something renderable.  For empty panes in multi-pane mode, the fill-empty
  // effect below handles creating new tabs, so we only act here for the
  // single-pane / zero-tabs case.
  useEffect(() => {
    if (tabs.length === 0) {
      const fallback = makeDefaultChatTab();
      setTabs([fallback]);
      setActiveTabId(fallback.id);
      gw.trackSession(fallback.sessionKey);
      gw.setActiveSession(fallback.sessionKey, fallback.chatId);
      if (layout.isMultiPane) layout.resetToSingle();
      layout.addTabToGroup(fallback.id, layout.groups[0]?.id);
      return;
    }

    // In multi-pane mode, let the fill-empty effect handle empty groups
    // instead of stealing a tab from another pane (which causes duplication).
    if (layout.isMultiPane) return;

    const visibleGroup = layout.visibleGroups[0];
    if (!visibleGroup) return;

    const tabIds = new Set(tabs.map(t => t.id));
    const hasRenderableTab = visibleGroup.tabIds.some(id => tabIds.has(id));
    if (hasRenderableTab) return;

    // Single-pane: safe to assign tabs[0] since there's only one pane
    const fallback = tabs[0];
    if (!fallback) return;
    layout.addTabToGroup(fallback.id, visibleGroup.id);
    layout.setGroupActiveTab(visibleGroup.id, fallback.id);
    setActiveTabId(fallback.id);
    if (isChatTab(fallback)) {
      gw.setActiveSession(fallback.sessionKey, fallback.chatId);
    }
  }, [tabs, layout, gw]);

  // Reactively fill empty visible groups with new tabs (handles splits)
  // Runs after render with fresh state — no stale closure issues
  useEffect(() => {
    // skip during closeTab — collapse will remove the empty group
    if (closingRef.current > 0) {
      closingRef.current--;
      return;
    }
    if (!layout.isMultiPane) return;
    const emptyGroups = layout.visibleGroups.filter(g => g.tabIds.length === 0);
    if (emptyGroups.length === 0) return;

    const newTabs: ChatTab[] = [];
    for (const group of emptyGroups) {
      const { sessionKey, chatId } = gw.newSession();
      const tab: ChatTab = {
        id: `chat:${chatId}`,
        type: 'chat',
        label: 'new task',
        closable: true,
        sessionKey,
        chatId,
      };
      newTabs.push(tab);
      // Ensure streams/events for auto-created split panes are subscribed immediately.
      gw.trackSession(tab.sessionKey);
      layout.addTabToGroup(tab.id, group.id);
    }
    setTabs(prev => [...prev, ...newTabs]);
  }, [layout.visibleGroups, layout.isMultiPane, layout.addTabToGroup, gw]);

  // Derive activeTab from the active group's activeTabId
  const activeGroup = layout.groups.find(g => g.id === layout.activeGroupId) || layout.groups[0];
  const activeTab = tabs.find(t => t.id === (activeGroup?.activeTabId || activeTabId)) || tabs[0];

  const openTab = useCallback((tab: Tab, groupId?: GroupId) => {
    setTabs(prev => {
      const existing = prev.find(t => t.id === tab.id);
      if (existing) return prev;
      return [...prev, tab];
    });
    setActiveTabId(tab.id);
    layout.addTabToGroup(tab.id, groupId);

    if (isChatTab(tab)) {
      gw.trackSession(tab.sessionKey);
      gw.setActiveSession(tab.sessionKey, tab.chatId);
      if (tab.sessionId) {
        gw.loadSessionIntoMap(tab.sessionId, tab.sessionKey, tab.chatId);
      }
    }
  }, [gw, layout]);

  const focusTab = useCallback((tabId: string, groupId?: GroupId) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);

    // Update group's active tab and switch focus to that group
    const ownerGroup = groupId || layout.findGroupForTab(tabId) || layout.activeGroupId;
    layout.setGroupActiveTab(ownerGroup, tabId);
    layout.focusGroup(ownerGroup);

    if (isChatTab(tab)) {
      gw.setActiveSession(tab.sessionKey, tab.chatId);
      setUnreadBySession(prev => {
        if (!prev[tab.sessionKey]) return prev;
        const { [tab.sessionKey]: _, ...rest } = prev;
        return rest;
      });
    }
  }, [tabs, gw, layout]);

  const closeTab = useCallback((tabId: string) => {
    // Warn if tab has unsaved changes
    if (dirtyTabs.has(tabId)) {
      if (!window.confirm('You have unsaved changes. Close anyway?')) return;
    }

    closingRef.current++;

    // Remove from layout group (reads current state, queues layout update)
    const { groupId, neighborTabId } = layout.removeTabFromGroup(tabId);

    // Untrack from gateway
    const closing = tabs.find(t => t.id === tabId);
    if (closing && isChatTab(closing)) {
      gw.untrackSession(closing.sessionKey);
      setUnreadBySession(prev => {
        if (!prev[closing.sessionKey]) return prev;
        const { [closing.sessionKey]: _, ...rest } = prev;
        return rest;
      });
    }
    // Kill shell process for terminal tabs
    if (closing && isTerminalTab(closing)) {
      gw.rpc('shell.kill', { shellId: closing.shellId }).catch(() => {});
    }
    // Tear down WebContentsView for browser tabs
    if (closing && isBrowserTab(closing) && closing.pageId) {
      try { window.electronAPI?.browser?.destroy(closing.pageId); } catch {}
    }

    const remainingTabs = tabs.filter(t => t.id !== tabId);

    // Always keep at least one tab and avoid side effects inside setState updaters.
    if (remainingTabs.length === 0) {
      const fallback = makeDefaultChatTab();
      gw.trackSession(fallback.sessionKey);
      gw.setActiveSession(fallback.sessionKey, fallback.chatId);
      setTabs([fallback]);
      setActiveTabId(fallback.id);
      if (layout.isMultiPane) layout.resetToSingle();
      layout.addTabToGroup(fallback.id, layout.groups[0]?.id);
      return;
    }

    setTabs(remainingTabs);

    // Handle focus and layout after close
    if (!neighborTabId) {
      if (layout.isMultiPane) {
        // Snapshot surviving groups and their active tabs BEFORE collapse
        // (layout.groups is stale after collapseGroup queues setState).
        const remainingGroupTabs = new Map<string, string | null>();
        for (const g of layout.groups) {
          if (g.id !== groupId && g.tabIds.length > 0) {
            remainingGroupTabs.set(g.id, g.activeTabId);
          }
        }

        // collapseGroup sets the correct activePaneId internally
        layout.collapseGroup(groupId);

        // Pick the tab to focus from our snapshot
        const preferredGroupId = layout.activeGroupId !== groupId ? layout.activeGroupId : null;
        const focusActiveTabId =
          (preferredGroupId && remainingGroupTabs.get(preferredGroupId))
          || remainingGroupTabs.values().next().value
          || null;
        if (focusActiveTabId) {
          const remTab = remainingTabs.find(t => t.id === focusActiveTabId);
          if (remTab) {
            setActiveTabId(remTab.id);
            if (isChatTab(remTab)) gw.setActiveSession(remTab.sessionKey, remTab.chatId);
          }
        }
      } else {
        // Single pane fallback: re-anchor the first remaining tab into this group.
        const fallback = remainingTabs[0];
        if (fallback) {
          layout.addTabToGroup(fallback.id, groupId);
          setActiveTabId(fallback.id);
          if (isChatTab(fallback)) {
            gw.setActiveSession(fallback.sessionKey, fallback.chatId);
          }
        }
      }
    } else if (tabId === activeTabId) {
      // Focus neighbor tab
      const neighbor = remainingTabs.find(t => t.id === neighborTabId);
      if (neighbor) {
        setActiveTabId(neighbor.id);
        if (isChatTab(neighbor)) {
          gw.setActiveSession(neighbor.sessionKey, neighbor.chatId);
        }
      }
    }
  }, [activeTabId, tabs, gw, layout]);

  const openChatTab = useCallback((opts: {
    sessionId?: string;
    sessionKey: string;
    chatId: string;
    channel?: string;
    label: string;
  }, groupId?: GroupId): string => {
    const existingTab = tabs.find(t =>
      isChatTab(t) && (
        (opts.sessionId && t.sessionId === opts.sessionId) ||
        t.sessionKey === opts.sessionKey
      )
    );

    if (existingTab) {
      focusTab(existingTab.id, groupId);
      return existingTab.id;
    }

    const tab: ChatTab = {
      id: `chat:${opts.chatId}`,
      type: 'chat',
      label: opts.label,
      closable: true,
      sessionKey: opts.sessionKey,
      chatId: opts.chatId,
      channel: opts.channel,
      sessionId: opts.sessionId,
    };

    openTab(tab, groupId);
    return tab.id;
  }, [tabs, focusTab, openTab]);

  const openViewTab = useCallback((type: Exclude<TabType, 'chat' | 'file' | 'diff' | 'terminal' | 'task' | 'pr' | 'browser'>, label: string, groupId?: GroupId) => {
    const id = `view:${type}`;
    const existing = tabs.find(t => t.id === id);
    if (existing) {
      focusTab(id, groupId);
      return;
    }

    const tab: ViewTab = {
      id,
      type,
      label,
      closable: true,
    };

    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    layout.addTabToGroup(id, groupId);
  }, [tabs, focusTab, layout]);

  const openFileTab = useCallback((filePath: string, groupId?: GroupId) => {
    const id = `file:${filePath}`;
    const existing = tabs.find(t => t.id === id);
    if (existing) {
      focusTab(id, groupId);
      return;
    }

    const label = filePath.split('/').pop() || filePath;
    const tab: FileTab = {
      id,
      type: 'file',
      label,
      closable: true,
      filePath,
    };

    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    layout.addTabToGroup(id, groupId);
  }, [tabs, focusTab, layout]);

  const openDiffTab = useCallback((opts: {
    filePath: string;
    oldContent: string;
    newContent: string;
    label?: string;
    isImage?: boolean;
  }, groupId?: GroupId) => {
    const id = `diff:${opts.filePath}:${Date.now()}`;
    const label = opts.label || `${opts.filePath.split('/').pop() || 'diff'} (diff)`;
    const tab: DiffTab = {
      id,
      type: 'diff',
      label,
      closable: true,
      filePath: opts.filePath,
      oldContent: opts.oldContent,
      newContent: opts.newContent,
      isImage: opts.isImage,
    };

    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    layout.addTabToGroup(id, groupId);
  }, [layout]);

  const openTerminalTab = useCallback((cwd?: string, groupId?: GroupId) => {
    const shellId = crypto.randomUUID();
    const id = `terminal:${shellId}`;
    const tab: TerminalTab = {
      id,
      type: 'terminal',
      label: 'Terminal',
      closable: true,
      shellId,
      cwd,
    };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    layout.addTabToGroup(id, groupId);
  }, [layout]);

  const openSessionTab = useCallback((tab: ChatTab, groupId?: GroupId) => {
    // Dedup inside updater to avoid stale-closure race on rapid double-click
    let existingId: string | null = null;
    setTabs(prev => {
      const existing = prev.find(t =>
        t.id === tab.id || (isChatTab(t) && tab.sessionId && (t as ChatTab).sessionId === tab.sessionId)
      );
      if (existing) {
        existingId = existing.id;
        return prev;
      }
      return [...prev, tab];
    });
    if (existingId) {
      focusTab(existingId, groupId);
      return;
    }
    gw.trackSession(tab.sessionKey);
    setActiveTabId(tab.id);
    layout.addTabToGroup(tab.id, groupId);
    gw.setActiveSession(tab.sessionKey, tab.chatId);
    // Load session history from server
    if (tab.sessionId) {
      gw.loadSessionIntoMap(tab.sessionId, tab.sessionKey, tab.chatId);
    }
  }, [focusTab, gw, layout]);

  const openBrowserTab = useCallback((url?: string, groupId?: GroupId) => {
    const id = `browser:${crypto.randomUUID()}`;
    const tab: BrowserTab = {
      id,
      type: 'browser',
      label: 'New Tab',
      closable: true,
      url,
    };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    layout.addTabToGroup(id, groupId);
    return id;
  }, [layout]);

  // Adopt a page the main process already created (e.g. agent-initiated)
  // into a UI tab. The tab starts with pageId pre-assigned so BrowserView
  // attaches to the existing WebContentsView instead of creating a new one.
  //
  // focus defaults to true for back-compat. Agent-created tabs pass focus:false
  // so the new tab appears silently in the tab bar without stealing the user's
  // current pane focus.
  //
  // preferSplit: when true AND layout is single-pane, split a new column to the
  // right and land the tab there (the user's pane stays focused). When the
  // layout is already multi-pane, the tab is placed in the active pane alongside
  // whatever the user is looking at — rule "pile into existing" avoids pane
  // proliferation.
  const adoptBrowserTab = useCallback((
    pageId: string,
    url?: string,
    label?: string,
    groupId?: GroupId,
    opts?: { focus?: boolean; preferSplit?: boolean },
  ) => {
    const focus = opts?.focus ?? true;
    const preferSplit = opts?.preferSplit ?? false;
    let fallbackLabel = 'New Tab';
    if (!label && url) {
      try { fallbackLabel = new URL(url).host; } catch {}
    }
    const id = `browser:${crypto.randomUUID()}`;
    const tab: BrowserTab = {
      id,
      type: 'browser',
      label: label || fallbackLabel,
      closable: true,
      pageId,
      url,
    };
    setTabs(prev => [...prev, tab]);
    if (focus) setActiveTabId(id);

    // Split a new column on the right when the layout is single-pane and no
    // target group was forced.  The tab becomes active *within* the new pane so
    // the WebContentsView paints there, but the user's original pane stays the
    // layout's active pane.
    if (preferSplit && !groupId && !layout.isMultiPane) {
      const newPaneId = layout.addColumnAt(layout.activeGroupId, 'right', { activate: false });
      layout.addTabToGroup(id, newPaneId, { activate: true });
    } else {
      layout.addTabToGroup(id, groupId, { activate: focus });
    }
    return id;
  }, [layout]);

  // Called by BrowserView once the WebContentsView is created and whenever
  // the controller emits tab-updated (url/title changes). Updates are in-memory
  // only; pageId is stripped when persisting tabs.
  const patchBrowserTab = useCallback((tabId: string, patch: Partial<Pick<BrowserTab, 'pageId' | 'url' | 'label'>>) => {
    setTabs(prev => prev.map(t => (t.id === tabId && isBrowserTab(t)) ? { ...t, ...patch } : t));
  }, []);

  const openTaskTab = useCallback((taskId: string, taskTitle: string, groupId?: GroupId) => {
    const id = `task:${taskId}`;
    const existing = tabs.find(t => t.id === id);
    if (existing) {
      focusTab(id, groupId);
      return;
    }
    const tab: TaskTab = {
      id,
      type: 'task',
      label: taskTitle,
      closable: true,
      taskId,
    };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    layout.addTabToGroup(id, groupId);
  }, [tabs, focusTab, layout]);

  const openPrTab = useCallback((repoRoot: string, prNumber: number, title: string, groupId?: GroupId) => {
    const id = `pr:${repoRoot}#${prNumber}`;
    const existing = tabs.find(t => t.id === id);
    if (existing) {
      focusTab(id, groupId);
      return;
    }

    const tab: PrTab = {
      id,
      type: 'pr',
      label: `#${prNumber} ${title}`.trim(),
      closable: true,
      repoRoot,
      prNumber,
    };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    layout.addTabToGroup(id, groupId);
  }, [tabs, focusTab, layout]);

  const newChatTab = useCallback((groupId?: GroupId): { tabId: string; sessionKey: string; chatId: string } => {
    const { sessionKey, chatId } = gw.newSession();
    const tab: ChatTab = {
      id: `chat:${chatId}`,
      type: 'chat',
      label: 'new task',
      closable: true,
      sessionKey,
      chatId,
    };

    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
    gw.trackSession(tab.sessionKey);
    layout.addTabToGroup(tab.id, groupId);
    return { tabId: tab.id, sessionKey, chatId };
  }, [gw, layout]);

  const closeOtherTabs = useCallback((tabId: string, groupId?: GroupId) => {
    const gid = groupId || layout.activeGroupId;
    const group = layout.groups.find(g => g.id === gid);
    if (!group) return;
    const toClose = new Set(group.tabIds.filter(id => id !== tabId));
    // Extract closing tabs inside updater, but do side effects after
    let closingTabs: Tab[] = [];
    setTabs(prev => {
      closingTabs = prev.filter(t => toClose.has(t.id) && t.closable);
      return prev.filter(t => !toClose.has(t.id) || !t.closable);
    });
    for (const tab of closingTabs) {
      if (isChatTab(tab)) gw.untrackSession(tab.sessionKey);
      if (isTerminalTab(tab)) gw.rpc('shell.kill', { shellId: tab.shellId }).catch(() => {});
      if (isBrowserTab(tab) && tab.pageId) { try { window.electronAPI?.browser?.destroy(tab.pageId); } catch {} }
      layout.removeTabFromGroup(tab.id, gid);
    }
    focusTab(tabId, gid);
  }, [layout, gw, focusTab]);

  const closeAllTabs = useCallback((groupId?: GroupId) => {
    const gid = groupId || layout.activeGroupId;
    const group = layout.groups.find(g => g.id === gid);
    if (!group) return;
    const toClose = new Set(group.tabIds);
    let closingTabs: Tab[] = [];
    const fallback: { tab: ChatTab | null } = { tab: null };
    setTabs(prev => {
      closingTabs = prev.filter(t => toClose.has(t.id) && t.closable);
      const remaining = prev.filter(t => !toClose.has(t.id) || !t.closable);
      if (remaining.length === 0) {
        fallback.tab = makeDefaultChatTab();
        return [fallback.tab];
      }
      return remaining;
    });
    for (const tab of closingTabs) {
      if (isChatTab(tab)) gw.untrackSession(tab.sessionKey);
      if (isTerminalTab(tab)) gw.rpc('shell.kill', { shellId: tab.shellId }).catch(() => {});
      if (isBrowserTab(tab) && tab.pageId) { try { window.electronAPI?.browser?.destroy(tab.pageId); } catch {} }
      layout.removeTabFromGroup(tab.id, gid);
    }
    if (fallback.tab) {
      gw.trackSession(fallback.tab.sessionKey);
      gw.setActiveSession(fallback.tab.sessionKey, fallback.tab.chatId);
      layout.addTabToGroup(fallback.tab.id, gid);
    }
  }, [layout, gw]);

  const closeTabsToRight = useCallback((tabId: string, groupId?: GroupId) => {
    const gid = groupId || layout.activeGroupId;
    const group = layout.groups.find(g => g.id === gid);
    if (!group) return;
    const idx = group.tabIds.indexOf(tabId);
    if (idx < 0) return;
    const toClose = new Set(group.tabIds.slice(idx + 1));
    let closingTabs: Tab[] = [];
    setTabs(prev => {
      closingTabs = prev.filter(t => toClose.has(t.id) && t.closable);
      return prev.filter(t => !toClose.has(t.id) || !t.closable);
    });
    for (const tab of closingTabs) {
      if (isChatTab(tab)) gw.untrackSession(tab.sessionKey);
      if (isTerminalTab(tab)) gw.rpc('shell.kill', { shellId: tab.shellId }).catch(() => {});
      if (isBrowserTab(tab) && tab.pageId) { try { window.electronAPI?.browser?.destroy(tab.pageId); } catch {} }
      layout.removeTabFromGroup(tab.id, gid);
    }
    focusTab(tabId, gid);
  }, [layout, gw, focusTab]);

  const updateTabLabel = useCallback((tabId: string, label: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, label } : t));
  }, []);

  // Next/prev within the active group's tabs
  const nextTab = useCallback(() => {
    const group = layout.groups.find(g => g.id === layout.activeGroupId);
    if (!group) return;
    const groupTabs = group.tabIds.map(id => tabs.find(t => t.id === id)).filter(Boolean) as Tab[];
    const idx = groupTabs.findIndex(t => t.id === group.activeTabId);
    const next = groupTabs[(idx + 1) % groupTabs.length];
    if (next) focusTab(next.id, group.id);
  }, [tabs, layout, focusTab]);

  const prevTab = useCallback(() => {
    const group = layout.groups.find(g => g.id === layout.activeGroupId);
    if (!group) return;
    const groupTabs = group.tabIds.map(id => tabs.find(t => t.id === id)).filter(Boolean) as Tab[];
    const idx = groupTabs.findIndex(t => t.id === group.activeTabId);
    const prev = groupTabs[(idx - 1 + groupTabs.length) % groupTabs.length];
    if (prev) focusTab(prev.id, group.id);
  }, [tabs, layout, focusTab]);

  const focusTabByIndex = useCallback((index: number) => {
    const group = layout.groups.find(g => g.id === layout.activeGroupId);
    if (!group) return;
    const groupTabs = group.tabIds.map(id => tabs.find(t => t.id === id)).filter(Boolean) as Tab[];
    const target = index >= groupTabs.length ? groupTabs[groupTabs.length - 1] : groupTabs[index];
    if (target) focusTab(target.id, group.id);
  }, [tabs, layout, focusTab]);

  // Track unread counts for chat tabs not currently visible as active pane tabs.
  useEffect(() => {
    const visibleActiveTabIds = new Set(
      layout.visibleGroups.map(g => g.activeTabId).filter((id): id is string => Boolean(id)),
    );
    const nextCounts = { ...streamCountRef.current };
    const deltas: Record<string, number> = {};

    for (const tab of tabs) {
      if (!isChatTab(tab)) continue;
      const sk = tab.sessionKey;
      const current = gw.sessionStates[sk]?.chatItems.length || 0;
      const previous = nextCounts[sk];
      if (previous == null) {
        nextCounts[sk] = current;
        continue;
      }
      if (current > previous && !visibleActiveTabIds.has(tab.id)) {
        deltas[sk] = (deltas[sk] || 0) + (current - previous);
      }
      nextCounts[sk] = current;
    }

    // remove sessions for tabs that no longer exist
    const liveSessionKeys = new Set(tabs.filter(isChatTab).map(t => t.sessionKey));
    for (const sk of Object.keys(nextCounts)) {
      if (!liveSessionKeys.has(sk)) delete nextCounts[sk];
    }
    streamCountRef.current = nextCounts;

    if (Object.keys(deltas).length === 0) return;
    setUnreadBySession(prev => {
      const next = { ...prev };
      for (const [sk, add] of Object.entries(deltas)) {
        next[sk] = (next[sk] || 0) + add;
      }
      return next;
    });
  }, [gw.sessionStates, tabs, layout.visibleGroups]);

  return {
    tabs,
    activeTabId,
    activeTab,
    openTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeTabsToRight,
    focusTab,
    openChatTab,
    openViewTab,
    openFileTab,
    openDiffTab,
    openTerminalTab,
    openBrowserTab,
    adoptBrowserTab,
    patchBrowserTab,
    openSessionTab,
    openTaskTab,
    openPrTab,
    newChatTab,
    unreadBySession,
    dirtyTabs,
    setTabDirty,
    updateTabLabel,
    nextTab,
    prevTab,
    focusTabByIndex,
  };
}
