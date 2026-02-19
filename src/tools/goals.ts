import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getDb } from '../db.js';

export type GoalStatus = 'active' | 'paused' | 'done';

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

export type GoalsState = {
  goals: Goal[];
  version: number;
};

function parseGoalRow(raw: string): Goal {
  const goal = JSON.parse(raw) as Goal;
  return {
    ...goal,
    status: goal.status || 'active',
    tags: Array.isArray(goal.tags) ? goal.tags : [],
  };
}

function nextId(goals: Goal[]): string {
  const ids = goals.map(g => Number.parseInt(g.id, 10)).filter(n => Number.isFinite(n));
  return String((ids.length ? Math.max(...ids) : 0) + 1);
}

export function loadGoals(): GoalsState {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM goals').all() as { data: string }[];
  const goals = rows.map(row => parseGoalRow(row.data));
  const versionRow = db.prepare("SELECT value FROM goals_meta_v2 WHERE key = 'version'").get() as { value: string } | undefined;
  return {
    goals,
    version: versionRow ? Number.parseInt(versionRow.value, 10) : 1,
  };
}

export function saveGoals(state: GoalsState): void {
  const db = getDb();
  state.version = (state.version || 0) + 1;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM goals').run();
    const insert = db.prepare('INSERT INTO goals (id, data) VALUES (?, ?)');
    for (const goal of state.goals) insert.run(goal.id, JSON.stringify(goal));
    db.prepare("INSERT OR REPLACE INTO goals_meta_v2 (key, value) VALUES ('version', ?)").run(String(state.version));
  });
  tx();
}

function goalSummary(goal: Goal): string {
  const tags = goal.tags?.length ? ` [${goal.tags.join(', ')}]` : '';
  return `#${goal.id} [${goal.status}] ${goal.title}${tags}`;
}

export const goalsViewTool = tool(
  'goals_view',
  'View goals and their status.',
  {
    status: z.enum(['all', 'active', 'paused', 'done']).optional(),
    id: z.string().optional(),
  },
  async (args) => {
    const state = loadGoals();

    if (args.id) {
      const goal = state.goals.find(g => g.id === args.id);
      if (!goal) return { content: [{ type: 'text', text: `Goal #${args.id} not found` }], isError: true };
      const lines = [
        goalSummary(goal),
        goal.description ? `Description: ${goal.description}` : '',
        goal.reason ? `Reason: ${goal.reason}` : '',
        goal.tags?.length ? `Tags: ${goal.tags.join(', ')}` : '',
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    const status = args.status || 'all';
    const goals = status === 'all' ? state.goals : state.goals.filter(g => g.status === status);
    if (!goals.length) {
      return { content: [{ type: 'text', text: status === 'all' ? 'No goals.' : `No goals with status: ${status}` }] };
    }
    const lines = goals
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(goalSummary)
      .join('\n');
    return { content: [{ type: 'text', text: `Goals (${goals.length}):\n\n${lines}` }] };
  },
);

export const goalsAddTool = tool(
  'goals_add',
  'Create a goal.',
  {
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    const state = loadGoals();
    const now = new Date().toISOString();
    const goal: Goal = {
      id: nextId(state.goals),
      title: args.title,
      description: args.description,
      status: 'active',
      tags: args.tags || [],
      createdAt: now,
      updatedAt: now,
    };
    state.goals.push(goal);
    saveGoals(state);
    return { content: [{ type: 'text', text: `Goal #${goal.id} created: ${goal.title}` }] };
  },
);

export const goalsUpdateTool = tool(
  'goals_update',
  'Update goal fields.',
  {
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'paused', 'done']).optional(),
    tags: z.array(z.string()).optional(),
    reason: z.string().optional(),
  },
  async (args) => {
    const state = loadGoals();
    const goal = state.goals.find(g => g.id === args.id);
    if (!goal) return { content: [{ type: 'text', text: `Goal #${args.id} not found` }], isError: true };

    if (args.title !== undefined) goal.title = args.title;
    if (args.description !== undefined) goal.description = args.description;
    if (args.status !== undefined) goal.status = args.status;
    if (args.tags !== undefined) goal.tags = args.tags;
    if (args.reason !== undefined) goal.reason = args.reason;
    goal.updatedAt = new Date().toISOString();
    saveGoals(state);
    return { content: [{ type: 'text', text: `Goal #${goal.id} updated` }] };
  },
);

export const goalsDeleteTool = tool(
  'goals_delete',
  'Delete a goal.',
  {
    id: z.string(),
  },
  async (args) => {
    const state = loadGoals();
    const before = state.goals.length;
    state.goals = state.goals.filter(g => g.id !== args.id);
    if (state.goals.length === before) {
      return { content: [{ type: 'text', text: `Goal #${args.id} not found` }], isError: true };
    }
    saveGoals(state);
    return { content: [{ type: 'text', text: `Goal #${args.id} deleted` }] };
  },
);

export const goalsTools = [
  goalsViewTool,
  goalsAddTool,
  goalsUpdateTool,
  goalsDeleteTool,
];
