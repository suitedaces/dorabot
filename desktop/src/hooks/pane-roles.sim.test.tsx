// throwaway simulation harness for pane role targeting.
// exercises the real useLayout + useTabs, stubbing only the gateway.
import { describe, it, beforeEach, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLayout } from './useLayout';
import { useTabs, isChatTab } from './useTabs';

function stubGw() {
  let n = 0;
  return {
    connectionState: 'connected',
    sessions: [],
    sessionStates: {},
    onFirstMessageRef: { current: null },
    onSessionIdChangeRef: { current: null },
    newSession: () => {
      const chatId = `sess${++n}`;
      return { sessionKey: `desktop:dm:${chatId}`, chatId };
    },
    trackSession: () => {},
    untrackSession: () => {},
    setActiveSession: () => {},
    loadSessionIntoMap: () => {},
    rpc: async () => ({}),
  } as any;
}

function setup() {
  const gw = stubGw();
  return renderHook(() => {
    const layout = useLayout();
    const tabs = useTabs(gw, layout);
    return { layout, tabs };
  });
}

// renders panes as "chat|file,term" left-to-right, marking roles
function snapshot(r: ReturnType<typeof setup>): string {
  const { layout, tabs } = r.result.current;
  const roles = layout.roles || {};
  return layout.columns
    .map(col =>
      col.panes
        .map(p => {
          const kinds = p.tabIds.map(id => {
            const t = tabs.tabs.find(x => x.id === id);
            if (!t) return '?';
            return isChatTab(t) ? 'chat' : t.type;
          });
          let tag = '';
          if (p.id === roles.chat) tag = 'C:';
          else if (p.id === roles.workspace) tag = 'W:';
          return `[${tag}${kinds.join(',') || 'empty'}]`;
        })
        .join('/'),
    )
    .join(' | ');
}

function paneCount(r: ReturnType<typeof setup>) {
  return r.result.current.layout.visibleGroups.length;
}

function chatTabCount(r: ReturnType<typeof setup>) {
  return r.result.current.tabs.tabs.filter(isChatTab).length;
}

// node 24 ships its own localStorage which shadows jsdom's; use a plain map
function installStorage() {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    },
  });
}

describe('pane role targeting', () => {
  beforeEach(() => {
    installStorage();
  });

  it('1. first file click splits right and leaves chat visible', () => {
    const r = setup();
    const before = snapshot(r);
    act(() => { r.result.current.tabs.openFileTab('/a/agent.ts'); });
    console.log('  start          :', before);
    console.log('  after file     :', snapshot(r));
    expect(paneCount(r)).toBe(2);
    // the chat pane must still hold the chat tab
    const { layout } = r.result.current;
    const chatPane = layout.visibleGroups.find(p => p.id === layout.roles?.chat)!;
    expect(chatPane.tabIds.length).toBe(1);
  });

  it('2. more files stack as tabs, no extra splits', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    act(() => { r.result.current.tabs.openFileTab('/a/two.ts'); });
    act(() => { r.result.current.tabs.openFileTab('/a/three.ts'); });
    console.log('  3 files        :', snapshot(r));
    expect(paneCount(r)).toBe(2);
  });

  it('3. terminal joins the workspace pane', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    act(() => { r.result.current.tabs.openTerminalTab('/a'); });
    console.log('  file+terminal  :', snapshot(r));
    expect(paneCount(r)).toBe(2);
  });

  it('4. views open in workspace, not over chat', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openViewTab('settings' as any, 'Settings'); });
    console.log('  settings       :', snapshot(r));
    expect(paneCount(r)).toBe(2);
  });

  it('5. cmd+T new chat lands in the chat pane', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    act(() => { r.result.current.tabs.newChatTab(); });
    console.log('  after cmd+T    :', snapshot(r));
    const { layout } = r.result.current;
    const chatPane = layout.visibleGroups.find(p => p.id === layout.roles?.chat)!;
    expect(chatPane.tabIds.length).toBe(2);
  });

  it('6. closing all workspace tabs collapses, next file re-splits', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    console.log('  two panes      :', snapshot(r));
    act(() => { r.result.current.tabs.closeTab('file:/a/one.ts'); });
    console.log('  after close    :', snapshot(r), `(panes=${paneCount(r)})`);
    act(() => { r.result.current.tabs.openFileTab('/a/two.ts'); });
    console.log('  file again     :', snapshot(r));
    expect(paneCount(r)).toBe(2);
  });

  it('7. closing all chats then cmd+T recreates a chat pane', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    const chatIds = r.result.current.tabs.tabs.filter(isChatTab).map(t => t.id);
    act(() => { chatIds.forEach(id => r.result.current.tabs.closeTab(id)); });
    console.log('  chats closed   :', snapshot(r), `(panes=${paneCount(r)})`);
    act(() => { r.result.current.tabs.newChatTab(); });
    console.log('  after cmd+T    :', snapshot(r));
    const { layout, tabs } = r.result.current;
    const chatPane = layout.visibleGroups.find(p => p.id === layout.roles?.chat);
    const filePane = layout.visibleGroups.find(p => p.tabIds.includes('file:/a/one.ts'));
    console.log('  chat separate? :', chatPane && filePane ? chatPane.id !== filePane.id : 'n/a');
    expect(tabs.tabs.some(isChatTab)).toBe(true);
  });

  it('8. dragging a file into the chat pane keeps roles put', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    const { layout } = r.result.current;
    const chatPaneId = layout.roles!.chat!;
    const wsPaneId = layout.roles!.workspace!;
    act(() => { r.result.current.layout.moveTabToGroup('file:/a/one.ts', wsPaneId, chatPaneId); });
    console.log('  after drag     :', snapshot(r));
    act(() => { r.result.current.tabs.openFileTab('/a/two.ts'); });
    console.log('  next file      :', snapshot(r));
    const after = r.result.current.layout;
    const two = after.visibleGroups.find(p => p.tabIds.includes('file:/a/two.ts'))!;
    console.log('  went to chat pane?', two.id === chatPaneId);
  });

  it('9. no phantom sessions appear from the split', () => {
    const r = setup();
    const before = chatTabCount(r);
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    const after = chatTabCount(r);
    console.log(`  chat tabs before=${before} after=${after}`);
    expect(after).toBe(before);
  });

  it('10. manual split then file click opens where you are looking', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    console.log('  two panes      :', snapshot(r));
    act(() => { r.result.current.layout.addColumn(); });
    console.log('  after cmd+D    :', snapshot(r), `(panes=${paneCount(r)})`);
    const focused = r.result.current.layout.activeGroupId;
    act(() => { r.result.current.tabs.openFileTab('/a/three.ts'); });
    console.log('  file in split  :', snapshot(r));
    const landed = r.result.current.layout.visibleGroups.find(p => p.tabIds.includes('file:/a/three.ts'))!;
    console.log('  landed in focused pane?', landed.id === focused);
    expect(landed.id).toBe(focused);
  });

  it('11. cmd+shift+E reset then file click re-splits', () => {
    const r = setup();
    act(() => { r.result.current.tabs.openFileTab('/a/one.ts'); });
    act(() => { r.result.current.layout.resetToSingle(); });
    console.log('  after reset    :', snapshot(r), `(panes=${paneCount(r)})`);
    act(() => { r.result.current.tabs.openFileTab('/a/two.ts'); });
    console.log('  file again     :', snapshot(r), `(panes=${paneCount(r)})`);
  });
});
