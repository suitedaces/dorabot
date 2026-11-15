import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity, Bell, BookOpen, Bot, Camera, ClipboardList, Clock, Copy, ExternalLink, FileDiff, FilePlus, FileText, FolderSearch, Globe,
  HelpCircle, Image as ImageIcon, ListChecks, ListTodo, MessageSquare, MousePointer2, Pencil, Plug, Search, Square,
  SquareTerminal, Terminal, Wrench, ArrowDownToLine, type LucideIcon,
} from 'lucide-react';
import { safeParse } from '@/lib/safe-parse';
import { computeDiff } from '@/lib/diff';
import type { ChatItem, TaskProgress } from '@/hooks/useGateway';
import { cn } from '@/lib/utils';
import { DiffStat, Favicon, hostOf, InputBand, KeyValues, Md, ScrollBox, Tag, TextBlock, type CardAction, type CardStatus } from './primitives';

export type ToolItem = Extract<ChatItem, { type: 'tool_use' }>;

export type ToolCtx = {
  live: boolean;                       // this tool holds the live slot (its body stays open at a fixed height)
  turnRunning: boolean;                // the agent is still working on this turn
  backgroundRunning: Set<string>;      // sdk task ids still running in this session
  progressByToolUse: Map<string, TaskProgress>;
  depth: number;
  open?: {
    file?: (path: string) => void;
    diff?: (opts: { filePath: string; oldContent: string; newContent: string; label?: string }) => void;
    research?: (id: string) => void;
    task?: (id: string, title: string) => void;
    background?: (toolUseId: string) => void;
    url?: (url: string) => void;
    stopTask?: (taskId: string) => void;
    tail?: (path: string, offset: number) => Promise<{ content: string; size: number; next?: number }>;
  };
  renderNested?: (items: ChatItem[], depth: number) => ReactNode;
};

export type CardSpec = {
  icon: LucideIcon;
  verb: string;
  target?: string;
  facts?: ReactNode;
  status: CardStatus;
  actions?: CardAction[];
  body?: () => ReactNode;
  dim?: boolean;
  kind: Kind;
  endedAt?: number;       // overrides the tool's own end (background tasks end long after the call)
  background?: boolean;   // runs past its turn; the "N running" pill tracks it, not the group
};

// what the turn summary counts
export type Kind = 'command' | 'read' | 'edit' | 'write' | 'search' | 'fetch' | 'agent' | 'browser' | 'plan' | 'other';

const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); };

function firstLine(s: string) { return (s || '').split('\n')[0]; }

