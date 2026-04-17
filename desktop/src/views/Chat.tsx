import { useState, useRef, useEffect, useMemo, useCallback, createContext, useContext, Fragment, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react';
import { DorabotSprite } from '../components/DorabotSprite';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { useGateway, ChatItem, AskUserQuestion, ImageAttachment, PendingElicitation } from '../hooks/useGateway';
import { ElicitationForm } from '../components/ElicitationForm';
import { ApprovalList } from '@/components/approval-ui';
import { ToolUI } from '@/components/tool-ui';
import { ToolStreamCard, hasStreamCard } from '@/components/tool-stream';
import { InlineErrorBoundary } from '@/components/ErrorBoundary';
import { AuroraBackground } from '@/components/aceternity/aurora-background';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { VirtualChatList } from '@/components/VirtualChatList';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { safeParse } from '@/lib/safe-parse';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Square, ChevronDown, ChevronUp, ChevronRight, Sparkles,
  FileText, FilePlus, Pencil, FolderSearch, FileSearch, Terminal,
  Globe, Search, Bot, MessageCircle, ListChecks, FileCode,
  MessageSquare, Camera, Monitor, Clock, Wrench, ArrowUp, LayoutGrid,
  Smile, Image, Brain, MapPin, PenLine, GitPullRequest, Radio,
  Paperclip, X, ExternalLink, Check, Circle, Loader2, Keyboard, Copy,
  type LucideIcon,
} from 'lucide-react';
import { SHORTCUTS as ALL_SHORTCUTS } from '@/components/ShortcutHelp';
import { jsonrepair } from 'jsonrepair';
import { CLAUDE_MODELS, CODEX_MODELS, DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_MODEL, codexModelsForAuth, labelForModel } from '@/lib/modelCatalog';

type SlashItem = {
  command: string;
  description: string;
  type: 'command' | 'skill';
};

type SkillInfo = {
  name: string;
  description: string;
  eligibility: { eligible: boolean };
};

type Props = {
  gateway: ReturnType<typeof useGateway>;
  chatItems: ChatItem[];
  agentStatus: string;
  pendingQuestion: AskUserQuestion | null;
  sessionKey?: string;
  onNavigateSettings?: () => void;
  onOpenFile?: (filePath: string) => void;
  onOpenDiff?: (opts: { filePath: string; oldContent: string; newContent: string; label?: string }) => void;
  onClearChat?: () => void;
  onNewTab?: () => void;
};

type ToolActions = {
  onOpenFile?: (filePath: string) => void;
  onOpenDiff?: (opts: { filePath: string; oldContent: string; newContent: string; label?: string }) => void;
};

const ToolActionsContext = createContext<ToolActions>({});

const TOOL_TEXT: Record<string, { pending: string; done: string }> = {
  Read: { pending: 'Reading file', done: 'Read file' },
  Write: { pending: 'Writing file', done: 'Wrote file' },
  Edit: { pending: 'Editing file', done: 'Edited file' },
  Glob: { pending: 'Searching files', done: 'Searched files' },
  Grep: { pending: 'Searching code', done: 'Searched code' },
  Bash: { pending: 'Running command', done: 'Ran command' },
  WebFetch: { pending: 'Fetching URL', done: 'Fetched URL' },
  WebSearch: { pending: 'Searching web', done: 'Searched web' },
  Task: { pending: 'Running task', done: 'Completed task' },
  AskUserQuestion: { pending: 'Asking question', done: 'Got answer' },
  TodoWrite: { pending: 'Updating tasks', done: 'Updated tasks' },
  NotebookEdit: { pending: 'Editing notebook', done: 'Edited notebook' },
  message: { pending: 'Sending message', done: 'Sent message' },
  screenshot: { pending: 'Taking screenshot', done: 'Took screenshot' },
  schedule: { pending: 'Scheduling event', done: 'Scheduled event' },
  list_schedule: { pending: 'Listing schedule', done: 'Listed schedule' },
  update_schedule: { pending: 'Updating schedule', done: 'Updated schedule' },
  cancel_schedule: { pending: 'Cancelling schedule', done: 'Cancelled schedule' },
  browser: { pending: 'Using browser', done: 'Used browser' },
  projects_view: { pending: 'Viewing projects', done: 'Viewed projects' },
  projects_add: { pending: 'Adding project', done: 'Added project' },
  projects_update: { pending: 'Updating project', done: 'Updated project' },
  projects_delete: { pending: 'Deleting project', done: 'Deleted project' },
  tasks_view: { pending: 'Viewing tasks', done: 'Viewed tasks' },
  tasks_add: { pending: 'Adding task', done: 'Added task' },
  tasks_update: { pending: 'Updating task', done: 'Updated task' },
  tasks_done: { pending: 'Completing task', done: 'Completed task' },
  tasks_delete: { pending: 'Deleting task', done: 'Deleted task' },
  research_view: { pending: 'Viewing research', done: 'Viewed research' },
  research_add: { pending: 'Adding research', done: 'Added research' },
  research_update: { pending: 'Updating research', done: 'Updated research' },
  memory_search: { pending: 'Searching memory', done: 'Searched memory' },
  memory_read: { pending: 'Reading memory', done: 'Read memory' },
};

function humanizeToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function toolText(name: string, state: 'pending' | 'done'): string {
  const t = TOOL_TEXT[name];
  if (t) return t[state];
  const h = humanizeToolName(name);
  return state === 'pending' ? `Running ${h}` : `Completed ${h}`;
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText, Write: FilePlus, Edit: Pencil,
  Glob: FolderSearch, Grep: FileSearch, Bash: Terminal,
  WebFetch: Globe, WebSearch: Search, Task: Bot,
  AskUserQuestion: MessageCircle, TodoWrite: ListChecks, NotebookEdit: FileCode,
  message: MessageSquare, screenshot: Camera, browser: Monitor,
  schedule: Clock, list_schedule: Clock,
  update_schedule: Clock, cancel_schedule: Clock,
  projects_view: LayoutGrid, projects_add: LayoutGrid,
  projects_update: LayoutGrid, projects_delete: LayoutGrid,
  tasks_view: ListChecks, tasks_add: ListChecks,
  tasks_update: ListChecks, tasks_done: ListChecks, tasks_delete: ListChecks,
  research_view: FileSearch, research_add: FilePlus, research_update: Pencil,
  memory_search: Search, memory_read: FileText,
};

const CLAUDE_EFFORT_LEVELS = [
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'max', label: 'max' },
  { value: 'xhigh', label: 'xhigh' },
];

