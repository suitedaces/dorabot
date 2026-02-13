import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getDb } from '../db.js';

// ── Types ──

export type GoalTask = {
  id: string;
  title: string;
  description?: string;
  status: 'proposed' | 'approved' | 'in_progress' | 'done' | 'rejected';
  priority: 'high' | 'medium' | 'low';
  source: 'agent' | 'user';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
  tags?: string[];
};

export type Goals = {
  tasks: GoalTask[];
  lastPlanAt?: string;
  version: number;
};

// ── Goals I/O ──

export function loadGoals(): Goals {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM goals_tasks').all() as { data: string }[];
  const tasks = rows.map(r => JSON.parse(r.data) as GoalTask);

  const versionRow = db.prepare("SELECT value FROM goals_meta WHERE key = 'version'").get() as { value: string } | undefined;
  const planRow = db.prepare("SELECT value FROM goals_meta WHERE key = 'last_plan_at'").get() as { value: string } | undefined;

  return {
    tasks,
    version: versionRow ? parseInt(versionRow.value, 10) : 1,
    lastPlanAt: planRow?.value || undefined,
  };
}

export function saveGoals(goals: Goals): void {
  const db = getDb();
  goals.version = (goals.version || 0) + 1;

  const run = db.transaction(() => {
    db.prepare('DELETE FROM goals_tasks').run();
    const insert = db.prepare('INSERT INTO goals_tasks (id, data) VALUES (?, ?)');
    for (const task of goals.tasks) {
      insert.run(task.id, JSON.stringify(task));
    }
    db.prepare("INSERT OR REPLACE INTO goals_meta (key, value) VALUES ('version', ?)").run(String(goals.version));
    if (goals.lastPlanAt) {
      db.prepare("INSERT OR REPLACE INTO goals_meta (key, value) VALUES ('last_plan_at', ?)").run(goals.lastPlanAt);
    }
  });
  run();
}

function nextId(goals: Goals): string {
  const ids = goals.tasks.map(t => parseInt(t.id, 10)).filter(n => !isNaN(n));
  return String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
}

// ── Markdown serialization (used by system-prompt.ts for display) ──

