import { useEffect } from 'react';
import type { EditorGroup } from '../hooks/useLayout';
import type { Tab } from '../hooks/useTabs';
import { isChatTab, isFileTab, isDiffTab, isTerminalTab, isTaskTab, isPrTab, isBrowserTab } from '../hooks/useTabs';
import type { useGateway } from '../hooks/useGateway';
import type { useTabs } from '../hooks/useTabs';
import { useDroppable } from '@dnd-kit/core';
import { TabBar } from './TabBar';
import { ChatView } from '../views/Chat';
import { ChannelView } from '../views/Channel';
import { Automations } from './Automations';
import { SettingsView } from '../views/Settings';
import { SoulView } from '../views/Soul';
import { ExtensionsView } from '../views/Extensions';
import { AgentsView } from '../views/Agents';
import { GoalsView } from '../views/Goals';
import { ResearchView } from '../views/Research';
import { TaskDetailView } from '../views/projects/TaskDetailView';
import { PullRequestView } from '../views/PullRequest';
import { FileViewer } from './FileViewer';
import { DiffViewer } from './viewers/DiffViewer';
import { ImageDiffViewer } from './viewers/ImageDiffViewer';
import { TerminalView } from './TerminalView';
import { BrowserView } from './BrowserView';
import { ErrorBoundary } from './ErrorBoundary';
import { useTheme } from '../hooks/useTheme';
import { cn } from '@/lib/utils';

// VS Code-style drop zone inside a panel — shows quadrant highlights when dragging
function PanelDropZone({ groupId, zone }: { groupId: string; zone: 'left' | 'right' | 'top' | 'bottom' | 'center' }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `panel-split:${groupId}:${zone}`,
    data: { panelGroupId: groupId, splitZone: zone },
  });

  const posStyles: Record<string, string> = {
    left: 'left-0 top-0 bottom-0 w-1/4',
    right: 'right-0 top-0 bottom-0 w-1/4',
    top: 'top-0 left-1/4 right-1/4 h-1/4',
    bottom: 'bottom-0 left-1/4 right-1/4 h-1/4',
    center: 'top-1/4 bottom-1/4 left-1/4 right-1/4',
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute z-40 transition-all pointer-events-auto rounded-sm',
        posStyles[zone],
        isOver ? 'bg-primary/20 border-2 border-primary/40' : 'bg-transparent',
      )}
    />
  );
}

type Props = {
  group: EditorGroup;
  tabs: Tab[];
  isActive: boolean;
  isMultiPane: boolean;
  isDragging: boolean;
  gateway: ReturnType<typeof useGateway>;
  tabState: ReturnType<typeof useTabs>;
  selectedChannel: 'whatsapp' | 'telegram';
  onFocusGroup: () => void;
  onNavigateSettings: () => void;
  onViewSession: (sessionId: string, channel?: string, chatId?: string, chatType?: string) => void;
  onSwitchChannel: (ch: 'whatsapp' | 'telegram') => void;
  onSetupChat: (prompt: string) => void;
  onNavClick: (navId: string) => void;
  onNewTerminal?: () => void;
  onNewBrowser?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
};