const CODEX_EFFORT_LEVELS = [
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

function ModelSelector({ gateway, disabled, sessionId }: { gateway: ReturnType<typeof useGateway>; disabled: boolean; sessionId?: string }) {
  const providerName = (gateway.configData as any)?.provider?.name || 'claude';
  // Per-session model if set, otherwise fall back to the default (config-level) model
  const claudeModel = gateway.getSessionModel(sessionId) || DEFAULT_CLAUDE_MODEL;
  const codexModel = (gateway.configData as any)?.provider?.codex?.model || DEFAULT_CODEX_MODEL;
  const [codexAuthMethod, setCodexAuthMethod] = useState<string | undefined>(undefined);
  const codexOptions = codexModelsForAuth(codexAuthMethod, codexModel);
  const currentValue = providerName === 'codex' ? `codex:${codexModel}` : `claude:${claudeModel}`;

  useEffect(() => {
    gateway.getProviderAuth('codex')
      .then((auth) => setCodexAuthMethod(auth.method))
      .catch(() => {});
  }, [gateway.getProviderAuth]);

  useEffect(() => {
    if (providerName === 'codex' && gateway.providerInfo?.auth?.method) {
      setCodexAuthMethod(gateway.providerInfo.auth.method);
    }
  }, [gateway.providerInfo, providerName]);

  const handleChange = async (encoded: string) => {
    const [provider, model] = encoded.split(':') as [string, string];
    if (provider === 'claude') {
      if (providerName !== 'claude') await gateway.setProvider('claude');
      // If we have a session, set the model per-session; otherwise change the default.
      if (sessionId) {
        gateway.changeSessionModel(sessionId, model);
      } else {
        gateway.changeModel(model);
      }
    } else {
      if (providerName !== 'codex') await gateway.setProvider('codex');
      await gateway.setConfig('provider.codex.model', model);
    }
  };

  const currentLabel = providerName === 'codex'
    ? labelForModel(CODEX_MODELS, codexModel)
    : labelForModel(CLAUDE_MODELS, claudeModel);

  const reasoningEffort = (gateway.configData as any)?.reasoningEffort || null;

  const handleEffortChange = async (value: string) => {
    const v = value === 'off' ? null : value;
    await gateway.setConfig('reasoningEffort', v);
  };

  return (
    <div className="flex items-center gap-1 min-w-0 shrink">
      <Select value={currentValue} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger size="sm" className="h-7 gap-1.5 text-[11px] rounded-lg shadow-none w-auto min-w-0">
          <img
            src={providerName === 'codex' ? './openai-icon.svg' : './claude-icon.svg'}
            alt=""
            className="w-3 h-3"
          />
          <span>{currentLabel}</span>
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="min-w-[180px]">
          <div className="px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Anthropic</div>
          {CLAUDE_MODELS.map(m => (
            <SelectItem key={m.value} value={`claude:${m.value}`} className="text-xs">
              <span className="flex items-center gap-1.5">
                <img src="./claude-icon.svg" alt="" className="w-3 h-3" />
                {m.label}
              </span>
            </SelectItem>
          ))}
          <div className="px-2 py-1 mt-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border">OpenAI</div>
          {codexOptions.map(m => (
            <SelectItem key={m.value} value={`codex:${m.value}`} className="text-xs">
              <span className="flex items-center gap-1.5">
                <img src="./openai-icon.svg" alt="" className="w-3 h-3" />
                {m.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Effort selector — provider-aware icon and levels */}
      {(() => {
        const isClaude = providerName === 'claude';
        const effortLevels = isClaude ? CLAUDE_EFFORT_LEVELS : CODEX_EFFORT_LEVELS;
        const EffortIcon = isClaude ? Brain : Sparkles;
        return (
          <Select value={reasoningEffort || 'off'} onValueChange={handleEffortChange} disabled={disabled}>
            <SelectTrigger size="sm" className="h-7 gap-1 text-[11px] rounded-lg shadow-none w-auto text-muted-foreground">
              <EffortIcon className="w-3 h-3" />
              <span>{reasoningEffort || 'auto'}</span>
            </SelectTrigger>
            <SelectContent position="popper" align="start" className="min-w-[120px]">
              <SelectItem value="off" className="text-xs">auto</SelectItem>
              {effortLevels.map(e => (
                <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })()}
    </div>
  );
}

function ThinkingItem({ item }: { item: Extract<ChatItem, { type: 'thinking' }> }) {
  const [open, setOpen] = useState(true);
  const wasStreaming = useRef(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wasStreaming.current && !item.streaming) setOpen(false);
    wasStreaming.current = !!item.streaming;
  }, [item.streaming]);

  useEffect(() => {
    if (item.streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [item.content, item.streaming]);

  // Empty thinking block = display: 'omitted' (Claude thought but didn't share).
  // No expandable content, no chevron, just a sweep while streaming / static pill when done.
  const hasContent = !!item.content?.trim();
  if (!hasContent) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] py-0.5 my-1">
        <Brain className="w-3 h-3 text-muted-foreground" />
        {item.streaming ? (
          <span className="compacting-sheen font-medium">Thinking</span>
        ) : (
          <span className="text-muted-foreground/70 italic">Thought</span>
        )}
      </div>
    );
  }

  const label = item.streaming ? 'Thinking...' : 'Thought';

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="thinking-container my-1">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5 group">
        <Brain className="w-3 h-3" />
        <span className={item.streaming ? 'compacting-sheen font-medium' : undefined}>{label}</span>
        <ChevronRight className="w-3 h-3 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div ref={bodyRef} className="thinking-body thinking-body-faded prose-chat text-muted-foreground text-xs">
          <Markdown remarkPlugins={[remarkGfm]}>{item.content}</Markdown>
          {item.streaming && <span className="streaming-cursor" />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolUseItem({ item }: { item: Extract<ChatItem, { type: 'tool_use' }> }) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const { onOpenFile, onOpenDiff } = useContext(ToolActionsContext);
  const hasOutput = item.output != null;
  const isPending = item.streaming || !hasOutput;
  const displayName = toolText(item.name, isPending ? 'pending' : 'done');
  const useStreamCard = hasStreamCard(item.name);

  // Read/Grep/Glob are fast, AskUserQuestion shows answered state collapsed
  const startCollapsed = item.name === 'Read' || item.name === 'Grep' || item.name === 'Glob' || item.name === 'AskUserQuestion';
  const isOpen = manualOpen !== null ? manualOpen : (isPending && !startCollapsed);

  const parsed = safeParse(item.input);
  const inputDetail = (() => {
    if (item.name === 'AskUserQuestion' && item.output) return item.output;
    return parsed.command?.split('\n')[0] || parsed.file_path || parsed.pattern || parsed.url || parsed.query || parsed.description || '';
  })();

  const canOpenInTab = !isPending && !item.is_error &&
    (item.name === 'Edit' || item.name === 'Write') &&
    onOpenFile && parsed.file_path;

  const handleOpenInTab = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenFile && parsed.file_path) {
      onOpenFile(parsed.file_path);
    }
  };

  // screenshot: show image inline after collapse
  const isScreenshot = item.name === 'screenshot';
  const screenshotSrc = isScreenshot
    ? (item.imageData || (item.output && item.output.startsWith('data:') ? item.output : undefined))
    : undefined;

  if (useStreamCard) {
    return (
      <div className="max-w-md">
        <Collapsible open={isOpen} onOpenChange={v => setManualOpen(v)}>
          {/* collapsed header — only visible when collapsed */}
          {!isOpen && (
            <div className="flex items-center gap-0">
              <CollapsibleTrigger className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors rounded-md border border-border/40">
                {(() => {
                  const Icon = TOOL_ICONS[item.name] || Wrench;
                  return <Icon className={item.is_error ? 'w-3 h-3 text-destructive' : 'w-3 h-3 text-muted-foreground'} />;
                })()}
                <span className="text-muted-foreground font-medium">{displayName}</span>
                <span className="text-muted-foreground/60 flex-1 truncate text-left text-[11px]">{inputDetail}</span>
                {!canOpenInTab && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
              </CollapsibleTrigger>
              {canOpenInTab && (
                <button
                  className="ml-1 p-1.5 rounded-md border border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors shrink-0"
                  onClick={handleOpenInTab}
                  title="Open file in tab"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <CollapsibleContent forceMount={isOpen ? true : undefined}>
            {isOpen && (
              <div className="relative">
                {/* action buttons when done */}
                {!isPending && (
                  <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
                    {canOpenInTab && (
                      <button
                        className="p-0.5 rounded bg-background/80 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        onClick={handleOpenInTab}
                        title="Open file in tab"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      className="p-0.5 rounded bg-background/80 hover:bg-secondary text-muted-foreground"
                      onClick={() => setManualOpen(false)}
                      title="collapse"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <ToolStreamCard
                  name={item.name}
                  input={item.input}
                  output={item.output}
                  imageData={item.imageData}
                  isError={item.is_error}
                  streaming={item.streaming}
                  subItems={item.subItems}
                />
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
        {/* screenshot: show image inline in chat after card collapses */}
        {isScreenshot && !isOpen && screenshotSrc && (
          <img
            src={screenshotSrc}
            alt="screenshot"
            className="mt-1.5 rounded-md border border-border/40 w-full cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => setManualOpen(true)}
          />
        )}
      </div>
    );
  }

  // fallback: old collapsible style for unmapped tools
  return (
    <Collapsible open={isOpen} onOpenChange={v => setManualOpen(v)}>
      <Card className="my-1 overflow-hidden border-border/50 max-w-md">
        <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors">
          {(() => {
            const Icon = TOOL_ICONS[item.name] || Wrench;
            if (item.streaming) return <Icon className="w-3 h-3 text-muted-foreground animate-pulse" />;
            if (hasOutput) return <Icon className={item.is_error ? 'w-3 h-3 text-destructive' : 'w-3 h-3 text-foreground'} />;
            return <Icon className="w-3 h-3 text-muted-foreground" />;
          })()}
          <span className="text-warning font-semibold">{displayName}</span>
          <span className="text-muted-foreground flex-1 truncate text-left">{inputDetail}</span>
          {isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/50 px-3 py-2 bg-background">
            <ToolUI
              name={item.name}
              input={item.input}
              output={item.output}
              imageData={item.imageData}
              isError={item.is_error}
              streaming={item.streaming}
            />
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// Collapses long user messages so they don't dominate the chat view.
// When expanded/collapsed, scroll is compensated to keep the arrow button
// anchored at the same screen position, so content below stays put and
// the bubble visually grows/shrinks upward.
const USER_MESSAGE_COLLAPSE_PX = 240;

function CopyMessageButton({
  getText,
  variant = 'inline',
  className,
}: {
  getText: () => string;
  variant?: 'inline' | 'overlay';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  useEffect(() => () => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current); }, []);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = getText();
    if (!text) return;
    const write = async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setCopied(true);
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => setCopied(false), 1100);
      } catch { /* noop */ }
    };
    void write();
  };
  const base = variant === 'overlay'
    ? 'absolute top-1 right-1 inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/60 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity'
    : 'inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] text-muted-foreground/70 hover:text-foreground hover:bg-secondary/60 transition-colors';
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(base, className)}
      title={copied ? 'Copied' : 'Copy message'}
      aria-label={copied ? 'Copied' : 'Copy message'}
    >
      {copied
        ? <Check className="w-3 h-3" />
        : <Copy className="w-3 h-3" />}
      {variant === 'inline' && (
        <span className="select-none">{copied ? 'copied' : 'copy'}</span>
      )}
    </button>
  );
}

function UserMessageItem({ item }: { item: Extract<ChatItem, { type: 'user' }> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  // Measure content height to decide whether collapse is needed.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () => {
      setNeedsCollapse(el.scrollHeight > USER_MESSAGE_COLLAPSE_PX + 20);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [item.content]);

  const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return node;
      node = node.parentElement;
    }
    return null;
  };

  const toggle = () => {
    const btn = btnRef.current;
    const viewport = findScrollParent(rootRef.current);
    if (!btn || !viewport) {
      setExpanded(e => !e);
      return;
    }
    // Record the arrow button's position relative to the viewport, then
    // after the DOM settles, scroll so it lands in the same spot.
    const vpTopBefore = viewport.getBoundingClientRect().top;
    const btnTopBefore = btn.getBoundingClientRect().top;
    const offsetBefore = btnTopBefore - vpTopBefore;

    setExpanded(e => !e);

    // Two RAFs: first for React commit, second for VirtualChatList re-layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!btnRef.current) return;
        const vpTopAfter = viewport.getBoundingClientRect().top;
        const btnTopAfter = btnRef.current.getBoundingClientRect().top;
        const offsetAfter = btnTopAfter - vpTopAfter;
        const delta = offsetAfter - offsetBefore;
        if (delta !== 0) {
          viewport.scrollBy({ top: delta, behavior: 'auto' });
        }
      });
    });
  };

  const collapsed = needsCollapse && !expanded;

  return (
    <div ref={rootRef} className="group relative flex gap-2 px-2 py-1.5 my-1 bg-secondary rounded-md min-w-0">
      <span className="text-primary font-semibold shrink-0">{'>'}</span>
      <div className="min-w-0 flex-1">
        {item.images?.length ? (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {item.images.map((img, j) => (
              <img
                key={j}
                src={`data:${img.mediaType};base64,${img.data}`}
                alt="attached"
                className="max-h-32 rounded border border-border/40 object-cover"
              />
            ))}
          </div>
        ) : null}
        {item.content && (
          <div className="relative">
            <div
              ref={contentRef}
              className="text-foreground break-words prose-chat overflow-hidden"
              style={collapsed ? { maxHeight: `${USER_MESSAGE_COLLAPSE_PX}px` } : undefined}
            >
              <Markdown remarkPlugins={[remarkGfm]}>{item.content}</Markdown>
            </div>
            {collapsed && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-secondary to-transparent" />
            )}
            {needsCollapse && (
              <button
                ref={btnRef}
                onClick={toggle}
                className="relative mt-1 flex w-full items-center justify-center py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                title={expanded ? 'Collapse' : 'Expand'}
                aria-label={expanded ? 'Collapse message' : 'Expand message'}
              >
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
        )}
      </div>
      {item.content && (
        <CopyMessageButton variant="overlay" getText={() => item.content} />
      )}
    </div>
  );
}

function AskUserQuestionPanel({
  question,
  onAnswer,
  onDismiss,
  streaming,
}: {
  question: AskUserQuestion;
  onAnswer: (requestId: string, answers: Record<string, string>) => void;
  onDismiss: () => void;
  streaming?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [useOther, setUseOther] = useState<Record<string, boolean>>({});

  const total = question.questions.length;
  const q = question.questions[step];
  const options = q?.options || [];

  const handleSelect = (questionText: string, label: string, multiSelect: boolean) => {
    if (multiSelect) {
      setSelections(prev => {
        const current = prev[questionText] || '';
        const labels = current ? current.split(', ') : [];
        const idx = labels.indexOf(label);
        if (idx >= 0) labels.splice(idx, 1);
        else labels.push(label);
        return { ...prev, [questionText]: labels.join(', ') };
      });
      setUseOther(prev => ({ ...prev, [questionText]: false }));
    } else {
      setSelections(prev => ({ ...prev, [questionText]: label }));
      setUseOther(prev => ({ ...prev, [questionText]: false }));
    }
  };

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    for (const qq of question.questions) {
      if (useOther[qq.question] && otherTexts[qq.question]) {
        answers[qq.question] = otherTexts[qq.question];
      } else {
        answers[qq.question] = selections[qq.question] || '';
      }
    }
    onAnswer(question.requestId, answers);
  };

  if (!q) return null;

  const currentAnswered =
    (useOther[q.question] && otherTexts[q.question]) || selections[q.question];
  const isLast = step === total - 1;

  // Countdown timer (5 min timeout from gateway)
  const [secondsLeft, setSecondsLeft] = useState(300);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(interval);
  }, []);
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <div className="border-t border-primary bg-card shrink-0">
      {/* Collapsible header - always visible */}
      <button
        className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-secondary/30 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle className="w-3 h-3 text-primary shrink-0" />
          <span className="text-xs font-medium">{q.header}: {q.question}</span>
          {total > 1 && (
            <span className="text-[10px] text-muted-foreground shrink-0">{step + 1}/{total}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('text-[10px] tabular-nums', secondsLeft < 60 ? 'text-destructive' : 'text-muted-foreground')}>
            {mins}:{secs.toString().padStart(2, '0')}
          </span>
          {collapsed ? <ChevronRight className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
        </div>
      </button>

      {/* Expandable content */}
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="flex flex-col gap-1">
            {options.map((opt, oi) => {
              const selected = q.multiSelect
                ? (selections[q.question] || '').split(', ').includes(opt.label)
                : selections[q.question] === opt.label && !useOther[q.question];
              return (
                <button
                  key={oi}
                  className={cn(
                    'flex flex-col items-start px-2.5 py-1.5 rounded-md border text-left w-full transition-colors',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:border-primary/50'
                  )}
                  onClick={() => handleSelect(q.question, opt.label, q.multiSelect)}
                >
                  <span className="text-xs font-medium">{opt.label}</span>
                  {opt.description && <span className="text-[10px] text-muted-foreground leading-tight">{opt.description}</span>}
                </button>
              );
            })}
            <button
              className={cn(
                'flex flex-col items-start px-2.5 py-1.5 rounded-md border text-left w-full transition-colors',
                useOther[q.question]
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background hover:border-primary/50'
              )}
              onClick={() => {
                setUseOther(prev => ({ ...prev, [q.question]: true }));
                setSelections(prev => ({ ...prev, [q.question]: '' }));
              }}
            >
              <span className="text-xs font-medium">Other</span>
              <span className="text-[10px] text-muted-foreground">type your own answer</span>
            </button>
          </div>
          {useOther[q.question] && (
            <input
              className="w-full px-2.5 py-1.5 bg-background border border-primary rounded-md text-xs outline-none placeholder:text-muted-foreground"
              placeholder="type your answer..."
              value={otherTexts[q.question] || ''}
              onChange={e => setOtherTexts(prev => ({ ...prev, [q.question]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && isLast) handleSubmit(); else if (e.key === 'Enter') setStep(s => s + 1); }}
              autoFocus
            />
          )}
          <div className="flex justify-between pt-0.5">
            <div>
              {step > 0 && (
                <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={() => setStep(s => s - 1)}>back</Button>
              )}
            </div>
            <div className="flex gap-1.5">
              {streaming ? (
                <span className="text-[10px] text-muted-foreground animate-pulse">loading...</span>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={isLast ? handleSubmit : () => setStep(s => s + 1)}>skip</Button>
                  {isLast ? (
                    <Button size="sm" className="h-6 text-[11px] px-2" onClick={handleSubmit} disabled={!currentAnswered}>answer</Button>
                  ) : (
                    <Button size="sm" className="h-6 text-[11px] px-2" onClick={() => setStep(s => s + 1)} disabled={!currentAnswered}>next</Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SUGGESTIONS: { icon: LucideIcon; label: string; prompt: string }[] = [
  { icon: Search, label: 'scan my competitors', prompt: 'research the latest AI coding tools on GitHub and Hacker News, summarize what\'s new' },
  { icon: MapPin, label: 'plan my weekend', prompt: 'help me plan a trip this weekend, find restaurants, activities, and keep it under budget' },
  { icon: PenLine, label: 'draft a launch post', prompt: 'write a Reddit launch post for my project, make it authentic and not too salesy' },
  { icon: GitPullRequest, label: 'review my latest PR', prompt: 'review the most recent pull request on this repo' },
  { icon: Brain, label: 'what did we do this week?', prompt: 'summarize everything we worked on this week from your memory' },
  { icon: Radio, label: 'set up a research agent', prompt: 'every morning, scan Hacker News and Twitter for AI agent news and send me a summary on Telegram' },
];

const QUICK_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '⌘T', label: 'new tab' },
  { keys: '⌘W', label: 'close tab' },
  { keys: '⌘L', label: 'focus input' },
  { keys: '⌘B', label: 'files' },
  { keys: '⌘D', label: 'split' },
  { keys: '⌘,', label: 'settings' },
  { keys: 'Esc', label: 'stop' },
];

function ImagePreviewStrip({ images, onRemove }: { images: ImageAttachment[]; onRemove: (index: number) => void }) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3">
      {images.map((img, j) => (
        <div key={j} className="relative group">
          <img
            src={`data:${img.mediaType};base64,${img.data}`}
            alt="attachment"
            className="h-16 rounded border border-border/40 object-cover"
          />
          <button
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onRemove(j)}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ChatProgress({ items }: { items: { content: string; status: string; activeForm: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const done = items.filter(i => i.status === 'completed').length;
  const total = items.length;
  const inProgress = items.find(i => i.status === 'in_progress');
  const pct = Math.round((done / total) * 100);

  return (
    <div className="px-4 shrink-0">
      <div className="rounded-lg bg-secondary/40 overflow-hidden">
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-secondary/60 transition-colors text-left"
          onClick={() => setExpanded(v => !v)}
        >
          <Loader2 className="w-3 h-3 text-primary shrink-0 animate-spin" />
          <span className="text-[11px] text-muted-foreground truncate flex-1">
            {inProgress ? inProgress.activeForm : `${done}/${total} tasks`}
          </span>
          <div className="w-12 h-1 bg-secondary rounded-full overflow-hidden shrink-0">
            <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">{done}/{total}</span>
          {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        </button>
        {expanded && (
          <div className="px-3 pb-2 space-y-0.5">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                {item.status === 'completed' ? (
                  <Check className="w-3 h-3 text-success shrink-0" />
                ) : item.status === 'in_progress' ? (
                  <Loader2 className="w-3 h-3 text-primary shrink-0 animate-spin" />
                ) : (
                  <Circle className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                )}
                <span className={item.status === 'completed' ? 'text-muted-foreground/50' : item.status === 'in_progress' ? 'text-foreground' : 'text-muted-foreground'}>
                  {item.status === 'in_progress' ? item.activeForm : item.content}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'good morning';
  if (h < 17) return 'good afternoon';
  return 'good evening';
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw;
  return raw.slice(end + 4).trimStart();
}

/** Shared dropdown overlays for slash commands, @ file picker, and active skill badge. */
function InputDropdowns({
  slashOpen, filteredSlashCommands, slashIndex, slashListRef, handleSlashSelect,
  atOpen, atEntries, atLoading, atIndex, atListRef, handleAtSelect,
  activeSkill, clearSkill,
}: {
  slashOpen: boolean;
  filteredSlashCommands: SlashItem[];
  slashIndex: number;
  slashListRef: React.RefObject<HTMLDivElement | null>;
  handleSlashSelect: (item: SlashItem) => void;
  atOpen: boolean;
  atEntries: Array<{ name: string; type: 'directory' | 'file' }>;
  atLoading: boolean;
  atIndex: number;
  atListRef: React.RefObject<HTMLDivElement | null>;
  handleAtSelect: (entry: { name: string; type: 'directory' | 'file' }) => void;
  activeSkill: { name: string; content: string } | null;
  clearSkill: () => void;
}) {
  return (
    <>
      {/* slash command dropdown */}
      {slashOpen && filteredSlashCommands.length > 0 && (
        <div ref={slashListRef} className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-border bg-popover shadow-md z-20 max-h-60 overflow-y-auto overflow-x-hidden">
          {filteredSlashCommands.map((cmd, i) => (
            <button
              key={cmd.command}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors',
                i === slashIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
              )}
              onMouseDown={e => {
                e.preventDefault();
                handleSlashSelect(cmd);
              }}
            >
              {cmd.type === 'skill' ? (
                <Wrench className="w-3 h-3 text-primary shrink-0" />
              ) : (
                <Terminal className="w-3 h-3 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono text-primary">{cmd.command}</span>
              <span className="text-muted-foreground truncate">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}
      {/* @ file picker dropdown */}
      {atOpen && (atEntries.length > 0 || atLoading) && (
        <div ref={atListRef} className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-border bg-popover shadow-md z-20 max-h-60 overflow-y-auto overflow-x-hidden">
          {atLoading && atEntries.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>loading...</span>
            </div>
          ) : (
            atEntries.map((entry, i) => (
              <button
                key={entry.name}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors',
                  i === atIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                )}
                onMouseDown={e => {
                  e.preventDefault();
                  handleAtSelect(entry);
                }}
              >
                {entry.type === 'directory' ? (
                  <FolderSearch className="w-3 h-3 text-primary shrink-0" />
                ) : (
                  <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                <span className="font-mono">{entry.name}{entry.type === 'directory' ? '/' : ''}</span>
              </button>
            ))
          )}
        </div>
      )}
      {activeSkill && (
        <div className="flex items-center gap-1.5 px-3 pt-2">
          <Badge variant="secondary" className="gap-1 text-[10px] h-5">
            <Wrench className="w-2.5 h-2.5" />
            {activeSkill.name}
            <button type="button" className="ml-0.5 hover:text-foreground" onClick={clearSkill}>
              <X className="w-2.5 h-2.5" />
            </button>
          </Badge>
          <span className="text-[10px] text-muted-foreground">skill loaded</span>
        </div>
      )}
    </>
  );
}

export function ChatView({ gateway, chatItems, agentStatus, pendingQuestion, sessionKey, onNavigateSettings, onOpenFile, onOpenDiff, onClearChat, onNewTab }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [compact, setCompact] = useState(false);
  const [inputHeight, setInputHeight] = useState<number | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [activeSkill, setActiveSkill] = useState<{ name: string; content: string } | null>(null);
  const [skillsList, setSkillsList] = useState<SkillInfo[]>([]);
  const [atOpen, setAtOpen] = useState(false);
  const [atFilter, setAtFilter] = useState('');
  const [atIndex, setAtIndex] = useState(0);
  const [atEntries, setAtEntries] = useState<Array<{ name: string; type: 'directory' | 'file' }>>([]);
  const [atLoading, setAtLoading] = useState(false);
  const [atStartPos, setAtStartPos] = useState(-1);
  const nextAutoScrollBehaviorRef = useRef<ScrollBehavior>('auto');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const landingInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const landingRef = useRef<HTMLDivElement>(null);
  const sentHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const historyInitRef = useRef(false);
  const slashListRef = useRef<HTMLDivElement>(null);
  const atListRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);
  const draftsRef = useRef<Record<string, { text: string; images: ImageAttachment[] }>>({});
  const liveInputRef = useRef(input);
  liveInputRef.current = input;
  const liveImagesRef = useRef(attachedImages);
  liveImagesRef.current = attachedImages;
  const isRunning = agentStatus !== 'idle';
  const isEmpty = chatItems.length === 0;

  // Derive elicitation and worktree state from active session
  const activeState = sessionKey ? gateway.sessionStates[sessionKey] : undefined;
  const pendingElicitation = activeState?.pendingElicitation ?? null;

  // Save/restore input draft and images per session when switching tabs
  useEffect(() => {
    if (!sessionKey) return;
    const sk = sessionKey;
    setInput(draftsRef.current[sk]?.text || '');
    setAttachedImages(draftsRef.current[sk]?.images || []);
    // Reset ephemeral picker state
    setSlashOpen(false);
    setSlashFilter('');
    setAtOpen(false);
    setAtFilter('');
    setAtStartPos(-1);
    setActiveSkill(null);
    return () => {
      draftsRef.current[sk] = {
        text: liveInputRef.current,
        images: liveImagesRef.current,
      };
    };
  }, [sessionKey]);

  // Seed message history from existing chat items so ArrowUp works after reload
  useEffect(() => {
    if (historyInitRef.current || chatItems.length === 0) return;
    historyInitRef.current = true;
    const userMessages = chatItems
      .filter((item): item is Extract<ChatItem, { type: 'user' }> => item.type === 'user')
      .map(item => item.content.trim())
      .filter(Boolean);
    if (userMessages.length > 0) {
      sentHistoryRef.current = userMessages;
    }
  }, [chatItems]);

  // Fetch skills list from gateway
  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    let cancelled = false;
    gateway.rpc('skills.list').then((result: unknown) => {
      if (cancelled || !Array.isArray(result)) return;
      setSkillsList(result.filter((s: any) => s.eligibility?.eligible !== false).map((s: any) => ({
        name: s.name as string,
        description: (s.description || '') as string,
        eligibility: (s.eligibility || { eligible: true }) as { eligible: boolean },
      })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [gateway.connectionState, gateway]);

  // Load file entries for @ picker (debounced, path-validated)
  useEffect(() => {
    if (!atOpen) { setAtEntries([]); setAtLoading(false); return; }
    const lastSlash = atFilter.lastIndexOf('/');
    const dir = lastSlash >= 0 ? atFilter.slice(0, lastSlash + 1) : '';
    const basename = lastSlash >= 0 ? atFilter.slice(lastSlash + 1) : atFilter;
    const listPath = dir || '.';

    // Reject absolute paths and path traversal
    if (listPath.startsWith('/') || listPath.includes('..')) {
      setAtEntries([]);
      setAtLoading(false);
      return;
    }

    let cancelled = false;
    setAtLoading(true);
    const timer = setTimeout(() => {
      gateway.rpc('fs.list', { path: listPath }).then((result: unknown) => {
        if (cancelled || !Array.isArray(result)) return;
        const entries = result as Array<{ name: string; type: 'directory' | 'file' }>;
        const filtered = basename
          ? entries.filter(e => e.name.toLowerCase().includes(basename.toLowerCase()))
          : entries.filter(e => !e.name.startsWith('.'));
        setAtEntries(filtered.slice(0, 20));
        setAtIndex(0);
      }).catch(() => { if (!cancelled) setAtEntries([]); })
        .finally(() => { if (!cancelled) setAtLoading(false); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [atOpen, atFilter, gateway]);

  const slashItems = useMemo<SlashItem[]>(() => {
    const commands: SlashItem[] = [
      { command: '/clear', description: 'Clear chat', type: 'command' },
      { command: '/new', description: 'New tab', type: 'command' },
      { command: '/help', description: 'Keyboard shortcuts', type: 'command' },
    ];
    const skills: SlashItem[] = skillsList.map(s => ({
      command: `/${s.name}`,
      description: s.description,
      type: 'skill',
    }));
    return [...commands, ...skills];
  }, [skillsList]);

  const filteredSlashCommands = useMemo(() => {
    if (!slashOpen) return [];
    const filter = slashFilter.toLowerCase();
    return slashItems.filter(c =>
      c.command.toLowerCase().includes(filter) ||
      c.description.toLowerCase().includes(filter)
    );
  }, [slashOpen, slashFilter, slashItems]);

  // Scroll active dropdown item into view on keyboard nav
  useEffect(() => {
    const container = slashListRef.current;
    if (!container || !slashOpen) return;
    const el = container.children[slashIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex, slashOpen]);

  useEffect(() => {
    const container = atListRef.current;
    if (!container || !atOpen) return;
    const el = container.children[atIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [atIndex, atOpen]);

  // progress from last TodoWrite in this chat
  const progress = useMemo(() => {
    for (let i = chatItems.length - 1; i >= 0; i--) {
      const item = chatItems[i];
      if (item.type === 'tool_use' && item.name === 'TodoWrite') {
        try {
          const parsed = (item as any).streaming
            ? JSON.parse(jsonrepair(item.input))
            : JSON.parse(item.input);
          const todos = (parsed.todos || []) as { content: string; status: string; activeForm: string }[];
          if (todos.length > 0 && todos.every(t => t.status === 'completed')) return [];
          return todos;
        } catch { return []; }
      }
    }
    return [];
  }, [chatItems]);

  useEffect(() => {
    if (!isEmpty) return;
    const el = landingRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e.contentRect.height > 0) setCompact(e.contentRect.height < 360);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isEmpty]);

  const addImagesFromFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        if (base64) {
          setAttachedImages(prev => [...prev, { data: base64, mediaType: file.type }]);
        }
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(i => i.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) addImagesFromFiles([file]);
    }
  }, [addImagesFromFiles]);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.files) addImagesFromFiles(e.dataTransfer.files);
  }, [addImagesFromFiles]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  // Derive streamingQuestion from this session's chatItems (not the global active session)
  const streamingQuestion = useMemo<AskUserQuestion['questions'] | null>(() => {
    for (let i = chatItems.length - 1; i >= 0; i--) {
      const item = chatItems[i];
      if (item.type === 'tool_use' && item.name === 'AskUserQuestion' && item.streaming) {
        const parsed = safeParse(item.input);
        const qs = parsed.questions;
        if (!Array.isArray(qs) || qs.length === 0) return null;
        const valid = qs.filter((q: any) => q?.question && Array.isArray(q?.options));
        return valid.length > 0 ? valid : null;
      }
    }
    return null;
  }, [chatItems]);

  // Filter approvals to this session only (avoid showing other panes' approvals)
  const sessionApprovals = useMemo(() => {
    if (!sessionKey) return gateway.pendingApprovals;
    return gateway.pendingApprovals.filter(a => !a.sessionKey || a.sessionKey === sessionKey);
  }, [gateway.pendingApprovals, sessionKey]);

  useEffect(() => {
    if (isEmpty) {
      landingInputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [isEmpty]);

  const handleSend = async (overridePrompt?: string) => {
    let prompt = overridePrompt || input.trim();
    if ((!prompt && attachedImages.length === 0) || sending || pendingQuestion) return;

    // Inject active skill context into prompt
    if (activeSkill) {
      const safeName = activeSkill.name.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
      prompt = `<skill-context name="${safeName}">\n${activeSkill.content}\n</skill-context>\n\n${prompt}`;
      setActiveSkill(null);
    }

    // Push to message history
    if (prompt) {
      const history = sentHistoryRef.current;
      if (history[history.length - 1] !== prompt) {
        history.push(prompt);
      }
      historyIndexRef.current = -1;
    }

    const images = attachedImages.length > 0 ? [...attachedImages] : undefined;
    nextAutoScrollBehaviorRef.current = 'smooth';
    if (!overridePrompt) setInput('');
    setAttachedImages([]);
    setInputHeight(null);
    setSlashOpen(false);
    setSlashFilter('');
    setAtOpen(false);
    setAtFilter('');
    setAtStartPos(-1);
    setSending(true);
    try {
      const chatId = sessionKey ? sessionKey.split(':').slice(2).join(':') : undefined;
      await gateway.sendMessage(prompt || 'What do you see in this image?', sessionKey, chatId, images);
    } finally {
      setSending(false);
    }
  };

  const handleSlashSelect = async (item: SlashItem) => {
    setSlashOpen(false);
    setSlashFilter('');
    setInput('');

    if (item.type === 'command') {
      switch (item.command) {
        case '/clear':
          onClearChat?.();
          break;
        case '/new':
          onNewTab?.();
          break;
        case '/help':
          handleSend('/help');
          break;
      }
    } else {
      // Skill: fetch SKILL.md content and set as active context
      const skillName = item.command.slice(1);
      try {
        const result = await gateway.rpc('skills.read', { name: skillName }) as { raw?: string } | undefined;
        if (result?.raw) {
          setActiveSkill({ name: skillName, content: stripFrontmatter(result.raw) });
        } else {
          console.warn(`Skill "${skillName}" returned no content`);
        }
      } catch (err) {
        console.error(`Failed to load skill "${skillName}":`, err);
      }
      setTimeout(() => {
        inputRef.current?.focus();
        landingInputRef.current?.focus();
      }, 0);
    }
  };

  const handleAtSelect = (entry: { name: string; type: 'directory' | 'file' }) => {
    const lastSlash = atFilter.lastIndexOf('/');
    const dir = lastSlash >= 0 ? atFilter.slice(0, lastSlash + 1) : '';

    if (entry.type === 'directory') {
      // Navigate into directory: update the @path in input
      const newPath = dir + entry.name + '/';
      const before = input.slice(0, atStartPos + 1);
      const after = input.slice(atStartPos + 1 + atFilter.length);
      const newInput = before + newPath + after;
      setInput(newInput);
      setAtFilter(newPath);
      setAtIndex(0);
    } else {
      // Insert file path, replacing the @mention
      const fullPath = dir + entry.name;
      const before = input.slice(0, atStartPos);
      const after = input.slice(atStartPos + 1 + atFilter.length);
      setInput(before + fullPath + ' ' + after);
      setAtOpen(false);
      setAtFilter('');
    }
  };

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    historyIndexRef.current = -1;
    // slash command detection (only at start of input)
    if (value.startsWith('/')) {
      setSlashOpen(true);
      setSlashFilter(value.slice(1));
      setSlashIndex(0);
      setAtOpen(false);
    } else {
      setSlashOpen(false);
      setSlashFilter('');

      // @ file picker detection: find @ preceded by whitespace or at start
      let atIdx = -1;
      for (let i = value.length - 1; i >= 0; i--) {
        if (value[i] === ' ' || value[i] === '\n') break;
        if (value[i] === '@' && (i === 0 || /\s/.test(value[i - 1]))) {
          atIdx = i;
          break;
        }
      }
      if (atIdx >= 0) {
        const afterAt = value.slice(atIdx + 1);
        setAtOpen(true);
        setAtFilter(afterAt);
        setAtStartPos(atIdx);
        setAtIndex(0);
      } else {
        setAtOpen(false);
      }
    }
  }, []);

  const handleDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const textarea = inputRef.current || landingInputRef.current;
    if (!textarea) return;
    const startY = e.clientY;
    const startHeight = textarea.offsetHeight;
    dragStartRef.current = { y: startY, height: startHeight };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return;
      const delta = dragStartRef.current.y - ev.clientY;
      const newHeight = Math.min(400, Math.max(64, dragStartRef.current.height + delta));
      setInputHeight(newHeight);
    };
    const onMouseUp = () => {
      dragStartRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash command navigation
    if (slashOpen && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(i => (i - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex(i => (i + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = filteredSlashCommands[slashIndex];
        if (cmd) handleSlashSelect(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        setSlashFilter('');
        return;
      }
    }

    // @ file picker navigation
    if (atOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setAtOpen(false);
        setAtFilter('');
        return;
      }
      if (atEntries.length > 0) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setAtIndex(i => (i - 1 + atEntries.length) % atEntries.length);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setAtIndex(i => (i + 1) % atEntries.length);
          return;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          const entry = atEntries[atIndex];
          if (entry) handleAtSelect(entry);
          return;
        }
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        // Loading or no results: swallow Enter/Tab to prevent sending raw @path
        e.preventDefault();
        return;
      }
    }

    // Up arrow for message history (when input is empty or browsing history)
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const history = sentHistoryRef.current;
      if (history.length === 0) return;
      const currentIdx = historyIndexRef.current;
      const isAtStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
      if (input === '' || currentIdx >= 0 || isAtStart) {
        e.preventDefault();
        const nextIdx = currentIdx < 0 ? history.length - 1 : Math.max(0, currentIdx - 1);
        historyIndexRef.current = nextIdx;
        setInput(history[nextIdx]);
      }
      return;
    }

    // Down arrow for message history
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      const history = sentHistoryRef.current;
      const currentIdx = historyIndexRef.current;
      if (currentIdx >= 0) {
        e.preventDefault();
        if (currentIdx >= history.length - 1) {
          historyIndexRef.current = -1;
          setInput('');
        } else {
          const nextIdx = currentIdx + 1;
          historyIndexRef.current = nextIdx;
          setInput(history[nextIdx]);
        }
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  const renderItemBase = (item: ChatItem, i: number) => {
    switch (item.type) {
      case 'user':
        return <UserMessageItem key={i} item={item} />;
      case 'text':
        return (
          <div key={i} className="prose-chat py-1.5">
            <InlineErrorBoundary>
              <Markdown remarkPlugins={[remarkGfm]}>{item.content}</Markdown>
            </InlineErrorBoundary>
            {item.streaming && <span className="streaming-cursor" />}
          </div>
        );
      case 'tool_use':
        if (item.name === 'TodoWrite') {
          const todos = safeParse(item.input).todos || [];
          const done = todos.filter((t: any) => t.status === 'completed').length;
          return (
            <div key={i} className="flex items-center gap-2 text-[10px] text-muted-foreground py-0.5">
              <ListChecks className="w-3 h-3" />
              <span>tasks {done}/{todos.length}</span>
            </div>
          );
        }
        if (item.name === 'AskUserQuestion' && !item.output) return <div key={i} style={{ height: 0, overflow: 'hidden' }} />;
        return <div key={i} className="my-1.5"><InlineErrorBoundary><ToolUseItem item={item} /></InlineErrorBoundary></div>;
      case 'thinking':
        return <ThinkingItem key={i} item={item} />;
      case 'compacting':
        return (
          <div key={i} className="flex items-center gap-2 py-2 my-1">
            <span className="compacting-sheen text-[11px] text-muted-foreground font-medium">Compacting</span>
            <span className="compacting-dots text-[11px] text-muted-foreground" />
          </div>
        );
      case 'result':
        return (
          <div key={i} className="flex gap-2 text-[10px] text-muted-foreground py-1 mt-1 border-t border-border">
            {item.cost != null && <span>${item.cost.toFixed(4)}</span>}
            <span>{formatTime(item.timestamp)}</span>
          </div>
        );
      case 'error':
        return (
          <div key={i} className="text-destructive py-1 break-words min-w-0">
            {item.content}
          </div>
        );
    }
  };

  // Returns text to copy for the assistant thread ending at endIdx.
  // A thread = run of non-user items between two user messages (or list ends).
  const getThreadCopyText = (endIdx: number): string => {
    let start = 0;
    for (let j = endIdx; j >= 0; j--) {
      if (chatItems[j].type === 'user') { start = j + 1; break; }
      if (j === 0) start = 0;
    }
    const parts: string[] = [];
    for (let j = start; j <= endIdx; j++) {
      const it = chatItems[j];
      if (it.type === 'text' && it.content.trim()) parts.push(it.content);
    }
    return parts.join('\n\n').trim();
  };

  // True when the next item (if any) starts a new user turn AND this item
  // belongs to an assistant thread that has at least one text block to copy.
  const isAssistantThreadEnd = (i: number): boolean => {
    const item = chatItems[i];
    if (!item || item.type === 'user') return false;
    // Skip trailing 'result' markers; show the footer above them
    if (item.type === 'result' || item.type === 'compacting') return false;
    const next = chatItems[i + 1];
    // Still streaming tail — wait until the turn ends
    if (!next && isRunning) return false;
    if (next && next.type !== 'user') return false;
    // Need at least some text to copy
    let hasText = false;
    for (let j = i; j >= 0; j--) {
      const it = chatItems[j];
      if (it.type === 'user') break;
      if (it.type === 'text' && it.content.trim()) { hasText = true; break; }
    }
    return hasText;
  };

  const renderItem = (item: ChatItem, i: number) => {
    const base = renderItemBase(item, i);
    if (!isAssistantThreadEnd(i)) return base;
    return (
      <Fragment key={i}>
        {base}
        <div className="flex items-center justify-start -mt-0.5 mb-1.5 pl-0.5 opacity-70 hover:opacity-100 transition-opacity">
          <CopyMessageButton getText={() => getThreadCopyText(i)} />
        </div>
      </Fragment>
    );
  };

  const toolActions = useMemo(() => ({ onOpenFile, onOpenDiff }), [onOpenFile, onOpenDiff]);

  const connected = gateway.connectionState === 'connected';
  const authenticated = gateway.providerInfo?.auth?.authenticated ?? true; // assume true until loaded
  const isReady = connected && authenticated;
  const gatewayFailed = !connected && !!gateway.gatewayError;

  // landing page — centered input with suggestions
  if (isEmpty) {
    return (
      <div ref={landingRef} className="flex flex-col h-full min-h-0 min-w-0">
        <div className="flex-1 flex items-center justify-center min-h-0 min-w-0">
          <AuroraBackground className="w-full h-full">
            <div className={cn('w-full mx-auto', compact ? 'space-y-3 px-4' : 'space-y-6 max-w-2xl px-6')}>
              {/* greeting */}
              <div className="text-center space-y-2">
                <div className="relative mx-auto flex items-center justify-center" style={{ width: compact ? 80 : 136, height: compact ? 80 : 136 }}>
                  <div className="absolute rounded-full bg-success/30 blur-xl animate-pulse" style={{ width: compact ? 56 : 96, height: compact ? 56 : 96 }} />
                  <DorabotSprite size={compact ? 56 : 96} className="relative dorabot-alive" />
                </div>
                <h1 className={cn('font-semibold text-foreground', compact ? 'text-sm' : 'text-lg')}>{getGreeting()}</h1>
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <div className={cn('w-1.5 h-1.5 rounded-full', isReady ? 'bg-success' : connected && !authenticated ? 'bg-warning' : connected ? 'bg-success' : 'bg-destructive')} />
                  {gatewayFailed
                    ? <span className="text-destructive">{gateway.gatewayError?.error || 'gateway failed to start'}</span>
                    : !connected ? <>connecting...{gateway.gatewayTelemetry.reconnectCount > 2 && <span className="ml-1 opacity-60">({gateway.gatewayTelemetry.disconnectReason || 'retrying'})</span>}</>
                    : !authenticated ? <>set up provider in <button type="button" className="underline hover:text-foreground transition-colors" onClick={onNavigateSettings}>Settings</button></>
                    : 'ready'}
                </div>
                {gatewayFailed && gateway.gatewayError?.logs && (
                  <details className="mt-2 max-w-md mx-auto text-left">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">view logs</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-3 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all">{gateway.gatewayError.logs}</pre>
                  </details>
                )}
              </div>

              {/* centered input */}
              <Card className="relative rounded-2xl chat-input-area" onDrop={handleDrop} onDragOver={handleDragOver}>
                {/* drag handle */}
                <div
                  className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center group z-10"
                  onMouseDown={handleDragHandleMouseDown}
                >
                  <div className="w-8 h-0.5 rounded-full bg-border/60 group-hover:bg-border transition-colors" />
                </div>
                <InputDropdowns
                  slashOpen={slashOpen} filteredSlashCommands={filteredSlashCommands} slashIndex={slashIndex} slashListRef={slashListRef} handleSlashSelect={handleSlashSelect}
                  atOpen={atOpen} atEntries={atEntries} atLoading={atLoading} atIndex={atIndex} atListRef={atListRef} handleAtSelect={handleAtSelect}
                  activeSkill={activeSkill} clearSkill={() => setActiveSkill(null)}
                />
                <ImagePreviewStrip images={attachedImages} onRemove={j => setAttachedImages(prev => prev.filter((_, k) => k !== j))} />
                <Textarea
                  ref={landingInputRef}
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={!connected ? 'waiting for gateway...' : !authenticated ? 'set up your AI provider to get started' : 'what are we building?'}
                  disabled={!isReady}
                  className="w-full min-h-[80px] max-h-[200px] resize-none text-sm border-0 rounded-2xl bg-transparent shadow-none focus-visible:ring-0 pt-3"
                  style={inputHeight ? { height: inputHeight, minHeight: 64, maxHeight: 400 } : undefined}
                  rows={2}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => { if (e.target.files) addImagesFromFiles(e.target.files); e.target.value = ''; }}
                />
                <div className="flex items-center px-3 pb-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg mr-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isReady}
                    title="Attach image"
                  >
                    <Paperclip className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  <ModelSelector gateway={gateway} disabled={!connected} sessionId={activeState?.sessionId} />
                  {input.trim() && (
                    <span className="text-[9px] text-muted-foreground/60 ml-2 select-none hidden @sm:inline">{'\u21E7\u21B5 new line'}</span>
                  )}
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg"
                    onClick={() => { handleSend(); }}
                    disabled={(!input.trim() && attachedImages.length === 0) || sending || !isReady}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                </div>
              </Card>

              {/* suggestions */}
              {isReady && !compact && (
                <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => handleSend(s.prompt)}
                      className="group flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border/60 bg-card/50 hover:bg-card hover:border-primary/30 hover:shadow-sm transition-all text-left"
                    >
                      <s.icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{s.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* keyboard shortcuts */}
              {!compact && (
                <Collapsible>
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground/80 pt-2">
                    {QUICK_SHORTCUTS.map(s => (
                      <span key={s.keys} className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded border border-border/50 bg-muted/60 text-[10px] font-mono">{s.keys}</kbd>
                        <span>{s.label}</span>
                      </span>
                    ))}
                    <CollapsibleTrigger className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer">
                      <Keyboard className="w-3 h-3" />
                      <span>all shortcuts</span>
                      <ChevronDown className="w-3 h-3" />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <div className="grid grid-cols-1 @sm:grid-cols-2 gap-4 pt-3 max-w-md mx-auto">
                      {ALL_SHORTCUTS.map(s => (
                        <div key={s.section}>
                          <div className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1">{s.section}</div>
                          <div className="space-y-0.5">
                            {s.items.map(i => (
                              <div key={i.keys} className="flex items-center justify-between text-[10px] text-muted-foreground/80">
                                <span>{i.desc}</span>
                                <kbd className="px-1 py-0.5 rounded border border-border/50 bg-muted/60 text-[9px] font-mono shrink-0 ml-2">{i.keys}</kbd>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          </AuroraBackground>
        </div>
      </div>
    );
  }

  // conversation view — messages + bottom input
  return (
    <ToolActionsContext.Provider value={toolActions}>
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* messages */}
      <VirtualChatList
        items={chatItems}
        renderItem={renderItem}
        className="flex-1 min-h-0 min-w-0 overflow-auto"
        itemClassName="px-4 min-w-0 overflow-hidden"
        scrollBehavior={nextAutoScrollBehaviorRef.current}
        onScrollBehaviorConsumed={() => {
          nextAutoScrollBehaviorRef.current = 'auto';
        }}
      />

      {/* question panel — show during streaming or when pending */}
      {pendingQuestion ? (
        <AskUserQuestionPanel
          question={pendingQuestion}
          onAnswer={(requestId, answers) => gateway.answerQuestion(requestId, answers, sessionKey)}
          onDismiss={() => gateway.dismissQuestion(sessionKey)}
        />
      ) : streamingQuestion ? (
        <AskUserQuestionPanel
          question={{ requestId: '', questions: streamingQuestion }}
          onAnswer={() => {}}
          onDismiss={() => {}}
          streaming
        />
      ) : null}

      {/* elicitation form (structured questions from agent) */}
      {pendingElicitation && (
        <ElicitationForm
          elicitation={pendingElicitation}
          onSubmit={(elicitationId, values) => {
            // Send the elicitation result back via RPC
            gateway.rpc('chat.answerElicitation', { elicitationId, values, sessionKey }).catch(() => {});
          }}
          onDismiss={() => {
            gateway.rpc('chat.dismissElicitation', { elicitationId: pendingElicitation.elicitationId, sessionKey }).catch(() => {});
          }}
        />
      )}

      {/* approvals */}
      {sessionApprovals.length > 0 && (
        <div className="px-4 pt-2 shrink-0">
          <ApprovalList
            approvals={sessionApprovals}
            onApprove={gateway.approveToolUse}
            onDeny={gateway.denyToolUse}
          />
        </div>
      )}

      {/* progress */}
      {progress.length > 0 && <ChatProgress items={progress} />}

      {/* input area */}
      <div className="px-4 py-3 shrink-0 min-w-0">
        <Card className="relative rounded-2xl chat-input-area" onDrop={handleDrop} onDragOver={handleDragOver}>
          {/* drag handle */}
          <div
            className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center group z-10"
            onMouseDown={handleDragHandleMouseDown}
          >
            <div className="w-8 h-0.5 rounded-full bg-border/60 group-hover:bg-border transition-colors" />
          </div>
          <InputDropdowns
            slashOpen={slashOpen} filteredSlashCommands={filteredSlashCommands} slashIndex={slashIndex} slashListRef={slashListRef} handleSlashSelect={handleSlashSelect}
            atOpen={atOpen} atEntries={atEntries} atLoading={atLoading} atIndex={atIndex} atListRef={atListRef} handleAtSelect={handleAtSelect}
            activeSkill={activeSkill} clearSkill={() => setActiveSkill(null)}
          />
          <ImagePreviewStrip images={attachedImages} onRemove={j => setAttachedImages(prev => prev.filter((_, k) => k !== j))} />
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={connected ? 'type a message...' : 'waiting for gateway...'}
            disabled={!connected || !!pendingQuestion}
            className="w-full min-h-[64px] max-h-[200px] resize-none text-[13px] border-0 rounded-2xl bg-transparent shadow-none focus-visible:ring-0 pt-3"
            style={inputHeight ? { height: inputHeight, minHeight: 64, maxHeight: 400 } : undefined}
            rows={2}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => { if (e.target.files) addImagesFromFiles(e.target.files); e.target.value = ''; }}
          />
          <div className="flex items-center px-3 pb-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 rounded-lg mr-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={!connected}
              title="Attach image"
            >
              <Paperclip className="w-4 h-4 text-muted-foreground" />
            </Button>
            <ModelSelector gateway={gateway} disabled={!connected} sessionId={activeState?.sessionId} />
            {input.trim() && (
              <span className="text-[9px] text-muted-foreground/60 ml-2 select-none hidden @sm:inline">{'\u21E7\u21B5 new line'}</span>
            )}
            <span className="flex-1" />
            {isRunning ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 w-8 p-0 rounded-lg"
                onClick={() => gateway.abortAgent(sessionKey)}
              >
                <Square className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 w-8 p-0 rounded-lg"
                onClick={() => { handleSend(); }}
                disabled={(!input.trim() && attachedImages.length === 0) || sending || !connected}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
    </ToolActionsContext.Provider>
  );
}
