import { useState, useRef, useEffect, useMemo, useCallback, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react';
import { DorabotSprite } from '../components/DorabotSprite';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { useGateway, ChatItem, AskUserQuestion, ImageAttachment } from '../hooks/useGateway';
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
  Square, ChevronDown, ChevronRight, Sparkles,
  FileText, FilePlus, Pencil, FolderSearch, FileSearch, Terminal,
  Globe, Search, Bot, MessageCircle, ListChecks, FileCode,
  MessageSquare, Camera, Monitor, Clock, Wrench, ArrowUp, LayoutGrid,
  Smile, Image, Brain, MapPin, PenLine, GitPullRequest, Radio,
  Paperclip, X,
  type LucideIcon,
} from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  chatItems: ChatItem[];
  agentStatus: string;
  pendingQuestion: AskUserQuestion | null;
  sessionKey?: string;
  onNavigateSettings?: () => void;
  getDraft?: (sessionKey: string) => { text: string; images: ImageAttachment[] } | undefined;
  saveDraft?: (sessionKey: string, text: string, images: ImageAttachment[]) => void;
  clearDraft?: (sessionKey: string) => void;
};

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
  goals_view: { pending: 'Viewing goals', done: 'Viewed goals' },
  goals_add: { pending: 'Adding goal', done: 'Added goal' },
  goals_update: { pending: 'Updating goal', done: 'Updated goal' },
  goals_delete: { pending: 'Deleting goal', done: 'Deleted goal' },
  tasks_view: { pending: 'Viewing tasks', done: 'Viewed tasks' },
  tasks_add: { pending: 'Adding task', done: 'Added task' },
  tasks_update: { pending: 'Updating task', done: 'Updated task' },
  tasks_done: { pending: 'Completing task', done: 'Completed task' },
  tasks_delete: { pending: 'Deleting task', done: 'Deleted task' },
  research_view: { pending: 'Viewing research', done: 'Viewed research' },
  research_add: { pending: 'Adding research', done: 'Added research' },
  research_update: { pending: 'Updating research', done: 'Updated research' },
  plan_view: { pending: 'Viewing plans', done: 'Viewed plans' },
  plan_add: { pending: 'Creating plan', done: 'Created plan' },
  plan_update: { pending: 'Updating plan', done: 'Updated plan' },
  plan_start: { pending: 'Starting plan', done: 'Started plan' },
  plan_delete: { pending: 'Deleting plan', done: 'Deleted plan' },
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
  goals_view: LayoutGrid, goals_add: LayoutGrid,
  goals_update: LayoutGrid, goals_delete: LayoutGrid,
  tasks_view: ListChecks, tasks_add: ListChecks,
  tasks_update: ListChecks, tasks_done: ListChecks, tasks_delete: ListChecks,
  research_view: FileSearch, research_add: FilePlus, research_update: Pencil,
  plan_view: LayoutGrid, plan_add: LayoutGrid,
  plan_update: LayoutGrid, plan_start: LayoutGrid, plan_delete: LayoutGrid,
  memory_search: Search, memory_read: FileText,
};

const ANTHROPIC_MODELS = [
  { value: 'claude-opus-4-6', label: 'opus' },
  { value: 'claude-sonnet-4-5-20250929', label: 'sonnet' },
  { value: 'claude-haiku-4-5-20251001', label: 'haiku' },
];

const OPENAI_MODELS = [
  { value: 'gpt-5.3-codex', label: 'gpt-5.3 codex' },
  { value: 'gpt-5.2-codex', label: 'gpt-5.2 codex' },
  { value: 'gpt-5.1-codex-mini', label: 'gpt-5.1 mini' },
  { value: 'gpt-5.1-codex-max', label: 'gpt-5.1 max' },
  { value: 'gpt-5.2', label: 'gpt-5.2' },
  { value: 'gpt-5.1', label: 'gpt-5.1' },
  { value: 'gpt-5', label: 'gpt-5' },
];

// Codex reasoning effort levels (SDK: minimal | low | medium | high | xhigh)
// Our config uses 'max' → maps to 'xhigh' in the provider
const EFFORT_LEVELS = [
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'max', label: 'xhigh' },
];

