import { useState, useCallback, useEffect, useRef } from 'react';
import type { useGateway } from './useGateway';
import type { useLayout } from './useLayout';
import type { GroupId } from './useLayout';

export type TabType = 'chat' | 'channels' | 'goals' | 'automation' | 'skills' | 'memory' | 'research' | 'settings';

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

export type ViewTab = {
  id: string;
  type: Exclude<TabType, 'chat'>;
  label: string;
  closable: true;
};

export type Tab = ChatTab | ViewTab;

export function isChatTab(tab: Tab): tab is ChatTab {
  return tab.type === 'chat';
}

const TABS_STORAGE_KEY = 'dorabot:tabs';
const ACTIVE_TAB_STORAGE_KEY = 'dorabot:activeTabId';

function makeDefaultChatTab(): ChatTab {
  const chatId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
    return parsed;
  } catch {
    return [];
  }
}

function loadActiveTabIdFromStorage(): string | null {
  return localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
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
  const subscribedSessionKeysRef = useRef<Set<string>>(new Set());
  const streamCountRef = useRef<Record<string, number>>({});
  const [unreadBySession, setUnreadBySession] = useState<Record<string, number>>({});

  // Migrate: if layout groups are empty but we have tabs, put them all in g0
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;

    const g0 = layout.groups[0];
    const allGroupTabIds = layout.groups.flatMap(g => g.tabIds);
    if (allGroupTabIds.length === 0 && tabs.length > 0) {
      // Old state: tabs exist but no group assignments
      for (const tab of tabs) {
        layout.addTabToGroup(tab.id, 'g0');
      }
      // Set g0's active tab
      const active = tabs.find(t => t.id === activeTabId) || tabs[0];
      if (active) {
        layout.setGroupActiveTab('g0', active.id);
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

  // Persist tabs
  useEffect(() => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
  }, [activeTabId]);

  // Invariant: visible groups should always have something renderable.
  // Guards against blank panes if tab/layout updates race.
  useEffect(() => {
    if (tabs.length === 0) {
      const fallback = makeDefaultChatTab();
      setTabs([fallback]);
      setActiveTabId(fallback.id);
      gw.trackSession(fallback.sessionKey);
      gw.setActiveSession(fallback.sessionKey, fallback.chatId);
      if (layout.isMultiPane) layout.resetToSingle();
      layout.addTabToGroup(fallback.id, 'g0');
      return;
    }

    const visibleGroup = layout.visibleGroups.find(g => g.id === layout.activeGroupId) || layout.visibleGroups[0];
    if (!visibleGroup) return;

    const tabIds = new Set(tabs.map(t => t.id));
    const hasRenderableTab = visibleGroup.tabIds.some(id => tabIds.has(id));
    if (hasRenderableTab) return;

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
  const activeTab = tabs.find(t => t.id === (activeGroup.activeTabId || activeTabId)) || tabs[0];

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

    const remainingTabs = tabs.filter(t => t.id !== tabId);

    // Always keep at least one tab and avoid side effects inside setState updaters.
    if (remainingTabs.length === 0) {
      const fallback = makeDefaultChatTab();
      gw.trackSession(fallback.sessionKey);
      gw.setActiveSession(fallback.sessionKey, fallback.chatId);
      setTabs([fallback]);
      setActiveTabId(fallback.id);
      if (layout.isMultiPane) layout.resetToSingle();
      layout.addTabToGroup(fallback.id, 'g0');
      return;
    }

    setTabs(remainingTabs);

    // Handle focus and layout after close
    if (!neighborTabId) {
      if (layout.isMultiPane) {
        // Compute focus target from pre-collapse state before it goes stale
        // (layout.groups won't reflect collapseGroup's setState until next render)
        const preCollapseRemaining = layout.groups.filter(g => g.id !== groupId && g.tabIds.length > 0);

        // collapseGroup sets the correct activeGroupId — don't call focusGroup after
        layout.collapseGroup(groupId);

        // Pick the tab to focus: keep current group's tab if it survived, otherwise first remaining
        const focusTarget = layout.activeGroupId !== groupId
          ? preCollapseRemaining.find(g => g.id === layout.activeGroupId) || preCollapseRemaining[0]
          : preCollapseRemaining[0];
        if (focusTarget?.activeTabId) {
          const remTab = tabs.find(t => t.id === focusTarget.activeTabId);
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

  const openViewTab = useCallback((type: Exclude<TabType, 'chat'>, label: string, groupId?: GroupId) => {
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
    focusTab,
    openChatTab,
    openViewTab,
    newChatTab,
    unreadBySession,
    updateTabLabel,
    nextTab,
    prevTab,
    focusTabByIndex,
  };
}
