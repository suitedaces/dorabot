import { useState, useRef, useEffect, useMemo, useCallback, createContext, useContext, Fragment, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { DorabotSprite } from '../components/DorabotSprite';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { useGateway, ChatItem, AskUserQuestion, ImageAttachment, PendingElicitation, CodexModelCatalog, ClaudeModelCatalog, ProviderInputItem, ProviderUsage } from '../hooks/useGateway';
import type { ChatDraftStore } from '../hooks/useTabs';
import { ElicitationForm } from '../components/ElicitationForm';
import { ApprovalList } from '@/components/approval-ui';
import { ActivityGroup, buildDisplay, type DisplayItem, type ListCtx } from '@/components/tool-card/ToolList';
import { PlanPill, RunningPill } from '@/components/tool-card/StatusPills';
import type { TaskProgress, TurnEnd } from '../hooks/useGateway';
import { focusResearch } from '@/lib/research-focus';
import { InlineErrorBoundary } from '@/components/ErrorBoundary';
import { AuroraBackground } from '@/components/aceternity/aurora-background';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { VirtualChatList } from '@/components/VirtualChatList';
import { ContextWheel } from '@/components/ContextWheel';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { safeParse } from '@/lib/safe-parse';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Square, ChevronDown, ChevronUp, ChevronRight,
  FileText, FilePlus, Pencil, FolderSearch, FileSearch, Terminal,
  Globe, Search, Bot, MessageCircle, ListChecks, FileCode,
  MessageSquare, Camera, Monitor, Clock, Wrench, ArrowUp, LayoutGrid,
  Smile, Image, Brain, MapPin, PenLine, GitPullRequest, Radio,
  Paperclip, X, ExternalLink, Check, Circle, Loader2, Keyboard, Copy,
  Quote, Reply, Zap,
  type LucideIcon,
} from 'lucide-react';
import { SHORTCUTS as ALL_SHORTCUTS } from '@/components/ShortcutHelp';
import { jsonrepair } from 'jsonrepair';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_MODEL,
  claudeModelsFromCatalog,
  claudeReasoningEffortOptions,
  codexModelsFromCatalog,
  codexReasoningEffortOptions,
  type ModelOption,
  labelForModel,
  reasoningEffortIsSupported,
  reasoningEffortLabel,
} from '@/lib/modelCatalog';

type SlashItem = {
  command: string;
  description: string;
  type: 'command' | 'skill';
};

type SkillInfo = {
  name: string;
  description: string;
  path?: string;
  eligibility: { eligible: boolean };
};

type Props = {
  gateway: ReturnType<typeof useGateway>;
  chatItems: ChatItem[];
  agentStatus: string;
  pendingQuestion: AskUserQuestion | null;
  sessionKey?: string;
  drafts: ChatDraftStore;
  onNavigateSettings?: () => void;
  onOpenFile?: (filePath: string) => void;
  onOpenDiff?: (opts: { filePath: string; oldContent: string; newContent: string; label?: string }) => void;
  onOpenResearch?: () => void;
  onOpenTask?: (taskId: string, title: string) => void;
  onOpenTerminal?: () => void;
  onClearChat?: () => void;
  onNewTab?: () => void;
};



const LIVE_TOOLS = new Set(['Bash', 'Edit', 'Write', 'Agent', 'Task', 'MultiEdit']);
const EMPTY_TASKS: never[] = [];
const EMPTY_PROGRESS: Record<string, TaskProgress> = {};

function UsageMeter({ usage }: { usage?: ProviderUsage }) {
  if (!usage?.windows.length) return null;
  const top = usage.windows.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
  const resets = (ms?: number) => (ms ? new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'unknown');
  const title = ['Plan usage', ...usage.windows.map(w => `${w.label}: ${w.usedPercent}% used, resets ${resets(w.resetsAt)}`)].join('\n');
  return (
    <span
      title={title}
      className={cn(
        'h-7 px-1.5 hidden @[520px]:flex items-center text-[11px] tabular-nums rounded-lg shrink-0',
        top.usedPercent >= 95 ? 'text-destructive' : top.usedPercent >= 80 ? 'text-amber-500' : 'text-muted-foreground',
      )}
    >
      {top.label} {top.usedPercent}%
    </span>
  );
}

