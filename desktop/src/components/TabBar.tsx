import type { Tab } from '../hooks/useTabs';
import { isChatTab } from '../hooks/useTabs';
import type { SessionState } from '../hooks/useGateway';
import { cn } from '@/lib/utils';
import {
  MessageSquare, Radio, LayoutGrid, Zap, Sparkles, Brain, Settings2,
  Plus, X, Loader2,
} from 'lucide-react';

const VIEW_ICONS: Record<string, React.ReactNode> = {
  chat: <MessageSquare className="w-3 h-3" />,
  channels: <Radio className="w-3 h-3" />,
  goals: <LayoutGrid className="w-3 h-3" />,
  automation: <Zap className="w-3 h-3" />,
  skills: <Sparkles className="w-3 h-3" />,
  memory: <Brain className="w-3 h-3" />,
  settings: <Settings2 className="w-3 h-3" />,
};

function getTabIcon(tab: Tab) {
  if (isChatTab(tab)) {
    if (tab.channel === 'whatsapp') return <img src="/whatsapp.png" className="w-3 h-3" alt="W" />;
    if (tab.channel === 'telegram') return <img src="/telegram.png" className="w-3 h-3" alt="T" />;
    return <MessageSquare className="w-3 h-3" />;
  }
  return VIEW_ICONS[tab.type] || <MessageSquare className="w-3 h-3" />;
}

type TabBarProps = {
  tabs: Tab[];
  activeTabId: string;
  sessionStates: Record<string, SessionState>;
  onFocusTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewChat: () => void;
};

export function TabBar({ tabs, activeTabId, sessionStates, onFocusTab, onCloseTab, onNewChat }: TabBarProps) {
  return (
    <div className="flex items-center h-[34px] bg-card border-b border-border shrink-0 min-w-0">
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto no-scrollbar">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isRunning = isChatTab(tab) && sessionStates[tab.sessionKey]?.agentStatus !== 'idle' && sessionStates[tab.sessionKey]?.agentStatus != null;

          return (
            <div
              key={tab.id}
              className={cn(
                'group relative flex items-center gap-1.5 px-3 h-[34px] text-[11px] font-mono border-r border-border/50 cursor-pointer transition-colors select-none',
                'max-w-[180px] min-w-[80px] shrink-0',
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
              )}
              onClick={() => onFocusTab(tab.id)}
              onMouseDown={(e) => {
                // middle-click to close
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
            >
              {/* active tab indicator */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
              )}

              {/* icon */}
              <span className="shrink-0 opacity-70">
                {isRunning ? (
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                ) : (
                  getTabIcon(tab)
                )}
              </span>

              {/* label */}
              <span className="truncate flex-1">{tab.label}</span>

              {/* close button */}
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
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* new chat tab button */}
      <button
        className="shrink-0 flex items-center justify-center w-[34px] h-[34px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors border-l border-border/50"
        onClick={onNewChat}
        title="new task"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