export function serializeGoals(goals: Goals): string {
  const lines: string[] = ['# Goals', ''];
  if (goals.lastPlanAt) {
    lines.push(`Last planned: ${goals.lastPlanAt}`, '');
  }

  const columns: Record<string, GoalTask[]> = {
    proposed: [],
    approved: [],
    in_progress: [],
    done: [],
    rejected: [],
  };

  for (const task of goals.tasks) {
    columns[task.status]?.push(task);
  }

  const columnLabels: Record<string, string> = {
    proposed: 'Proposed (awaiting approval)',
    approved: 'Approved (ready to execute)',
    in_progress: 'In Progress',
    done: 'Done',
    rejected: 'Rejected',
  };

  for (const [status, label] of Object.entries(columnLabels)) {
    const tasks = columns[status];
    if (!tasks || tasks.length === 0) continue;

    lines.push(`## ${label}`, '');
    for (const task of tasks) {
      const tags = task.tags?.length ? ` [${task.tags.join(', ')}]` : '';
      const priority = task.priority !== 'medium' ? ` (${task.priority})` : '';
      lines.push(`- **#${task.id}** ${task.title}${priority}${tags}`);
      if (task.description) {
        lines.push(`  ${task.description}`);
      }
      if (task.result) {
        lines.push(`  Result: ${task.result}`);
      }
      lines.push(`  source:${task.source} created:${task.createdAt} updated:${task.updatedAt}${task.completedAt ? ` completed:${task.completedAt}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Markdown parsing (used by migration script) ──

export function parseGoals(raw: string): Goals {
  const goals: Goals = { tasks: [], version: 1 };
  const lines = raw.split('\n');

  let currentStatus: string | null = null;
  let currentTask: Partial<GoalTask> | null = null;

  const statusMap: Record<string, string> = {
    'proposed': 'proposed',
    'approved': 'approved',
    'in progress': 'in_progress',
    'in_progress': 'in_progress',
    'done': 'done',
    'rejected': 'rejected',
  };

  for (const line of lines) {
    // last planned
    const planMatch = line.match(/^Last planned:\s*(.+)/);
    if (planMatch) {
      goals.lastPlanAt = planMatch[1].trim();
      continue;
    }

    // column header
    const headerMatch = line.match(/^## (.+)/);
    if (headerMatch) {
      if (currentTask?.id) {
        goals.tasks.push(currentTask as GoalTask);
        currentTask = null;
      }
      const headerText = headerMatch[1].toLowerCase();
      for (const [key, value] of Object.entries(statusMap)) {
        if (headerText.includes(key)) {
          currentStatus = value;
          break;
        }
      }
      continue;
    }

    // task line
    const taskMatch = line.match(/^- \*\*#(\d+)\*\*\s+(.+)/);
    if (taskMatch) {
      if (currentTask?.id) {
        goals.tasks.push(currentTask as GoalTask);
      }

      const titlePart = taskMatch[2];
      const priorityMatch = titlePart.match(/\(high\)|\(low\)/);
      const tagsMatch = titlePart.match(/\[([^\]]+)\]/);
      let title = titlePart
        .replace(/\s*\(high\)\s*/, ' ')
        .replace(/\s*\(low\)\s*/, ' ')
        .replace(/\s*\[[^\]]+\]\s*/, ' ')
        .trim();

      currentTask = {
        id: taskMatch[1],
        title,
        status: (currentStatus || 'proposed') as GoalTask['status'],
        priority: priorityMatch ? (priorityMatch[0].replace(/[()]/g, '') as GoalTask['priority']) : 'medium',
        source: 'agent',
        tags: tagsMatch ? tagsMatch[1].split(',').map(s => s.trim()) : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      continue;
    }

    // metadata line
    if (currentTask && line.match(/^\s+source:/)) {
      const sourceMatch = line.match(/source:(\w+)/);
      const createdMatch = line.match(/created:(\S+)/);
      const updatedMatch = line.match(/updated:(\S+)/);
      const completedMatch = line.match(/completed:(\S+)/);
      if (sourceMatch) currentTask.source = sourceMatch[1] as 'agent' | 'user';
      if (createdMatch) currentTask.createdAt = createdMatch[1];
      if (updatedMatch) currentTask.updatedAt = updatedMatch[1];
      if (completedMatch) currentTask.completedAt = completedMatch[1];
      continue;
    }

    // description or result
    if (currentTask && line.match(/^\s+Result:\s/)) {
      currentTask.result = line.replace(/^\s+Result:\s*/, '');
    } else if (currentTask && line.match(/^\s+\S/) && !line.match(/^\s+source:/)) {
      currentTask.description = (currentTask.description ? currentTask.description + ' ' : '') + line.trim();
    }
  }

  if (currentTask?.id) {
    goals.tasks.push(currentTask as GoalTask);
  }

  return goals;
}

// ── MCP Tools ──

export const goalsViewTool = tool(
  'goals_view',
  'View your goals - shows all tasks organized by status (proposed, approved, in_progress, done). Use this to see what needs to be done.',
  {
    status: z.enum(['all', 'proposed', 'approved', 'in_progress', 'done', 'rejected']).optional()
      .describe('Filter by status. Default: all active (excludes done/rejected)'),
  },
  async (args) => {
    const goals = loadGoals();
    const filter = args.status || 'all';

    let tasks = goals.tasks;
    if (filter === 'all') {
      tasks = tasks.filter(t => !['done', 'rejected'].includes(t.status));
    } else {
      tasks = tasks.filter(t => t.status === filter);
    }

    if (tasks.length === 0) {
      return { content: [{ type: 'text', text: filter === 'all' ? 'No active goals.' : `No goals with status: ${filter}` }] };
    }

    const formatted = tasks.map(t => {
      const tags = t.tags?.length ? ` [${t.tags.join(', ')}]` : '';
      const desc = t.description ? `\n  ${t.description}` : '';
      const result = t.result ? `\n  Result: ${t.result}` : '';
      return `#${t.id} [${t.status}] ${t.priority === 'medium' ? '' : `(${t.priority}) `}${t.title}${tags}${desc}${result}`;
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Goals (${tasks.length} tasks):\n\n${formatted}` }],
    };
  }
);

export const goalsAddTool = tool(
  'goals_add',
  'Add a goal. Agent-proposed goals start as "proposed" (need user approval). User-requested goals start as "approved".',
  {
    title: z.string().describe('Short goal title'),
    description: z.string().optional().describe('Detailed description of what needs to be done'),
    priority: z.enum(['high', 'medium', 'low']).optional().describe('Goal priority. Default: medium'),
    source: z.enum(['agent', 'user']).optional().describe('Who created this goal. Default: agent'),
    status: z.enum(['proposed', 'approved']).optional().describe('Initial status. Agent goals default to proposed, user goals to approved'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
  },
  async (args) => {
    const goals = loadGoals();
    const source = args.source || 'agent';
    const status = args.status || (source === 'user' ? 'approved' : 'proposed');
    const now = new Date().toISOString();

    const task: GoalTask = {
      id: nextId(goals),
      title: args.title,
      description: args.description,
      status,
      priority: args.priority || 'medium',
      source,
      createdAt: now,
      updatedAt: now,
      tags: args.tags,
    };

    goals.tasks.push(task);
    saveGoals(goals);

    return {
      content: [{ type: 'text', text: `Goal #${task.id} added: "${task.title}" [${task.status}]` }],
    };
  }
);

export const goalsUpdateTool = tool(
  'goals_update',
  'Update a goal. Use to change status, add results, or modify details.',
  {
    id: z.string().describe('Goal ID (number)'),
    status: z.enum(['proposed', 'approved', 'in_progress', 'done', 'rejected']).optional()
      .describe('New status'),
    result: z.string().optional().describe('Result or outcome of the goal'),
    title: z.string().optional().describe('Updated title'),
    description: z.string().optional().describe('Updated description'),
    priority: z.enum(['high', 'medium', 'low']).optional().describe('Updated priority'),
  },
  async (args) => {
    const goals = loadGoals();
    const task = goals.tasks.find(t => t.id === args.id);
    if (!task) {
      return { content: [{ type: 'text', text: `Goal #${args.id} not found` }], isError: true };
    }

    const now = new Date().toISOString();
    if (args.status) task.status = args.status;
    if (args.result) task.result = args.result;
    if (args.title) task.title = args.title;
    if (args.description) task.description = args.description;
    if (args.priority) task.priority = args.priority;
    task.updatedAt = now;

    if (args.status === 'done') {
      task.completedAt = now;
    }

    saveGoals(goals);

    return {
      content: [{ type: 'text', text: `Goal #${task.id} updated: "${task.title}" [${task.status}]${args.result ? ` - ${args.result}` : ''}` }],
    };
  }
);

export const goalsBatchProposeTool = tool(
  'goals_propose',
  'Propose multiple goals at once for user approval. Used during planning cycles to batch-propose work.',
  {
    tasks: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      tags: z.array(z.string()).optional(),
    })).describe('Array of goals to propose'),
  },
  async (args) => {
    const goals = loadGoals();
    const now = new Date().toISOString();
    const added: string[] = [];

    for (const t of args.tasks) {
      const task: GoalTask = {
        id: nextId(goals),
        title: t.title,
        description: t.description,
        status: 'proposed',
        priority: t.priority || 'medium',
        source: 'agent',
        createdAt: now,
        updatedAt: now,
        tags: t.tags,
      };
      goals.tasks.push(task);
      added.push(`#${task.id}: ${task.title}`);
    }

    goals.lastPlanAt = now;
    saveGoals(goals);

    return {
      content: [{ type: 'text', text: `Proposed ${added.length} goals:\n${added.join('\n')}` }],
    };
  }
);

export const goalsTools = [
  goalsViewTool,
  goalsAddTool,
  goalsUpdateTool,
  goalsBatchProposeTool,
];
