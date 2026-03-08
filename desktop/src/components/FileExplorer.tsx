import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  Folder, File, ChevronRight, ChevronDown, FolderPlus, Pencil, Trash2,
  GitBranch, Plus, Minus, FileEdit, RefreshCw, ArrowDownToLine,
  Check, ChevronUp, Undo2, RotateCcw,
} from 'lucide-react';

type FileEntry = {
  name: string;
  type: 'file' | 'directory';
  size?: number;
};

type GitFileStatus = {
  path: string;
  status: string;
  staged: boolean;
};

type GitState = {
  root: string;
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
};

type GitBranchInfo = {
  name: string;
  current: boolean;
  remote: boolean;
};

type GitCommit = {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
};

type DirState = {
  entries: FileEntry[];
  loading: boolean;
  error?: string;
};

type ContextMenuState = {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
} | null;

type Props = {
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  connected: boolean;
  onFileClick?: (filePath: string) => void;
  onOpenDiff?: (opts: { filePath: string; oldContent: string; newContent: string; label?: string }) => void;
  onFileChange?: (listener: (path: string) => void) => () => void;
  onOpenTerminal?: (cwd: string) => void;
  mode?: 'files' | 'git';
  initialViewRoot?: string;
  initialExpanded?: string[];
  initialSelectedPath?: string | null;
  onStateChange?: (state: { viewRoot: string; expanded: string[]; selectedPath: string | null }) => void;
};

function shortenPath(p: string): string {
  const m = p.match(/^\/Users\/[^/]+/);
  if (m && p.startsWith(m[0])) return '~' + p.slice(m[0].length);
  return p;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'K';
  return (bytes / (1024 * 1024)).toFixed(1) + 'M';
}

