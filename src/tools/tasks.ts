import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getDb } from '../db.js';
import { PLANS_DIR } from '../workspace.js';

export type TaskStatus = 'planning' | 'planned' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

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

export type TasksState = {
  tasks: Task[];
  version: number;
};

const TASK_PLAN_ROOT_DIR = join(PLANS_DIR, 'tasks');
const TASK_PLAN_FILENAME = 'PLAN.md';

function normalizeTaskPlan(task: Task, content?: string): string {
  const trimmed = content?.trim();
  if (trimmed) return `${trimmed}\n`;

  const goalLabel = task.goalId ? `#${task.goalId}` : '(orphan)';
  return [
    `# Task ${task.id} Plan`,
    '',
    `Task: ${task.title}`,
    `Goal: ${goalLabel}`,
    `Status: ${task.status}`,
    '',
    '## Objective',
    'Define the exact outcome this task should achieve.',
    '',
    '## Context',
    '- Add constraints, assumptions, and references.',
    '',
    '## Execution Plan',
    '1. Step one',
    '2. Step two',
    '3. Step three',
    '',
    '## Risks',
    '- List concrete risks and mitigations.',
    '',
    '## Validation',
    '- Describe how completion will be verified.',
    '',
  ].join('\n');
}

export function getTaskPlanDir(taskId: string): string {
  return join(TASK_PLAN_ROOT_DIR, taskId);
}

export function getTaskPlanPath(taskId: string): string {
  return join(getTaskPlanDir(taskId), TASK_PLAN_FILENAME);
}

export function ensureTaskPlanDoc(task: Task, initialContent?: string): string {
  const taskPlanDir = getTaskPlanDir(task.id);
  const path = task.planDocPath || getTaskPlanPath(task.id);
  mkdirSync(taskPlanDir, { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, normalizeTaskPlan(task, initialContent || task.plan), 'utf-8');
  }
  task.planDocPath = path;
  return path;
}

export function readTaskPlanDoc(task: Task): string {
  const path = task.planDocPath || getTaskPlanPath(task.id);
  if (!existsSync(path)) return task.plan || '';
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return task.plan || '';
  }
}

export function writeTaskPlanDoc(task: Task, content: string): string {
  const path = ensureTaskPlanDoc(task, content);
  const normalized = normalizeTaskPlan(task, content);
  writeFileSync(path, normalized, 'utf-8');
  task.planDocPath = path;
  task.plan = normalized;
  return path;
}

export function getTaskPlanContent(task: Task): string {
  const content = readTaskPlanDoc(task);
  return content.trim() ? content : normalizeTaskPlan(task, task.plan);
}

function normalizeStatusForApproval(task: Task, requested: TaskStatus): TaskStatus {
  if ((requested === 'in_progress' || requested === 'done') && !task.approvedAt) {
    return 'planned';
  }
  return requested;
}

function parseTaskRow(raw: string): Task {
  const task = JSON.parse(raw) as Task;
  return {
    ...task,
    status: task.status || 'planning',
    planDocPath: task.planDocPath || getTaskPlanPath(task.id),
  };
}

function nextId(tasks: Task[]): string {
  const ids = tasks.map(t => Number.parseInt(t.id, 10)).filter(n => Number.isFinite(n));
  return String((ids.length ? Math.max(...ids) : 0) + 1);
}

export function loadTasks(): TasksState {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM tasks').all() as { data: string }[];
  const tasks = rows.map(row => parseTaskRow(row.data));
  const versionRow = db.prepare("SELECT value FROM tasks_meta WHERE key = 'version'").get() as { value: string } | undefined;
  return {
    tasks,
    version: versionRow ? Number.parseInt(versionRow.value, 10) : 1,
  };
}

export function saveTasks(state: TasksState): void {
  const db = getDb();
  state.version = (state.version || 0) + 1;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tasks').run();
    const insert = db.prepare('INSERT INTO tasks (id, data) VALUES (?, ?)');
    for (const task of state.tasks) insert.run(task.id, JSON.stringify(task));
    db.prepare("INSERT OR REPLACE INTO tasks_meta (key, value) VALUES ('version', ?)").run(String(state.version));
  });
  tx();
}

export function appendTaskLog(taskId: string, eventType: string, message: string, data?: unknown): void {
  getDb().prepare(
    'INSERT INTO tasks_logs (task_id, event_type, message, data) VALUES (?, ?, ?, ?)',
  ).run(taskId, eventType, message, data ? JSON.stringify(data) : null);
}

