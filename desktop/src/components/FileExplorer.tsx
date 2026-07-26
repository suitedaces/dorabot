import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  Folder, File, ChevronRight, ChevronDown, FolderPlus, FilePlus, Pencil, Trash2,
  GitBranch, FolderGit2, Plus, Minus, FileEdit, RefreshCw, ArrowDownToLine, ArrowUpToLine,
  Check, ChevronUp, Undo2, RotateCcw, X, Search, ChevronsUpDown,
  GitPullRequest, ExternalLink, ArrowLeftRight, Circle,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';

// Inline input for new file/folder/rename (replaces window.prompt which doesn't work in Electron)
type InlineInputState = {
  parentPath: string;
  type: 'file' | 'folder' | 'rename';
  defaultValue?: string;
  originalPath?: string; // for rename
} | null;

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
  lastCommitDate: string;
  author: string;
  isMine: boolean;
};

type GitCommit = {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
};

type WorktreeInfo = {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  clean: boolean;
  staged: number;
  changed: number;
  untracked: number;
  ahead: number;
  behind: number;
  lastCommit: string;
};

type GitPR = {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  state: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
  createdAt: string;
  updatedAt: string;
};

type DiffFile = {
  path: string;
  additions: number;
  deletions: number;
  status?: string;
  previousFilename?: string | null;
  binary?: boolean;
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
  onOpenDiff?: (opts: { filePath: string; oldContent: string; newContent: string; label?: string; isImage?: boolean }) => void;
  onOpenPr?: (repoRoot: string, prNumber: number, title: string) => void;
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

// ── Worktree Dropdown (for > 3 worktrees) ──────────────────────────

function WorktreeDropdown({ mainBranch, worktrees, activeWorktreePath, onSelect, onRemove, removingWorktree }: {
  mainBranch: string;
  worktrees: WorktreeInfo[];
  activeWorktreePath: string | null;
  onSelect: (path: string | null) => void;
  onRemove: (wt: WorktreeInfo) => void;
  removingWorktree: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeWt = worktrees.find(wt => wt.path === activeWorktreePath);
  const activeLabel = activeWt ? activeWt.branch : mainBranch;
  const activeIcon = activeWt ? FolderGit2 : GitBranch;
  const ActiveIcon = activeIcon;

  const allItems: { path: string | null; branch: string; icon: typeof GitBranch; dirtyCount: number; worktree?: WorktreeInfo }[] = [
    { path: null, branch: mainBranch, icon: GitBranch, dirtyCount: 0 },
    ...worktrees.map(wt => ({
      path: wt.path as string | null,
      branch: wt.branch,
      icon: FolderGit2,
      dirtyCount: wt.staged + wt.changed + wt.untracked,
      worktree: wt,
    })),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-[10px] font-medium bg-secondary/50 hover:bg-secondary transition-colors"
        onClick={() => setOpen(!open)}
      >
        <ActiveIcon className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
        <span className="truncate">{activeLabel}</span>
        <span className="ml-auto text-[9px] text-muted-foreground shrink-0">{worktrees.length + 1} worktrees</span>
        <ChevronsUpDown className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-0.5 rounded-md border border-border bg-popover shadow-md overflow-y-auto max-h-[200px]">
          {allItems.map(item => {
            const isActive = item.path === activeWorktreePath;
            return (
              <div
                key={item.path ?? '__main'}
                className={cn(
                  'group flex items-center gap-1.5 px-2 py-1.5 text-[10px] cursor-pointer transition-colors',
                  isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                )}
                onClick={() => { onSelect(item.path); setOpen(false); }}
              >
                <item.icon className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{item.branch}</span>
                {item.dirtyCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[14px] h-3.5 px-1 rounded-full text-[8px] font-bold bg-warning/20 text-warning">
                    {item.dirtyCount}
                  </span>
                )}
                {isActive && <Check className="w-2.5 h-2.5 ml-auto shrink-0 text-primary" />}
                {item.worktree && (
                  <button
                    className={cn(
                      'hidden group-hover:flex items-center justify-center w-4 h-4 rounded-sm ml-auto transition-colors',
                      'text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10',
                    )}
                    onClick={(e) => { e.stopPropagation(); onRemove(item.worktree!); }}
                    disabled={removingWorktree === item.path}
                    title="Remove worktree"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Branch Row ─────────────────────────────────────────────────────

function BranchRow({ branch: b, idx, selectedIdx, onSelect, onCheckout, showMeta }: {
  branch: GitBranchInfo;
  idx: number;
  selectedIdx: number;
  onSelect: (idx: number) => void;
  onCheckout: (name: string) => void;
  showMeta?: boolean;
}) {
  return (
    <button
      className={cn(
        'flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left transition-colors group',
        idx === selectedIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-secondary/50',
        b.current && 'font-medium',
      )}
      onClick={() => onCheckout(b.name)}
      onMouseEnter={() => onSelect(idx)}
    >
      {b.current ? <Check className="w-3.5 h-3.5 shrink-0 text-primary" /> : <span className="w-3.5 shrink-0" />}
      <span className={cn('truncate', b.remote && !b.current && 'text-muted-foreground')}>{b.name}</span>
      {showMeta && b.lastCommitDate && (
        <span className="ml-auto flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground/70">
          {b.author && <span className="hidden group-hover:inline">{b.author}</span>}
          <span>{timeAgo(b.lastCommitDate)}</span>
        </span>
      )}
    </button>
  );
}

// ── Git Source Control Panel (VS Code style) ───────────────────────

type GitContextMenuState = {
  x: number;
  y: number;
  file: GitFileStatus;
  section: 'staged' | 'unstaged';
} | null;

function GitPanel({ rpc, gitState, onFileClick, onOpenDiff, onOpenPr, onRefresh, onOpenTerminal }: {
  rpc: Props['rpc'];
  gitState: GitState;
  onFileClick?: (path: string) => void;
  onOpenDiff?: Props['onOpenDiff'];
  onOpenPr?: Props['onOpenPr'];
  onRefresh: () => void;
  onOpenTerminal?: (cwd: string) => void;
}) {
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [branchSelectedIdx, setBranchSelectedIdx] = useState(0);
  const [showCommits, setShowCommits] = useState(false);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [actionError, setActionError] = useState('');
  const [contextMenu, setContextMenu] = useState<GitContextMenuState>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);

  // ── Worktree context switching ──
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(null); // null = main repo
  const [worktreeGitState, setWorktreeGitState] = useState<GitState | null>(null);
  const [worktreeLoading, setWorktreeLoading] = useState(false);
  const [removingWorktree, setRemovingWorktree] = useState<string | null>(null);

  const loadWorktrees = useCallback(async () => {
    try {
      const res = await rpc('git.worktrees', { path: gitState.root }) as { worktrees: WorktreeInfo[] };
      setWorktrees(res.worktrees);
    } catch { /* ignore */ }
  }, [rpc, gitState.root]);

  // Load worktrees on mount and periodically. Reset active worktree when repo root changes.
  const loadWorktreesRef = useRef(loadWorktrees);
  loadWorktreesRef.current = loadWorktrees;
  const worktreePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setActiveWorktreePath(null);
    setWorktreeGitState(null);
    loadWorktreesRef.current();
    worktreePollRef.current = setInterval(() => loadWorktreesRef.current(), 10000);
    return () => { if (worktreePollRef.current) clearInterval(worktreePollRef.current); };
  }, [gitState.root]);

  // Clear active worktree if it disappears from the list (removed externally)
  useEffect(() => {
    if (activeWorktreePath && worktrees.length > 0 && !worktrees.some(w => w.path === activeWorktreePath)) {
      setActiveWorktreePath(null);
      setWorktreeGitState(null);
    }
  }, [worktrees, activeWorktreePath]);

  // Fetch git status for the active worktree (use ref for rpc to avoid interval thrashing)
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  useEffect(() => {
    if (!activeWorktreePath) { setWorktreeGitState(null); setWorktreeLoading(false); return; }
    let cancelled = false;
    setWorktreeLoading(true);
    const fetchStatus = async () => {
      try {
        const res = await rpcRef.current('git.status', { path: activeWorktreePath }) as GitState;
        if (!cancelled) { setWorktreeGitState(res); setWorktreeLoading(false); }
      } catch { if (!cancelled) { setWorktreeGitState(null); setWorktreeLoading(false); } }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeWorktreePath]);

  const handleRemoveWorktree = useCallback(async (wt: WorktreeInfo) => {
    setRemovingWorktree(wt.path);
    try {
      await rpc('git.worktreeRemove', { path: gitState.root, worktreePath: wt.path, branch: wt.branch });
      toast(`Removed worktree ${wt.branch}`, 'success');
      if (activeWorktreePath === wt.path) {
        setActiveWorktreePath(null);
        setWorktreeGitState(null);
      }
      loadWorktrees();
      onRefresh();
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setRemovingWorktree(null);
    }
  }, [rpc, gitState.root, activeWorktreePath, loadWorktrees, onRefresh]);

  // Effective state: use worktree's state when one is selected and loaded, otherwise main
  const effectiveState = activeWorktreePath && worktreeGitState ? worktreeGitState : gitState;
  const nonMainWorktrees = worktrees.filter(w => !w.isMain);
  const showWorktreeBar = nonMainWorktrees.length > 0;
  const isWorktreeContext = !!activeWorktreePath;

  // ── PRs & Branch Comparison ──
  const [showPRs, setShowPRs] = useState(false);
  const [prs, setPrs] = useState<GitPR[]>([]);
  const [prsLoading, setPrsLoading] = useState(false);
  const [ghMissing, setGhMissing] = useState(false);
  const [ghAuthError, setGhAuthError] = useState(false);
  const [expandedPR, setExpandedPR] = useState<number | null>(null);
  const [prFiles, setPrFiles] = useState<DiffFile[]>([]);
  const [prFilesLoading, setPrFilesLoading] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareBase, setCompareBase] = useState('');
  const [compareHead, setCompareHead] = useState('');
  const [compareResult, setCompareResult] = useState<{ files: DiffFile[]; commits: GitCommit[]; totalAdditions: number; totalDeletions: number } | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Reset PR & compare state when repo root changes (e.g. worktree switch)
  const prevRootRef = useRef(effectiveState.root);
  useEffect(() => {
    if (prevRootRef.current !== effectiveState.root) {
      prevRootRef.current = effectiveState.root;
      setPrs([]); setExpandedPR(null); setPrFiles([]); setGhMissing(false); setGhAuthError(false);
      setCompareBase(''); setCompareHead(''); setCompareResult(null);
    }
  }, [effectiveState.root]);

  const loadPRs = useCallback(async () => {
    setPrsLoading(true);
    setGhMissing(false);
    setGhAuthError(false);
    setExpandedPR(null);
    setPrFiles([]);
    prFilesRequestRef.current = null;
    try {
      const res = await rpc('git.prs', { path: effectiveState.root }) as { prs: GitPR[]; ghMissing?: boolean; ghAuthError?: boolean };
      setPrs(res.prs || []);
      if (res.ghMissing) setGhMissing(true);
      if (res.ghAuthError) setGhAuthError(true);
    } catch { /* ignore */ }
    setPrsLoading(false);
  }, [rpc, effectiveState.root]);

  // Track in-flight PR file request to avoid race conditions
  const prFilesRequestRef = useRef<number | null>(null);
  const loadPRFiles = useCallback(async (prNumber: number) => {
    prFilesRequestRef.current = prNumber;
    setPrFilesLoading(true);
    try {
      const res = await rpc('git.prDiff', { path: effectiveState.root, number: prNumber }) as { files: DiffFile[] };
      if (prFilesRequestRef.current !== prNumber) return; // superseded by a newer request
      setPrFiles(res.files || []);
    } catch {
      if (prFilesRequestRef.current === prNumber) setPrFiles([]);
    }
    if (prFilesRequestRef.current === prNumber) setPrFilesLoading(false);
  }, [rpc, effectiveState.root]);

  const runBranchCompare = useCallback(async () => {
    if (!compareBase || !compareHead || compareBase === compareHead) return;
    setCompareLoading(true);
    setCompareResult(null);
    try {
      const res = await rpc('git.branchCompare', { path: effectiveState.root, base: compareBase, compare: compareHead }) as { files: DiffFile[]; commits: GitCommit[]; totalAdditions: number; totalDeletions: number };
      setCompareResult({
        files: res.files || [],
        commits: res.commits || [],
        totalAdditions: res.totalAdditions || 0,
        totalDeletions: res.totalDeletions || 0,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
    setCompareLoading(false);
  }, [rpc, effectiveState.root, compareBase, compareHead]);

  const staged = effectiveState.files.filter(f => f.staged);
  const unstaged = effectiveState.files.filter(f => !f.staged);
  const hasAhead = effectiveState.ahead > 0;
  const hasBehind = effectiveState.behind > 0;

  const loadBranches = useCallback(async () => {
    try {
      const res = await rpc('git.branches', { path: effectiveState.root }) as { branches: GitBranchInfo[] };
      setBranches(res.branches);
    } catch { /* ignore */ }
  }, [rpc, effectiveState.root]);

  // Auto-populate compare selects once branches load (only when compare is open and selects are empty)
  useEffect(() => {
    if (!showCompare || branches.length === 0) return;
    if (!compareBase) {
      const defaultBase = branches.find(b => !b.remote && (b.name === 'main' || b.name === 'master'))?.name || '';
      setCompareBase(defaultBase);
    }
    if (!compareHead) {
      setCompareHead(effectiveState.branch || '');
    }
  }, [showCompare, branches, compareBase, compareHead, effectiveState.branch]);

  const loadCommits = useCallback(async () => {
    try {
      const res = await rpc('git.log', { path: effectiveState.root, count: 20 }) as { commits: GitCommit[] };
      setCommits(res.commits);
    } catch { /* ignore */ }
  }, [rpc, effectiveState.root]);

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

  const handleCheckout = async (branch: string, create?: boolean) => {
    setActionError('');
    closeBranchPicker();
    try {
      await rpc('git.checkout', { path: effectiveState.root, branch, ...(create ? { create: true } : {}) });
      onRefresh();
      toast(`Switched to ${branch}`, 'success');
    } catch (err) {
      toast(String(err), 'error');
    }
  };

  const handleFetch = async () => {
    setFetching(true);
    setActionError('');
    try {
      await rpc('git.fetch', { path: effectiveState.root });
      onRefresh();
      toast('Fetch complete', 'success');
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setFetching(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setActionError('');
    try {
      await rpc('git.pull', { path: effectiveState.root });
      onRefresh();
      toast('Pull complete', 'success');
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setPulling(false);
    }
  };

  const handlePush = async () => {
    setActionError('');
    setPushing(true);
    try {
      await rpc('git.push', { path: effectiveState.root });
      onRefresh();
      toast('Push complete', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setPushing(false);
    }
  };

  const handleStage = async (filePath: string) => {
    try {
      await rpc('git.stageFile', { path: effectiveState.root, file: filePath });
    } catch (err) {
      toast(String(err), 'error');
    }
    onRefresh();
  };

  const handleUnstage = async (filePath: string) => {
    try {
      await rpc('git.unstageFile', { path: effectiveState.root, file: filePath });
    } catch (err) {
      toast(String(err), 'error');
    }
    onRefresh();
  };

  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null);

  const handleDiscard = async (filePath: string) => {
    if (pendingDiscard !== filePath) { setPendingDiscard(filePath); return; }
    setPendingDiscard(null);
    try {
      await rpc('git.discardFile', { path: effectiveState.root, file: filePath });
      onRefresh();
    } catch (err) {
      toast(String(err), 'error');
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim() || staged.length === 0) return;
    setCommitting(true);
    setActionError('');
    try {
      await rpc('git.commit', { path: effectiveState.root, message: commitMsg.trim() });
      setCommitMsg('');
      onRefresh();
      toast('Committed', 'success');
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setCommitting(false);
    }
  };

  const handleStageAll = async () => {
    try {
      await rpc('git.stageAll', { path: effectiveState.root });
    } catch {
      for (const f of unstaged) await rpc('git.stageFile', { path: effectiveState.root, file: f.path });
    }
    onRefresh();
  };

  const handleUnstageAll = async () => {
    try {
      await rpc('git.unstageAll', { path: effectiveState.root });
    } catch {
      for (const f of staged) await rpc('git.unstageFile', { path: effectiveState.root, file: f.path });
    }
    onRefresh();
  };

  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];

  const openFileDiff = useCallback(async (f: GitFileStatus) => {
    const fullPath = effectiveState.root + '/' + f.path;
    if (onOpenDiff && (f.status === 'M' || f.status === 'A')) {
      const ext = f.path.split('.').pop()?.toLowerCase() || '';
      const isImage = IMAGE_EXTS.includes(ext);
      try {
        let newContent: string;
        let oldContent: string;
        if (isImage) {
          const currentRes = await rpc('fs.readBinary', { path: fullPath }) as { content: string };
          const oldRes = await rpc('git.showFile', { path: effectiveState.root, file: f.path, binary: true }) as { content: string; encoding?: string };
          newContent = currentRes.content || '';
          oldContent = oldRes.content || '';
        } else {
          const currentRes = await rpc('fs.read', { path: fullPath }) as { content: string };
          const oldRes = await rpc('git.showFile', { path: effectiveState.root, file: f.path }) as { content: string };
          newContent = currentRes.content;
          oldContent = oldRes.content || '';
        }
        onOpenDiff({ filePath: f.path, oldContent, newContent, label: `${f.path.split('/').pop()} (diff)`, isImage });
      } catch {
        onFileClick?.(fullPath);
      }
    } else {
      onFileClick?.(fullPath);
    }
  }, [effectiveState.root, rpc, onOpenDiff, onFileClick]);

  // Branch picker
  const [branchView, setBranchView] = useState<'recent' | 'mine' | 'all'>('recent');
  const filteredBranches = branchFilter
    ? branches.filter(b => b.name.toLowerCase().includes(branchFilter.toLowerCase()))
    : branches;

  const branchGroups = useMemo(() => {
    // Already sorted by lastCommitDate from gateway (--sort=-committerdate)
    const mine = filteredBranches.filter(b => b.isMine);
    const local = filteredBranches.filter(b => !b.remote);
    const remote = filteredBranches.filter(b => b.remote);
    // "recent" = all branches, already sorted by date
    // "mine" = only isMine branches
    // "all" = local then remote (classic view)
    return { mine, local, remote };
  }, [filteredBranches]);

  const visibleBranches = useMemo(() => {
    if (branchView === 'mine') return branchGroups.mine;
    if (branchView === 'all') return [...branchGroups.local, ...branchGroups.remote];
    return filteredBranches; // recent: all, sorted by date
  }, [branchView, branchGroups, filteredBranches]);

  const canCreateBranch = branchFilter.trim().length > 0 && !branches.some(b => b.name === branchFilter.trim());
  const allFiltered = visibleBranches;

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

    if (pendingDiscard === f.path) {
      return (
        <div
          key={`${f.path}-${f.staged}-confirm`}
          className="relative flex items-center gap-1.5 px-2 py-1 text-[11px] bg-destructive/10 border-y border-destructive/20"
        >
          <span className="truncate min-w-0 flex-1 text-destructive">Discard changes to <strong>{fileName}</strong>?</span>
          <button
            className="px-1.5 py-0.5 rounded text-[10px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => { e.stopPropagation(); handleDiscard(f.path); }}
          >Yes</button>
          <button
            className="px-1.5 py-0.5 rounded text-[10px] bg-secondary hover:bg-secondary/80"
            onClick={(e) => { e.stopPropagation(); setPendingDiscard(null); }}
          >No</button>
        </div>
      );
    }

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
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-5 w-5 p-0 relative transition-colors',
                hasBehind && 'bg-warning/15 text-warning hover:bg-warning/25 hover:text-warning',
              )}
              onClick={handlePull}
              disabled={pulling}
            >
              <ArrowDownToLine className={cn('w-3 h-3', pulling && 'animate-pulse')} />
              {hasBehind && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[12px] h-3 px-0.5 rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center">
                  {effectiveState.behind}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">
            {hasBehind ? `Pull (${effectiveState.behind} behind)` : 'Pull'}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-5 w-5 p-0 relative transition-colors',
                hasAhead && 'bg-success/15 text-success hover:bg-success/25 hover:text-success',
              )}
              onClick={handlePush}
              disabled={pushing || !hasAhead}
            >
              <ArrowUpToLine className={cn('w-3 h-3', pushing && 'animate-pulse')} />
              {hasAhead && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[12px] h-3 px-0.5 rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center">
                  {effectiveState.ahead}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">
            {hasAhead ? `Push (${effectiveState.ahead} ahead)` : 'Push'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* worktree context bar */}
      {showWorktreeBar && (
        <div className="px-1.5 py-1 border-b border-border shrink-0">
          {nonMainWorktrees.length <= 3 ? (
            /* chips mode for <= 3 worktrees */
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              <button
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors shrink-0',
                  !activeWorktreePath
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
                onClick={() => setActiveWorktreePath(null)}
              >
                <GitBranch className="w-2.5 h-2.5" />
                <span className="truncate max-w-[100px]">{gitState.branch || 'main'}</span>
              </button>
              {nonMainWorktrees.map(wt => {
                const isActive = activeWorktreePath === wt.path;
                const dirtyCount = wt.staged + wt.changed + wt.untracked;
                return (
                  <div key={wt.path} className="relative group shrink-0 flex items-center">
                    <button
                      className={cn(
                        'inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
                      )}
                      onClick={() => setActiveWorktreePath(isActive ? null : wt.path)}
                      title={wt.path}
                    >
                      <FolderGit2 className="w-2.5 h-2.5" />
                      <span className="truncate max-w-[100px]">{wt.branch}</span>
                      {dirtyCount > 0 && (
                        <span className={cn(
                          'inline-flex items-center justify-center min-w-[14px] h-3.5 px-1 rounded-full text-[8px] font-bold',
                          isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-warning/20 text-warning',
                        )}>
                          {dirtyCount}
                        </span>
                      )}
                    </button>
                    <button
                      className={cn(
                        'hidden group-hover:flex items-center justify-center w-4 h-4 rounded-sm ml-0.5 transition-colors',
                        'text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10',
                      )}
                      onClick={(e) => { e.stopPropagation(); handleRemoveWorktree(wt); }}
                      disabled={removingWorktree === wt.path}
                      title="Remove worktree"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            /* dropdown mode for > 3 worktrees */
            <WorktreeDropdown
              mainBranch={gitState.branch || 'main'}
              worktrees={nonMainWorktrees}
              activeWorktreePath={activeWorktreePath}
              onSelect={setActiveWorktreePath}
              onRemove={handleRemoveWorktree}
              removingWorktree={removingWorktree}
            />
          )}
        </div>
      )}

      {/* branch bar */}
      <div className="px-2 py-1 border-b border-border shrink-0">
        <button
          className="flex items-center gap-1 w-full px-1.5 py-0.5 rounded text-[11px] font-medium hover:bg-secondary/50 transition-colors"
          onClick={openBranchPicker}
        >
          <GitBranch className="w-3 h-3 shrink-0 text-primary" />
          <span className="truncate">{effectiveState.branch || 'HEAD (detached)'}</span>
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-mono',
                hasBehind
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : hasAhead
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-border/60 bg-secondary/40 text-muted-foreground',
              )}
              title={`ahead/behind: ${effectiveState.ahead}/${effectiveState.behind}`}
            >
              {hasAhead && <span>↑{effectiveState.ahead}</span>}
              {hasBehind && <span>↓{effectiveState.behind}</span>}
              {!hasAhead && !hasBehind && <span>synced</span>}
              <span className="text-foreground/70">{effectiveState.ahead}/{effectiveState.behind}</span>
            </span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </span>
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
        {/* loading worktree state */}
        {activeWorktreePath && worktreeLoading && !worktreeGitState && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1.5">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Loading worktree...
          </div>
        )}
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

        {/* pull requests */}
        <div className="mt-1">
          <button
            className="flex items-center gap-1 px-2 py-1 w-full text-left hover:bg-secondary/50 transition-colors"
            onClick={() => { setShowPRs(v => !v); if (!showPRs) loadPRs(); }}
          >
            {showPRs ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            <GitPullRequest className="w-3 h-3 shrink-0 text-muted-foreground" />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pull Requests</span>
          </button>
          {showPRs && (
            <div>
              {prsLoading && (
                <div className="px-2 py-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Loading...
                </div>
              )}
              {ghMissing && !prsLoading && (
                <div className="px-2 py-2 text-[10px] text-muted-foreground">
                  Install <span className="font-mono">gh</span> CLI to view PRs
                </div>
              )}
              {ghAuthError && !prsLoading && (
                <div className="px-2 py-2 text-[10px] text-muted-foreground">
                  Run <span className="font-mono">gh auth login</span> to authenticate
                </div>
              )}
              {!prsLoading && !ghMissing && !ghAuthError && prs.length === 0 && (
                <div className="px-2 py-2 text-[11px] text-muted-foreground">No open PRs</div>
              )}
              {prs.map(pr => (
                <div key={pr.number}>
                  <div
                    className={cn(
                      'flex items-start gap-1 px-2 py-1.5 transition-colors',
                      expandedPR === pr.number ? 'bg-secondary/50' : 'hover:bg-secondary/30',
                    )}
                  >
                    <button
                      className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
                      onClick={() => onOpenPr?.(effectiveState.root, pr.number, pr.title)}
                    >
                      <Circle className={cn(
                        'w-2 h-2 mt-1 shrink-0 fill-current',
                        pr.isDraft ? 'text-muted-foreground' : 'text-success',
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono text-primary shrink-0">#{pr.number}</span>
                          <span className="text-[11px] text-foreground truncate">{pr.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[9px] font-mono text-muted-foreground truncate">
                            {pr.headRefName} → {pr.baseRefName}
                          </span>
                          <span className="flex items-center gap-1 ml-auto shrink-0">
                            <span className="text-[9px] text-success">+{pr.additions}</span>
                            <span className="text-[9px] text-destructive">-{pr.deletions}</span>
                            <span className="text-[9px] text-muted-foreground">{pr.changedFiles} files</span>
                          </span>
                        </div>
                      </div>
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                      onClick={() => {
                        if (expandedPR === pr.number) { setExpandedPR(null); setPrFiles([]); }
                        else { setExpandedPR(pr.number); loadPRFiles(pr.number); }
                      }}
                      title={expandedPR === pr.number ? 'Hide changed files' : 'Show changed files'}
                    >
                      {expandedPR === pr.number ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                    </button>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                      onClick={e => e.stopPropagation()}
                      title="Open on GitHub"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  {expandedPR === pr.number && (
                    <div className="ml-4 border-l border-primary/20 pl-1.5">
                      {prFilesLoading && (
                        <div className="px-1 py-1.5 text-[10px] text-muted-foreground flex items-center gap-1">
                          <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Loading files...
                        </div>
                      )}
                      {!prFilesLoading && prFiles.map(f => (
                        <div
                          key={f.path}
                          className="flex items-center gap-1 px-1 py-0.5 text-[10px] hover:bg-secondary/30 transition-colors cursor-pointer rounded"
                          onClick={() => onFileClick?.(effectiveState.root + '/' + f.path)}
                        >
                          <File className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1 text-foreground">{f.path}</span>
                          {f.binary ? (
                            <span className="text-muted-foreground shrink-0">binary</span>
                          ) : (
                            <>
                              <span className="text-success shrink-0">+{f.additions}</span>
                              <span className="text-destructive shrink-0">-{f.deletions}</span>
                            </>
                          )}
                        </div>
                      ))}
                      {!prFilesLoading && prFiles.length === 0 && (
                        <div className="px-1 py-1 text-[10px] text-muted-foreground">No files</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!prsLoading && (
                <button
                  className="flex items-center gap-1 px-2 py-1 w-full text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
                  onClick={loadPRs}
                >
                  <RefreshCw className="w-2.5 h-2.5" /> Refresh
                </button>
              )}
            </div>
          )}
        </div>

        {/* branch comparison */}
        <div className="mt-1">
          <button
            className="flex items-center gap-1 px-2 py-1 w-full text-left hover:bg-secondary/50 transition-colors"
            onClick={() => {
              const opening = !showCompare;
              setShowCompare(v => !v);
              if (opening) {
                setCompareResult(null);
                loadBranches();
              }
            }}
          >
            {showCompare ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            <ArrowLeftRight className="w-3 h-3 shrink-0 text-muted-foreground" />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Compare Branches</span>
          </button>
          {showCompare && (
            <div className="px-2 py-1.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5 block">Base</label>
                  <select
                    className="w-full px-1.5 py-1 text-[10px] bg-secondary/30 border border-border rounded outline-none focus:border-primary/50"
                    value={compareBase}
                    onChange={e => { setCompareBase(e.target.value); setCompareResult(null); }}
                  >
                    <option value="">Select...</option>
                    {branches.filter(b => !b.remote).map(b => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <ArrowLeftRight className="w-3 h-3 text-muted-foreground shrink-0 mt-3" />
                <div className="flex-1 min-w-0">
                  <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5 block">Compare</label>
                  <select
                    className="w-full px-1.5 py-1 text-[10px] bg-secondary/30 border border-border rounded outline-none focus:border-primary/50"
                    value={compareHead}
                    onChange={e => { setCompareHead(e.target.value); setCompareResult(null); }}
                  >
                    <option value="">Select...</option>
                    {branches.filter(b => !b.remote).map(b => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-6 text-[10px]"
                disabled={!compareBase || !compareHead || compareBase === compareHead || compareLoading}
                onClick={runBranchCompare}
              >
                {compareLoading ? 'Comparing...' : 'Compare'}
              </Button>
              {compareResult && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">{compareResult.files.length} files</span>
                    <span className="text-success">+{compareResult.totalAdditions}</span>
                    <span className="text-destructive">-{compareResult.totalDeletions}</span>
                    <span className="text-muted-foreground ml-auto">{compareResult.commits.length} commits</span>
                  </div>
                  <div className="border border-border/60 rounded overflow-hidden">
                    {compareResult.files.length === 0 && (
                      <div className="px-2 py-2 text-[10px] text-muted-foreground text-center">Branches are identical</div>
                    )}
                    {compareResult.files.map(f => {
                      const total = f.additions + f.deletions;
                      const addPct = total > 0 ? Math.round((f.additions / total) * 100) : 0;
                      return (
                        <div
                          key={f.path}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] hover:bg-secondary/30 transition-colors cursor-pointer border-b border-border/30 last:border-b-0"
                          onClick={() => onFileClick?.(effectiveState.root + '/' + f.path)}
                        >
                          <File className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1 text-foreground">{f.path}</span>
                          <span className="flex items-center gap-0.5 shrink-0">
                            {f.binary ? (
                              <span className="text-muted-foreground">binary</span>
                            ) : (
                              <>
                                <span className="text-success">+{f.additions}</span>
                                <span className="text-destructive">-{f.deletions}</span>
                                <span className="flex h-1.5 w-8 rounded-full overflow-hidden bg-destructive/30 ml-1">
                                  <span className="bg-success h-full" style={{ width: `${addPct}%` }} />
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {compareResult.commits.length > 0 && (
                    <div className="mt-1">
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">Commits</div>
                      {compareResult.commits.slice(0, 10).map(c => (
                        <div key={c.hash} className="flex items-center gap-1 px-1 py-0.5 text-[10px]">
                          <span className="font-mono text-primary shrink-0">{c.short}</span>
                          <span className="truncate flex-1 text-foreground">{c.subject}</span>
                          <span className="text-[9px] text-muted-foreground/50 shrink-0">{timeAgo(c.date)}</span>
                        </div>
                      ))}
                      {compareResult.commits.length > 10 && (
                        <div className="px-1 py-0.5 text-[9px] text-muted-foreground">
                          +{compareResult.commits.length - 10} more commits
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
                placeholder="Switch or create branch..."
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { closeBranchPicker(); return; }
                  if (e.key === 'ArrowDown') { e.preventDefault(); setBranchSelectedIdx(i => Math.min(i + 1, allFiltered.length + (canCreateBranch ? 1 : 0) - 1)); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setBranchSelectedIdx(i => Math.max(i - 1, 0)); return; }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (canCreateBranch && branchSelectedIdx === 0) {
                      handleCheckout(branchFilter.trim(), true);
                    } else {
                      const idx = canCreateBranch ? branchSelectedIdx - 1 : branchSelectedIdx;
                      if (allFiltered[idx]) handleCheckout(allFiltered[idx].name);
                    }
                  }
                }}
                autoFocus
              />
            </div>
            {/* view tabs */}
            <div className="flex items-center gap-0 px-1 py-1 border-b border-border bg-muted/20">
              {(['recent', 'mine', 'all'] as const).map(tab => (
                <button
                  key={tab}
                  className={cn(
                    'px-2.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                    branchView === tab
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => { setBranchView(tab); setBranchSelectedIdx(0); }}
                >
                  {tab === 'recent' ? 'Recent' : tab === 'mine' ? 'Mine' : 'All'}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {canCreateBranch && (
                <button
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left transition-colors border-b border-border',
                    branchSelectedIdx === 0 ? 'bg-accent text-accent-foreground' : 'hover:bg-secondary/50',
                  )}
                  onClick={() => handleCheckout(branchFilter.trim(), true)}
                  onMouseEnter={() => setBranchSelectedIdx(0)}
                >
                  <Plus className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <span className="truncate">Create branch <span className="font-medium">{branchFilter.trim()}</span></span>
                </button>
              )}
              {branchView === 'all' ? (
                /* classic local/remote grouping */
                <>
                  {branchGroups.local.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 sticky top-0">
                        Local
                      </div>
                      {branchGroups.local.map((b, i) => {
                        const globalIdx = (canCreateBranch ? 1 : 0) + i;
                        return (
                          <BranchRow key={b.name} branch={b} idx={globalIdx} selectedIdx={branchSelectedIdx}
                            onSelect={setBranchSelectedIdx} onCheckout={handleCheckout} showMeta />
                        );
                      })}
                    </>
                  )}
                  {branchGroups.remote.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 sticky top-0">
                        Remote
                      </div>
                      {branchGroups.remote.map((b, i) => {
                        const globalIdx = (canCreateBranch ? 1 : 0) + branchGroups.local.length + i;
                        return (
                          <BranchRow key={b.name} branch={b} idx={globalIdx} selectedIdx={branchSelectedIdx}
                            onSelect={setBranchSelectedIdx} onCheckout={handleCheckout} showMeta />
                        );
                      })}
                    </>
                  )}
                </>
              ) : (
                /* recent or mine: flat list sorted by date */
                visibleBranches.map((b, i) => {
                  const globalIdx = (canCreateBranch ? 1 : 0) + i;
                  return (
                    <BranchRow key={b.name} branch={b} idx={globalIdx} selectedIdx={branchSelectedIdx}
                      onSelect={setBranchSelectedIdx} onCheckout={handleCheckout} showMeta />
                  );
                })
              )}
              {allFiltered.length === 0 && !canCreateBranch && (
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
            onClick={() => { onFileClick?.(effectiveState.root + '/' + contextMenu.file.path); setContextMenu(null); }}
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
              >{pendingDiscard === contextMenu.file.path ? 'Confirm Discard?' : 'Discard Changes'}</button>
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
              rpc('fs.reveal', { path: effectiveState.root + '/' + contextMenu.file.path }).catch(() => {});
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

export function FileExplorer({ rpc, connected, onFileClick, onOpenDiff, onOpenPr, onFileChange, onOpenTerminal, mode = 'files', initialViewRoot, initialExpanded, initialSelectedPath, onStateChange }: Props) {
  const [homeCwd, setHomeCwd] = useState('');
  const [viewRoot, setViewRoot] = useState(initialViewRoot || '');
  const [dirs, setDirs] = useState<Map<string, DirState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set(initialExpanded || []));
  // selectedPath is the cursor: the row the keyboard acts on and the anchor a
  // shift-click ranges from. selection is everything highlighted. Invariant:
  // when selectedPath is set it is also in selection.
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath ?? null);
  const [selection, setSelection] = useState<Set<string>>(
    () => new Set(initialSelectedPath ? [initialSelectedPath] : []),
  );
  // The row a shift-extension ranges from. Stays put while the cursor moves,
  // otherwise shift+arrow would drag the anchor along and shrink the range.
  const anchorRef = useRef<string | null>(initialSelectedPath ?? null);

  // Collapse to a single row. Used by plain clicks and unshifted arrows.
  const selectOnly = useCallback((path: string | null) => {
    setSelectedPath(path);
    anchorRef.current = path;
    setSelection(path ? new Set([path]) : new Set());
  }, []);

  const toggleSelect = useCallback((path: string) => {
    setSelection(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setSelectedPath(path);
    anchorRef.current = path;
  }, []);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [inlineInput, setInlineInput] = useState<InlineInputState>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [fileFilter, setFileFilter] = useState('');

  const [gitState, setGitState] = useState<GitState | null>(null);
  const gitBranchRef = useRef<string | undefined>(undefined);
  const gitPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const viewRootRef = useRef(viewRoot);
  viewRootRef.current = viewRoot;
  const gitErrorCountRef = useRef(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const focusTree = useCallback(() => {
    treeRef.current?.focus();
  }, []);

  const reloadTreeRef = useRef<() => void>(() => {});

  const fetchGitStatus = useCallback(async () => {
    if (!connectedRef.current || !viewRoot) return;
    try {
      const detectRes = await rpc('git.detect', { path: viewRoot }) as { root: string | null };
      if (viewRoot !== viewRootRef.current) return; // viewRoot changed during fetch
      if (!detectRes?.root) { setGitState(null); gitBranchRef.current = undefined; return; }
      const statusRes = await rpc('git.status', { path: detectRes.root }) as GitState;
      if (viewRoot !== viewRootRef.current) return; // viewRoot changed during fetch
      // Branch changed: reload file tree so UI reflects new branch contents
      if (gitBranchRef.current && statusRes.branch !== gitBranchRef.current) {
        reloadTreeRef.current();
      }
      gitBranchRef.current = statusRes.branch;
      setGitState(statusRes);
      gitErrorCountRef.current = 0;
    } catch {
      // Keep stale gitState on transient RPC errors (prevents flicker during reconnection).
      // After 5 consecutive failures, clear state to reflect actual disconnection.
      gitErrorCountRef.current += 1;
      if (gitErrorCountRef.current >= 5) setGitState(null);
    }
  }, [viewRoot, rpc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref so the poll interval doesn't tear down on callback recreation
  const fetchGitStatusRef = useRef(fetchGitStatus);
  fetchGitStatusRef.current = fetchGitStatus;

  // Detect git repo and poll status; interval only restarts on connect/viewRoot change.
  // Reset stale git state from previous viewRoot immediately on navigation.
  useEffect(() => {
    if (!connected || !viewRoot) return;
    setGitState(null);
    gitBranchRef.current = undefined;
    gitErrorCountRef.current = 0;
    fetchGitStatusRef.current();
    gitPollRef.current = setInterval(() => fetchGitStatusRef.current(), 3000);
    return () => {
      if (gitPollRef.current) clearInterval(gitPollRef.current);
    };
  }, [connected, viewRoot]);

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
      const msg = String(err);
      // Suppress transient disconnection errors (bridge auto-reconnects)
      const isDisconnect = msg.includes('connection_lost') || msg.includes('Connection closed') || msg.includes('Not connected') || msg.includes('ws_close');
      setDirs(prev => {
        const next = new Map(prev);
        next.set(path, { entries: prev.get(path)?.entries || [], loading: false, ...(isDisconnect ? {} : { error: msg }) });
        return next;
      });
    }
  }, [rpc]);

  // Keep ref current so fetchGitStatus can reload tree without a dep on loadDir/expanded
  reloadTreeRef.current = () => {
    if (viewRoot) loadDir(viewRoot);
    expanded.forEach(dir => loadDir(dir));
  };

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
    setSelectedPath(null);
    setInlineInput(null);
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

  const getCreationParentPath = useCallback(() => {
    if (!selectedPath) return viewRoot;
    const lastSlash = selectedPath.lastIndexOf('/');
    if (lastSlash <= 0) return viewRoot;
    const parentPath = selectedPath.slice(0, lastSlash);
    const entryName = selectedPath.slice(lastSlash + 1);
    const entry = dirs.get(parentPath)?.entries.find(item => item.name === entryName);
    return entry?.type === 'directory' ? selectedPath : parentPath;
  }, [dirs, selectedPath, viewRoot]);

  const createFolder = useCallback(() => {
    const parentPath = getCreationParentPath();
    setExpanded(prev => new Set(prev).add(parentPath));
    loadDir(parentPath);
    setInlineInput({ parentPath, type: 'folder' });
  }, [getCreationParentPath, loadDir]);

  const createFile = useCallback(() => {
    const parentPath = getCreationParentPath();
    setExpanded(prev => new Set(prev).add(parentPath));
    loadDir(parentPath);
    setInlineInput({ parentPath, type: 'file' });
  }, [getCreationParentPath, loadDir]);

  const submitInlineInput = useCallback(async (name: string) => {
    if (!inlineInput || !name.trim()) { setInlineInput(null); return; }
    const trimmed = name.trim();
    try {
      if (inlineInput.type === 'rename' && inlineInput.originalPath) {
        const parentPath = inlineInput.originalPath.substring(0, inlineInput.originalPath.lastIndexOf('/'));
        const newPath = parentPath + '/' + trimmed;
        await rpc('fs.rename', { oldPath: inlineInput.originalPath, newPath });
        loadDir(parentPath);
        if (selectedPath === inlineInput.originalPath) setSelectedPath(newPath);
      } else if (inlineInput.type === 'folder') {
        const newPath = inlineInput.parentPath + '/' + trimmed;
        await rpc('fs.mkdir', { path: newPath });
        setExpanded(prev => new Set(prev).add(inlineInput.parentPath));
        loadDir(inlineInput.parentPath);
        setSelectedPath(newPath);
      } else {
        const newPath = inlineInput.parentPath + '/' + trimmed;
        await rpc('fs.write', { path: newPath, content: '' });
        setExpanded(prev => new Set(prev).add(inlineInput.parentPath));
        loadDir(inlineInput.parentPath);
        setSelectedPath(newPath);
      }
    } catch (err) {
      toast(String(err), 'error');
    }
    setInlineInput(null);
    focusTree();
  }, [focusTree, inlineInput, rpc, loadDir, selectedPath]);

  // Deleting a row that is part of a multi-selection deletes the whole
  // selection, the way Finder does. Right-clicking an unselected row acts on
  // that row alone.
  const deleteItem = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(selection.has(path) ? Array.from(selection) : [path]);
  }, [selection]);

  const confirmDeleteItem = useCallback(async () => {
    if (!confirmDelete || confirmDelete.length === 0) return;
    const parents = new Set<string>();
    const failures: string[] = [];
    for (const path of confirmDelete) {
      try {
        await rpc('fs.delete', { path });
        parents.add(path.substring(0, path.lastIndexOf('/')));
      } catch (err) {
        failures.push(`${path.substring(path.lastIndexOf('/') + 1)}: ${String(err)}`);
      }
    }
    parents.forEach(p => loadDir(p));
    const gone = new Set(confirmDelete);
    setSelection(prev => new Set(Array.from(prev).filter(p => !gone.has(p))));
    if (selectedPath && gone.has(selectedPath)) setSelectedPath(null);
    if (failures.length) toast(failures.join('\n'), 'error');
    setConfirmDelete(null);
  }, [confirmDelete, rpc, loadDir, selectedPath]);

  const renameItem = useCallback((oldPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const oldName = oldPath.substring(oldPath.lastIndexOf('/') + 1);
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    setInlineInput({ parentPath, type: 'rename', defaultValue: oldName, originalPath: oldPath });
  }, []);

  const handleFileClick = useCallback((path: string) => {
    selectOnly(path);
    onFileClick?.(path);
  }, [onFileClick, selectOnly]);

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

  // Shift-click / shift-arrow: select every visible row between the cursor and
  // target inclusive. Ranges follow display order, not insertion order.
  const extendTo = useCallback((path: string) => {
    const visible = getVisiblePaths();
    const anchor = anchorRef.current ?? selectedPath;
    const anchorIdx = anchor ? visible.findIndex(v => v.path === anchor) : -1;
    const targetIdx = visible.findIndex(v => v.path === path);
    if (targetIdx < 0) return;
    if (anchorIdx < 0) {
      selectOnly(path);
      return;
    }
    const [lo, hi] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    setSelection(new Set(visible.slice(lo, hi + 1).map(v => v.path)));
    // cursor moves, anchor deliberately does not
    setSelectedPath(path);
  }, [getVisiblePaths, selectedPath, selectOnly]);

  // Everything acted on by delete/copy/drag. Falls back to the cursor so
  // actions still work before anything has been explicitly multi-selected.
  const actionTargets = useCallback((): string[] => {
    if (selection.size > 0) return Array.from(selection);
    return selectedPath ? [selectedPath] : [];
  }, [selection, selectedPath]);

  // ── Copy / paste / duplicate / drag ───────────────────────────────
  const DRAG_MIME = 'application/x-dorabot-paths';
  // 'cut' pastes as a move. Finder has no cmd+X for files (it uses
  // cmd+opt+V to move a copied set), VS Code does. Both are supported.
  const [clipboard, setClipboard] = useState<{ paths: string[]; mode: 'copy' | 'cut' }>({ paths: [], mode: 'copy' });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const draggingPathsRef = useRef<string[]>([]);
  // drop events don't reliably carry modifier state, so remember it from the
  // last dragover, which fires continuously while hovering
  const copyDragRef = useRef(false);

  const baseName = (p: string) => p.substring(p.lastIndexOf('/') + 1);
  const parentOf = (p: string) => p.substring(0, p.lastIndexOf('/'));

  // Refuse a move/copy that would put a directory inside itself. The gateway
  // rejects it too, this just avoids a pointless round trip and a red toast.
  const wouldNest = (src: string, destDir: string) => destDir === src || destDir.startsWith(src + '/');

  const transfer = useCallback(async (paths: string[], destDir: string, mode: 'move' | 'copy') => {
    const touched = new Set<string>([destDir]);
    const failures: string[] = [];
    for (const src of paths) {
      if (wouldNest(src, destDir)) {
        failures.push(`${baseName(src)}: cannot go inside itself`);
        continue;
      }
      if (mode === 'move' && parentOf(src) === destDir) continue; // already there
      try {
        if (mode === 'move') {
          await rpc('fs.rename', { oldPath: src, newPath: destDir + '/' + baseName(src), onCollision: 'rename' });
          touched.add(parentOf(src));
        } else {
          await rpc('fs.copy', { sourcePath: src, destPath: destDir + '/' + baseName(src) });
        }
      } catch (err) {
        failures.push(`${baseName(src)}: ${String(err)}`);
      }
    }
    touched.forEach(d => loadDir(d));
    if (failures.length) toast(failures.join('\n'), 'error');
  }, [rpc, loadDir]);

  const copySelection = useCallback((mode: 'copy' | 'cut' = 'copy') => {
    const targets = actionTargets();
    if (!targets.length) return;
    setClipboard({ paths: targets, mode });
    const verb = mode === 'cut' ? 'Cut' : 'Copied';
    toast(`${verb} ${targets.length} item${targets.length > 1 ? 's' : ''}`, 'success');
  }, [actionTargets]);

  // Paste into the selected folder, or into the folder holding the cursor.
  const pasteClipboard = useCallback(async (forceMove = false) => {
    if (!clipboard.paths.length) return;
    const mode = (forceMove || clipboard.mode === 'cut') ? 'move' : 'copy';
    await transfer(clipboard.paths, getCreationParentPath(), mode);
    // a cut is spent once pasted; a copy can be pasted repeatedly
    if (mode === 'move') setClipboard({ paths: [], mode: 'copy' });
  }, [clipboard, transfer, getCreationParentPath]);

  const duplicateSelection = useCallback(async () => {
    const targets = actionTargets();
    if (!targets.length) return;
    const failures: string[] = [];
    for (const src of targets) {
      try {
        // same destination as source: the gateway appends " copy"
        await rpc('fs.copy', { sourcePath: src, destPath: src });
      } catch (err) {
        failures.push(`${baseName(src)}: ${String(err)}`);
      }
    }
    new Set(targets.map(parentOf)).forEach(d => loadDir(d));
    if (failures.length) toast(failures.join('\n'), 'error');
  }, [actionTargets, rpc, loadDir]);

  const handleDragStart = useCallback((e: React.DragEvent, path: string) => {
    // Dragging an unselected row acts on that row alone, like Finder.
    const paths = selection.has(path) ? Array.from(selection) : [path];
    if (!selection.has(path)) selectOnly(path);
    draggingPathsRef.current = paths;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(paths));
    e.dataTransfer.setData('text/plain', paths.join('\n'));
  }, [selection, selectOnly]);

  const handleDragOver = useCallback((e: React.DragEvent, path: string, isDir: boolean) => {
    const internal = e.dataTransfer.types.includes(DRAG_MIME);
    const external = e.dataTransfer.types.includes('Files');
    if (!internal && !external) return;
    const destDir = isDir ? path : parentOf(path);
    // no drop indicator on a row being dragged, or into its own subtree
    if (internal && draggingPathsRef.current.some(p => p === destDir || wouldNest(p, destDir))) return;
    e.preventDefault();
    e.stopPropagation();
    copyDragRef.current = e.altKey;
    e.dataTransfer.dropEffect = external ? 'copy' : (e.altKey ? 'copy' : 'move');
    setDropTarget(isDir ? path : null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, destDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);

    // From Finder: copy the files in.
    if (e.dataTransfer.files?.length) {
      const api = (window as unknown as { electronAPI?: { getPathForFile?: (f: File) => string } }).electronAPI;
      const paths = Array.from(e.dataTransfer.files)
        .map(f => api?.getPathForFile?.(f) || '')
        .filter(Boolean);
      if (!paths.length) {
        toast('Could not resolve dropped file paths', 'error');
        return;
      }
      await transfer(paths, destDir, 'copy');
      return;
    }

    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    let paths: string[] = [];
    try { paths = JSON.parse(raw) as string[]; } catch { return; }
    draggingPathsRef.current = [];
    if (!paths.length) return;
    await transfer(paths, destDir, (e.altKey || copyDragRef.current) ? 'copy' : 'move');
  }, [transfer]);

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

    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault();
      e.stopPropagation(); copySelection('copy'); return; }
    if (mod && e.key.toLowerCase() === 'x') { e.preventDefault();
      e.stopPropagation(); copySelection('cut'); return; }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault();
      e.stopPropagation(); void pasteClipboard(e.altKey); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault();
      e.stopPropagation(); void duplicateSelection(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const targets = actionTargets();
      if (targets.length) setConfirmDelete(targets);
      return;
    }

    if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) createFolder();
      else createFile();
      return;
    }

    // Cmd+Right: navigate into selected folder, Cmd+Left: navigate up
    if (mod && e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      if (selectedPath) {
        const visible = getVisiblePaths();
        const item = visible.find(v => v.path === selectedPath);
        if (item?.isDir) navigateTo(item.path);
      }
      return;
    }
    if (mod && e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      const parentDir = viewRoot.substring(0, viewRoot.lastIndexOf('/'));
      if (parentDir) navigateTo(parentDir);
      return;
    }

    const visible = getVisiblePaths();
    if (visible.length === 0) return;

    const currentIdx = selectedPath ? visible.findIndex(v => v.path === selectedPath) : -1;

    switch (e.key) {
      case 'ArrowDown':
      case 'j': {
        e.preventDefault();
      e.stopPropagation();
        const nextIdx = currentIdx < visible.length - 1 ? currentIdx + 1 : 0;
        if (e.shiftKey) extendTo(visible[nextIdx].path);
        else selectOnly(visible[nextIdx].path);
        scrollPathIntoView(visible[nextIdx].path);
        break;
      }
      case 'ArrowUp':
      case 'k': {
        e.preventDefault();
      e.stopPropagation();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : visible.length - 1;
        if (e.shiftKey) extendTo(visible[prevIdx].path);
        else selectOnly(visible[prevIdx].path);
        scrollPathIntoView(visible[prevIdx].path);
        break;
      }
      case 'ArrowRight':
      case 'l': {
        e.preventDefault();
      e.stopPropagation();
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
      e.stopPropagation();
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
      e.stopPropagation();
        if (currentIdx < 0) break;
        const item = visible[currentIdx];
        if (item.isDir) {
          navigateTo(item.path);
        } else {
          handleFileClick(item.path);
        }
        break;
      }
    }
  }, [createFile, createFolder, getVisiblePaths, selectedPath, expanded, toggleDir, handleFileClick, navigateTo, viewRoot, scrollPathIntoView]);

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
    // right-clicking inside a multi-selection keeps it; outside collapses to
    // the clicked row
    if (selection.has(path)) setSelectedPath(path);
    else selectOnly(path);
    focusTree();
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
  }, [focusTree, selection, selectOnly]);

  const handleBlankAreaContextMenu = useCallback((e: React.MouseEvent) => {
    // Only fire if the click target is the container itself (blank area)
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-file-entry]') === null) {
      e.preventDefault();
      selectOnly(null);
      focusTree();
      setContextMenu({ x: e.clientX, y: e.clientY, path: viewRoot, isDir: true });
    }
  }, [focusTree, viewRoot]);

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

  const ctxNewFile = useCallback((folder: string) => {
    setContextMenu(null);
    setExpanded(prev => new Set(prev).add(folder));
    loadDir(folder);
    setInlineInput({ parentPath: folder, type: 'file' });
  }, [loadDir]);

  const ctxNewFolder = useCallback((folder: string) => {
    setContextMenu(null);
    setExpanded(prev => new Set(prev).add(folder));
    loadDir(folder);
    setInlineInput({ parentPath: folder, type: 'folder' });
  }, [loadDir]);

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
    return <GitPanel rpc={rpc} gitState={gitState} onFileClick={onFileClick} onOpenDiff={onOpenDiff} onOpenPr={onOpenPr} onRefresh={fetchGitStatus} onOpenTerminal={onOpenTerminal} />;
  }

  // ── Files mode ──────────────────────────────────────────────────

  // Build absolute path -> git status map for file tree coloring
  const gitFileMap = new Map<string, string>();
  if (gitState) {
    for (const f of gitState.files) {
      gitFileMap.set(gitState.root + '/' + f.path, f.status);
    }
  }

  // Check if a subtree contains any entry matching the filter
  const filterLower = fileFilter.toLowerCase();
  const subtreeMatches = (parentPath: string): boolean => {
    const st = dirs.get(parentPath);
    if (!st) return false;
    for (const e of st.entries) {
      if (e.name.toLowerCase().includes(filterLower)) return true;
      if (e.type === 'directory' && subtreeMatches(parentPath + '/' + e.name)) return true;
    }
    return false;
  };

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

      // Filter: skip entries that don't match and don't contain matching children
      if (fileFilter) {
        const nameMatches = entry.name.toLowerCase().includes(filterLower);
        if (!nameMatches && (!isDir || !subtreeMatches(fullPath))) continue;
      }
      const isDot = entry.name.startsWith('.');
      const isBeingRenamed = inlineInput?.type === 'rename' && inlineInput.originalPath === fullPath;

      const gitStatus = gitFileMap.get(fullPath);
      const gitColor = gitStatus === 'D' ? 'text-destructive' :
        (gitStatus === 'A' || gitStatus === '?') ? 'text-success' :
        gitStatus === 'M' ? 'text-warning' : undefined;

      items.push(
        <div
          key={fullPath}
          data-file-entry
          data-path={fullPath}
          role="treeitem"
          aria-selected={selection.has(fullPath)}
          className={cn(
            'flex items-center gap-1.5 py-0.5 px-1 rounded-sm text-[11px] cursor-pointer group transition-colors min-w-0',
            isDot && 'opacity-50',
            clipboard.mode === 'cut' && clipboard.paths.includes(fullPath) && 'opacity-40 italic',
            selection.has(fullPath) ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
            // the cursor row is outlined so it stays visible inside a range
            selectedPath === fullPath && selection.size > 1 && 'ring-1 ring-inset ring-primary/40',
            dropTarget === fullPath && 'bg-primary/20 ring-1 ring-inset ring-primary',
          )}
          style={{ paddingLeft: Math.min(depth * 16, 128) + 12 }}
          draggable
          onDragStart={(e) => handleDragStart(e, fullPath)}
          onDragOver={(e) => handleDragOver(e, fullPath, isDir)}
          onDragLeave={() => setDropTarget(prev => (prev === fullPath ? null : prev))}
          onDrop={(e) => handleDrop(e, isDir ? fullPath : parentPath)}
          onDragEnd={() => { setDropTarget(null); draggingPathsRef.current = []; copyDragRef.current = false; }}
          onClick={(e) => {
            focusTree();
            if (e.shiftKey) {
              e.preventDefault();
              extendTo(fullPath);
              return;
            }
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              toggleSelect(fullPath);
              return;
            }
            selectOnly(fullPath);
            if (!isDir) handleFileClick(fullPath);
          }}
          onDoubleClick={isDir ? () => navigateTo(fullPath) : undefined}
          onContextMenu={(e) => handleContextMenu(e, fullPath, isDir)}
        >
          {isDir ? (
            <button
              className="shrink-0 rounded-sm hover:bg-secondary/60"
              onClick={(e) => {
                e.stopPropagation();
                selectOnly(fullPath);
                focusTree();
                toggleDir(fullPath);
              }}
            >
              {isExpanded2 ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {isDir ? <Folder className="w-3 h-3 shrink-0 text-primary" /> : <File className="w-3 h-3 shrink-0" />}
          {isBeingRenamed ? (
            <input
              autoFocus
              className="flex-1 bg-transparent border border-primary/50 rounded px-1 py-0 text-[11px] outline-none focus:border-primary min-w-0"
              defaultValue={entry.name}
              onFocus={(e) => {
                const name = e.target.value;
                const dotIdx = name.lastIndexOf('.');
                e.target.setSelectionRange(0, dotIdx > 0 ? dotIdx : name.length);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submitInlineInput((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setInlineInput(null);
              }}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== entry.name) submitInlineInput(val);
                else setInlineInput(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
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
            </>
          )}
        </div>
      );

      if (isDir && (isExpanded2 || fileFilter)) {
        items.push(...renderEntries(fullPath, depth + 1));
      }
    }

    // In-place input for new file/folder
    if (inlineInput && inlineInput.type !== 'rename' && inlineInput.parentPath === parentPath) {
      items.push(
        <div key="__inline_input__" className="flex items-center gap-1.5 py-0.5 px-1 text-[11px]" style={{ paddingLeft: Math.min(depth * 16, 128) + 12 }}>
          {inlineInput.type === 'folder' ? <Folder className="w-3 h-3 shrink-0 text-primary" /> : <File className="w-3 h-3 shrink-0" />}
          <input
            autoFocus
            className="flex-1 bg-transparent border border-primary/50 rounded px-1 py-0 text-[11px] outline-none focus:border-primary min-w-0"
            placeholder={inlineInput.type === 'folder' ? 'Folder name...' : 'File name...'}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') submitInlineInput((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setInlineInput(null);
            }}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val) submitInlineInput(val);
              else setInlineInput(null);
            }}
          />
        </div>
      );
    }

    return items;
  };

  const crumbs = viewRoot ? buildCrumbs(homeCwd, viewRoot) : [];

  return (
    <div className="flex flex-col h-full min-h-0 border border-transparent focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/35" onMouseDown={(e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') focusTree();
    }}>
      <div className="group/explorer-header flex items-center gap-1 px-3 py-2 border-b border-border shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">Files</span>
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground shrink-0 opacity-0 group-hover/explorer-header:opacity-100 hover:text-foreground hover:bg-accent transition-all" onClick={createFile}>
              <FilePlus className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">New File</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground shrink-0 opacity-0 group-hover/explorer-header:opacity-100 hover:text-foreground hover:bg-accent transition-all" onClick={createFolder}>
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">New Folder</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0">
        <Search className="w-3 h-3 text-muted-foreground shrink-0" />
        <input
          className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50 min-w-0"
          placeholder="Filter files..."
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
        />
        {fileFilter && (
          <button className="p-0.5 hover:text-foreground text-muted-foreground transition-colors" onClick={() => setFileFilter('')}>
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div
          ref={(node) => {
            treeRef.current = node;
            scrollContainerRef.current = node;
          }}
          className={cn(
            'py-1 min-h-full outline-none',
            dropTarget === '__root__' && 'bg-primary/10 ring-1 ring-inset ring-primary/50',
          )}
          tabIndex={0}
          data-file-tree
          onKeyDown={handleTreeKeyDown}
          onContextMenu={handleBlankAreaContextMenu}
          onMouseDown={() => focusTree()}
          onDragOver={(e) => {
            const internal = e.dataTransfer.types.includes(DRAG_MIME);
            const external = e.dataTransfer.types.includes('Files');
            if (!internal && !external) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = external ? 'copy' : (e.altKey ? 'copy' : 'move');
            setDropTarget('__root__');
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDropTarget(null);
          }}
          onDrop={(e) => { void handleDrop(e, viewRoot); }}
        >
          {viewRoot ? renderEntries(viewRoot, 0) : <div className="text-[11px] text-muted-foreground p-3">loading...</div>}
        </div>
      </ScrollArea>

      {/* Delete confirmation */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmDelete(null)}>
          <div className="bg-popover border rounded-lg shadow-lg p-4 max-w-sm" onClick={e => e.stopPropagation()}>
            <p className="text-sm mb-1">
              {confirmDelete.length === 1 ? 'Delete this item?' : `Delete ${confirmDelete.length} items?`}
            </p>
            <p className="text-xs text-muted-foreground mb-1 break-all">
              {confirmDelete.length === 1
                ? confirmDelete[0].substring(confirmDelete[0].lastIndexOf('/') + 1)
                : confirmDelete.slice(0, 5).map(p => p.substring(p.lastIndexOf('/') + 1)).join(', ')
                  + (confirmDelete.length > 5 ? ` and ${confirmDelete.length - 5} more` : '')}
            </p>
            <p className="text-[10px] text-muted-foreground mb-3">Moves to Trash.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={confirmDeleteItem}>Delete</Button>
            </div>
          </div>
        </div>,
        document.body
      )}

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
                onClick={() => { copySelection('copy'); setContextMenu(null); }}
              >Copy{selection.size > 1 ? ` (${selection.size})` : ''}</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { copySelection('cut'); setContextMenu(null); }}
              >Cut{selection.size > 1 ? ` (${selection.size})` : ''}</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40"
                disabled={clipboard.paths.length === 0}
                onClick={() => { void pasteClipboard(); setContextMenu(null); }}
              >{clipboard.mode === 'cut' ? 'Move Here' : 'Paste'}{clipboard.paths.length > 1 ? ` (${clipboard.paths.length})` : ''}</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { void duplicateSelection(); setContextMenu(null); }}
              >Duplicate</button>
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
                onClick={() => { copySelection('copy'); setContextMenu(null); }}
              >Copy{selection.size > 1 ? ` (${selection.size})` : ''}</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { copySelection('cut'); setContextMenu(null); }}
              >Cut{selection.size > 1 ? ` (${selection.size})` : ''}</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40"
                disabled={clipboard.paths.length === 0}
                onClick={() => { void pasteClipboard(); setContextMenu(null); }}
              >{clipboard.mode === 'cut' ? 'Move Here' : 'Paste'}{clipboard.paths.length > 1 ? ` (${clipboard.paths.length})` : ''}</button>
              <button
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { void duplicateSelection(); setContextMenu(null); }}
              >Duplicate</button>
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