function buildCrumbs(root: string, current: string): { label: string; path: string }[] {
  const short = shortenPath(current);
  const parts = short.split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  let abs = short.startsWith('~') ? root.match(/^\/Users\/[^/]+/)?.[0] || '' : '';
  for (const part of parts) {
    if (part === '~') {
      abs = root.match(/^\/Users\/[^/]+/)?.[0] || '';
      crumbs.push({ label: '~', path: abs });
    } else {
      abs = abs + '/' + part;
      crumbs.push({ label: part, path: abs });
    }
  }
  return crumbs;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Git Source Control Panel (VS Code style) ───────────────────────

type GitContextMenuState = {
  x: number;
  y: number;
  file: GitFileStatus;
  section: 'staged' | 'unstaged';
} | null;

function GitPanel({ rpc, gitState, onFileClick, onOpenDiff, onRefresh }: {
  rpc: Props['rpc'];
  gitState: GitState;
  onFileClick?: (path: string) => void;
  onOpenDiff?: Props['onOpenDiff'];
  onRefresh: () => void;
}) {
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [branchSelectedIdx, setBranchSelectedIdx] = useState(0);
  const [showCommits, setShowCommits] = useState(false);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [actionError, setActionError] = useState('');
  const [contextMenu, setContextMenu] = useState<GitContextMenuState>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);

  const staged = gitState.files.filter(f => f.staged);
  const unstaged = gitState.files.filter(f => !f.staged);

  const loadBranches = useCallback(async () => {
    try {
      const res = await rpc('git.branches', { path: gitState.root }) as { branches: GitBranchInfo[] };
      setBranches(res.branches);
    } catch { /* ignore */ }
  }, [rpc, gitState.root]);

  const loadCommits = useCallback(async () => {
    try {
      const res = await rpc('git.log', { path: gitState.root, count: 20 }) as { commits: GitCommit[] };
      setCommits(res.commits);
    } catch { /* ignore */ }
  }, [rpc, gitState.root]);

  const openBranchPicker = useCallback(() => {
    setShowBranchPicker(true);
    setBranchFilter('');
    setBranchSelectedIdx(0);
    loadBranches();
  }, [loadBranches]);

  const closeBranchPicker = useCallback(() => {
    setShowBranchPicker(false);
    setBranchFilter('');
  }, []);

  const handleCheckout = async (branch: string) => {
    setActionError('');
    closeBranchPicker();
    try {
      await rpc('git.checkout', { path: gitState.root, branch });
      onRefresh();
    } catch (err) {
      setActionError(String(err));
    }
  };

  const handleFetch = async () => {
    setFetching(true);
    setActionError('');
    try {
      await rpc('git.fetch', { path: gitState.root });
      onRefresh();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setFetching(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setActionError('');
    try {
      await rpc('git.pull', { path: gitState.root });
      onRefresh();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setPulling(false);
    }
  };

  const handleStage = async (filePath: string) => {
    await rpc('git.stageFile', { path: gitState.root, file: filePath });
    onRefresh();
  };

  const handleUnstage = async (filePath: string) => {
    try {
      await rpc('git.unstageFile', { path: gitState.root, file: filePath });
    } catch (err) {
      console.error('unstage failed:', filePath, err);
    }
    onRefresh();
  };

  const handleDiscard = async (filePath: string) => {
    if (!confirm(`Discard changes to ${filePath}?`)) return;
    try {
      await rpc('git.discardFile', { path: gitState.root, file: filePath });
      onRefresh();
    } catch (err) {
      setActionError(String(err));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim() || staged.length === 0) return;
    setCommitting(true);
    setActionError('');
    try {
      await rpc('git.commit', { path: gitState.root, message: commitMsg.trim() });
      setCommitMsg('');
      onRefresh();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setCommitting(false);
    }
  };

  const handleStageAll = async () => {
    try {
      await rpc('git.stageAll', { path: gitState.root });
    } catch {
      for (const f of unstaged) await rpc('git.stageFile', { path: gitState.root, file: f.path });
    }
    onRefresh();
  };

  const handleUnstageAll = async () => {
    try {
      await rpc('git.unstageAll', { path: gitState.root });
    } catch {
      for (const f of staged) await rpc('git.unstageFile', { path: gitState.root, file: f.path });
    }
    onRefresh();
  };

  const openFileDiff = useCallback(async (f: GitFileStatus) => {
    const fullPath = gitState.root + '/' + f.path;
    if (onOpenDiff && (f.status === 'M' || f.status === 'A')) {
      try {
        const currentRes = await rpc('fs.read', { path: fullPath }) as { content: string };
        const oldRes = await rpc('git.showFile', { path: gitState.root, file: f.path }) as { content: string };
        onOpenDiff({ filePath: f.path, oldContent: oldRes.content || '', newContent: currentRes.content, label: `${f.path.split('/').pop()} (diff)` });
      } catch {
        onFileClick?.(fullPath);
      }
    } else {
      onFileClick?.(fullPath);
    }
  }, [gitState.root, rpc, onOpenDiff, onFileClick]);

  // Branch picker keyboard nav
  const filteredBranches = branchFilter
    ? branches.filter(b => b.name.toLowerCase().includes(branchFilter.toLowerCase()))
    : branches;

  const localBranches = filteredBranches.filter(b => !b.remote);
  const remoteBranches = filteredBranches.filter(b => b.remote);
  const allFiltered = [...localBranches, ...remoteBranches];

  useEffect(() => {
    setBranchSelectedIdx(0);
  }, [branchFilter]);

  // Dismiss context menu
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const handleFileContextMenu = useCallback((e: React.MouseEvent, f: GitFileStatus, section: 'staged' | 'unstaged') => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file: f, section });
  }, []);

  const renderFileRow = (f: GitFileStatus, section: 'staged' | 'unstaged') => {
    const canStage = section === 'unstaged';
    const statusColor =
      f.status === 'D' ? 'text-destructive' :
      f.status === 'A' || f.status === '?' ? 'text-success' :
      'text-warning';
    const fileName = f.path.split('/').pop() || f.path;
    const dirPart = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';

    return (
      <div
        key={`${f.path}-${f.staged}`}
        className={cn(
          'relative flex items-center gap-1 px-2 py-0.5 text-[11px] group cursor-pointer transition-colors',
          section === 'staged' ? 'hover:bg-success/10' : 'hover:bg-warning/10',
        )}
        onClick={() => openFileDiff(f)}
        onContextMenu={(e) => handleFileContextMenu(e, f, section)}
        title={f.path}
      >
        <span
          className={cn(
            'absolute left-0.5 top-1 bottom-1 w-px rounded-full transition-colors',
            section === 'staged' ? 'bg-success/40 group-hover:bg-success/70' : 'bg-warning/40 group-hover:bg-warning/70',
          )}
        />
        <span className="truncate min-w-0 flex-1">
          <span className="text-foreground">{fileName}</span>
          {dirPart && <span className="text-muted-foreground/50 ml-1 text-[10px]">{dirPart}</span>}
        </span>
        {/* hover action icons (VS Code style) */}
        <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          {canStage && (
            <button
              className="p-0.5 rounded hover:bg-secondary"
              onClick={(e) => { e.stopPropagation(); handleDiscard(f.path); }}
              title="Discard Changes"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
          <button
            className="p-0.5 rounded hover:bg-secondary"
            onClick={(e) => {
              e.stopPropagation();
              canStage ? handleStage(f.path) : handleUnstage(f.path);
            }}
            title={canStage ? 'Stage Changes' : 'Unstage Changes'}
          >
            {canStage ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
        </span>
        <span className={cn('text-[9px] font-mono shrink-0 w-3 text-right', statusColor)}>{f.status === '?' ? 'U' : f.status}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* header bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold flex-1">source control</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={handleFetch} disabled={fetching}>
              <RefreshCw className={cn('w-3 h-3', fetching && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">Fetch</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 relative" onClick={handlePull} disabled={pulling}>
              <ArrowDownToLine className={cn('w-3 h-3', pulling && 'animate-pulse')} />
              {gitState.behind > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[12px] h-3 px-0.5 rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center">
                  {gitState.behind}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">
            {gitState.behind > 0 ? `Pull (${gitState.behind} behind)` : 'Pull'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* branch bar */}
      <div className="px-2 py-1 border-b border-border shrink-0">
        <button
          className="flex items-center gap-1 w-full px-1.5 py-0.5 rounded text-[11px] font-medium hover:bg-secondary/50 transition-colors"
          onClick={openBranchPicker}
        >
          <GitBranch className="w-3 h-3 shrink-0 text-primary" />
          <span className="truncate">{gitState.branch || 'HEAD (detached)'}</span>
          {(gitState.ahead > 0 || gitState.behind > 0) && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-normal shrink-0">
              {gitState.ahead > 0 && <span title={`${gitState.ahead} ahead of upstream`}>↑{gitState.ahead}</span>}
              {gitState.behind > 0 && <span title={`${gitState.behind} behind upstream`}>↓{gitState.behind}</span>}
            </span>
          )}
          <ChevronDown className="w-3 h-3 shrink-0 ml-auto text-muted-foreground" />
        </button>
      </div>

      {actionError && (
        <div className="px-2 py-1 text-[10px] text-destructive bg-destructive/10 border-b border-border shrink-0 break-words">
          {actionError}
          <button className="ml-1 underline" onClick={() => setActionError('')}>dismiss</button>
        </div>
      )}

      {/* commit input */}
      <div className="px-2 py-1.5 border-b border-border shrink-0 space-y-1">
        <textarea
          className="w-full px-2 py-1 text-[11px] bg-secondary/30 border border-border rounded resize-none outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
          rows={2}
          placeholder="Message (Cmd+Enter to commit)"
          value={commitMsg}
          onChange={e => setCommitMsg(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              handleCommit();
            }
          }}
        />
        <Button
          variant="default"
          size="sm"
          className="w-full h-6 text-[11px]"
          disabled={!commitMsg.trim() || staged.length === 0 || committing}
          onClick={handleCommit}
        >
          {committing ? 'Committing...' : staged.length > 0 ? `Commit (${staged.length})` : 'Commit'}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {/* staged changes */}
        {staged.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center justify-between px-2 py-1.5 sticky top-0 bg-background/95 backdrop-blur border-y border-border/60 z-10">
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-success/20 text-success">
                  <Check className="w-2.5 h-2.5" />
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Staged Changes ({staged.length})
                </span>
              </span>
              <button
                className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                onClick={handleUnstageAll}
                title="Unstage All"
              >
                <Minus className="w-3 h-3" />
              </button>
            </div>
            <div className="border-l border-success/25 ml-2 pl-1">
              {staged.map(f => renderFileRow(f, 'staged'))}
            </div>
          </div>
        )}

        {/* unstaged changes */}
        {unstaged.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center justify-between px-2 py-1.5 sticky top-0 bg-background/95 backdrop-blur border-y border-border/60 z-10">
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-warning/20 text-warning">
                  <FileEdit className="w-2.5 h-2.5" />
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Changes ({unstaged.length})
                </span>
              </span>
              <span className="flex items-center gap-0.5">
                <button
                  className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  onClick={handleStageAll}
                  title="Stage All"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </span>
            </div>
            <div className="border-l border-warning/25 ml-2 pl-1">
              {unstaged.map(f => renderFileRow(f, 'unstaged'))}
            </div>
          </div>
        )}

        {staged.length === 0 && unstaged.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
            No changes detected
          </div>
        )}

        {/* recent commits */}
        <div className="mt-1">
          <button
            className="flex items-center gap-1 px-2 py-1 w-full text-left hover:bg-secondary/50 transition-colors"
            onClick={() => { setShowCommits(v => !v); if (!showCommits) loadCommits(); }}
          >
            {showCommits ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Commits</span>
          </button>
          {showCommits && (
            <div>
              {commits.map(c => (
                <div key={c.hash} className="px-2 py-1 hover:bg-secondary/50 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-primary shrink-0">{c.short}</span>
                    <span className="text-[11px] text-foreground truncate flex-1">{c.subject}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] text-muted-foreground/60">{c.author}</span>
                    <span className="text-[9px] text-muted-foreground/40 ml-auto">{timeAgo(c.date)}</span>
                  </div>
                </div>
              ))}
              {commits.length === 0 && (
                <div className="px-2 py-2 text-[11px] text-muted-foreground">Loading...</div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Branch picker overlay (command palette style) */}
      {showBranchPicker && createPortal(
        <div className="fixed inset-0 z-[9999]" onClick={closeBranchPicker}>
          <div
            className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[320px] max-h-[400px] bg-popover border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-border">
              <input
                ref={branchInputRef}
                className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
                placeholder="Switch branch..."
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { closeBranchPicker(); return; }
                  if (e.key === 'ArrowDown') { e.preventDefault(); setBranchSelectedIdx(i => Math.min(i + 1, allFiltered.length - 1)); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setBranchSelectedIdx(i => Math.max(i - 1, 0)); return; }
                  if (e.key === 'Enter' && allFiltered[branchSelectedIdx]) {
                    e.preventDefault();
                    handleCheckout(allFiltered[branchSelectedIdx].name);
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {localBranches.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 sticky top-0">
                    Local Branches
                  </div>
                  {localBranches.map((b, i) => {
                    const globalIdx = i;
                    return (
                      <button
                        key={b.name}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left transition-colors',
                          globalIdx === branchSelectedIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-secondary/50',
                          b.current && 'font-medium'
                        )}
                        onClick={() => handleCheckout(b.name)}
                        onMouseEnter={() => setBranchSelectedIdx(globalIdx)}
                      >
                        {b.current ? <Check className="w-3.5 h-3.5 shrink-0 text-primary" /> : <span className="w-3.5 shrink-0" />}
                        <span className="truncate">{b.name}</span>
                      </button>
                    );
                  })}
                </>
              )}
              {remoteBranches.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 sticky top-0">
                    Remote Branches
                  </div>
                  {remoteBranches.map((b, i) => {
                    const globalIdx = localBranches.length + i;
                    return (
                      <button
                        key={b.name}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left transition-colors',
                          globalIdx === branchSelectedIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-secondary/50'
                        )}
                        onClick={() => handleCheckout(b.name)}
                        onMouseEnter={() => setBranchSelectedIdx(globalIdx)}
                      >
                        <span className="w-3.5 shrink-0" />
                        <span className="truncate text-muted-foreground">{b.name}</span>
                      </button>
                    );
                  })}
                </>
              )}
              {allFiltered.length === 0 && (
                <div className="px-3 py-3 text-[12px] text-muted-foreground text-center">No matching branches</div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* File context menu */}
      {contextMenu && createPortal(
        <div
          ref={el => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 4}px`;
            if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 4}px`;
          }}
          className="fixed z-[9999] min-w-[180px] bg-popover text-popover-foreground border rounded-md shadow-md py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => { openFileDiff(contextMenu.file); setContextMenu(null); }}
          >Open Changes</button>
          <button
            className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => { onFileClick?.(gitState.root + '/' + contextMenu.file.path); setContextMenu(null); }}
          >Open File</button>
          <div className="bg-border my-1 h-px" />
          {contextMenu.section === 'unstaged' ? (
            <>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { handleStage(contextMenu.file.path); setContextMenu(null); }}
              >Stage Changes</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                onClick={() => { handleDiscard(contextMenu.file.path); setContextMenu(null); }}
              >Discard Changes</button>
            </>
          ) : (
            <button
              className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
              onClick={() => { handleUnstage(contextMenu.file.path); setContextMenu(null); }}
            >Unstage Changes</button>
          )}
          <div className="bg-border my-1 h-px" />
          <button
            className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.file.path).catch(() => {});
              setContextMenu(null);
            }}
          >Copy Path</button>
          <button
            className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => {
              rpc('fs.reveal', { path: gitState.root + '/' + contextMenu.file.path }).catch(() => {});
              setContextMenu(null);
            }}
          >Reveal in Finder</button>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Main Export ──────────────────────────────────────────────────────