export function readTaskLogs(taskId: string, limit = 50): Array<{
  id: number;
  taskId: string;
  eventType: string;
  message: string;
  data?: unknown;
  createdAt: string;
}> {
  const rows = getDb().prepare(`
    SELECT id, task_id, event_type, message, data, created_at
    FROM tasks_logs
    WHERE task_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(taskId, limit) as Array<{
    id: number;
    task_id: string;
    event_type: string;
    message: string;
    data: string | null;
    created_at: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type,
    message: row.message,
    data: row.data ? JSON.parse(row.data) : undefined,
    createdAt: row.created_at,
  }));
}

function derivedState(task: Task): string {
  if (task.status === 'planned') {
    if (task.approvalRequestId) return 'needs_approval';
    if (task.reason && /denied/i.test(task.reason)) return 'denied';
    if (task.approvedAt) return 'ready';
  }
  return task.status;
}

function taskSummary(task: Task): string {
  const goal = task.goalId ? ` goal=${task.goalId}` : '';
  const state = derivedState(task);
  const extra = state !== task.status ? ` (${state})` : '';
  return `#${task.id} [${task.status}${extra}]${goal} ${task.title}`;
}

export const tasksViewTool = tool(
  'tasks_view',
  'View tasks. Filter by status (raw), filter (derived state like needs_approval/ready/denied), goalId, or id.',
  {
    status: z.enum(['all', 'planning', 'planned', 'in_progress', 'done', 'blocked', 'cancelled']).optional(),
    filter: z.enum(['needs_approval', 'ready', 'denied', 'running', 'active']).optional()
      .describe('Derived state filter. needs_approval = awaiting human approval, ready = approved but not started, denied = plan was denied, running = in_progress, active = not done/cancelled/denied'),
    goalId: z.string().optional(),
    id: z.string().optional(),
    includeLogs: z.boolean().optional(),
  },
  async (args) => {
    const state = loadTasks();

    if (args.id) {
      const task = state.tasks.find(t => t.id === args.id);
      if (!task) return { content: [{ type: 'text', text: `Task #${args.id} not found` }], isError: true };
      const planContent = getTaskPlanContent(task);
      const logs = args.includeLogs ? readTaskLogs(task.id, 20) : [];
      const lines = [
        taskSummary(task),
        task.reason ? `Reason: ${task.reason}` : '',
        `Plan file: ${task.planDocPath || getTaskPlanPath(task.id)}`,
        planContent ? `\nPlan:\n${planContent}` : '',
        task.result ? `\nResult:\n${task.result}` : '',
      ].filter(Boolean);

      if (logs.length) {
        lines.push('\nRecent logs:');
        for (const log of logs.reverse()) {
          lines.push(`- [${log.createdAt}] ${log.eventType}: ${log.message}`);
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    const status = args.status || 'all';
    let tasks = status === 'all' ? state.tasks : state.tasks.filter(t => t.status === status);
    if (args.goalId) tasks = tasks.filter(t => t.goalId === args.goalId);

    if (args.filter) {
      const DISMISSED = new Set(['done', 'cancelled']);
      tasks = tasks.filter(t => {
        const ds = derivedState(t);
        switch (args.filter) {
          case 'needs_approval': return ds === 'needs_approval';
          case 'ready': return ds === 'ready';
          case 'denied': return ds === 'denied';
          case 'running': return t.status === 'in_progress';
          case 'active': return !DISMISSED.has(t.status) && ds !== 'denied';
          default: return true;
        }
      });
    }

    if (!tasks.length) {
      return { content: [{ type: 'text', text: 'No tasks found.' }] };
    }

    const lines = tasks
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(taskSummary)
      .join('\n');
    return { content: [{ type: 'text', text: `Tasks (${tasks.length}):\n\n${lines}` }] };
  },
);

export const tasksAddTool = tool(
  'tasks_add',
  'Create a task and initialize its PLAN.md file.',
  {
    title: z.string(),
    goalId: z.string().optional(),
    status: z.enum(['planning', 'planned', 'in_progress', 'done', 'blocked', 'cancelled']).optional(),
    plan: z.string().optional(),
    reason: z.string().optional(),
  },
  async (args) => {
    const state = loadTasks();
    const now = new Date().toISOString();
    const id = nextId(state.tasks);
    const requestedStatus = args.status || 'planning';
    const status = requestedStatus === 'in_progress' || requestedStatus === 'done'
      ? 'planned'
      : requestedStatus;
    const task: Task = {
      id,
      goalId: args.goalId,
      title: args.title,
      status,
      plan: args.plan,
      planDocPath: getTaskPlanPath(id),
      reason: args.reason,
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
    };
    task.planDocPath = ensureTaskPlanDoc(task, args.plan);
    task.plan = readTaskPlanDoc(task);
    state.tasks.push(task);
    saveTasks(state);
    appendTaskLog(task.id, 'task_add', `Task created: ${task.title}`);
    return { content: [{ type: 'text', text: `Task #${task.id} created: ${task.title}` }] };
  },
);

export const tasksUpdateTool = tool(
  'tasks_update',
  'Update task fields. When plan is provided, rewrite the task PLAN.md file.',
  {
    id: z.string(),
    title: z.string().optional(),
    goalId: z.string().nullable().optional(),
    status: z.enum(['planning', 'planned', 'in_progress', 'done', 'blocked', 'cancelled']).optional(),
    plan: z.string().optional(),
    result: z.string().optional(),
    reason: z.string().optional(),
    sessionId: z.string().optional(),
    sessionKey: z.string().optional(),
  },
  async (args) => {
    const state = loadTasks();
    const task = state.tasks.find(t => t.id === args.id);
    if (!task) return { content: [{ type: 'text', text: `Task #${args.id} not found` }], isError: true };

    if (args.title !== undefined) task.title = args.title;
    if (args.goalId !== undefined) task.goalId = args.goalId || undefined;
    if (args.status !== undefined) task.status = normalizeStatusForApproval(task, args.status);
    if (args.plan !== undefined) {
      writeTaskPlanDoc(task, args.plan);
    } else {
      ensureTaskPlanDoc(task, task.plan);
      task.plan = readTaskPlanDoc(task);
    }
    if (args.result !== undefined) task.result = args.result;
    if (args.reason !== undefined) task.reason = args.reason;
    if (args.sessionId !== undefined) task.sessionId = args.sessionId;
    if (args.sessionKey !== undefined) task.sessionKey = args.sessionKey;
    task.updatedAt = new Date().toISOString();
    if (task.status === 'done' && !task.completedAt) task.completedAt = task.updatedAt;
    if (task.status !== 'done') task.completedAt = undefined;
    if (task.status !== 'planned') task.approvalRequestId = undefined;
    saveTasks(state);

    const changes: string[] = [];
    if (args.status) changes.push(`status=${args.status}`);
    if (args.goalId !== undefined) changes.push(`goal=${args.goalId || 'none'}`);
    appendTaskLog(task.id, 'task_update', changes.join(', ') || 'updated');
    return { content: [{ type: 'text', text: `Task #${task.id} updated` }] };
  },
);

export const tasksDoneTool = tool(
  'tasks_done',
  'Mark task as done and optionally set result.',
  {
    id: z.string(),
    result: z.string().optional(),
  },
  async (args) => {
    const state = loadTasks();
    const task = state.tasks.find(t => t.id === args.id);
    if (!task) return { content: [{ type: 'text', text: `Task #${args.id} not found` }], isError: true };
    const now = new Date().toISOString();

    if (!task.approvedAt) {
      task.status = 'planned';
      if (args.result !== undefined) task.result = args.result;
      task.updatedAt = now;
      task.completedAt = undefined;
      saveTasks(state);
      appendTaskLog(task.id, 'task_done_blocked', 'Task attempted done before approval, moved to planned');
      return { content: [{ type: 'text', text: `Task #${task.id} moved to planned for human approval` }] };
    }

    task.status = 'done';
    if (args.result !== undefined) task.result = args.result;
    task.updatedAt = now;
    task.completedAt = now;
    saveTasks(state);
    appendTaskLog(task.id, 'task_done', 'Task marked done');
    return { content: [{ type: 'text', text: `Task #${task.id} marked done` }] };
  },
);

export const tasksDeleteTool = tool(
  'tasks_delete',
  'Delete a task.',
  {
    id: z.string(),
  },
  async (args) => {
    const state = loadTasks();
    const before = state.tasks.length;
    state.tasks = state.tasks.filter(t => t.id !== args.id);
    if (state.tasks.length === before) {
      return { content: [{ type: 'text', text: `Task #${args.id} not found` }], isError: true };
    }
    saveTasks(state);
    appendTaskLog(args.id, 'task_delete', `Task #${args.id} deleted`);
    return { content: [{ type: 'text', text: `Task #${args.id} deleted` }] };
  },
);

export const tasksTools = [
  tasksViewTool,
  tasksAddTool,
  tasksUpdateTool,
  tasksDoneTool,
  tasksDeleteTool,
];
