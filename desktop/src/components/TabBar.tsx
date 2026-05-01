import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Tab } from '../hooks/useTabs';
import { isChatTab, isFileTab, isDiffTab, isTerminalTab, isBrowserTab } from '../hooks/useTabs';
import { whatsappImg, telegramImg } from '../assets';
import type { SessionState } from '../hooks/useGateway';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import {
  MessageSquare, Radio, LayoutGrid, Zap, Sparkles, Brain, Settings2,
  Plus, X, Loader2, FileCode, FileText, FileImage, File, FileDiff, TerminalSquare, Globe,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const VIEW_ICONS: Record<string, React.ReactNode> = {
  chat: <MessageSquare className="w-3 h-3" />,
  channels: <Radio className="w-3 h-3" />,
  goals: <LayoutGrid className="w-3 h-3" />,
  automation: <Zap className="w-3 h-3" />,
  skills: <Sparkles className="w-3 h-3" />,
  memory: <Brain className="w-3 h-3" />,
  settings: <Settings2 className="w-3 h-3" />,
};

const CODE_EXTS = new Set(['js','jsx','ts','tsx','py','rs','go','java','c','cpp','h','hpp','rb','php','swift','kt','scala','css','html','json','xml','yaml','yml','toml','sh','bash','sql','lua']);
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','bmp','ico']);

function getFileIcon(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (CODE_EXTS.has(ext)) return <FileCode className="w-3 h-3" />;
  if (IMAGE_EXTS.has(ext)) return <FileImage className="w-3 h-3" />;
  if (ext === 'md' || ext === 'txt' || ext === 'log') return <FileText className="w-3 h-3" />;
  return <File className="w-3 h-3" />;
}

function getTabIcon(tab: Tab) {
  if (isChatTab(tab)) {
    if (tab.channel === 'whatsapp') return <img src={whatsappImg} className="w-3 h-3" alt="W" />;
    if (tab.channel === 'telegram') return <img src={telegramImg} className="w-3 h-3" alt="T" />;
    return <MessageSquare className="w-3 h-3" />;
  }
  if (isFileTab(tab)) return getFileIcon(tab.filePath);
  if (isDiffTab(tab)) return <FileDiff className="w-3 h-3" />;
  if (isTerminalTab(tab)) return <TerminalSquare className="w-3 h-3" />;
  if (isBrowserTab(tab)) {
    // prefer the page's own favicon; fall back to globe if none has arrived
    // yet or the image fails to load (onError swaps the element content for
    // the fallback Globe via a simple inline trick — set src to empty
    // transparent pixel so React's reconciler just re-renders on next patch).
    if (tab.favicon) {
      return (
        <img
          src={tab.favicon}
          className="w-3 h-3 rounded-sm"
          alt=""
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      );
    }
    return <Globe className="w-3 h-3" />;
  }
  return VIEW_ICONS[tab.type] || <MessageSquare className="w-3 h-3" />;
}

function DraggableTab({
  tab,
  isActive,
  isRunning,
  isDirty,
  unreadCount,
  groupId,
  onFocusTab,
  onCloseTab,
  onContextMenu,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onStartRename,
}: {
  tab: Tab;
  isActive: boolean;
  isRunning: boolean;
  isDirty: boolean;
  unreadCount: number;
  groupId?: string;
  onFocusTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (v: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onStartRename?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab:${tab.id}`,
    data: { tabId: tab.id, sourceGroupId: groupId },
  });

  const tooltipText = isFileTab(tab) ? tab.filePath : isDiffTab(tab) ? tab.filePath : undefined;
  const inner = (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'group relative flex items-center gap-1.5 px-3 h-[34px] text-[11px] font-mono border-r border-border/50 cursor-grab transition-colors select-none',
        'max-w-[180px] min-w-[80px] shrink-0',
        isDragging && 'opacity-30',
        isActive
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
      onClick={() => onFocusTab(tab.id)}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onCloseTab(tab.id);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, tab.id)}
    >
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
      )}
      <span className="shrink-0 opacity-70">
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
        ) : (
          getTabIcon(tab)
        )}
      </span>
      {isRenaming ? (
        <input
          className="truncate flex-1 bg-transparent outline-none text-[11px] font-mono border-b border-primary px-0"
          value={renameValue}
          onChange={e => onRenameChange?.(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onRenameCommit?.();
            if (e.key === 'Escape') onRenameCancel?.();
          }}
          onBlur={() => onRenameCommit?.()}
          autoFocus
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="truncate flex-1" onDoubleClick={e => { e.stopPropagation(); onStartRename?.(); }}>{tab.label}</span>
      )}
      {!isActive && unreadCount > 0 && (
        <span className="shrink-0 rounded-full bg-primary text-primary-foreground text-[9px] px-1.5 min-w-[14px] text-center">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      {tab.closable && (
        <button
          className={cn(
            'shrink-0 rounded p-0.5 transition-all',
            isActive
              ? 'opacity-50 hover:opacity-100 hover:bg-secondary'
              : 'opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-secondary',
          )}
          onClick={e => {
            e.stopPropagation();
            onCloseTab(tab.id);
          }}
          aria-label={`Close ${tab.label}`}
        >
          {isDirty ? (
            <span className="w-3 h-3 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-warning" />
            </span>
          ) : (
            <X className="w-3 h-3" />
          )}
        </button>
      )}
    </div>
  );

  if (tooltipText) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-[10px] font-mono max-w-[400px]">{tooltipText}</TooltipContent>
      </Tooltip>
    );
  }

  return inner;
}

type ContextMenuState = {
  x: number;
  y: number;
  tabId: string;
  groupId: string;
} | null;

function TabContextMenu({
  menu,
  tabs,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onSplitRight,
  onSplitDown,
  onRename,
}: {
  menu: NonNullable<ContextMenuState>;
  tabs: Tab[];
  onClose: () => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (tabId: string, groupId: string) => void;
  onCloseAllTabs: (groupId: string) => void;
  onCloseTabsToRight: (tabId: string, groupId: string) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onRename?: (tabId: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const el = menuRef.current;
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 4}px`;
    }
  }, []);

  const tab = tabs.find(t => t.id === menu.tabId);
  const isFile = tab && (isFileTab(tab) || isDiffTab(tab));
  const filePath = tab && isFileTab(tab) ? tab.filePath : tab && isDiffTab(tab) ? tab.filePath : null;

  const itemClass = 'text-xs px-2 py-1.5 rounded-sm hover:bg-accent cursor-default select-none flex items-center justify-between gap-4';

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-popover text-popover-foreground border rounded-md shadow-md p-1 min-w-[180px]"
      style={{ left: menu.x, top: menu.y }}
    >
      <div
        className={itemClass}
        onClick={() => handleAction(() => onCloseTab(menu.tabId))}
      >
        <span>Close</span>
      </div>
      <div
        className={itemClass}
        onClick={() => handleAction(() => onCloseOtherTabs(menu.tabId, menu.groupId))}
      >
        <span>Close Others</span>
      </div>
      <div
        className={itemClass}
        onClick={() => handleAction(() => onCloseAllTabs(menu.groupId))}
      >
        <span>Close All</span>
      </div>
      <div
        className={itemClass}
        onClick={() => handleAction(() => onCloseTabsToRight(menu.tabId, menu.groupId))}
      >
        <span>Close to the Right</span>
      </div>

      {onRename && (isTerminalTab(tab!) || isChatTab(tab!)) && (
        <div
          className={itemClass}
          onClick={() => handleAction(() => onRename(menu.tabId))}
        >
          <span>Rename</span>
        </div>
      )}

      <div className="h-px bg-border my-1" />

      {isFile && filePath && (
        <>
          <div
            className={itemClass}
            onClick={() => handleAction(() => {
              navigator.clipboard.writeText(filePath);
            })}
          >
            <span>Copy Path</span>
          </div>
          <div className="h-px bg-border my-1" />
        </>
      )}

      <div
        className={itemClass}
        onClick={() => handleAction(onSplitRight)}
      >
        <span>Split Right</span>
        <span className="text-muted-foreground text-[10px]">\u2318D</span>
      </div>
      <div
        className={itemClass}
        onClick={() => handleAction(onSplitDown)}
      >
        <span>Split Down</span>
        <span className="text-muted-foreground text-[10px]">\u21E7\u2318D</span>
      </div>
    </div>,
    document.body,
  );
}