export function FileExplorer({ rpc, connected, onFileClick, onOpenDiff, onFileChange, onOpenTerminal, mode = 'files', initialViewRoot, initialExpanded, initialSelectedPath, onStateChange }: Props) {
  const [homeCwd, setHomeCwd] = useState('');
  const [viewRoot, setViewRoot] = useState(initialViewRoot || '');
  const [dirs, setDirs] = useState<Map<string, DirState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set(initialExpanded || []));
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath ?? null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const [gitState, setGitState] = useState<GitState | null>(null);
  const gitPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGitStatus = useCallback(async () => {
    if (!connected || !viewRoot) return;
    try {
      const detectRes = await rpc('git.detect', { path: viewRoot }) as { root: string | null };
      if (!detectRes?.root) { setGitState(null); return; }
      const statusRes = await rpc('git.status', { path: detectRes.root }) as GitState;
      setGitState(statusRes);
    } catch {
      setGitState(null);
    }
  }, [connected, viewRoot, rpc]);

  // Detect git repo and poll status when viewRoot changes
  useEffect(() => {
    if (!connected || !viewRoot) return;
    fetchGitStatus();
    gitPollRef.current = setInterval(fetchGitStatus, 3000);
    return () => {
      if (gitPollRef.current) clearInterval(gitPollRef.current);
    };
  }, [connected, viewRoot, fetchGitStatus]);

  // Report state changes to parent for per-tab persistence
  useEffect(() => {
    if (onStateChange && viewRoot) {
      onStateChange({ viewRoot, expanded: Array.from(expanded), selectedPath });
    }
  }, [viewRoot, expanded, selectedPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDir = useCallback(async (path: string) => {
    setDirs(prev => {
      const next = new Map(prev);
      next.set(path, { entries: prev.get(path)?.entries || [], loading: true });
      return next;
    });
    try {
      const entries = await rpc('fs.list', { path }) as FileEntry[];
      setDirs(prev => {
        const next = new Map(prev);
        next.set(path, { entries: entries || [], loading: false });
        return next;
      });
    } catch (err) {
      setDirs(prev => {
        const next = new Map(prev);
        next.set(path, { entries: [], loading: false, error: String(err) });
        return next;
      });
    }
  }, [rpc]);

  useEffect(() => {
    if (!connected) return;
    rpc('config.get').then((res: unknown) => {
      const c = (res as Record<string, unknown>)?.cwd as string;
      if (c) {
        setHomeCwd(c);
        if (!viewRoot) {
          setViewRoot(c);
          loadDir(c);
        } else if (!dirs.has(viewRoot)) {
          loadDir(viewRoot);
        }
      }
    }).catch(() => {});
  }, [rpc, loadDir, connected, viewRoot]);

  useEffect(() => {
    if (!viewRoot || !connected) return;
    rpc('fs.watch.start', { path: viewRoot }).catch(() => {});
    const unsubscribe = onFileChange?.((changedPath) => {
      if (changedPath === viewRoot) loadDir(viewRoot);
    });
    return () => {
      rpc('fs.watch.stop', { path: viewRoot }).catch(() => {});
      unsubscribe?.();
    };
  }, [viewRoot, connected, rpc, loadDir, onFileChange]);

  const navigateTo = useCallback((path: string) => {
    setViewRoot(path);
    setExpanded(new Set());
    if (!dirs.has(path)) loadDir(path);
  }, [dirs, loadDir]);

  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!dirs.has(path)) loadDir(path);
      }
      return next;
    });
  }, [dirs, loadDir]);

  const createFolder = useCallback(async () => {
    const folderName = prompt('Enter folder name:');
    if (!folderName) return;
    const newPath = viewRoot + '/' + folderName;
    try {
      await rpc('fs.mkdir', { path: newPath });
      loadDir(viewRoot);
    } catch (err) {
      alert('Failed to create folder: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [viewRoot, rpc, loadDir]);

  const deleteItem = useCallback(async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete ${path}?`)) return;
    try {
      await rpc('fs.delete', { path });
      const parentPath = path.substring(0, path.lastIndexOf('/'));
      loadDir(parentPath);
      if (selectedPath === path) setSelectedPath(null);
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [rpc, loadDir, selectedPath]);

  const renameItem = useCallback(async (oldPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const oldName = oldPath.substring(oldPath.lastIndexOf('/') + 1);
    const newName = prompt('Enter new name:', oldName);
    if (!newName || newName === oldName) return;
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = parentPath + '/' + newName;
    try {
      await rpc('fs.rename', { oldPath, newPath });
      loadDir(parentPath);
      if (selectedPath === oldPath) setSelectedPath(newPath);
    } catch (err) {
      alert('Failed to rename: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [rpc, loadDir, selectedPath]);

  const handleFileClick = useCallback((path: string) => {
    setSelectedPath(path);
    onFileClick?.(path);
  }, [onFileClick]);

  // ── Keyboard navigation (yazi / VS Code style) ────────────────────
  // Build flat list of visible entries for arrow key navigation
  const getVisiblePaths = useCallback((): Array<{ path: string; isDir: boolean; parent: string }> => {
    const result: Array<{ path: string; isDir: boolean; parent: string }> = [];
    const walk = (parentPath: string) => {
      const state = dirs.get(parentPath);
      if (!state) return;
      for (const entry of state.entries) {
        const fullPath = parentPath + '/' + entry.name;
        const isDir = entry.type === 'directory';
        result.push({ path: fullPath, isDir, parent: parentPath });
        if (isDir && expanded.has(fullPath)) {
          walk(fullPath);
        }
      }
    };
    if (viewRoot) walk(viewRoot);
    return result;
  }, [dirs, expanded, viewRoot]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll a path's element into view (uses data-path attribute lookup via iteration, not CSS selectors)
  const scrollPathIntoView = useCallback((path: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const els = container.querySelectorAll('[data-path]');
    for (const el of els) {
      if ((el as HTMLElement).dataset.path === path) {
        el.scrollIntoView({ block: 'nearest' });
        break;
      }
    }
  }, []);

  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't handle if focus is on an input/textarea
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

    const visible = getVisiblePaths();
    if (visible.length === 0) return;

    const currentIdx = selectedPath ? visible.findIndex(v => v.path === selectedPath) : -1;

    switch (e.key) {
      case 'ArrowDown':
      case 'j': {
        e.preventDefault();
        const nextIdx = currentIdx < visible.length - 1 ? currentIdx + 1 : 0;
        setSelectedPath(visible[nextIdx].path);
        scrollPathIntoView(visible[nextIdx].path);
        break;
      }
      case 'ArrowUp':
      case 'k': {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : visible.length - 1;
        setSelectedPath(visible[prevIdx].path);
        scrollPathIntoView(visible[prevIdx].path);
        break;
      }
      case 'ArrowRight':
      case 'l': {
        e.preventDefault();
        if (currentIdx < 0) break;
        const item = visible[currentIdx];
        if (item.isDir) {
          if (!expanded.has(item.path)) {
            // Expand the folder, then select first child after re-render
            toggleDir(item.path);
          } else {
            // Already expanded: move to first child
            if (currentIdx + 1 < visible.length && visible[currentIdx + 1].parent === item.path) {
              setSelectedPath(visible[currentIdx + 1].path);
              scrollPathIntoView(visible[currentIdx + 1].path);
            }
          }
        } else {
          // Open file on right arrow (like yazi)
          handleFileClick(item.path);
        }
        break;
      }
      case 'ArrowLeft':
      case 'h': {
        e.preventDefault();
        if (currentIdx < 0) break;
        const item = visible[currentIdx];
        if (item.isDir && expanded.has(item.path)) {
          // Collapse the folder
          toggleDir(item.path);
        } else {
          // Move to parent folder entry, or navigate up a directory if at root level
          const parentEntry = visible.find(v => v.path === item.parent);
          if (parentEntry) {
            setSelectedPath(parentEntry.path);
            scrollPathIntoView(parentEntry.path);
          } else if (item.parent === viewRoot) {
            // At top level: navigate up like yazi
            const parentDir = viewRoot.substring(0, viewRoot.lastIndexOf('/'));
            if (parentDir) navigateTo(parentDir);
          }
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (currentIdx < 0) break;
        const item = visible[currentIdx];
        if (item.isDir) {
          toggleDir(item.path);
        } else {
          handleFileClick(item.path);
        }
        break;
      }
    }
  }, [getVisiblePaths, selectedPath, expanded, toggleDir, handleFileClick, navigateTo, viewRoot, scrollPathIntoView]);

  // ── Context menu dismiss ──────────────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
  }, []);

  const handleBlankAreaContextMenu = useCallback((e: React.MouseEvent) => {
    // Only fire if the click target is the container itself (blank area)
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-file-entry]') === null) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, path: viewRoot, isDir: true });
    }
  }, [viewRoot]);

  const ctxCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(() => {});
    setContextMenu(null);
  }, []);

  const ctxCopyRelativePath = useCallback((path: string) => {
    const rel = path.startsWith(viewRoot + '/') ? path.slice(viewRoot.length + 1) : path;
    navigator.clipboard.writeText(rel).catch(() => {});
    setContextMenu(null);
  }, [viewRoot]);

  const ctxReveal = useCallback((path: string) => {
    rpc('fs.reveal', { path }).catch(() => {});
    setContextMenu(null);
  }, [rpc]);

  const ctxNewFile = useCallback(async (folder: string) => {
    setContextMenu(null);
    const name = prompt('Enter file name:');
    if (!name) return;
    try {
      await rpc('fs.write', { path: folder + '/' + name, content: '' });
      loadDir(folder);
    } catch (err) {
      alert('Failed to create file: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [rpc, loadDir]);

  const ctxNewFolder = useCallback(async (folder: string) => {
    setContextMenu(null);
    const name = prompt('Enter folder name:');
    if (!name) return;
    try {
      await rpc('fs.mkdir', { path: folder + '/' + name });
      loadDir(folder);
    } catch (err) {
      alert('Failed to create folder: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [rpc, loadDir]);

  // ── Git mode ────────────────────────────────────────────────────
  if (mode === 'git') {
    if (!gitState) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
          <GitBranch className="w-6 h-6 text-muted-foreground/40" />
          <span className="text-[11px] text-muted-foreground">Not a git repository</span>
          <span className="text-[10px] text-muted-foreground/60">Navigate to a folder with a .git directory</span>
        </div>
      );
    }
    return <GitPanel rpc={rpc} gitState={gitState} onFileClick={onFileClick} onOpenDiff={onOpenDiff} onRefresh={fetchGitStatus} />;
  }

  // ── Files mode ──────────────────────────────────────────────────

  // Build absolute path -> git status map for file tree coloring
  const gitFileMap = new Map<string, string>();
  if (gitState) {
    for (const f of gitState.files) {
      gitFileMap.set(gitState.root + '/' + f.path, f.status);
    }
  }

  const renderEntries = (parentPath: string, depth: number): React.JSX.Element[] => {
    const state = dirs.get(parentPath);
    if (!state) return [];

    if (state.loading && state.entries.length === 0) {
      return [<div key="loading" className="text-[11px] text-muted-foreground py-1" style={{ paddingLeft: Math.min(depth * 16, 128) + 12 }}>...</div>];
    }

    if (state.error) {
      return [<div key="error" className="text-[11px] text-destructive py-1 truncate" style={{ paddingLeft: Math.min(depth * 16, 128) + 12 }}>{state.error}</div>];
    }

    const items: React.JSX.Element[] = [];
    for (const entry of state.entries) {
      const fullPath = parentPath + '/' + entry.name;
      const isDir = entry.type === 'directory';
      const isExpanded2 = expanded.has(fullPath);
      const isDot = entry.name.startsWith('.');

      const gitStatus = gitFileMap.get(fullPath);
      const gitColor = gitStatus === 'D' ? 'text-destructive' :
        (gitStatus === 'A' || gitStatus === '?') ? 'text-success' :
        gitStatus === 'M' ? 'text-warning' : undefined;

      items.push(
        <div
          key={fullPath}
          data-file-entry
          data-path={fullPath}
          className={cn(
            'flex items-center gap-1.5 py-0.5 px-1 rounded-sm text-[11px] cursor-pointer group transition-colors min-w-0',
            isDot && 'opacity-50',
            selectedPath === fullPath ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
          )}
          style={{ paddingLeft: Math.min(depth * 16, 128) + 12 }}
          onClick={isDir ? () => toggleDir(fullPath) : () => handleFileClick(fullPath)}
          onDoubleClick={isDir ? () => navigateTo(fullPath) : undefined}
          onContextMenu={(e) => handleContextMenu(e, fullPath, isDir)}
        >
          {isDir ? (
            isExpanded2 ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {isDir ? <Folder className="w-3 h-3 shrink-0 text-primary" /> : <File className="w-3 h-3 shrink-0" />}
          <span className={cn('flex-1 truncate min-w-0', isDir && 'font-semibold', gitColor)}>{entry.name}</span>
          {gitStatus && <span className={cn('text-[9px] font-mono shrink-0', gitColor)}>{gitStatus}</span>}
          {entry.size != null && !gitStatus && <span className="text-[9px] text-muted-foreground shrink-0">{formatSize(entry.size)}</span>}
          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="p-0.5 hover:text-primary transition-colors" onClick={(e) => renameItem(fullPath, e)}>
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">Rename</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="p-0.5 hover:text-destructive transition-colors" onClick={(e) => deleteItem(fullPath, e)}>
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">Delete</TooltipContent>
            </Tooltip>
          </span>
        </div>
      );

      if (isDir && isExpanded2) {
        items.push(...renderEntries(fullPath, depth + 1));
      }
    }

    return items;
  };

  const crumbs = viewRoot ? buildCrumbs(homeCwd, viewRoot) : [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold">files</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={createFolder}>
              <FolderPlus className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">New Folder</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground flex-1 min-w-0 overflow-hidden ml-1">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-0.5 shrink min-w-0">
              {i > 0 && <span className="shrink-0">/</span>}
              <span
                className={cn(
                  'hover:text-foreground transition-colors truncate',
                  i === crumbs.length - 1 ? 'text-foreground font-semibold' : 'cursor-pointer'
                )}
                onClick={i < crumbs.length - 1 ? () => navigateTo(c.path) : undefined}
              >{c.label}</span>
            </span>
          ))}
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div
          ref={scrollContainerRef}
          className="py-1 min-h-full outline-none"
          tabIndex={0}
          onKeyDown={handleTreeKeyDown}
          onContextMenu={handleBlankAreaContextMenu}
        >
          {viewRoot ? renderEntries(viewRoot, 0) : <div className="text-[11px] text-muted-foreground p-3">loading...</div>}
        </div>
      </ScrollArea>

      {/* Context menu portal */}
      {contextMenu && createPortal(
        <div
          ref={el => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 4}px`;
            if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 4}px`;
          }}
          className="fixed z-50 min-w-[180px] bg-popover text-popover-foreground border rounded-md shadow-md py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.path === viewRoot && !contextMenu.isDir ? null : contextMenu.path === viewRoot ? (
            <>
              {/* Blank area menu */}
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxNewFile(viewRoot)}
              >New File...</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxNewFolder(viewRoot)}
              >New Folder...</button>
              {onOpenTerminal && (
                <>
                  <div className="bg-border -mx-0 my-1 h-px" />
                  <button
                    className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                    onClick={() => { onOpenTerminal(viewRoot); setContextMenu(null); }}
                  >Open in Terminal</button>
                </>
              )}
            </>
          ) : contextMenu.isDir ? (
            <>
              {/* Folder menu */}
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { navigateTo(contextMenu.path); setContextMenu(null); }}
              >Open in File Explorer</button>
              <div className="bg-border -mx-0 my-1 h-px" />
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxNewFile(contextMenu.path)}
              >New File...</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxNewFolder(contextMenu.path)}
              >New Folder...</button>
              <div className="bg-border -mx-0 my-1 h-px" />
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxCopyPath(contextMenu.path)}
              >Copy Path</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxCopyRelativePath(contextMenu.path)}
              >Copy Relative Path</button>
              <div className="bg-border -mx-0 my-1 h-px" />
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={(e) => { renameItem(contextMenu.path, e); setContextMenu(null); }}
              >Rename</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                onClick={(e) => { deleteItem(contextMenu.path, e); setContextMenu(null); }}
              >Delete</button>
              <div className="bg-border -mx-0 my-1 h-px" />
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxReveal(contextMenu.path)}
              >Reveal in Finder</button>
              {onOpenTerminal && (
                <button
                  className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => { onOpenTerminal(contextMenu.path); setContextMenu(null); }}
                >Open in Terminal</button>
              )}
            </>
          ) : (
            <>
              {/* File menu */}
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { handleFileClick(contextMenu.path); setContextMenu(null); }}
              >Open</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { handleFileClick(contextMenu.path); setContextMenu(null); }}
              >Open to the Side</button>
              <div className="bg-border -mx-0 my-1 h-px" />
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxCopyPath(contextMenu.path)}
              >Copy Path</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxCopyRelativePath(contextMenu.path)}
              >Copy Relative Path</button>
              <div className="bg-border -mx-0 my-1 h-px" />
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={(e) => { renameItem(contextMenu.path, e); setContextMenu(null); }}
              >Rename</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                onClick={(e) => { deleteItem(contextMenu.path, e); setContextMenu(null); }}
              >Delete</button>
              <div className="bg-border -mx-0 my-1 h-px" />
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => ctxReveal(contextMenu.path)}
              >Reveal in Finder</button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