// how a finished tool ended, from the result text the sdk writes
function outcome(item: ToolItem, ctx: ToolCtx): { status: CardStatus; label?: string; tone?: 'warn' | 'bad' } {
  const done = item.output != null && !item.streaming;
  if (!done) return ctx.turnRunning ? { status: 'running' } : { status: 'stopped', label: 'stopped', tone: 'warn' };
  const out = item.output || '';
  if (/^\[Request interrupted by user/.test(out)) return { status: 'stopped', label: 'you stopped it', tone: 'warn' };
  if (!item.is_error) return { status: 'ok' };
  if (/^The user doesn't want to proceed|^User rejected|tool use was rejected/i.test(out)) return { status: 'stopped', label: 'denied by you', tone: 'warn' };
  if (/^(PreToolUse|PostToolUse)\S* hook|blocked by (a )?hook/i.test(out)) return { status: 'error', label: 'blocked by hook', tone: 'warn' };
  if (/timed out|timeout/i.test(firstLine(out))) return { status: 'error', label: 'timed out', tone: 'bad' };
  if (/has not been read yet|must read/i.test(out)) return { status: 'error', label: 'file not read first', tone: 'bad' };
  if (/String to replace not found|not found in file/i.test(out)) return { status: 'error', label: 'old text not found', tone: 'bad' };
  return { status: 'error' };
}

const verbFor = (running: boolean, a: string, b: string) => (running ? a : b);

// ---------------------------------------------------------------------------------------------
// bodies

function CommandBody({ command, output, error, live, item, ctx }: { command: string; output: string; error: boolean; live: boolean; item: ToolItem; ctx: ToolCtx }) {
  const persisted = typeof item.meta?.persistedOutputPath === 'string' ? item.meta.persistedOutputPath as string : null;
  const [full, setFull] = useState<string | null>(null);
  const text = full ?? output;
  return (
    <ScrollBox live={live} follow={command + text}>
      <InputBand><pre className="px-3 py-1.5 m-0 font-mono text-[11px] leading-[18px] whitespace-pre-wrap break-words text-foreground"><span className="text-primary select-none">$ </span>{command}</pre></InputBand>
      {text ? <TextBlock text={text} tone={error ? 'error' : undefined} /> : null}
      {persisted && !full && ctx.open?.tail && (
        <button type="button" className="mx-3 mb-2 text-[10.5px] text-primary hover:underline" onClick={() => {
          ctx.open!.tail!(persisted, 0).then(r => setFull(r.content)).catch(() => {});
        }}>output was saved to a file: load all of it</button>
      )}
    </ScrollBox>
  );
}

// follows a growing file (background command output) while the task runs
function TailBody({ path, command, running, tail }: { path: string; command: string; running: boolean; tail: NonNullable<ToolCtx['open']>['tail'] }) {
  const [text, setText] = useState('');
  const offset = useRef(0);
  useEffect(() => {
    if (!tail) return;
    let stop = false;
    const pull = () => tail(path, offset.current).then(r => {
      if (stop) return;
      if (r.content) { offset.current = r.next ?? r.size; setText(t => t + r.content); }
    }).catch(() => {});
    pull();
    if (!running) return () => { stop = true; };
    const id = setInterval(pull, 1000);
    return () => { stop = true; clearInterval(id); };
  }, [path, running, tail]);
  return (
    <ScrollBox live={running} follow={text}>
      <InputBand><pre className="px-3 py-1.5 m-0 font-mono text-[11px] leading-[18px] whitespace-pre-wrap break-words text-foreground"><span className="text-primary select-none">$ </span>{command}</pre></InputBand>
      {text ? <TextBlock text={text} /> : <div className="px-3 py-2 text-[11px] text-muted-foreground">{running ? 'waiting for output…' : 'no output'}</div>}
    </ScrollBox>
  );
}

function CodeLines({ lines, start = 1 }: { lines: string[]; start?: number }) {
  return (
    <div className="py-1.5 font-mono text-[11px] leading-[19px]">
      {lines.map((l, i) => (
        <div key={i} className="flex">
          <span className="w-12 pr-3 text-right text-muted-foreground select-none shrink-0 tabular-nums">{start + i}</span>
          <span className="whitespace-pre-wrap break-words pr-3 min-w-0 text-foreground">{l || ' '}</span>
        </div>
      ))}
    </div>
  );
}

type DiffRow = { k: 'add' | 'del' | 'ctx' | 'gap'; s: string; o?: number; n?: number };

function DiffRows({ rows, live }: { rows: DiffRow[]; live?: boolean }) {
  return (
    <div className="py-1.5 font-mono text-[11px] leading-[19px]">
      {rows.map((r, i) => r.k === 'gap'
        ? <div key={i} className="px-3 text-muted-foreground select-none">⋯</div>
        : (
          <div key={i} className={cn('flex', r.k === 'add' && 'bg-success/10', r.k === 'del' && 'bg-destructive/10')}>
            <span className="w-10 pr-2 text-right text-muted-foreground select-none shrink-0 tabular-nums">{r.k !== 'add' ? r.o : ''}</span>
            <span className="w-10 pr-2 text-right text-muted-foreground select-none shrink-0 tabular-nums">{r.k !== 'del' ? r.n : ''}</span>
            <span className={cn('w-4 select-none shrink-0', r.k === 'add' ? 'text-success' : r.k === 'del' ? 'text-destructive' : 'text-muted-foreground')}>{r.k === 'add' ? '+' : r.k === 'del' ? '−' : ''}</span>
            <span className={cn('whitespace-pre-wrap break-words pr-3 min-w-0', r.k === 'add' ? 'text-success' : r.k === 'del' ? 'text-destructive' : 'text-muted-foreground')}>{r.s || ' '}{live && i === rows.length - 1 && <span className="streaming-cursor" />}</span>
          </div>
        ))}
    </div>
  );
}

// structuredPatch hunks carry real file line numbers; while streaming we only have the strings
function diffRowsFor(item: ToolItem, oldStr: string, newStr: string): DiffRow[] {
  const patch = item.meta?.structuredPatch;
  if (Array.isArray(patch) && patch.length) {
    const rows: DiffRow[] = [];
    patch.forEach((h: any, hi: number) => {
      if (hi > 0) rows.push({ k: 'gap', s: '' });
      let o = h.oldStart, n = h.newStart;
      for (const raw of h.lines as string[]) {
        const c = raw[0], s = raw.slice(1);
        if (c === '+') rows.push({ k: 'add', s, n: n++ });
        else if (c === '-') rows.push({ k: 'del', s, o: o++ });
        else rows.push({ k: 'ctx', s, o: o++, n: n++ });
      }
    });
    return rows;
  }
  return computeDiff(oldStr, newStr).map(d => ({ k: d.type, s: d.line, o: d.oldNum, n: d.newNum }));
}

function parseReadOutput(out: string): { start: number; lines: string[] } | null {
  const raw = out.split('\n');
  const m = /^\s*(\d+)[\t→]/.exec(raw[0] || '');
  if (!m) return null;
  const lines = raw.map(l => l.replace(/^\s*\d+[\t→]/, ''));
  while (lines.length && lines[lines.length - 1] === '' && !/^\s*\d+[\t→]/.test(raw[lines.length - 1] || '')) lines.pop();
  return { start: Number(m[1]), lines };
}

function SearchBody({ output, links }: { output: string; links: Array<{ title: string; url: string }> }) {
  const summary = output
    .split('\n')
    .filter(l => !/^Web search results for query:/.test(l) && !/^Links: \[/.test(l))
    .join('\n')
    .replace(/\n*REMINDER:[\s\S]*$/, '')
    .trim();
  return (
    <ScrollBox follow={0} className="max-h-[460px]">
      {summary && <Md text={summary} />}
      {links.length > 0 && (
        <div className="border-t border-border/40 px-2 py-1.5">
          <div className="text-[10.5px] text-muted-foreground px-1.5 pb-1">{links.length} source{links.length === 1 ? '' : 's'}</div>
          {links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-secondary/60 text-[11.5px] text-foreground no-underline min-w-0">
              <Favicon url={l.url} />
              <span className="min-w-0 break-words">{l.title}</span>
              <span className="ml-auto text-[10.5px] text-muted-foreground whitespace-nowrap pl-2">{hostOf(l.url)}</span>
            </a>
          ))}
        </div>
      )}
    </ScrollBox>
  );
}

function linksFrom(item: ToolItem): Array<{ title: string; url: string }> {
  if (Array.isArray(item.meta?.links)) return item.meta!.links;
  const line = (item.output || '').split('\n').find(l => l.startsWith('Links: ['));
  if (!line) return [];
  try { return JSON.parse(line.slice(7)); } catch { return []; }
}

function Checklist({ todos }: { todos: Array<{ content?: string; subject?: string; status?: string; activeForm?: string }> }) {
  return (
    <div className="py-1.5">
      {todos.map((t, i) => {
        const done = t.status === 'completed', doing = t.status === 'in_progress';
        return (
          <div key={i} className="flex items-start gap-2 px-3 py-0.5 text-[11.5px] leading-relaxed">
            <span className={cn('w-3.5 h-3.5 mt-[3px] rounded border shrink-0 flex items-center justify-center', done ? 'bg-success border-success text-background' : doing ? 'border-primary' : 'border-border')}>{done ? '✓' : ''}</span>
            <span className={cn(done ? 'text-muted-foreground line-through' : doing ? 'text-foreground font-medium' : 'text-foreground')}>{t.content || t.subject}</span>
          </div>
        );
      })}
    </div>
  );
}

function SmartOutput({ text, error }: { text: string; error?: boolean }) {
  const parsed = useMemo(() => { try { const v = JSON.parse(text); return typeof v === 'object' && v ? v : null; } catch { return null; } }, [text]);
  if (parsed) {
    const rows = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any).rows) ? (parsed as any).rows : null;
    if (rows && rows.length && rows.every((r: unknown) => r && typeof r === 'object' && !Array.isArray(r))) {
      const cols = [...new Set(rows.flatMap((r: object) => Object.keys(r)))] as string[];
      if (cols.length <= 12) {
        return (
          <div className="overflow-auto max-h-[300px]">
            <table className="tool-table w-full text-[11px] border-collapse">
              <thead><tr>{cols.map(c => <th key={c} className="text-left font-semibold text-foreground px-3 py-1 sticky top-0 bg-[var(--stream-deep)]">{c}</th>)}</tr></thead>
              <tbody>{rows.map((r: any, i: number) => <tr key={i}>{cols.map(c => <td key={c} className="px-3 py-1 text-foreground whitespace-nowrap">{typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      }
    }
    return <TextBlock text={JSON.stringify(parsed, null, 2)} />;
  }
  if (/^#{1,3} |\*\*|^- |\n- |\n\d+\. /.test(text) && !error) return <Md text={text} />;
  return <TextBlock text={text} tone={error ? 'error' : undefined} />;
}

function inputEntries(input: Record<string, unknown>): Array<[string, ReactNode]> {
  return Object.entries(input).map(([k, v]) => [k, typeof v === 'string'
    ? (v.includes('\n') ? <pre className="m-0 font-mono whitespace-pre-wrap break-words">{v}</pre> : v)
    : <span className="font-mono">{JSON.stringify(v)}</span>]);
}

// ---------------------------------------------------------------------------------------------
// the registry

const BROWSER_VERBS: Record<string, [string, string]> = {
  open: ['Opening', 'Opened'], navigate: ['Opening', 'Opened'], click: ['Clicking', 'Clicked'], click_at: ['Clicking', 'Clicked'],
  type: ['Typing', 'Typed'], fill: ['Filling', 'Filled'], fill_form: ['Filling', 'Filled form'], select: ['Selecting', 'Selected'],
  press: ['Pressing', 'Pressed'], hover: ['Hovering', 'Hovered'], scroll: ['Scrolling', 'Scrolled'], snapshot: ['Reading page', 'Read page'],
  screenshot: ['Capturing', 'Captured page'], evaluate: ['Running script', 'Ran script'], back: ['Going back', 'Went back'],
  forward: ['Going forward', 'Went forward'], reload: ['Reloading', 'Reloaded'], wait: ['Waiting', 'Waited'], pdf: ['Saving PDF', 'Saved PDF'],
  upload_file: ['Uploading', 'Uploaded'], drag: ['Dragging', 'Dragged'], close: ['Closing', 'Closed'],
};

function bare(name: string) { return name.replace(/^mcp__(dorabot-tools|my-agent-tools)__/, ''); }

export function describeTool(item: ToolItem, ctx: ToolCtx): CardSpec {
  const name = bare(item.name);
  const input = safeParse(item.input) as Record<string, any>;
  const out = item.output || '';
  const o = outcome(item, ctx);
  const running = o.status === 'running';
  const err = item.is_error;
  const tag = o.label ? <Tag tone={o.tone}>{o.label}</Tag> : null;
  const open = ctx.open;

  switch (name) {
    case 'Bash': {
      const command = String(input.command || '');
      const bgId = item.meta?.backgroundTaskId as string | undefined;
      const bg = !!input.run_in_background || !!bgId;
      const outPath = /Output is being written to: (\S+)/.exec(out)?.[1];
      const prog = ctx.progressByToolUse.get(item.id);
      const ended = (prog && prog.status !== 'running' ? prog.status : undefined) ?? (item.meta?.bgStatus as string | undefined);
      const bgRunning = bg && !ended && (prog ? prog.status === 'running' : !!bgId && ctx.backgroundRunning.has(bgId));
      // success needs no label
      const endTag = ended === 'failed' ? <Tag tone="bad">failed</Tag> : ended === 'killed' || ended === 'stopped' ? <Tag tone="warn">stopped</Tag> : undefined;
      const desc = input.description ? String(input.description) : '';
      if (bg) {
        return {
          kind: 'command', background: true, icon: SquareTerminal, verb: 'Background', target: desc || command,
          facts: running || bgRunning ? undefined : tag ?? endTag,
          status: bgRunning ? 'running' : ended === 'failed' ? 'error' : ended === 'killed' || ended === 'stopped' ? 'stopped' : o.status,
          endedAt: bgRunning ? undefined : prog?.endedAt ?? (item.meta?.bgEndedAt as number | undefined),
          actions: [
            { icon: Copy, label: 'copy command', onClick: () => copy(command) },
            ...(bgRunning && bgId && open?.stopTask ? [{ icon: Square, label: 'stop', onClick: () => open.stopTask!(bgId) }] : []),
          ],
          body: outPath && open?.tail ? () => <TailBody path={outPath} command={command} running={bgRunning} tail={open.tail} /> : () => <CommandBody command={command} output={out} error={!!err} live={ctx.live} item={item} ctx={ctx} />,
        };
      }
      return {
        kind: 'command', icon: Terminal, verb: verbFor(running, 'Running', 'Ran'), target: command,
        facts: tag,
        status: o.status,
        actions: [
          { icon: Copy, label: 'copy command', onClick: () => copy(command) },
          ...(out ? [{ icon: ClipboardList, label: 'copy output', onClick: () => copy(out) }] : []),
          // the cli can move it only once it has registered the call as a task
          ...(running && prog?.status === 'running' && open?.background ? [{ icon: ArrowDownToLine, label: 'move to background', onClick: () => open.background!(item.id) }] : []),
        ],
        body: () => <CommandBody command={command} output={out} error={!!err} live={ctx.live} item={item} ctx={ctx} />,
      };
    }

    case 'Read': {
      const path = String(input.file_path || '');
      const f = item.meta?.file as Record<string, any> | undefined;
      const parsed = !err ? parseReadOutput(out) : null;
      const isImage = !!item.imageData || f?.type === 'image' || item.meta?.type === 'image';
      const facts = tag;
      return {
        kind: 'read', icon: isImage ? ImageIcon : FileText, verb: verbFor(running, 'Reading', 'Read'), target: path, facts, status: o.status,
        actions: open?.file && path ? [{ icon: ExternalLink, label: 'open file', onClick: () => open.file!(path) }] : [],
        body: item.imageData
          ? () => <img src={item.imageData} alt="" className="m-2 max-h-[320px] rounded border border-border/50" />
          : parsed ? () => <ScrollBox follow={0}><CodeLines lines={parsed.lines} start={parsed.start} /></ScrollBox>
          : out ? () => <ScrollBox follow={0}><TextBlock text={out} tone={err ? 'error' : undefined} /></ScrollBox> : undefined,
      };
    }

    case 'Edit': case 'MultiEdit': {
      const path = String(input.file_path || '');
      const oldStr = String(input.old_string ?? ''), newStr = String(input.new_string ?? '');
      const rows = diffRowsFor(item, oldStr, newStr);
      const add = rows.filter(r => r.k === 'add').length, del = rows.filter(r => r.k === 'del').length;
      return {
        kind: 'edit', icon: Pencil, verb: verbFor(running, 'Editing', 'Edited'), target: path,
        facts: tag ?? <DiffStat add={add} del={del} />, status: o.status,
        actions: [
          ...(open?.file && path ? [{ icon: ExternalLink, label: 'open file', onClick: () => open.file!(path) }] : []),
          ...(open?.diff && path ? [{ icon: FileDiff, label: 'open diff', onClick: () => open.diff!({ filePath: path, oldContent: oldStr, newContent: newStr, label: `${path.split('/').pop()} (edit)` }) }] : []),
        ],
        body: () => (
          <ScrollBox live={ctx.live} follow={newStr}>
            {err && out ? <TextBlock text={out} tone="error" /> : null}
            <DiffRows rows={rows} live={running} />
          </ScrollBox>
        ),
      };
    }

    case 'Write': {
      const path = String(input.file_path || '');
      const content = String(input.content ?? '');
      const lines = content.split('\n');
      const replaced = item.meta?.type === 'update';
      return {
        kind: 'write', icon: FilePlus, verb: verbFor(running, 'Writing', replaced ? 'Rewrote' : 'Wrote'), target: path,
        facts: tag, status: o.status,
        actions: open?.file && path && !running ? [{ icon: ExternalLink, label: 'open file', onClick: () => open.file!(path) }] : [],
        body: () => (
          <ScrollBox live={ctx.live} follow={content}>
            {err && out ? <TextBlock text={out} tone="error" /> : null}
            <CodeLines lines={lines} />
          </ScrollBox>
        ),
      };
    }

    case 'Grep': case 'Glob': {
      const isGlob = name === 'Glob';
      const pattern = String(input.pattern || '');
      const where = input.path ? `  in ${input.path}` : '';
      const lines = out.split('\n').filter(Boolean);
      const header = /^Found (\d+) (files?|matches?|lines?)/.exec(lines[0] || '');
      const items = header ? lines.slice(1) : lines;
      const chips = ['glob', 'type', 'output_mode', '-i', '-n', 'multiline'].filter(k => input[k] != null && input[k] !== false).map(k => `${k}${input[k] === true ? '' : `: ${input[k]}`}`);
      return {
        kind: 'search', icon: isGlob ? FolderSearch : Search, verb: verbFor(running, 'Searching', isGlob ? 'Found' : 'Searched'), target: pattern + where,
        facts: tag ?? (!running && !items.length ? <Tag>no matches</Tag> : undefined),
        status: o.status,
        body: out ? () => (
          <ScrollBox follow={0}>
            {chips.length > 0 && <div className="flex flex-wrap gap-1 px-3 pt-2">{chips.map(c => <Tag key={c}>{c}</Tag>)}</div>}
            <div className="py-1.5 font-mono text-[11px] leading-[19px]">
              {items.map((l, i) => {
                const m = /^(.+?):(\d+)[:-](.*)$/.exec(l);
                const path = m ? m[1] : l;
                return (
                  <div key={i} className="flex px-3 min-w-0">
                    {m && <span className="text-muted-foreground w-10 shrink-0 text-right pr-2 tabular-nums">{m[2]}</span>}
                    <button type="button" disabled={!open?.file} onClick={() => open?.file?.(path)} className={cn('text-left min-w-0 break-all', m ? 'text-foreground' : 'text-foreground hover:underline')}>{m ? <><span className="text-muted-foreground">{path.split('/').pop()}:</span> {m[3]}</> : l}</button>
                  </div>
                );
              })}
            </div>
          </ScrollBox>
        ) : undefined,
      };
    }

    case 'WebSearch': {
      const links = linksFrom(item);
      return {
        kind: 'search', icon: Globe, verb: verbFor(running, 'Searching web', 'Searched web'), target: String(input.query || ''),
        facts: tag, status: o.status,
        body: out ? () => <SearchBody output={out} links={links} /> : undefined,
      };
    }

    case 'WebFetch': {
      const url = String(input.url || item.meta?.url || '');
      const code = item.meta?.code;
      return {
        kind: 'fetch', icon: Globe, verb: verbFor(running, 'Fetching', 'Fetched'), target: url.replace(/^https?:\/\/(www\.)?/, ''),
        facts: tag ?? (typeof code === 'number' && (code < 200 || code >= 300) ? <Tag tone="bad">HTTP {code}</Tag> : undefined), status: o.status,
        actions: url && open?.url ? [{ icon: ExternalLink, label: 'open page', onClick: () => open.url!(url) }] : [],
        body: out || input.prompt ? () => (
          <ScrollBox follow={0} className="max-h-[460px]">
            {input.prompt && <InputBand className="px-3 py-1.5 text-[11px] text-foreground whitespace-pre-wrap break-words">{String(input.prompt)}</InputBand>}
            {out && (err ? <TextBlock text={out} tone="error" /> : <Md text={out} />)}
            {url && <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border/40 text-[10.5px] text-muted-foreground"><Favicon url={url} /><span className="break-all">{url}</span></div>}
          </ScrollBox>
        ) : undefined,
      };
    }

    case 'browser': case 'browser_navigate': case 'browser_evaluate': {
      const action = String(input.action || name.replace('browser_', ''));
      const [pv, dv] = BROWSER_VERBS[action] || [`Browser ${action}`, `Browser ${action}`];
      const target = [input.url, input.ref ? `ref ${input.ref}` : '', input.text ? `"${input.text}"` : '', input.selector].filter(Boolean).join(' · ');
      return {
        kind: 'browser', icon: MousePointer2, verb: verbFor(running, pv, dv), target, facts: tag, status: o.status,
        actions: input.url && open?.url ? [{ icon: ExternalLink, label: 'open page', onClick: () => open.url!(String(input.url)) }] : [],
        body: item.imageData ? () => <img src={item.imageData} alt="" className="m-2 max-h-[360px] rounded border border-border/50" /> : out ? () => <ScrollBox follow={0}><TextBlock text={out} tone={err ? 'error' : undefined} /></ScrollBox> : undefined,
      };
    }

    case 'screenshot': case 'imageView': case 'imageGeneration': {
      const verb = name === 'imageGeneration' ? verbFor(running, 'Generating image', 'Generated image') : verbFor(running, 'Capturing', 'Screenshot');
      const src = item.imageData || (out.startsWith('data:') ? out : undefined);
      return {
        kind: 'other', icon: name === 'screenshot' ? Camera : ImageIcon, verb, target: String(input.prompt || input.display || input.path || ''), facts: tag, status: o.status,
        body: src ? () => <img src={src} alt="" className="m-2 max-h-[360px] rounded border border-border/50" /> : out ? () => <TextBlock text={out} /> : undefined,
      };
    }

    case 'message': {
      const message = String(input.message || '');
      return {
        kind: 'other', icon: MessageSquare, verb: verbFor(running, 'Sending', 'Sent'), target: [input.channel, input.target].filter(Boolean).join(' · '), facts: tag, status: o.status,
        body: message ? () => <div className="p-3"><div className="inline-block max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words bg-[var(--stream-bubble-default)]">{message}</div></div> : undefined,
      };
    }

    case 'Agent': case 'Task': {
      return describeAgent(item, input, ctx, o, tag);
    }

    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet': {
      const todos = Array.isArray(input.todos) ? input.todos : null;
      if (todos) {
        const done = todos.filter((t: any) => t.status === 'completed').length;
        return { kind: 'plan', icon: ListTodo, verb: 'Plan', target: todos.find((t: any) => t.status === 'in_progress')?.activeForm || '', facts: `${done} of ${todos.length} done`, status: o.status === 'running' ? 'none' : o.status, body: () => <Checklist todos={todos} /> };
      }
      const verb = name === 'TaskCreate' ? 'Added to plan' : name === 'TaskUpdate' ? 'Updated plan' : 'Read plan';
      return { kind: 'plan', icon: ListTodo, verb, target: String(input.subject || input.taskId || input.status || ''), facts: tag, status: o.status, dim: true, body: out ? () => <TextBlock text={out} /> : undefined };
    }

    case 'AskUserQuestion': {
      const qs = Array.isArray(input.questions) ? input.questions : [];
      const answers = (item.meta?.answers || {}) as Record<string, string>;
      const firstQ = qs[0]?.question || '';
      const firstA = answers[firstQ] || (out && !/^User has answered/.test(out) ? out : '');
      return {
        kind: 'other', icon: HelpCircle, verb: running ? 'Asking' : 'Asked', target: firstQ, facts: tag, status: o.status,
        body: qs.length ? () => (
          <div className="py-1.5">
            {qs.map((q: any, qi: number) => (
              <div key={qi} className="px-3 py-1">
                <div className="text-[11.5px] text-foreground mb-1">{q.question}</div>
                {(q.options || []).map((op: any, i: number) => {
                  const picked = String(answers[q.question] || '').split(', ').includes(op.label);
                  return <div key={i} className={cn('flex items-center gap-2 text-[11.5px] py-0.5', picked ? 'text-foreground' : 'text-muted-foreground')}><span className={cn('w-3 h-3 rounded-full border shrink-0', picked ? 'border-primary bg-primary' : 'border-border')} />{op.label}</div>;
                })}
                {answers[q.question] && !(q.options || []).some((op: any) => String(answers[q.question]).split(', ').includes(op.label)) && <div className="text-[11px] text-muted-foreground mt-1">your answer: {answers[q.question]}</div>}
              </div>
            ))}
          </div>
        ) : undefined,
      };
    }

    case 'schedule': case 'list_schedule': case 'update_schedule': case 'cancel_schedule': {
      const verb = { schedule: 'Scheduled', list_schedule: 'Listed schedule', update_schedule: 'Updated schedule', cancel_schedule: 'Cancelled' }[name]!;
      return { kind: 'other', icon: Clock, verb, target: String(input.summary || input.message || input.id || ''), facts: tag, status: o.status, body: () => <><InputBand><KeyValues entries={inputEntries(input)} /></InputBand>{out && <TextBlock text={out} />}</> };
    }

    case 'research_view': case 'research_add': case 'research_update': case 'research_delete': {
      const id = String(input.id || /#?(\d+)/.exec(out)?.[1] || '');
      const verb = { research_view: 'Viewed research', research_add: 'Added research', research_update: 'Updated research', research_delete: 'Deleted research' }[name]!;
      return {
        kind: 'other', icon: BookOpen, verb, target: [id && `#${id}`, input.title || input.query].filter(Boolean).join(' '), facts: tag, status: o.status,
        actions: id && open?.research && name !== 'research_delete' ? [{ icon: ExternalLink, label: `open #${id}`, onClick: () => open.research!(id) }] : [],
        body: out ? () => <ScrollBox follow={0}><SmartOutput text={out} error={err} /></ScrollBox> : undefined,
      };
    }

    case 'memory_search': case 'memory_read': {
      return {
        kind: 'read', icon: name === 'memory_search' ? Search : BookOpen, verb: name === 'memory_search' ? 'Searched memory' : 'Read memory', target: String(input.query || input.id || ''), facts: tag, status: o.status,
        body: out ? () => <ScrollBox follow={0}><SmartOutput text={out} error={err} /></ScrollBox> : undefined,
      };
    }

    case 'Monitor': {
      return {
        kind: 'command', icon: Activity, verb: running ? 'Starting watch' : 'Watching', target: [input.description, input.command].filter(Boolean).join('\n'), facts: tag, status: o.status,
        body: () => <CommandBody command={String(input.command || '')} output={out} error={!!err} live={false} item={item} ctx={ctx} />,
      };
    }

    case 'TaskOutput': case 'TaskStop': case 'KillShell': {
      const what = String(item.meta?.command || input.task_id || input.shell_id || '');
      return { kind: 'other', icon: Square, verb: name === 'TaskOutput' ? 'Read output of' : 'Stopped', target: what, facts: tag, status: o.status, dim: true, body: out && name === 'TaskOutput' ? () => <ScrollBox follow={0}><TextBlock text={out} /></ScrollBox> : undefined };
    }

    case 'SendMessage': {
      const msg = String(input.message || input.summary || '');
      return { kind: 'other', icon: MessageSquare, verb: 'Messaged agent', target: String(input.to || ''), facts: tag, status: o.status, body: msg ? () => <div className="p-3"><div className="inline-block max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 text-xs whitespace-pre-wrap break-words bg-[var(--stream-bubble-default)]">{msg}</div></div> : undefined };
    }

    case 'ToolSearch': {
      const m = Array.isArray(item.meta?.matches) ? (item.meta!.matches as string[]).join(' · ') : String(input.query || '').replace(/^select:/, '').split(',').join(' · ');
      return { kind: 'other', icon: Wrench, verb: 'Loaded tools', target: m, status: o.status, dim: true };
    }
    case 'Skill':
      return { kind: 'other', icon: BookOpen, verb: 'Using skill', target: String(input.skill || input.name || ''), status: o.status, dim: true };
    case 'ScheduleWakeup':
      return { kind: 'other', icon: Clock, verb: 'Will check back', target: `in ${Math.round(Number(input.delaySeconds || 0) / 60)} min${input.reason ? `: ${input.reason}` : ''}`, status: o.status, dim: true };
    case 'PushNotification':
      return { kind: 'other', icon: Bell, verb: 'Notified you', target: String(input.message || input.title || ''), status: o.status, dim: true };
  }

  // anything else, mcp or not: inputs as key/values, output as a table, json or text
  const mcp = /^mcp__(.+?)__(.+)$/.exec(item.name);
  const server = mcp ? mcp[1].replace(/^claude_ai_/, '').replace(/_/g, ' ') : '';
  const short = mcp ? mcp[2] : item.name;
  return {
    kind: 'other', icon: mcp ? Plug : Wrench, verb: short.replace(/_/g, ' '), target: firstString(input),
    facts: tag, status: o.status,
    body: () => (
      <ScrollBox follow={0}>
        <InputBand><KeyValues entries={inputEntries(input)} /></InputBand>
        {out && <div><SmartOutput text={item.meta?.structuredContent ? JSON.stringify(item.meta.structuredContent) : out} error={err} /></div>}
      </ScrollBox>
    ),
  };
}

function firstString(input: Record<string, any>): string {
  for (const k of ['query', 'q', 'sql', 'url', 'path', 'name', 'title', 'id']) if (typeof input[k] === 'string') return input[k];
  const v = Object.values(input).find(x => typeof x === 'string');
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------------------------------------
// subagents

function describeAgent(item: ToolItem, input: Record<string, any>, ctx: ToolCtx, o: ReturnType<typeof outcome>, tag: ReactNode): CardSpec {
  const description = String(input.description || input.name || input.subagent_type || 'agent');
  const prompt = String(input.prompt || '');
  const progress = ctx.progressByToolUse.get(item.id);
  const meta = item.meta || {};
  const bg = !!input.run_in_background || meta.isAsync === true;
  const subs = (item.subItems || []).filter(s => s.type === 'tool_use' || s.type === 'text' || s.type === 'thinking');
  const ended = (progress && progress.status !== 'running' ? progress.status : undefined) ?? (meta.bgStatus as string | undefined);
  const bgRunning = bg && !ended && (progress ? progress.status === 'running' : ctx.backgroundRunning.has(String(meta.agentId || '')));
  const status: CardStatus = bg
    ? (bgRunning ? 'running' : ended === 'failed' ? 'error' : ended === 'killed' || ended === 'stopped' ? 'stopped' : o.status === 'running' ? 'running' : o.status)
    : o.status;
  const endTag = bg && !bgRunning && ended ? (ended === 'failed' ? <Tag tone="bad">failed</Tag> : ended === 'killed' || ended === 'stopped' ? <Tag tone="warn">stopped</Tag> : null) : null;
  const facts = tag ?? endTag;
  const outputFile = typeof meta.outputFile === 'string' ? meta.outputFile : undefined;
  const taskId = progress?.taskId || (typeof meta.agentId === 'string' ? meta.agentId : undefined);
  return {
    kind: 'agent', background: bg, icon: Bot, verb: bg ? 'Background agent' : 'Agent', target: description,
    facts, status,
    endedAt: bg && !bgRunning ? progress?.endedAt ?? (meta.bgEndedAt as number | undefined) : undefined,
    actions: [
      ...(outputFile && ctx.open?.file ? [{ icon: ExternalLink, label: 'open transcript', onClick: () => ctx.open!.file!(outputFile) }] : []),
      ...(status === 'running' && taskId && ctx.open?.stopTask ? [{ icon: Square, label: 'stop', onClick: () => ctx.open!.stopTask!(taskId) }] : []),
      ...(!bg && status === 'running' && progress?.status === 'running' && ctx.open?.background ? [{ icon: ArrowDownToLine, label: 'move to background', onClick: () => ctx.open!.background!(item.id) }] : []),
    ],
    body: () => <AgentBody item={item} prompt={prompt} progress={progress} subs={subs} ctx={ctx} running={status === 'running'} bg={bg} outputFile={outputFile} />,
  };
}

function AgentBody({ item, prompt, progress, subs, ctx, running, bg, outputFile }: { item: ToolItem; prompt: string; progress?: TaskProgress; subs: ChatItem[]; ctx: ToolCtx; running: boolean; bg: boolean; outputFile?: string }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const live = useBackgroundTranscript(bg ? outputFile : undefined, running, ctx.open?.tail);
  const nested = bg && live.length ? live : subs;
  const final = !running && item.output && !bg ? item.output : bg && !running && progress?.summary ? progress.summary : '';
  return (
    <div className="min-w-0">
      {(progress?.summary && running) && <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border/30">now: {progress.summary}</div>}
      {prompt && (
        <button type="button" onClick={() => setShowPrompt(v => !v)} className="block w-full text-left px-3 py-1 text-[10.5px] text-muted-foreground hover:text-foreground">{showPrompt ? '▾ prompt' : '▸ prompt'}</button>
      )}
      {showPrompt && <InputBand className="px-3 py-1.5 text-[11px] text-foreground whitespace-pre-wrap break-words">{prompt}</InputBand>}
      {nested.length > 0 && (
        <ScrollBox live={running} follow={nested.length} className="!rounded-none">
          <div className="pl-3 pr-1 py-1">{ctx.renderNested?.(nested, ctx.depth + 1)}</div>
        </ScrollBox>
      )}
      {final && <div className="border-t border-border/40"><Md text={final} /></div>}
    </div>
  );
}

// background agents do not stream into the parent session; their transcript file does grow.
// pull it and turn tool calls into nested rows.
function useBackgroundTranscript(path: string | undefined, running: boolean, tail: NonNullable<ToolCtx['open']>['tail']): ChatItem[] {
  const [items, setItems] = useState<ChatItem[]>([]);
  const offset = useRef(0);
  const carry = useRef('');
  const byId = useRef(new Map<string, number>());
  useEffect(() => {
    if (!path || !tail) return;
    let stop = false;
    const pull = () => tail(path, offset.current).then(r => {
      if (stop || !r.content) return;
      offset.current = r.next ?? r.size;
      const text = carry.current + r.content;
      const lines = text.split('\n');
      carry.current = lines.pop() || '';
      setItems(prev => {
        const next = [...prev];
        for (const line of lines) {
          let m: any;
          try { m = JSON.parse(line); } catch { continue; }
          const blocks = m?.message?.content;
          if (!Array.isArray(blocks)) continue;
          for (const b of blocks) {
            if (b.type === 'tool_use') {
              byId.current.set(b.id, next.length);
              next.push({ type: 'tool_use', id: b.id, name: b.name, input: JSON.stringify(b.input || {}), streaming: true, timestamp: Date.parse(m.timestamp) || Date.now() });
            } else if (b.type === 'tool_result') {
              const idx = byId.current.get(b.tool_use_id);
              if (idx == null) continue;
              const content = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : '';
              next[idx] = { ...(next[idx] as ToolItem), output: content, is_error: !!b.is_error, streaming: false, endedAt: Date.parse(m.timestamp) || Date.now() };
            } else if (b.type === 'text' && m.type === 'assistant' && b.text?.trim()) {
              next.push({ type: 'text', content: b.text, timestamp: Date.parse(m.timestamp) || Date.now() });
            }
          }
        }
        return next;
      });
    }).catch(() => {});
    pull();
    if (!running) return () => { stop = true; };
    const id = setInterval(pull, 1500);
    return () => { stop = true; clearInterval(id); };
  }, [path, running, tail]);
  return items;
}