export function EditorGroupPanel({
  group,
  tabs,
  isActive,
  isMultiPane,
  isDragging,
  gateway,
  tabState,
  selectedChannel,
  onFocusGroup,
  onNavigateSettings,
  onViewSession,
  onSwitchChannel,
  onSetupChat,
  onNavClick,
  onNewTerminal,
  onNewBrowser,
  onSplitRight,
  onSplitDown,
}: Props) {
  const { palette } = useTheme();
  const groupTabs = group.tabIds
    .map(id => tabs.find(t => t.id === id))
    .filter(Boolean) as Tab[];

  const activeTab = groupTabs.find(t => t.id === group.activeTabId) || groupTabs[0];

  // When the active tab is not a browser tab, clear any browser claim on this
  // pane so the main-process tab model hides the native WebContentsView. When
  // it IS a browser tab, the BrowserView itself pushes the claim + bounds via
  // its own ResizeObserver — we stay quiet here to avoid racing it.
  // Always paneRemove on unmount so the model forgets this pane entirely.
  const activeIsBrowser = !!activeTab && isBrowserTab(activeTab);
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.browser : undefined;
    if (!api) return;
    if (!activeIsBrowser) {
      api.paneUpdate(group.id, { activeBrowserPageId: null, visible: true }).catch(() => {});
    }
  }, [group.id, activeIsBrowser]);
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.browser : undefined;
    return () => { api?.paneRemove(group.id).catch(() => {}); };
  }, [group.id]);

  const renderContent = () => {
    if (!activeTab) return null;

    switch (activeTab.type) {
      case 'file':
        return (
          <FileViewer
            filePath={activeTab.filePath}
            rpc={gateway.rpc}
            onClose={() => tabState.closeTab(activeTab.id)}
            headerless
            onDirtyChange={(dirty) => tabState.setTabDirty(activeTab.id, dirty)}
          />
        );
      case 'diff':
        if (activeTab.isImage) {
          return (
            <ImageDiffViewer
              oldSrc={activeTab.oldContent ? `data:image/*;base64,${activeTab.oldContent}` : ''}
              newSrc={activeTab.newContent ? `data:image/*;base64,${activeTab.newContent}` : ''}
              filePath={activeTab.filePath}
            />
          );
        }
        return (
          <DiffViewer
            oldContent={activeTab.oldContent}
            newContent={activeTab.newContent}
            filePath={activeTab.filePath}
          />
        );
      case 'terminal':
        return null; // Terminals are rendered persistently below to preserve buffer
      case 'browser':
        return null; // Browser tabs render persistently below; overlay stays alive when hidden
      case 'chat': {
        const ss = gateway.sessionStates[activeTab.sessionKey] || {
          chatItems: [],
          agentStatus: 'idle',
          pendingQuestion: null,
        };
        return (
          <ChatView
            gateway={gateway}
            chatItems={ss.chatItems}
            agentStatus={ss.agentStatus}
            pendingQuestion={ss.pendingQuestion}
            sessionKey={activeTab.sessionKey}
            onNavigateSettings={onNavigateSettings}
            onOpenFile={(filePath) => tabState.openFileTab(filePath)}
            onOpenDiff={(opts) => tabState.openDiffTab(opts)}
            onClearChat={() => {
              tabState.closeTab(activeTab.id);
              tabState.newChatTab(group.id);
            }}
            onNewTab={() => tabState.newChatTab(group.id)}
          />
        );
      }
      case 'channels':
        return (
          <ChannelView
            channel={selectedChannel}
            gateway={gateway}
            onViewSession={onViewSession}
            onSwitchChannel={onSwitchChannel}
          />
        );
      case 'goals':
        return <GoalsView gateway={gateway} onViewSession={onViewSession} onSetupChat={onSetupChat} onOpenTask={(taskId: string, taskTitle: string) => tabState.openTaskTab(taskId, taskTitle)} />;
      case 'task':
        if (isTaskTab(activeTab)) {
          return (
            <TaskDetailView
              taskId={activeTab.taskId}
              gateway={gateway}
              onViewSession={onViewSession}
              onClose={() => tabState.closeTab(activeTab.id)}
            />
          );
        }
        return null;
      case 'pr':
        if (isPrTab(activeTab)) {
          return (
            <PullRequestView
              key={activeTab.id}
              repoRoot={activeTab.repoRoot}
              prNumber={activeTab.prNumber}
              gateway={gateway}
            />
          );
        }
        return null;
      case 'automation':
        return <Automations gateway={gateway} />;
      case 'research':
        return <ResearchView gateway={gateway} />;
      case 'extensions':
        return <ExtensionsView gateway={gateway} />;
      case 'agents':
        return <AgentsView gateway={gateway} />;
      case 'memory':
        return (
          <SoulView
            gateway={gateway}
            onSetupChat={onSetupChat}
          />
        );
      case 'settings':
        return <SettingsView gateway={gateway} />;
      default:
        return null;
    }
  };

  return (
    <div
      data-group-id={group.id}
      className={cn(
        'flex flex-col h-full min-h-0 min-w-0 transition-all duration-150',
        isMultiPane && (isActive
          ? 'ring-2 ring-primary/50 ring-inset'
          : 'opacity-75 hover:opacity-90'),
      )}
      onClick={onFocusGroup}
    >
      <TabBar
        tabs={groupTabs}
        activeTabId={group.activeTabId || ''}
        sessionStates={gateway.sessionStates}
        unreadBySession={tabState.unreadBySession}
        dirtyTabs={tabState.dirtyTabs}
        isActiveGroup={isActive}
        isMultiPane={isMultiPane}
        groupId={group.id}
        onFocusTab={(id) => {
          onFocusGroup();
          tabState.focusTab(id, group.id);
        }}
        onCloseTab={tabState.closeTab}
        onNewChat={() => {
          onFocusGroup();
          tabState.newChatTab(group.id);
        }}
        onNewTerminal={onNewTerminal}
        onNewBrowser={onNewBrowser}
        onCloseOtherTabs={(tabId, groupId) => tabState.closeOtherTabs(tabId, groupId as any)}
        onCloseAllTabs={(groupId) => tabState.closeAllTabs(groupId as any)}
        onCloseTabsToRight={(tabId, groupId) => tabState.closeTabsToRight(tabId, groupId as any)}
        onSplitRight={onSplitRight}
        onSplitDown={onSplitDown}
        onRenameTab={(tabId, label) => {
          tabState.updateTabLabel(tabId, label);
          const tab = tabs.find(t => t.id === tabId);
          if (tab && isChatTab(tab) && tab.sessionId) {
            gateway.rpc('sessions.rename', { sessionId: tab.sessionId, name: label }).catch(() => {});
          }
        }}
      />
      <div className="@container flex-1 min-h-0 min-w-0 relative">
        <ErrorBoundary>
          <div className="relative z-10" style={{ display: activeTab && !isTerminalTab(activeTab) && !isBrowserTab(activeTab) ? 'contents' : 'none' }}>
            {renderContent()}
          </div>
          {/* Keep all terminal tabs mounted so xterm preserves its buffer */}
          {groupTabs.filter(isTerminalTab).map(t => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ visibility: t.id === activeTab?.id ? 'visible' : 'hidden', zIndex: t.id === activeTab?.id ? 1 : 0 }}
            >
              <TerminalView
                shellId={t.shellId}
                cwd={t.cwd}
                rpc={gateway.rpc}
                onShellEvent={gateway.onShellEvent}
                palette={palette}
                focused={t.id === activeTab?.id}
              />
            </div>
          ))}
          {/* Keep all browser tabs mounted so the WebContentsView stays alive */}
          {groupTabs.filter(isBrowserTab).map(t => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ visibility: t.id === activeTab?.id ? 'visible' : 'hidden', zIndex: t.id === activeTab?.id ? 1 : 0 }}
            >
              <BrowserView
                tab={t}
                isActive={t.id === activeTab?.id}
                paneId={group.id}
                onPatch={(patch) => tabState.patchBrowserTab(t.id, patch)}
              />
            </div>
          ))}
        </ErrorBoundary>
        {isDragging && (
          <>
            <PanelDropZone groupId={group.id} zone="left" />
            <PanelDropZone groupId={group.id} zone="right" />
            <PanelDropZone groupId={group.id} zone="top" />
            <PanelDropZone groupId={group.id} zone="bottom" />
            <PanelDropZone groupId={group.id} zone="center" />
          </>
        )}
      </div>
    </div>
  );
}
