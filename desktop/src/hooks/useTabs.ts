import { useState, useCallback, useEffect, useRef } from 'react';
import type { useGateway } from './useGateway';

export type TabType = 'chat' | 'channels' | 'goals' | 'automation' | 'skills' | 'memory' | 'settings';

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
  const chatId = `task-${Date.now()}`;
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

export function useTabs(gw: ReturnType<typeof useGateway>) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const stored = loadTabsFromStorage();
    return stored.length > 0 ? stored : [makeDefaultChatTab()];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const stored = loadActiveTabIdFromStorage();
    // Validate that the stored ID exists in the loaded tabs
    const loadedTabs = loadTabsFromStorage();
    if (stored && loadedTabs.some(t => t.id === stored)) return stored;
    return loadedTabs[0]?.id || tabs[0]?.id || '';
  });

  const initializedRef = useRef(false);

  // On first connect, register all chat tabs with the gateway and load their sessions
  useEffect(() => {
    if (gw.connectionState !== 'connected' || initializedRef.current) return;
    initializedRef.current = true;

    for (const tab of tabs) {
      if (isChatTab(tab)) {
        gw.trackSession(tab.sessionKey);
        if (tab.sessionId) {
          gw.loadSessionIntoMap(tab.sessionId, tab.sessionKey, tab.chatId);
        }
      }
    }

    // Set the active session
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && isChatTab(activeTab)) {
      gw.setActiveSession(activeTab.sessionKey, activeTab.chatId);
    }
  }, [gw.connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset initialization flag on disconnect so we re-init on reconnect
  useEffect(() => {
    if (gw.connectionState === 'disconnected') {
      initializedRef.current = false;
    }
  }, [gw.connectionState]);

  // Listen for sessionId changes from the gateway (when agent.result assigns a sessionId)
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

  // Persist tabs to localStorage
  useEffect(() => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
  }, [activeTabId]);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const openTab = useCallback((tab: Tab) => {
    setTabs(prev => {
      const existing = prev.find(t => t.id === tab.id);
      if (existing) return prev;
      return [...prev, tab];
    });
    setActiveTabId(tab.id);

    // Track chat sessions in the gateway
    if (isChatTab(tab)) {
      gw.trackSession(tab.sessionKey);
      gw.setActiveSession(tab.sessionKey, tab.chatId);
      if (tab.sessionId) {
        gw.loadSessionIntoMap(tab.sessionId, tab.sessionKey, tab.chatId);
      }
    }
  }, [gw]);

  const focusTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);

    if (isChatTab(tab)) {
      gw.setActiveSession(tab.sessionKey, tab.chatId);
    }
  }, [tabs, gw]);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx < 0) return prev;

      const closing = prev[idx];

      // Untrack from gateway if it's a chat tab
      if (isChatTab(closing)) {
        gw.untrackSession(closing.sessionKey);
      }

      const next = prev.filter(t => t.id !== tabId);

      // Prevent closing the last tab — create a new empty chat tab
      if (next.length === 0) {
        const newTab = makeDefaultChatTab();
        gw.trackSession(newTab.sessionKey);
        gw.setActiveSession(newTab.sessionKey, newTab.chatId);
        setActiveTabId(newTab.id);
        return [newTab];
      }

      // If we closed the active tab, activate the neighbor
      if (tabId === activeTabId) {
        const newIdx = Math.min(idx, next.length - 1);
        const neighbor = next[newIdx];
        setActiveTabId(neighbor.id);
        if (isChatTab(neighbor)) {
          gw.setActiveSession(neighbor.sessionKey, neighbor.chatId);
        }
      }

      return next;
    });
  }, [activeTabId, gw]);

  const openChatTab = useCallback((opts: {
    sessionId?: string;
    sessionKey: string;
    chatId: string;
    channel?: string;
    label: string;
  }): string => {
    // Check if a tab for this session already exists
    const existingTab = tabs.find(t =>
      isChatTab(t) && (
        (opts.sessionId && t.sessionId === opts.sessionId) ||
        t.sessionKey === opts.sessionKey
      )
    );

    if (existingTab) {
      focusTab(existingTab.id);
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

    openTab(tab);
    return tab.id;
  }, [tabs, focusTab, openTab]);

  const openViewTab = useCallback((type: Exclude<TabType, 'chat'>, label: string) => {
    const id = `view:${type}`;
    const existing = tabs.find(t => t.id === id);
    if (existing) {
      setActiveTabId(id);
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
  }, [tabs]);

  const newChatTab = useCallback((): string => {
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
    return tab.id;
  }, [gw]);

  const updateTabLabel = useCallback((tabId: string, label: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, label } : t));
  }, []);

  const nextTab = useCallback(() => {
    const idx = tabs.findIndex(t => t.id === activeTabId);
    const next = tabs[(idx + 1) % tabs.length];
    if (next) focusTab(next.id);
  }, [tabs, activeTabId, focusTab]);

  const prevTab = useCallback(() => {
    const idx = tabs.findIndex(t => t.id === activeTabId);
    const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
    if (prev) focusTab(prev.id);
  }, [tabs, activeTabId, focusTab]);

  const focusTabByIndex = useCallback((index: number) => {
    const target = index >= tabs.length ? tabs[tabs.length - 1] : tabs[index];
    if (target) focusTab(target.id);
  }, [tabs, focusTab]);

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
    updateTabLabel,
    nextTab,
    prevTab,
    focusTabByIndex,
  };
}