type TabBarProps = {
  tabs: Tab[];
  activeTabId: string;
  sessionStates: Record<string, SessionState>;
  unreadBySession?: Record<string, number>;
  dirtyTabs?: Set<string>;
  isActiveGroup?: boolean;
  isMultiPane?: boolean;
  groupId?: string;
  onFocusTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewChat: () => void;
  onNewTerminal?: () => void;
  onNewBrowser?: () => void;
  onCloseOtherTabs?: (tabId: string, groupId: string) => void;
  onCloseAllTabs?: (groupId: string) => void;
  onCloseTabsToRight?: (tabId: string, groupId: string) => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onRenameTab?: (tabId: string, newLabel: string) => void;
};

export function TabBar({ tabs, activeTabId, sessionStates, unreadBySession = {}, dirtyTabs, isActiveGroup, isMultiPane, groupId, onFocusTab, onCloseTab, onNewChat, onNewTerminal, onNewBrowser, onCloseOtherTabs, onCloseAllTabs, onCloseTabsToRight, onSplitRight, onSplitDown, onRenameTab }: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const { setNodeRef, isOver } = useDroppable({
    id: `group-drop:${groupId || 'default'}`,
    data: { groupId },
  });

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId, groupId: groupId || 'default' });
  }, [groupId]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center h-[34px] bg-card border-b shrink-0 min-w-0 transition-colors",
        isMultiPane && isActiveGroup ? "border-b-2 border-b-primary" : "border-b-border",
        isOver && "bg-primary/10 border-b-primary",
      )}
    >
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto no-scrollbar">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isRunning = isChatTab(tab) && sessionStates[tab.sessionKey]?.agentStatus !== 'idle' && sessionStates[tab.sessionKey]?.agentStatus != null;

          return (
            <DraggableTab
              key={tab.id}
              tab={tab}
              isActive={isActive}
              isRunning={isRunning}
              isDirty={dirtyTabs?.has(tab.id) || false}
              unreadCount={isChatTab(tab) ? (unreadBySession[tab.sessionKey] || 0) : 0}
              groupId={groupId}
              onFocusTab={onFocusTab}
              onCloseTab={onCloseTab}
              onContextMenu={handleContextMenu}
              isRenaming={renamingTabId === tab.id}
              renameValue={renamingTabId === tab.id ? renameValue : ''}
              onRenameChange={setRenameValue}
              onRenameCommit={() => {
                if (renameValue.trim() && onRenameTab) onRenameTab(tab.id, renameValue.trim());
                setRenamingTabId(null);
              }}
              onRenameCancel={() => setRenamingTabId(null)}
              onStartRename={() => { setRenamingTabId(tab.id); setRenameValue(tab.label); }}
            />
          );
        })}
      </div>

      {onNewTerminal && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="shrink-0 flex items-center justify-center w-[34px] h-[34px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors border-l border-border/50"
              onClick={onNewTerminal}
              aria-label="new terminal"
            >
              <TerminalSquare className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px] font-mono">new terminal (⌃`)</TooltipContent>
        </Tooltip>
      )}

      {onNewBrowser && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="shrink-0 flex items-center justify-center w-[34px] h-[34px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors border-l border-border/50"
              onClick={onNewBrowser}
              aria-label="new browser tab"
            >
              <Globe className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px] font-mono">new browser (⌘⇧B)</TooltipContent>
        </Tooltip>
      )}

      <button
        className="shrink-0 flex items-center justify-center w-[34px] h-[34px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors border-l border-border/50"
        onClick={onNewChat}
        title="new task"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      {contextMenu && (
        <TabContextMenu
          menu={contextMenu}
          tabs={tabs}
          onClose={closeContextMenu}
          onCloseTab={onCloseTab}
          onCloseOtherTabs={onCloseOtherTabs || (() => {})}
          onCloseAllTabs={onCloseAllTabs || (() => {})}
          onCloseTabsToRight={onCloseTabsToRight || (() => {})}
          onSplitRight={onSplitRight || (() => {})}
          onSplitDown={onSplitDown || (() => {})}
          onRename={onRenameTab ? (tabId) => {
            const tab = tabs.find(t => t.id === tabId);
            if (tab) { setRenamingTabId(tabId); setRenameValue(tab.label); }
          } : undefined}
        />
      )}
    </div>
  );
}

// Reusable tab preview for DragOverlay
export function TabDragOverlay({ tab }: { tab: Tab }) {
  return (
    <div className="flex items-center gap-1.5 px-3 h-[34px] text-[11px] font-mono bg-card border border-border rounded shadow-lg select-none max-w-[180px]">
      <span className="shrink-0 opacity-70">{getTabIcon(tab)}</span>
      <span className="truncate flex-1">{tab.label}</span>
    </div>
  );
}
