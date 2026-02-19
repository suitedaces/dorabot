import type { TaskRun } from '../../hooks/useGateway';

export type GoalStatus = 'active' | 'paused' | 'done';
export type TaskStatus = 'planning' | 'planned' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

export type Goal = {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;
  tags?: string[];
  reason?: string;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  goalId?: string;
  title: string;
  status: TaskStatus;
  plan?: string;
  planDocPath?: string;
  result?: string;
  reason?: string;
  sessionId?: string;
  sessionKey?: string;
  approvalRequestId?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type TaskLog = {
  id: number;
  taskId: string;
  eventType: string;
  message: string;
  createdAt: string;
};

export type TaskPresentation = {
  label: string;
  dotClass: string;
  action: 'approve' | 'start' | 'watch' | 'unblock' | null;
};

const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  blocked: 1,
  planning: 2,
  planned: 3,
  done: 4,
  cancelled: 5,
};

export function getTaskPresentation(
  task: Task,
  taskRuns: Record<string, TaskRun>,
): TaskPresentation {
  const running = taskRuns[task.id]?.status === 'started';

  if (running || task.status === 'in_progress') {
    return {
      label: 'running',
      dotClass: 'bg-foreground animate-pulse',
      action: task.sessionId || task.sessionKey ? 'watch' : null,
    };
  }

  if (task.status === 'planned') {
    if (task.approvalRequestId) {
      return { label: 'needs approval', dotClass: 'bg-amber-500', action: 'approve' };
    }
    if (task.reason && /denied/i.test(task.reason)) {
      return { label: 'denied', dotClass: 'bg-destructive', action: null };
    }
    if (task.approvedAt) {
      return { label: 'ready', dotClass: 'bg-muted-foreground/40', action: 'start' };
    }
    return { label: 'planned', dotClass: 'bg-muted-foreground/40', action: null };
  }

  if (task.status === 'blocked') {
    return { label: 'blocked', dotClass: 'bg-destructive', action: 'unblock' };
  }

  if (task.status === 'planning') {
    return { label: 'planning', dotClass: 'bg-muted-foreground/20', action: null };
  }

  if (task.status === 'done') {
    return { label: 'done', dotClass: 'bg-muted-foreground/20', action: null };
  }

  return { label: 'cancelled', dotClass: 'bg-muted-foreground/20', action: null };
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (order !== 0) return order;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function parseSessionKey(sessionKey?: string): { channel: string; chatType: string; chatId: string } | null {
  if (!sessionKey) return null;
  const [channel = 'desktop', chatType = 'dm', ...rest] = sessionKey.split(':');
  const chatId = rest.join(':');
  if (!chatId) return null;
  return { channel, chatType, chatId };
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err || 'unknown error');
}

// status badge colors for tasks
export function getStatusBadge(label: string): { bg: string; text: string } {
  switch (label) {
    case 'running':
      return { bg: 'bg-sky-500/15', text: 'text-sky-500' };
    case 'needs approval':
      return { bg: 'bg-amber-500/15', text: 'text-amber-500' };
    case 'ready':
      return { bg: 'bg-amber-500/15', text: 'text-amber-500' };
    case 'planning':
      return { bg: 'bg-muted', text: 'text-muted-foreground' };
    case 'planned':
      return { bg: 'bg-muted', text: 'text-muted-foreground' };
    case 'blocked':
      return { bg: 'bg-destructive/15', text: 'text-destructive' };
    case 'denied':
      return { bg: 'bg-destructive/15', text: 'text-destructive' };
    case 'done':
      return { bg: 'bg-emerald-500/15', text: 'text-emerald-500' };
    case 'cancelled':
      return { bg: 'bg-muted', text: 'text-muted-foreground' };
    default:
      return { bg: 'bg-muted', text: 'text-muted-foreground' };
  }
}

// stable goal colors — deterministic from id, won't shift when goals reorder
const GOAL_COLORS = [
  { border: 'border-l-sky-500', accent: 'bg-sky-500/5' },
  { border: 'border-l-amber-500', accent: 'bg-amber-500/5' },
  { border: 'border-l-emerald-500', accent: 'bg-emerald-500/5' },
  { border: 'border-l-violet-500', accent: 'bg-violet-500/5' },
  { border: 'border-l-rose-500', accent: 'bg-rose-500/5' },
  { border: 'border-l-cyan-500', accent: 'bg-cyan-500/5' },
  { border: 'border-l-orange-500', accent: 'bg-orange-500/5' },
  { border: 'border-l-teal-500', accent: 'bg-teal-500/5' },
] as const;

export function getGoalColor(goalId: string): { border: string; accent: string } {
  let hash = 0;
  for (let i = 0; i < goalId.length; i++) {
    hash = ((hash << 5) - hash + goalId.charCodeAt(i)) | 0;
  }
  return GOAL_COLORS[Math.abs(hash) % GOAL_COLORS.length];
}
