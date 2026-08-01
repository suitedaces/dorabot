import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorGroupPanel } from './EditorGroupPanel';
import { TooltipProvider } from './ui/tooltip';

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ palette: 'default-dark' }),
}));

vi.mock('./FileViewer', () => ({ FileViewer: () => null }));
vi.mock('./viewers/DiffViewer', () => ({ DiffViewer: () => null }));
vi.mock('./viewers/ImageDiffViewer', () => ({ ImageDiffViewer: () => null }));
vi.mock('./TerminalView', () => ({ TerminalView: () => null }));

const SESSION_KEY = 'desktop:dm:draft-test';
const CHAT_TAB = {
  id: 'chat:draft-test',
  type: 'chat' as const,
  label: 'draft test',
  closable: true as const,
  sessionKey: SESSION_KEY,
  chatId: 'draft-test',
};
const FILE_TAB = {
  id: 'file:draft-test',
  type: 'file' as const,
  label: 'draft.json',
  closable: true as const,
  filePath: '/tmp/draft.json',
};

function makeGateway() {
  return {
    sessionStates: {
      [SESSION_KEY]: { chatItems: [], agentStatus: 'idle', pendingQuestion: null },
    },
    connectionState: 'connected',
    providerInfo: { auth: { authenticated: true } },
    gatewayError: null,
    gatewayTelemetry: { reconnectCount: 0 },
    pendingApprovals: [],
    backgroundTasks: {},
    rpc: vi.fn(async () => []),
    getSessionModel: vi.fn(() => undefined),
    getProviderAuth: vi.fn(async () => ({})),
    getCodexModels: vi.fn(async () => ({ models: [] })),
    sendMessage: vi.fn(async () => {}),
    setProvider: vi.fn(async () => ({})),
    setConfig: vi.fn(async () => ({})),
    changeSessionModel: vi.fn(),
    changeModel: vi.fn(),
    answerQuestion: vi.fn(),
    dismissQuestion: vi.fn(),
    approveToolUse: vi.fn(),
    denyToolUse: vi.fn(),
    abortAgent: vi.fn(),
    onShellEvent: vi.fn(),
  };
}

function Harness() {
  const [split, setSplit] = useState(false);
  const [activeTabId, setActiveTabId] = useState(CHAT_TAB.id);
  const drafts = useRef(new Map());
  const gateway = useRef(makeGateway()).current;
  const tabState = {
    tabs: [CHAT_TAB, FILE_TAB],
    unreadBySession: {},
    dirtyTabs: new Set(),
    closeTab: vi.fn(),
    newChatTab: vi.fn(),
    focusTab: vi.fn(),
    closeOtherTabs: vi.fn(),
    closeAllTabs: vi.fn(),
    closeTabsToRight: vi.fn(),
    updateTabLabel: vi.fn(),
    openFileTab: vi.fn(),
    openDiffTab: vi.fn(),
    setTabDirty: vi.fn(),
    chatDrafts: drafts.current,
  };
  const panel = (
    <EditorGroupPanel
      group={{ id: 'pane-a', tabIds: [CHAT_TAB.id, FILE_TAB.id], activeTabId }}
      tabs={[CHAT_TAB, FILE_TAB]}
      isActive
      isMultiPane={split}
      isDragging={false}
      gateway={gateway as any}
      tabState={tabState as any}
      selectedChannel="whatsapp"
      onFocusGroup={() => {}}
      onNavigateSettings={() => {}}
      onViewSession={() => {}}
      onSwitchChannel={() => {}}
      onSetupChat={() => {}}
      onNavClick={() => {}}
    />
  );

  return (
    <TooltipProvider>
      <button type="button" onClick={() => setSplit(true)}>Split</button>
      <button type="button" onClick={() => setActiveTabId(FILE_TAB.id)}>Show file</button>
      <button type="button" onClick={() => setActiveTabId(CHAT_TAB.id)}>Show chat</button>
      {split ? <div>{panel}</div> : panel}
    </TooltipProvider>
  );
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
});

afterEach(cleanup);

describe('chat drafts', () => {
  it('survives the panel remount caused by adding a split', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('what are we building?');
    fireEvent.change(input, { target: { value: 'keep this draft' } });
    expect((input as HTMLTextAreaElement).value).toBe('keep this draft');

    fireEvent.click(screen.getByRole('button', { name: 'Split' }));

    expect((screen.getByPlaceholderText('what are we building?') as HTMLTextAreaElement).value).toBe('keep this draft');
  });

  it('survives switching to a non-chat tab and back', () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText('what are we building?'), {
      target: { value: 'still here' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show file' }));
    expect(screen.queryByPlaceholderText('what are we building?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show chat' }));
    expect((screen.getByPlaceholderText('what are we building?') as HTMLTextAreaElement).value).toBe('still here');
  });

  it('does not restore a draft after it is sent', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('what are we building?');
    fireEvent.change(input, { target: { value: 'send this' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    expect((input as HTMLTextAreaElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect((screen.getByPlaceholderText('what are we building?') as HTMLTextAreaElement).value).toBe('');
  });
});