function ModelSelector({ gateway, disabled }: { gateway: ReturnType<typeof useGateway>; disabled: boolean }) {
  const providerName = (gateway.configData as any)?.provider?.name || 'claude';
  const claudeModel = gateway.model || 'claude-sonnet-4-5-20250929';
  const codexModel = (gateway.configData as any)?.provider?.codex?.model || 'gpt-5.3-codex';
  const currentValue = providerName === 'codex' ? `codex:${codexModel}` : `claude:${claudeModel}`;

  const handleChange = async (encoded: string) => {
    const [provider, model] = encoded.split(':') as [string, string];
    if (provider === 'claude') {
      if (providerName !== 'claude') await gateway.setProvider('claude');
      gateway.changeModel(model);
    } else {
      if (providerName !== 'codex') await gateway.setProvider('codex');
      await gateway.setConfig('provider.codex.model', model);
    }
  };

  const currentLabel = providerName === 'codex'
    ? OPENAI_MODELS.find(m => m.value === codexModel)?.label || codexModel
    : ANTHROPIC_MODELS.find(m => m.value === claudeModel)?.label || claudeModel;

  const reasoningEffort = (gateway.configData as any)?.reasoningEffort || null;

  const handleEffortChange = async (value: string) => {
    const v = value === 'off' ? null : value;
    await gateway.setConfig('reasoningEffort', v);
  };

  return (
    <div className="flex items-center gap-1">
      <Select value={currentValue} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger size="sm" className="h-7 gap-1.5 text-[11px] rounded-lg shadow-none w-auto">
          <img
            src={providerName === 'codex' ? './openai-icon.svg' : './claude-icon.svg'}
            alt=""
            className="w-3 h-3"
          />
          <span>{currentLabel}</span>
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="min-w-[180px]">
          <div className="px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Anthropic</div>
          {ANTHROPIC_MODELS.map(m => (
            <SelectItem key={m.value} value={`claude:${m.value}`} className="text-xs">
              <span className="flex items-center gap-1.5">
                <img src="./claude-icon.svg" alt="" className="w-3 h-3" />
                {m.label}
              </span>
            </SelectItem>
          ))}
          <div className="px-2 py-1 mt-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border">OpenAI</div>
          {OPENAI_MODELS.map(m => (
            <SelectItem key={m.value} value={`codex:${m.value}`} className="text-xs">
              <span className="flex items-center gap-1.5">
                <img src="./openai-icon.svg" alt="" className="w-3 h-3" />
                {m.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {providerName === 'codex' && (
        <Select value={reasoningEffort || 'off'} onValueChange={handleEffortChange} disabled={disabled}>
          <SelectTrigger size="sm" className="h-7 gap-1 text-[11px] rounded-lg shadow-none w-auto text-muted-foreground">
            <Sparkles className="w-3 h-3" />
            <span>{reasoningEffort || 'auto'}</span>
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="min-w-[120px]">
            <SelectItem value="off" className="text-xs">auto</SelectItem>
            {EFFORT_LEVELS.map(e => (
              <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
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

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="thinking-container my-1">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5 group">
        <Brain className="w-3 h-3" />
        <span>{item.streaming ? 'Thinking...' : 'Thought'}</span>
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
  const hasOutput = item.output != null;
  const isPending = item.streaming || !hasOutput;
  const displayName = toolText(item.name, isPending ? 'pending' : 'done');
  const useStreamCard = hasStreamCard(item.name);

  // Read/Grep/Glob are fast, AskUserQuestion shows answered state collapsed
  const startCollapsed = item.name === 'Read' || item.name === 'Grep' || item.name === 'Glob' || item.name === 'AskUserQuestion';
  const isOpen = manualOpen !== null ? manualOpen : (isPending && !startCollapsed);

  const inputDetail = (() => {
    const p = safeParse(item.input);
    if (item.name === 'AskUserQuestion' && item.output) return item.output;
    return p.command?.split('\n')[0] || p.file_path || p.pattern || p.url || p.query || p.description || '';
  })();

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
            <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors rounded-md border border-border/40">
              {(() => {
                const Icon = TOOL_ICONS[item.name] || Wrench;
                return <Icon className={item.is_error ? 'w-3 h-3 text-destructive' : 'w-3 h-3 text-muted-foreground'} />;
              })()}
              <span className="text-muted-foreground font-medium">{displayName}</span>
              <span className="text-muted-foreground/60 flex-1 truncate text-left text-[11px]">{inputDetail}</span>
              <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
            </CollapsibleTrigger>
          )}
          <CollapsibleContent forceMount={isOpen ? true : undefined}>
            {isOpen && (
              <div className="relative">
                {/* clickable overlay to collapse when done */}
                {!isPending && (
                  <button
                    className="absolute top-1 right-1 z-10 p-0.5 rounded bg-background/80 hover:bg-secondary text-muted-foreground"
                    onClick={() => setManualOpen(false)}
                    title="collapse"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
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
          <span className="text-xs font-medium truncate">{q.header}: {q.question}</span>
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

const SHORTCUTS: { keys: string; label: string }[] = [
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

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'good morning';
  if (h < 17) return 'good afternoon';
  return 'good evening';
}

export function ChatView({ gateway, chatItems, agentStatus, pendingQuestion, sessionKey, onNavigateSettings, getDraft, saveDraft, clearDraft }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [compact, setCompact] = useState(false);
  const nextAutoScrollBehaviorRef = useRef<ScrollBehavior>('auto');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const landingInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const landingRef = useRef<HTMLDivElement>(null);
  const isRunning = agentStatus !== 'idle';
  const isEmpty = chatItems.length === 0;
  const draftLoadedRef = useRef(false);

  useEffect(() => {
    const el = landingRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.height < 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Restore draft on mount or sessionKey change
  useEffect(() => {
    if (!sessionKey || !getDraft) return;
    const draft = getDraft(sessionKey);
    if (draft) {
      setInput(draft.text);
      setAttachedImages(draft.images);
    } else {
      // Clear input when switching to a session with no draft
      if (draftLoadedRef.current) {
        setInput('');
        setAttachedImages([]);
      }
    }
    draftLoadedRef.current = true;
  }, [sessionKey, getDraft]);

  // Save draft when input or images change (debounced)
  useEffect(() => {
    if (!sessionKey || !saveDraft || !draftLoadedRef.current) return;
    const timeout = setTimeout(() => {
      saveDraft(sessionKey, input, attachedImages);
    }, 300);
    return () => clearTimeout(timeout);
  }, [input, attachedImages, sessionKey, saveDraft]);

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
    const prompt = overridePrompt || input.trim();
    if ((!prompt && attachedImages.length === 0) || sending || pendingQuestion) return;

    const images = attachedImages.length > 0 ? [...attachedImages] : undefined;
    nextAutoScrollBehaviorRef.current = 'smooth';
    if (!overridePrompt) setInput('');
    setAttachedImages([]);
    setSending(true);
    try {
      const chatId = sessionKey ? sessionKey.split(':').slice(2).join(':') : undefined;
      await gateway.sendMessage(prompt || 'What do you see in this image?', sessionKey, chatId, images);
      // Clear draft after successful send
      if (sessionKey && clearDraft) {
        clearDraft(sessionKey);
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  const renderItem = (item: ChatItem, i: number) => {
    switch (item.type) {
      case 'user':
        return (
          <div key={i} className="flex gap-2 px-2 py-1.5 my-1 bg-secondary rounded-md min-w-0">
            <span className="text-primary font-semibold shrink-0">{'>'}</span>
            <div className="min-w-0">
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
              {item.content && <span className="text-foreground break-words">{item.content}</span>}
            </div>
          </div>
        );
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
              <Card className="rounded-2xl chat-input-area" onDrop={handleDrop} onDragOver={handleDragOver}>
                <ImagePreviewStrip images={attachedImages} onRemove={j => setAttachedImages(prev => prev.filter((_, k) => k !== j))} />
                <Textarea
                  ref={landingInputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={!connected ? 'waiting for gateway...' : !authenticated ? 'set up your AI provider to get started' : 'what are we building?'}
                  disabled={!isReady}
                  className="w-full min-h-[80px] max-h-[200px] resize-none text-sm border-0 rounded-2xl bg-transparent shadow-none focus-visible:ring-0"
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
                  <ModelSelector gateway={gateway} disabled={!connected} />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg ml-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isReady}
                    title="Attach image"
                  >
                    <Paperclip className="w-4 h-4 text-muted-foreground" />
                  </Button>
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
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground/80 pt-2">
                  {SHORTCUTS.map(s => (
                    <span key={s.keys} className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 rounded border border-border/50 bg-muted/60 text-[10px] font-mono">{s.keys}</kbd>
                      <span>{s.label}</span>
                    </span>
                  ))}
                </div>
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

      {/* input area */}
      <div className="px-4 py-3 shrink-0 min-w-0">
        <Card className="rounded-2xl chat-input-area" onDrop={handleDrop} onDragOver={handleDragOver}>
          <ImagePreviewStrip images={attachedImages} onRemove={j => setAttachedImages(prev => prev.filter((_, k) => k !== j))} />
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={connected ? 'type a message...' : 'waiting for gateway...'}
            disabled={!connected || !!pendingQuestion}
            className="w-full min-h-[64px] max-h-[200px] resize-none text-[13px] border-0 rounded-2xl bg-transparent shadow-none focus-visible:ring-0"
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
            <ModelSelector gateway={gateway} disabled={!connected} />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 rounded-lg ml-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={!connected}
              title="Attach image"
            >
              <Paperclip className="w-4 h-4 text-muted-foreground" />
            </Button>
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
  );
}
