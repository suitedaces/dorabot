import { useState, useEffect, useCallback, useRef } from 'react';
import type React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  Folder, File, ChevronRight, ChevronDown, FolderPlus, Pencil, Trash2,
  GitBranch, Plus, Minus, FileEdit, RefreshCw, ArrowDownToLine,
  Check, ChevronUp, Undo2,
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

type Props = {
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  connected: boolean;
  onFileClick?: (filePath: string) => void;
  onOpenDiff?: (opts: { filePath: string; oldContent: string; newContent: string; label?: string }) => void;
  onFileChange?: (listener: (path: string) => void) => () => void;
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

// ── Git Source Control Panel ────────────────────────────────────────

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
  const [showBranches, setShowBranches] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [showCommits, setShowCommits] = useState(false);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [actionError, setActionError] = useState('');

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

  const handleCheckout = async (branch: string) => {
    setActionError('');
    try {
      await rpc('git.checkout', { path: gitState.root, branch });
      setShowBranches(false);
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
    await rpc('git.unstageFile', { path: gitState.root, file: filePath });
    onRefresh();
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
    for (const f of unstaged) {
      await rpc('git.stageFile', { path: gitState.root, file: f.path });
    }
    onRefresh();
  };

  const handleUnstageAll = async () => {
    for (const f of staged) {
      await rpc('git.unstageFile', { path: gitState.root, file: f.path });
    }
    onRefresh();
  };

  const filteredBranches = branchFilter
    ? branches.filter(b => b.name.toLowerCase().includes(branchFilter.toLowerCase()))
    : branches;

  const renderFileRow = (f: GitFileStatus, canStage: boolean) => {
    const statusColor =
      f.status === 'D' ? 'text-destructive' :
      f.status === 'A' || f.status === '?' ? 'text-success' :
      'text-warning';
    const StatusIcon =
      f.status === 'D' ? Minus :
      f.status === 'A' || f.status === '?' ? Plus :
      FileEdit;
    const fileName = f.path.split('/').pop() || f.path;
    const dirPart = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';

    return (
      <div
        key={`${f.path}-${f.staged}`}
        className="flex items-center gap-1 px-2 py-0.5 text-[11px] group cursor-pointer hover:bg-secondary/50 transition-colors"
        onClick={async () => {
          const fullPath = gitState.root + '/' + f.path;
          if (onOpenDiff && f.status === 'M') {
            // Open diff for modified files
            try {
              const diffRes = await rpc('git.diff', { path: gitState.root, file: f.path, staged: f.staged }) as { diff: string };
              // Read current file content and compute old content from diff
              const currentRes = await rpc('fs.read', { path: fullPath }) as { content: string };
              // For a simple approach: show the git diff output by reconstructing old content
              // Actually, use git show HEAD:file for the old version
              const oldRes = await rpc('git.showFile', { path: gitState.root, file: f.path }) as { content: string };
              onOpenDiff({ filePath: f.path, oldContent: oldRes.content || '', newContent: currentRes.content, label: `${f.path.split('/').pop()} (diff)` });
            } catch {
              // Fallback: just open the file
              onFileClick?.(fullPath);
            }
          } else {
            onFileClick?.(fullPath);
          }
        }}
        title={f.path}
      >
        <StatusIcon className={cn('w-3 h-3 shrink-0', statusColor)} />
        <span className="truncate min-w-0 flex-1">
          <span className="text-foreground">{fileName}</span>
          {dirPart && <span className="text-muted-foreground/50 ml-1 text-[10px]">{dirPart}</span>}
        </span>
        <span className={cn('text-[9px] font-mono shrink-0', statusColor)}>{f.status}</span>
        <button
          className="hidden group-hover:block p-0.5 rounded hover:bg-secondary shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            canStage ? handleStage(f.path) : handleUnstage(f.path);
          }}
          title={canStage ? 'Stage file' : 'Unstage file'}
        >
          {canStage ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* branch bar */}
      <div className="px-2 py-1.5 border-b border-border shrink-0 space-y-1.5">
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium hover:bg-secondary/50 transition-colors min-w-0 flex-1"
            onClick={() => { setShowBranches(v => !v); if (!showBranches) loadBranches(); }}
          >
            <GitBranch className="w-3 h-3 shrink-0 text-primary" />
            <span className="truncate">{gitState.branch || 'detached'}</span>
            {showBranches ? <ChevronUp className="w-3 h-3 shrink-0 ml-auto" /> : <ChevronDown className="w-3 h-3 shrink-0 ml-auto" />}
          </button>
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
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={handlePull} disabled={pulling}>
                <ArrowDownToLine className={cn('w-3 h-3', pulling && 'animate-pulse')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px]">Pull</TooltipContent>
          </Tooltip>
        </div>

        {/* branch switcher dropdown */}
        {showBranches && (
          <div className="border border-border rounded bg-background shadow-lg max-h-[200px] flex flex-col">
            <input
              className="px-2 py-1 text-[11px] bg-transparent border-b border-border outline-none placeholder:text-muted-foreground/50"
              placeholder="Filter branches..."
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              autoFocus
            />
            <ScrollArea className="flex-1 min-h-0">
              {filteredBranches.map(b => (
                <button
                  key={b.name}
                  className={cn(
                    'flex items-center gap-1.5 w-full px-2 py-1 text-[11px] text-left hover:bg-secondary/50 transition-colors',
                    b.current && 'text-primary font-medium'
                  )}
                  onClick={() => handleCheckout(b.name)}
                >
                  {b.current && <Check className="w-3 h-3 shrink-0" />}
                  <span className={cn('truncate', !b.current && 'ml-[18px]')}>{b.name}</span>
                  {b.remote && <span className="text-[9px] text-muted-foreground/50 ml-auto shrink-0">remote</span>}
                </button>
              ))}
              {filteredBranches.length === 0 && (
                <div className="px-2 py-2 text-[11px] text-muted-foreground">No branches found</div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>

      {actionError && (
        <div className="px-2 py-1 text-[10px] text-destructive bg-destructive/10 border-b border-border shrink-0 break-words">
          {actionError}
        </div>
      )}

      {/* commit input */}
      <div className="px-2 py-1.5 border-b border-border shrink-0 space-y-1">
        <textarea
          className="w-full px-2 py-1 text-[11px] bg-secondary/30 border border-border rounded resize-none outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
          rows={2}
          placeholder="Commit message..."
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
          {committing ? 'Committing...' : `Commit (${staged.length} staged)`}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {/* staged changes */}
        {staged.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 py-1 sticky top-0 bg-background z-10">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Staged ({staged.length})
              </span>
              <button
                className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                onClick={handleUnstageAll}
                title="Unstage all"
              >
                <Undo2 className="w-3 h-3" />
              </button>
            </div>
            {staged.map(f => renderFileRow(f, false))}
          </div>
        )}

        {/* unstaged changes */}
        {unstaged.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 py-1 sticky top-0 bg-background z-10">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Changes ({unstaged.length})
              </span>
              <button
                className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                onClick={handleStageAll}
                title="Stage all"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {unstaged.map(f => renderFileRow(f, true))}
          </div>
        )}

        {staged.length === 0 && unstaged.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
            No changes
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
    </div>
  );
}

// ── Main Export ──────────────────────────────────────────────────────

export function FileExplorer({ rpc, connected, onFileClick, onOpenDiff, onFileChange, mode = 'files', initialViewRoot, initialExpanded, initialSelectedPath, onStateChange }: Props) {
  const [homeCwd, setHomeCwd] = useState('');
  const [viewRoot, setViewRoot] = useState(initialViewRoot || '');
  const [dirs, setDirs] = useState<Map<string, DirState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set(initialExpanded || []));
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath ?? null);

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
          className={cn(
            'flex items-center gap-1.5 py-0.5 px-1 rounded-sm text-[11px] cursor-pointer group transition-colors min-w-0',
            isDot && 'opacity-50',
            selectedPath === fullPath ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
          )}
          style={{ paddingLeft: Math.min(depth * 16, 128) + 12 }}
          onClick={isDir ? () => toggleDir(fullPath) : () => handleFileClick(fullPath)}
          onDoubleClick={isDir ? () => navigateTo(fullPath) : undefined}
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
        <div className="py-1">
          {viewRoot ? renderEntries(viewRoot, 0) : <div className="text-[11px] text-muted-foreground p-3">loading...</div>}
        </div>
      </ScrollArea>
    </div>
  );
}