function ModelSelector({ gateway, disabled, sessionId, sessionKey }: { gateway: ReturnType<typeof useGateway>; disabled: boolean; sessionId?: string; sessionKey?: string }) {
  const providerName = (gateway.configData as any)?.provider?.name || 'claude';
  const isClaude = providerName !== 'codex';
  // this session's model: saved pick, unsent pick, or the last model picked anywhere
  const claudeModel = gateway.getSessionModel(sessionId, sessionKey) || DEFAULT_CLAUDE_MODEL;
  const codexModel = (gateway.configData as any)?.provider?.codex?.model || DEFAULT_CODEX_MODEL;
  const [codexCatalog, setCodexCatalog] = useState<CodexModelCatalog | null>(null);
  const [claudeCatalog, setClaudeCatalog] = useState<ClaudeModelCatalog | null>(null);
  const codexOptions = codexModelsFromCatalog(codexCatalog?.models, codexModel);
  const claudeOptions = claudeModelsFromCatalog(claudeCatalog?.models, claudeModel);
  const selected = isClaude
    ? claudeOptions.find(option => option.value === claudeModel) || null
    : codexOptions.find(option => option.value === codexModel) || null;
  const currentValue = isClaude ? `claude:${claudeModel}` : `codex:${codexModel}`;
  const reasoningEffort = (gateway.configData as any)?.reasoningEffort || null;
  const effortOptionsFor = (provider: string, option: ModelOption | null) =>
    provider === 'claude' ? claudeReasoningEffortOptions(option) : codexReasoningEffortOptions(option);

  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    let cancelled = false;
    gateway.getCodexModels()
      .then((catalog) => {
        if (!cancelled) setCodexCatalog(catalog);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gateway.connectionState, gateway.getCodexModels]);

  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    let cancelled = false;
    gateway.getClaudeModels()
      .then((catalog) => {
        if (!cancelled) setClaudeCatalog(catalog);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gateway.connectionState, gateway.getClaudeModels]);

  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    gateway.loadProviderUsage(isClaude ? 'claude' : 'codex').catch(() => {});
  }, [gateway.connectionState, gateway.loadProviderUsage, isClaude]);

  const handleChange = async (encoded: string) => {
    const [provider, model] = encoded.split(':') as [string, string];
    const option = (provider === 'claude' ? claudeOptions : codexOptions).find(candidate => candidate.value === model) || null;
    if (provider !== providerName) await gateway.setProvider(provider);
    if (provider === 'claude') {
      // always scoped to this chat. with no session row yet it rides along with the next message.
      gateway.selectModel(sessionKey || '', sessionId, model);
    } else {
      await gateway.setConfig('provider.codex.model', model);
    }
    if (reasoningEffort && !reasoningEffortIsSupported(effortOptionsFor(provider, option), reasoningEffort)) {
      await gateway.setConfig('reasoningEffort', null);
    }
    if (sessionKey && !option?.supportsFastMode) gateway.setSessionFastMode(sessionKey, false);
  };

  const currentLabel = labelForModel(isClaude ? claudeOptions : codexOptions, isClaude ? claudeModel : codexModel);

  const handleEffortChange = async (value: string) => {
    const v = value === 'off' ? null : value;
    await gateway.setConfig('reasoningEffort', v);
  };

  const providerGroups = [
    { provider: 'claude', heading: 'Anthropic', icon: './claude-icon.svg', options: claudeOptions },
    { provider: 'codex', heading: 'OpenAI', icon: './openai-icon.svg', options: codexOptions },
  ];

  return (
    <div className="flex items-center gap-1 min-w-0 shrink">
      <Select value={currentValue} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger size="sm" title={currentLabel} className="h-7 gap-1.5 text-[11px] rounded-lg shadow-none w-auto shrink-0 @[360px]:shrink @[360px]:min-w-[72px] max-w-[200px] @max-[400px]:px-2 @max-[400px]:[&>svg:last-child]:hidden">
          <img src={isClaude ? './claude-icon.svg' : './openai-icon.svg'} alt="" className="w-3 h-3 shrink-0" />
          {/* too tight for the name: the provider icon alone, name on hover */}
          <span className="hidden @[360px]:inline truncate min-w-0">{currentLabel}</span>
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="min-w-[180px]">
          {providerGroups.map((group, i) => (
            <div key={group.provider}>
              <div className={cn('px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider', i > 0 && 'mt-1 border-t border-border')}>{group.heading}</div>
              {group.options.map(m => (
                <SelectItem key={m.value} value={`${group.provider}:${m.value}`} className="text-xs">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <img src={group.icon} alt="" className="w-3 h-3" />
                      {m.label}
                      {m.isDefault && <span className="text-[9px] text-primary">default</span>}
                    </span>
                    {m.description && <span className="text-[10px] text-muted-foreground truncate max-w-72">{m.description}</span>}
                  </div>
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
      {(() => {
        const effortLevels = effortOptionsFor(providerName, selected);
        if (effortLevels.length === 0) return null;
        const effortValue = reasoningEffortIsSupported(effortLevels, reasoningEffort) ? reasoningEffort : 'off';
        return (
          <Select value={effortValue} onValueChange={handleEffortChange} disabled={disabled}>
            <SelectTrigger size="sm" className="h-7 gap-1 text-[11px] rounded-lg shadow-none w-auto shrink-0 text-muted-foreground @max-[400px]:px-2 @max-[400px]:[&>svg:last-child]:hidden" title={`effort: ${effortValue === 'off' ? 'auto' : reasoningEffortLabel(effortLevels, effortValue)}`}>
              <Brain className="w-3 h-3" />
              {/* narrow panes keep the icon; the label comes back from 480px */}
              <span className="hidden @[480px]:inline">{effortValue === 'off' ? 'auto' : reasoningEffortLabel(effortLevels, effortValue)}</span>
            </SelectTrigger>
            <SelectContent position="popper" align="start" className="min-w-[120px]">
              <SelectItem value="off" className="text-xs">auto</SelectItem>
              {effortLevels.map(e => (
                <SelectItem key={e.value} value={e.value} className="text-xs">
                  {e.label}{e.description ? ` (${e.description})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })()}
      {(() => {
        // desktop chats only: the gateway ignores fast mode for channel and calendar sessions
        if (!selected?.supportsFastMode) return null;
        if (!sessionKey?.startsWith('desktop:')) return null;
        const fastOn = gateway.getSessionFastMode(sessionKey);
        const available = !isClaude || claudeCatalog?.fastMode.available !== false;
        const what = isClaude
          ? 'up to 2.5x faster at 2x the price, billed to usage credits'
          : selected.fastModeDescription || 'faster, uses more of your plan';
        const title = !available
          ? `Fast mode unavailable${claudeCatalog?.fastMode.reason ? ` (${claudeCatalog.fastMode.reason.replace(/_/g, ' ')})` : ''}`
          : `Fast mode ${fastOn ? 'on' : 'off'}: ${what}. Applies from your next message.`;
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={title}
            aria-label={title}
            aria-pressed={fastOn}
            disabled={disabled || !available}
            onClick={() => gateway.setSessionFastMode(sessionKey, !fastOn)}
            className={cn('h-7 w-7 rounded-lg shrink-0', fastOn ? 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 hover:text-amber-500' : 'text-muted-foreground')}
          >
            <Zap className="w-3 h-3" fill={fastOn ? 'currentColor' : 'none'} />
          </Button>
        );
      })()}
      <UsageMeter usage={gateway.usageByProvider[isClaude ? 'claude' : 'codex']} />
    </div>
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

function UserMessageItem({
  item,
  onReply,
}: {
  item: Extract<ChatItem, { type: 'user' }>;
  onReply: (snippet: QuotedSnippet) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  // Split off any leading <replying_to>...</replying_to> block so we render
  // it as a styled chip instead of leaking raw XML into the bubble.
  const { quote, body } = useMemo(() => parseReplyingTo(item.content), [item.content]);

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
        {quote && (
          <div className="mb-1.5 flex items-start gap-1.5 rounded-md border-l-2 border-primary bg-background/50 px-2 py-1 text-[11px] min-w-0">
            <Quote className="w-3 h-3 mt-[2px] shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-tight">replying to</div>
              <div className="prose-chat prose-chat--quote line-clamp-3 break-words text-left leading-snug">
                <Markdown remarkPlugins={[remarkGfm]}>{quote}</Markdown>
              </div>
            </div>
          </div>
        )}
        {body && (
          <SelectableForReply onReply={onReply}>
            <div
              ref={contentRef}
              className="text-foreground break-words prose-chat overflow-hidden"
              style={collapsed ? { maxHeight: `${USER_MESSAGE_COLLAPSE_PX}px` } : undefined}
            >
              <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
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
          </SelectableForReply>
        )}
      </div>
      {body && (
        <CopyMessageButton variant="overlay" getText={() => body} />
      )}
    </div>
  );
}

export function AskUserQuestionPanel({
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

  // keyboard: the panel takes focus when it appears and hands it back when it goes away
  const panelRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [question.requestId]);
  useEffect(() => { setCursor(0); }, [step]);

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

  // option index options.length is "Other"
  const choose = (index: number) => {
    if (index < options.length) handleSelect(q.question, options[index].label, q.multiSelect);
    else {
      setUseOther(prev => ({ ...prev, [q.question]: true }));
      setSelections(prev => ({ ...prev, [q.question]: '' }));
    }
  };
  const confirm = () => {
    if (streaming || !currentAnswered) return;
    if (isLast) handleSubmit();
    else setStep(s => s + 1);
  };
  const skip = () => {
    if (streaming) return;
    if (isLast) handleSubmit();
    else setStep(s => s + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // typing in "Other", or the header/footer buttons, keep their own keys
    if (target !== panelRef.current && target.dataset.questionOption == null) return;
    const count = options.length + 1;
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= count) {
      e.preventDefault();
      setCursor(Number(e.key) - 1);
      choose(Number(e.key) - 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => (c + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
    } else if (e.key === ' ') {
      e.preventDefault();
      choose(cursor);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    } else if ((e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowLeft') {
      if (step === 0) return;
      e.preventDefault();
      setStep(s => s - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      skip();
    }
  };

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
    <div ref={panelRef} tabIndex={-1} onKeyDown={handleKeyDown} className="border-t border-primary bg-card shrink-0 outline-none">
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
                  data-question-option={oi}
                  aria-pressed={selected}
                  className={cn(
                    'flex items-start gap-2 px-2.5 py-1.5 rounded-md border text-left w-full transition-colors',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:border-primary/50',
                    cursor === oi && 'ring-1 ring-primary/60'
                  )}
                  onFocus={() => setCursor(oi)}
                  onClick={() => { setCursor(oi); handleSelect(q.question, opt.label, q.multiSelect); }}
                >
                  {oi < 9 && <span className="text-[10px] text-muted-foreground/70 tabular-nums mt-px w-2 shrink-0">{oi + 1}</span>}
                  <span className="flex flex-col items-start min-w-0">
                    <span className="text-xs font-medium">{opt.label}</span>
                    {opt.description && <span className="text-[10px] text-muted-foreground leading-tight">{opt.description}</span>}
                  </span>
                </button>
              );
            })}
            <button
              data-question-option={options.length}
              aria-pressed={!!useOther[q.question]}
              className={cn(
                'flex items-start gap-2 px-2.5 py-1.5 rounded-md border text-left w-full transition-colors',
                useOther[q.question]
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background hover:border-primary/50',
                cursor === options.length && 'ring-1 ring-primary/60'
              )}
              onFocus={() => setCursor(options.length)}
              onClick={() => { setCursor(options.length); choose(options.length); }}
            >
              {options.length < 9 && <span className="text-[10px] text-muted-foreground/70 tabular-nums mt-px w-2 shrink-0">{options.length + 1}</span>}
              <span className="flex flex-col items-start min-w-0">
                <span className="text-xs font-medium">Other</span>
                <span className="text-[10px] text-muted-foreground">type your own answer</span>
              </span>
            </button>
          </div>
          {useOther[q.question] && (
            <input
              className="w-full px-2.5 py-1.5 bg-background border border-primary rounded-md text-xs outline-none placeholder:text-muted-foreground"
              placeholder="type your answer..."
              value={otherTexts[q.question] || ''}
              onChange={e => setOtherTexts(prev => ({ ...prev, [q.question]: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); confirm(); }
                else if (e.key === 'Escape') { e.preventDefault(); panelRef.current?.focus(); }
              }}
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
                  <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={skip}>skip</Button>
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

// say why a turn stopped, only when it was not a normal ending
const STOP_REASONS: Record<string, string> = {
  max_tokens: 'stopped at the output limit',
  refusal: 'stopped by the safety classifier',
  pause_turn: 'paused by the server',
  model_context_window_exceeded: 'ran out of context',
};
const END_SUBTYPES: Record<string, string> = {
  error_max_turns: 'stopped: hit the turn limit',
  error_during_execution: 'stopped before it finished',
  error_max_budget_usd: 'stopped: hit the budget limit',
  error_max_structured_output_retries: 'stopped: could not produce the required output',
};
function turnEndNote(end?: TurnEnd) {
  if (!end) return null;
  const notes: Array<{ text: string; bad?: boolean; title?: string }> = [];
  if (end.message) notes.push({ text: end.message, bad: true });
  else if (end.subtype && END_SUBTYPES[end.subtype]) notes.push({ text: END_SUBTYPES[end.subtype], bad: end.subtype !== 'error_during_execution', title: end.errors?.join('\n') });
  else if (end.isError) notes.push({ text: 'ended with an error', bad: true, title: end.errors?.join('\n') });
  if (end.stopReason && STOP_REASONS[end.stopReason]) notes.push({ text: STOP_REASONS[end.stopReason], bad: end.stopReason !== 'pause_turn' });
  if (end.denied) notes.push({ text: `${end.denied} tool call${end.denied === 1 ? '' : 's'} denied` });
  return notes.map((n, k) => <span key={k} title={n.title} className={n.bad ? 'text-destructive' : 'text-warning'}>{n.text}</span>);
}

// text the safety classifier stopped and another model redid: kept, but folded and marked
function WithdrawnText({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex items-center gap-1.5 text-[11px] text-warning/90 hover:text-warning">
        <ChevronRight className={cn('w-3 h-3 transition-transform', open && 'rotate-90')} />
        withdrawn by the safety classifier, redone below
      </button>
      {open && <div className="mt-1 pl-4 border-l-2 border-warning/30 opacity-60 line-through decoration-muted-foreground/40 prose-chat text-sm"><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div>}
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
  quotedSnippet, clearQuote,
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
  quotedSnippet: QuotedSnippet | null;
  clearQuote: () => void;
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
      {quotedSnippet && (
        <div className="px-3 pt-2 min-w-0">
          <div className="flex items-start gap-1.5 rounded-md border-l-2 border-primary bg-secondary/60 text-secondary-foreground px-2 py-1 text-[11px] min-w-0">
            <Quote className="w-3 h-3 mt-[2px] shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-tight">replying to</div>
              <div
                className="prose-chat prose-chat--quote line-clamp-2 break-words text-left leading-snug"
                dangerouslySetInnerHTML={{ __html: quotedSnippet.html }}
              />
            </div>
            <button
              type="button"
              className="shrink-0 mt-[2px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={clearQuote}
              aria-label="Clear quote"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
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

// A staged quote: plain text for the model (XML payload) + HTML for the chip
// (so the chip preserves the same markdown formatting the user selected from).
type QuotedSnippet = { text: string; html: string };

// Strip a leading <replying_to>...</replying_to> block off a user message so
// it can be rendered as a styled chip instead of raw XML in the bubble.
const REPLYING_TO_RE = /^<replying_to>\n([\s\S]*?)\n<\/replying_to>\n\n([\s\S]*)$/;
function parseReplyingTo(content: string): { quote: string | null; body: string } {
  const m = content.match(REPLYING_TO_RE);
  if (!m) return { quote: null, body: content };
  return { quote: m[1], body: m[2] };
}

// Wraps any block with a floating "Reply" button that appears when the user
// selects text inside it. Clicking captures the selection and hands both the
// plain text and the rendered HTML up to the chat input. The popover is
// rendered into a portal with viewport coordinates so it never gets clipped
// by virtualized rows or stacking contexts, and flips above the selection
// when there isn't room below.
function SelectableForReply({
  children,
  onReply,
  className,
}: {
  children: React.ReactNode;
  onReply: (snippet: QuotedSnippet) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<{ top: number; left: number; text: string; html: string } | null>(null);

  const updateFromSelection = useCallback(() => {
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) {
      setPopover(null);
      return;
    }
    const range = sel.getRangeAt(0);
    // Selection must be entirely inside this block.
    if (!container.contains(range.commonAncestorContainer)) {
      setPopover(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setPopover(null);
      return;
    }
    // Serialize the selected DOM fragment so the chip can render the same
    // formatting (bold/code/lists/etc.) the user actually selected.
    const fragment = range.cloneContents();
    const tmp = document.createElement('div');
    tmp.appendChild(fragment);
    const html = tmp.innerHTML;

    // Viewport-anchored coords so the portal popover is never clipped by
    // overflow:hidden parents or virtualized row containers.
    const rect = range.getBoundingClientRect();
    const POP_W = 76;
    const POP_H = 24;
    const PAD = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + 4;
    // Flip above the selection when there isn't room below.
    if (top + POP_H > vh - PAD) top = Math.max(PAD, rect.top - POP_H - 4);
    let left = rect.right - 60;
    if (left + POP_W > vw - PAD) left = vw - POP_W - PAD;
    if (left < PAD) left = PAD;
    setPopover({ top, left, text, html });
  }, []);

  const handleReplyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!popover) return;
    onReply({ text: popover.text, html: popover.html });
    window.getSelection()?.removeAllRanges();
    setPopover(null);
  };

  // Hide popover when selection changes outside this block or clears.
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPopover(null);
        return;
      }
      if (containerRef.current?.contains(sel.anchorNode)) {
        updateFromSelection();
      } else {
        setPopover(null);
      }
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [updateFromSelection]);

  // Reposition / dismiss on scroll so the popover follows the selection.
  useEffect(() => {
    if (!popover) return;
    const onScroll = () => updateFromSelection();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [popover, updateFromSelection]);

  return (
    <div ref={containerRef} className={cn('relative', className)} onMouseUp={updateFromSelection}>
      {children}
      {popover && createPortal(
        <button
          type="button"
          className="fixed z-50 flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[10px] shadow-md hover:bg-primary/90 transition-colors"
          style={{ top: popover.top, left: popover.left }}
          // mousedown to fire before selection collapses on click.
          onMouseDown={handleReplyClick}
        >
          <Reply className="w-3 h-3" />
          Reply
        </button>,
        document.body,
      )}
    </div>
  );
}

// Wraps an assistant text block with the selection-to-Reply affordance.
function AssistantTextWithReply({
  content,
  streaming,
  onReply,
}: {
  content: string;
  streaming?: boolean;
  onReply: (snippet: QuotedSnippet) => void;
}) {
  return (
    <SelectableForReply className="prose-chat py-1.5" onReply={onReply}>
      <InlineErrorBoundary>
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
      </InlineErrorBoundary>
      {streaming && <span className="streaming-cursor" />}
    </SelectableForReply>
  );
}

export function ChatView({ gateway, chatItems, agentStatus, pendingQuestion, sessionKey, drafts, onNavigateSettings, onOpenFile, onOpenDiff, onOpenResearch, onOpenTask, onOpenTerminal, onClearChat, onNewTab }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [compact, setCompact] = useState(false);
  const [inputHeight, setInputHeight] = useState<number | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [activeSkill, setActiveSkill] = useState<{ name: string; content: string; path?: string } | null>(null);
  const [quotedSnippet, setQuotedSnippet] = useState<QuotedSnippet | null>(null);
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
  const liveInputRef = useRef(input);
  liveInputRef.current = input;
  const liveImagesRef = useRef(attachedImages);
  liveImagesRef.current = attachedImages;
  const isRunning = agentStatus !== 'idle';
  const [approvalsFolded, setApprovalsFolded] = useState(false);
  const [queuedOpen, setQueuedOpen] = useState(false);
  const isEmpty = chatItems.length === 0;

  // Derive elicitation and worktree state from active session
  const activeState = sessionKey ? gateway.sessionStates[sessionKey] : undefined;
  const pendingElicitation = activeState?.pendingElicitation ?? null;

  // save/restore input draft and images per session when switching tabs or panes
  useEffect(() => {
    if (!sessionKey) return;
    const sk = sessionKey;
    const draft = drafts.get(sk);
    const text = draft?.text || '';
    const images = draft ? [...draft.images] : [];
    liveInputRef.current = text;
    liveImagesRef.current = images;
    setInput(text);
    setAttachedImages(images);
    // Reset ephemeral picker state
    setSlashOpen(false);
    setSlashFilter('');
    setAtOpen(false);
    setAtFilter('');
    setAtStartPos(-1);
    setActiveSkill(null);
    return () => {
      const text = liveInputRef.current;
      const images = liveImagesRef.current;
      if (text || images.length > 0) {
        drafts.set(sk, { text, images: [...images] });
      } else {
        drafts.delete(sk);
      }
    };
  }, [drafts, sessionKey]);

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

  // fetch skills list from gateway
  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    let cancelled = false;
    gateway.rpc('skills.list').then((result: unknown) => {
      if (cancelled || !Array.isArray(result)) return;
      setSkillsList(result.filter((s: any) => s.eligibility?.eligible !== false).map((s: any) => ({
        name: s.name as string,
        description: (s.description || '') as string,
        path: typeof s.path === 'string' ? s.path : undefined,
        eligibility: (s.eligibility || { eligible: true }) as { eligible: boolean },
      })));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.connectionState, gateway.rpc]);

  // Load file entries for @ picker (debounced, path-validated)
  useEffect(() => {
    if (!atOpen) { setAtEntries([]); setAtLoading(false); return; }
    const lastSlash = atFilter.lastIndexOf('/');
    const dir = lastSlash >= 0 ? atFilter.slice(0, lastSlash + 1) : '';
    const basename = lastSlash >= 0 ? atFilter.slice(lastSlash + 1) : atFilter;
    const listPath = dir || '.';

    // Reject absolute paths and path traversal. Close the picker entirely so
    // Enter/Tab don't stay swallowed by the "atOpen with no entries" branch in
    // handleKeyDown.
    if (listPath.startsWith('/') || listPath.includes('..')) {
      setAtEntries([]);
      setAtLoading(false);
      setAtOpen(false);
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
    // gateway.rpc is stable (useCallback with []); depending on the whole
    // gateway object would re-run this effect on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atOpen, atFilter, gateway.rpc]);

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
          return (parsed.todos || []) as { content: string; status: string; activeForm: string }[];
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

    // Inject quoted assistant snippet (the user is replying to a specific section)
    if (quotedSnippet && !overridePrompt) {
      prompt = `<replying_to>\n${quotedSnippet.text}\n</replying_to>\n\n${prompt}`;
      setQuotedSnippet(null);
    }

    let inputItems: ProviderInputItem[] | undefined;
    const providerName = (gateway.configData as any)?.provider?.name || 'claude';
    // codex uses structured skill input; claude needs inline context
    if (activeSkill && providerName === 'codex' && activeSkill.path) {
      if (!new RegExp(`(^|\\s)\\$${activeSkill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(prompt)) {
        prompt = `$${activeSkill.name} ${prompt}`.trim();
      }
      inputItems = [{ type: 'skill', name: activeSkill.name, path: activeSkill.path }];
      setActiveSkill(null);
    } else if (activeSkill) {
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
    const remainingText = overridePrompt ? input : '';
    if (!overridePrompt) setInput('');
    setAttachedImages([]);
    liveInputRef.current = remainingText;
    liveImagesRef.current = [];
    if (sessionKey) {
      if (remainingText) drafts.set(sessionKey, { text: remainingText, images: [] });
      else drafts.delete(sessionKey);
    }
    setInputHeight(null);
    setSlashOpen(false);
    setSlashFilter('');
    setAtOpen(false);
    setAtFilter('');
    setAtStartPos(-1);
    setSending(true);
    try {
      const chatId = sessionKey ? sessionKey.split(':').slice(2).join(':') : undefined;
      await gateway.sendMessage(prompt || 'What do you see in this image?', sessionKey, chatId, images, inputItems);
    } finally {
      setSending(false);
    }
  };

  const handleSlashSelect = async (item: SlashItem) => {
    setSlashOpen(false);
    setSlashFilter('');
    setInput('');
    liveInputRef.current = '';
    if (sessionKey) {
      const images = liveImagesRef.current;
      if (images.length > 0) drafts.set(sessionKey, { text: '', images: [...images] });
      else drafts.delete(sessionKey);
    }

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
      // fetch skill content and set active context
      const skillName = item.command.slice(1);
      try {
        const result = await gateway.rpc('skills.read', { name: skillName }) as { raw?: string } | undefined;
        if (result?.raw) {
          setActiveSkill({ name: skillName, content: stripFrontmatter(result.raw), path: typeof (result as any).path === 'string' ? (result as any).path : undefined });
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

  const handleInputChange = useCallback((value: string, cursor?: number) => {
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

      // @ file picker detection: scan backward from cursor (not value.length) to find
      // the @ that belongs to the token the user is currently editing. This keeps the
      // picker open when the cursor is inside an @token that has text after it.
      const scanFrom = typeof cursor === 'number' ? Math.min(cursor, value.length) : value.length;
      let atIdx = -1;
      for (let i = scanFrom - 1; i >= 0; i--) {
        if (value[i] === ' ' || value[i] === '\n' || value[i] === '\t') break;
        if (value[i] === '@' && (i === 0 || /\s/.test(value[i - 1]))) {
          atIdx = i;
          break;
        }
      }
      if (atIdx >= 0) {
        // Filter is everything between @ and the next whitespace (or end of value)
        let end = scanFrom;
        for (let j = atIdx + 1; j < value.length; j++) {
          if (value[j] === ' ' || value[j] === '\n' || value[j] === '\t') { end = j; break; }
          end = j + 1;
        }
        const afterAt = value.slice(atIdx + 1, end);
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
    // tab takes the suggested next message
    if (e.key === 'Tab' && !e.shiftKey && !input && suggestion && !isRunning) {
      e.preventDefault();
      handleInputChange(suggestion, suggestion.length);
      return;
    }
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

  const handleReply = useCallback((snippet: QuotedSnippet) => {
    setQuotedSnippet(snippet);
    // Focus whichever input is mounted (landing vs main).
    setTimeout(() => {
      inputRef.current?.focus();
      landingInputRef.current?.focus();
    }, 0);
  }, []);

  // tool calls and thinking become activity groups; the newest command/edit/write/agent holds the live slot
  const display = useMemo(() => buildDisplay(chatItems), [chatItems]);
  const lastUserIdx = useMemo(() => {
    for (let i = chatItems.length - 1; i >= 0; i--) if (chatItems[i].type === 'user') return i;
    return -1;
  }, [chatItems]);
  const liveId = useMemo(() => {
    if (!isRunning) return null;
    for (let i = chatItems.length - 1; i > lastUserIdx; i--) {
      const it = chatItems[i];
      if (it.type === 'tool_use' && LIVE_TOOLS.has(it.name)) return it.id;
    }
    return null;
  }, [chatItems, isRunning, lastUserIdx]);
  const bgTasks = (sessionKey && gateway.backgroundTasks[sessionKey]) || EMPTY_TASKS;
  const taskProgress = activeState?.taskProgress || EMPTY_PROGRESS;
  const suggestion = activeState?.suggestion;
  const listBase = useMemo(() => {
    const progressByToolUse = new Map<string, TaskProgress>();
    for (const p of Object.values(taskProgress)) if (p.toolUseId) progressByToolUse.set(p.toolUseId, p);
    const base: Omit<ListCtx, 'turnRunning'> = {
      liveId,
      backgroundRunning: new Set(bgTasks.map(t => t.taskId)),
      progressByToolUse,
      open: {
        file: onOpenFile,
        diff: onOpenDiff,
        research: onOpenResearch ? (id: string) => { focusResearch(id); onOpenResearch(); } : undefined,
        task: onOpenTask,
        terminal: onOpenTerminal,
        url: (url: string) => { (window as any).electronAPI?.openExternal ? (window as any).electronAPI.openExternal(url) : window.open(url, '_blank'); },
        stopTask: sessionKey ? (taskId: string) => { gateway.stopTask(sessionKey, taskId).catch(() => {}); } : undefined,
        tail: async (path: string, offset: number) => await gateway.rpc('fs.tail', { path, offset }) as { content: string; size: number; next?: number },
      },
    };
    return { current: { ...base, turnRunning: true } as ListCtx, past: { ...base, liveId: null, turnRunning: false } as ListCtx };
  }, [liveId, bgTasks, taskProgress, onOpenFile, onOpenDiff, onOpenResearch, onOpenTask, onOpenTerminal, sessionKey, gateway.stopTask, gateway.rpc]);

  const jumpToTool = useCallback((toolUseId: string) => {
    document.getElementById(`tool-${toolUseId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  const renderItemBase = (item: ChatItem, i: number) => {
    switch (item.type) {
      case 'user':
        return <UserMessageItem key={i} item={item} onReply={handleReply} />;
      case 'text':
        if (item.withdrawn) return <WithdrawnText key={i} content={item.content} />;
        return (
          <AssistantTextWithReply
            key={i}
            content={item.content}
            streaming={item.streaming}
            onReply={handleReply}
          />
        );
      case 'tool_use':
      case 'thinking':
      case 'notice':
        return null; // drawn by ActivityGroup
      case 'compacting':
        return (
          <div key={i} className="flex items-center gap-2 py-2 my-1">
            <span className="compacting-sheen text-[11px] text-muted-foreground font-medium">Compacting</span>
            <span className="compacting-dots text-[11px] text-muted-foreground" />
          </div>
        );
      case 'result':
        return (
          <div key={i} className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground py-1 mt-1 border-t border-border">
            {item.cost != null && <span>${item.cost.toFixed(4)}</span>}
            <span>{formatTime(item.timestamp)}</span>
            {turnEndNote(item.end)}
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

  const renderDisplay = (d: DisplayItem) => {
    if (d.type === 'item') return renderItem(d.item, d.index);
    // everything in the current turn stays open until the turn ends, then folds at once
    const current = isRunning && d.index > lastUserIdx;
    const group = (
      <div key={d.index} className="my-1.5">
        <InlineErrorBoundary>
          <ActivityGroup items={d.items} base={current ? listBase.current : listBase.past} active={current} />
        </InlineErrorBoundary>
      </div>
    );
    if (!isAssistantThreadEnd(d.lastIndex)) return group;
    return (
      <Fragment key={d.index}>
        {group}
        <div className="flex items-center justify-start -mt-0.5 mb-1.5 pl-0.5 opacity-70 hover:opacity-100 transition-opacity">
          <CopyMessageButton getText={() => getThreadCopyText(d.lastIndex)} />
        </div>
      </Fragment>
    );
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
                  quotedSnippet={quotedSnippet} clearQuote={() => setQuotedSnippet(null)}
                />
                <ImagePreviewStrip images={attachedImages} onRemove={j => setAttachedImages(prev => prev.filter((_, k) => k !== j))} />
                <Textarea
                  ref={landingInputRef}
                  value={input}
                  onChange={e => handleInputChange(e.target.value, e.target.selectionStart ?? undefined)}
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
                <div className="flex items-center gap-0.5 px-3 pb-3 min-w-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg mr-1 shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isReady}
                    title="Attach image"
                  >
                    <Paperclip className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  <ModelSelector gateway={gateway} disabled={!connected} sessionId={activeState?.sessionId} sessionKey={sessionKey} />
                  {input.trim() && (
                    <span className="text-[9px] text-muted-foreground/60 ml-2 select-none hidden @sm:inline">{'\u21E7\u21B5 new line'}</span>
                  )}
                  <span className="flex-1 min-w-1" />
                  <Button
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg shrink-0"
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
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* messages */}
      <VirtualChatList
        items={display}
        renderItem={renderDisplay}
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

      {/* messages sent mid-turn: they start the next turn. one line, opens to show them */}
      {sessionKey && (activeState?.queued?.length ?? 0) > 0 && (
        <div className="px-4 pt-2 shrink-0">
          <button type="button" onClick={() => setQueuedOpen(v => !v)} className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-secondary/50">
            <ChevronRight className={cn('w-3 h-3 transition-transform', queuedOpen && 'rotate-90')} />
            {activeState!.queued!.length} queued
            <span className="text-muted-foreground/70">· {isRunning ? 'starts after this turn' : 'not sent: the run stopped'}</span>
          </button>
          {queuedOpen && activeState!.queued!.map((q, i) => (
            <div key={q.timestamp + ':' + i} className="flex items-start gap-2 pl-7 pr-2 py-1 text-[12px]">
              <span className="flex-1 min-w-0 whitespace-pre-wrap break-words text-foreground/90">{q.content}</span>
              {!isRunning && (
                <>
                  <button type="button" className="text-[11px] text-primary hover:underline shrink-0" onClick={() => { const t = gateway.takeQueued(sessionKey, i); if (t) gateway.sendMessage(t.content, sessionKey, undefined, t.images); }}>send</button>
                  <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground shrink-0" onClick={() => { const t = gateway.takeQueued(sessionKey, i); if (t) handleInputChange(t.content, t.content.length); }}>edit</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* approvals: they need an answer, so they stay above the composer, but fold to one line */}
      {sessionApprovals.length > 0 && (
        <div className="px-4 pt-2 shrink-0">
          <button
            type="button"
            onClick={() => setApprovalsFolded(v => !v)}
            className="w-full flex items-center gap-2 px-2.5 py-1 mb-1 rounded-md text-[11px] text-warning hover:bg-warning/10"
          >
            <ChevronRight className={cn('w-3 h-3 transition-transform', !approvalsFolded && 'rotate-90')} />
            {sessionApprovals.length} approval{sessionApprovals.length === 1 ? '' : 's'} waiting
          </button>
          {!approvalsFolded && (
            <ApprovalList
              approvals={sessionApprovals}
              onApprove={gateway.approveToolUse}
              onDeny={gateway.denyToolUse}
            />
          )}
        </div>
      )}


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
                  quotedSnippet={quotedSnippet} clearQuote={() => setQuotedSnippet(null)}
          />
          <ImagePreviewStrip images={attachedImages} onRemove={j => setAttachedImages(prev => prev.filter((_, k) => k !== j))} />
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => handleInputChange(e.target.value, e.target.selectionStart ?? undefined)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={!connected ? 'waiting for gateway...' : suggestion && !isRunning ? `${suggestion}   (tab)` : 'type a message...'}
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
          <div className="flex items-center gap-0.5 px-3 pb-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 rounded-lg mr-1 shrink-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={!connected}
              title="Attach image"
            >
              <Paperclip className="w-4 h-4 text-muted-foreground" />
            </Button>
            <ModelSelector gateway={gateway} disabled={!connected} sessionId={activeState?.sessionId} sessionKey={sessionKey} />
            <span className="hidden @[400px]:flex shrink-0"><ContextWheel getContextUsage={gateway.getContextUsage} sessionKey={sessionKey} isRunning={isRunning} /></span>
            {input.trim() && (
              <span className="text-[9px] text-muted-foreground/60 ml-2 select-none hidden @sm:inline">{'\u21E7\u21B5 new line'}</span>
            )}
            <span className="flex-1 min-w-1" />
            <PlanPill items={progress} />
            {sessionKey && (
              <RunningPill
                tasks={bgTasks}
                progress={taskProgress}
                onStop={taskId => { gateway.stopTask(sessionKey, taskId).catch(() => {}); }}
                onJump={jumpToTool}
              />
            )}
            {isRunning ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 w-8 p-0 rounded-lg shrink-0"
                onClick={() => gateway.abortAgent(sessionKey)}
              >
                <Square className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 w-8 p-0 rounded-lg shrink-0"
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
  );
}
