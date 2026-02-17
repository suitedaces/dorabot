import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WORKTREES_DIR } from '../workspace.js';

export type WorktreeCreateResult = {
  path: string;
  branch: string;
  baseBranch: string;
  created: boolean;
};

export type WorktreeStats = {
  path: string;
  branch: string;
  clean: boolean;
  staged: number;
  changed: number;
  untracked: number;
  ahead: number;
  behind: number;
  lastCommit: string;
};

export type WorktreePushPrResult = {
  pushed: boolean;
  branch: string;
  baseBranch: string;
  prUrl?: string;
};

function runCommand(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  }).trim();
}

function runGit(args: string[], cwd: string): string {
  return runCommand('git', args, cwd);
}

function tryRunGit(args: string[], cwd: string): string | null {
  try {
    return runGit(args, cwd);
  } catch {
    return null;
  }
}

function tryRunCommand(command: string, args: string[], cwd: string): string | null {
  try {
    return runCommand(command, args, cwd);
  } catch {
    return null;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function repoRoot(cwd: string): string {
  return runGit(['rev-parse', '--show-toplevel'], cwd);
}

function defaultBaseBranch(repo: string): string {
  const fromOriginHead = tryRunGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], repo);
  if (fromOriginHead) return fromOriginHead.replace(/^origin\//, '');
  return tryRunGit(['rev-parse', '--abbrev-ref', 'HEAD'], repo) || 'main';
}

function branchForPlan(planId: string, title?: string): string {
  const suffix = slugify(title || `plan-${planId}`) || `plan-${planId}`;
  return `codex/plan-${planId}-${suffix}`;
}

export function ensureWorktreeForPlan(args: {
  planId: string;
  title?: string;
  cwd: string;
  baseBranch?: string;
}): WorktreeCreateResult {
  const repo = repoRoot(args.cwd);
  const baseBranch = args.baseBranch || defaultBaseBranch(repo);
  mkdirSync(WORKTREES_DIR, { recursive: true });
  const path = join(WORKTREES_DIR, `plan-${args.planId}`);
  const branch = branchForPlan(args.planId, args.title);

  if (existsSync(path)) {
    const existingBranch = tryRunGit(['rev-parse', '--abbrev-ref', 'HEAD'], path) || branch;
    return {
      path,
      branch: existingBranch,
      baseBranch,
      created: false,
    };
  }

  const hasBranch = tryRunGit(['show-ref', '--verify', `refs/heads/${branch}`], repo) !== null;
  if (hasBranch) {
    runGit(['worktree', 'add', path, branch], repo);
  } else {
    runGit(['worktree', 'add', '-b', branch, path, baseBranch], repo);
  }

  return {
    path,
    branch,
    baseBranch,
    created: true,
  };
}

export function getWorktreeStats(path: string): WorktreeStats {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], path);
  const porcelain = runGit(['status', '--porcelain'], path);
  const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];

  let staged = 0;
  let changed = 0;
  let untracked = 0;
  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    if (x === '?' && y === '?') {
      untracked += 1;
      continue;
    }
    if (x && x !== ' ') staged += 1;
    if (y && y !== ' ') changed += 1;
  }

  let ahead = 0;
  let behind = 0;
  const aheadBehind = tryRunGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], path);
  if (aheadBehind) {
    const [behindRaw, aheadRaw] = aheadBehind.split(/\s+/);
    behind = Number.parseInt(behindRaw || '0', 10) || 0;
    ahead = Number.parseInt(aheadRaw || '0', 10) || 0;
  }

  const lastCommit = tryRunGit(['log', '-1', '--pretty=format:%h %s'], path) || '';

  return {
    path,
    branch,
    clean: lines.length === 0,
    staged,
    changed,
    untracked,
    ahead,
    behind,
    lastCommit,
  };
}

export function mergeWorktreeBranch(args: {
  cwd: string;
  sourceBranch: string;
  targetBranch?: string;
}): { merged: boolean; targetBranch: string; commit: string } {
  const repo = repoRoot(args.cwd);
  const targetBranch = args.targetBranch || defaultBaseBranch(repo);
  runGit(['checkout', targetBranch], repo);
  runGit(['merge', '--no-ff', args.sourceBranch, '-m', `Merge ${args.sourceBranch} into ${targetBranch}`], repo);
  const commit = runGit(['rev-parse', 'HEAD'], repo);
  return {
    merged: true,
    targetBranch,
    commit,
  };
}

export function pushWorktreePr(args: {
  worktreePath: string;
  baseBranch?: string;
  title?: string;
  body?: string;
}): WorktreePushPrResult {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], args.worktreePath);
  const baseBranch = args.baseBranch || 'main';
  runGit(['push', '-u', 'origin', branch], args.worktreePath);

  const ghAvailable = tryRunCommand('gh', ['--version'], args.worktreePath) !== null;
  if (!ghAvailable) {
    return { pushed: true, branch, baseBranch };
  }

  let prUrl: string | undefined;
  try {
    const title = args.title || `Plan ${branch}`;
    const body = args.body || 'Automated plan worktree PR';
    prUrl = runCommand('gh', ['pr', 'create', '--head', branch, '--base', baseBranch, '--title', title, '--body', body], args.worktreePath);
  } catch {
    // PR creation can fail if one already exists or auth is missing; push still succeeded.
  }

  return { pushed: true, branch, baseBranch, prUrl };
}

export function removeWorktree(args: {
  cwd: string;
  worktreePath: string;
  branch?: string;
  removeBranch?: boolean;
}): { removed: boolean; removedBranch: boolean } {
  const repo = repoRoot(args.cwd);
  if (existsSync(args.worktreePath)) {
    try {
      runGit(['worktree', 'remove', args.worktreePath, '--force'], repo);
    } catch {
      rmSync(args.worktreePath, { recursive: true, force: true });
    }
  }

  let removedBranch = false;
  if (args.removeBranch && args.branch) {
    try {
      runGit(['branch', '-D', args.branch], repo);
      removedBranch = true;
    } catch {
      removedBranch = false;
    }
  }

  return { removed: true, removedBranch };
}
