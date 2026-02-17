import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getDb } from '../db.js';
import { PLANS_DIR } from '../workspace.js';

export type PlanStatus = 'plan' | 'in_progress' | 'done';
export type PlanType = 'feature' | 'bug' | 'chore';
export type PlanRunState = 'idle' | 'running' | 'failed';

export type Plan = {
  id: string;
  title: string;
  description?: string;
  type: PlanType;
  status: PlanStatus;
  runState: PlanRunState;
  error?: string;
  result?: string;
  planDocPath: string;
  roadmapItemId?: string;
  sessionKey?: string;
  worktreePath?: string;
  branch?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  source: 'agent' | 'user' | 'roadmap';
  tags?: string[];
};

export type PlansState = {
  tasks: Plan[];
  version: number;
};

const PLAN_DOC_FILENAME = 'plan.md';

function parsePlanRow(raw: string): Plan {
  const plan = JSON.parse(raw) as Plan;
  return {
    ...plan,
    runState: plan.runState || 'idle',
    type: plan.type || 'chore',
    status: plan.status || 'plan',
    source: plan.source || 'roadmap',
    planDocPath: plan.planDocPath || getPlanDocPath(plan.id),
  };
}

function nextId(plans: Plan[]): string {
  const ids = plans
    .map((p) => Number.parseInt(p.id, 10))
    .filter((n) => Number.isFinite(n));
  return String((ids.length ? Math.max(...ids) : 0) + 1);
}

export function getPlanDir(planId: string): string {
  return join(PLANS_DIR, planId);
}

export function getPlanDocPath(planId: string): string {
  return join(getPlanDir(planId), PLAN_DOC_FILENAME);
}

function buildPlanDoc(plan: Plan): string {
  const lines = [
    `# Plan ${plan.id}: ${plan.title}`,
    '',
    `Status: ${plan.status}`,
    `Type: ${plan.type}`,
    plan.roadmapItemId ? `Roadmap Item: ${plan.roadmapItemId}` : '',
    '',
    '## Objective',
    plan.description?.trim() || 'Define the concrete objective for this plan.',
    '',
    '## Execution Notes',
    '- Add implementation details and milestones during execution.',
    '',
    '## Success Criteria',
    '- Explicitly define what "done" means.',
    '',
  ].filter(Boolean);

  return lines.join('\n');
}

export function ensurePlanDoc(plan: Plan, initialContent?: string): string {
  const planDir = getPlanDir(plan.id);
  const planDocPath = plan.planDocPath || getPlanDocPath(plan.id);
  mkdirSync(planDir, { recursive: true });
  if (!existsSync(planDocPath)) {
    writeFileSync(planDocPath, initialContent || buildPlanDoc(plan), 'utf-8');
  }
  return planDocPath;
}

export function readPlanDoc(plan: Plan): string {
  const path = plan.planDocPath || getPlanDocPath(plan.id);
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

export function loadPlans(): PlansState {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM plans_tasks').all() as { data: string }[];
  const tasks = rows.map((row) => parsePlanRow(row.data));
  const versionRow = db.prepare("SELECT value FROM plans_meta WHERE key = 'version'").get() as { value: string } | undefined;

  return {
    tasks,
    version: versionRow ? Number.parseInt(versionRow.value, 10) : 1,
  };
}

export function savePlans(state: PlansState): void {
  const db = getDb();
  state.version = (state.version || 0) + 1;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM plans_tasks').run();
    const insert = db.prepare('INSERT INTO plans_tasks (id, data) VALUES (?, ?)');
    for (const task of state.tasks) {
      insert.run(task.id, JSON.stringify(task));
    }
    db.prepare("INSERT OR REPLACE INTO plans_meta (key, value) VALUES ('version', ?)").run(String(state.version));
  });

  tx();
}

export function findPlan(planId: string): Plan | undefined {
  const plans = loadPlans();
  return plans.tasks.find((p) => p.id === planId);
}

export function appendPlanLog(planId: string, eventType: string, message: string, data?: unknown): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO plans_logs (plan_id, event_type, message, data) VALUES (?, ?, ?, ?)',
  ).run(planId, eventType, message, data ? JSON.stringify(data) : null);
}

export function readPlanLogs(planId: string, limit = 50): Array<{
  id: number;
  planId: string;
  eventType: string;
  message: string;
  data?: unknown;
  createdAt: string;
}> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, plan_id, event_type, message, data, created_at
    FROM plans_logs
    WHERE plan_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(planId, limit) as Array<{
    id: number;
    plan_id: string;
    event_type: string;
    message: string;
    data: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    planId: row.plan_id,
    eventType: row.event_type,
    message: row.message,
    data: row.data ? JSON.parse(row.data) : undefined,
    createdAt: row.created_at,
  }));
}

type UpsertPlanInput = {
  id?: string;
  title: string;
  description?: string;
  type?: PlanType;
  status?: PlanStatus;
  runState?: PlanRunState;
  roadmapItemId?: string;
  source?: Plan['source'];
  tags?: string[];
};

function upsertPlan(args: UpsertPlanInput): Plan {
  const state = loadPlans();
  const now = new Date().toISOString();
  let plan = args.id ? state.tasks.find((t) => t.id === args.id) : undefined;

  if (!plan) {
    plan = {
      id: nextId(state.tasks),
      title: args.title,
      description: args.description,
      type: args.type || 'chore',
      status: args.status || 'plan',
      runState: args.runState || 'idle',
      planDocPath: '',
      roadmapItemId: args.roadmapItemId,
      createdAt: now,
      updatedAt: now,
      source: args.source || 'roadmap',
      tags: args.tags,
    };
    plan.planDocPath = getPlanDocPath(plan.id);
    state.tasks.push(plan);
  } else {
    plan.title = args.title;
    plan.description = args.description;
    plan.type = args.type || plan.type;
    plan.status = args.status || plan.status;
    plan.runState = args.runState || plan.runState;
    plan.roadmapItemId = args.roadmapItemId ?? plan.roadmapItemId;
    plan.tags = args.tags ?? plan.tags;
    plan.updatedAt = now;
  }

  ensurePlanDoc(plan);
  savePlans(state);
  return plan;
}

export function createPlan(input: Omit<UpsertPlanInput, 'id'>): Plan {
  return upsertPlan(input);
}

export function createPlanFromRoadmapItem(input: {
  roadmapItemId: string;
  title: string;
  description?: string;
  type: PlanType;
  tags?: string[];
}): Plan {
  return upsertPlan({
    title: input.title,
    description: input.description,
    type: input.type,
    status: 'plan',
    runState: 'idle',
    roadmapItemId: input.roadmapItemId,
    source: 'roadmap',
    tags: input.tags,
  });
}

export const planViewTool = tool(
  'plan_view',
  'View plans and their execution status. Use this to inspect what is queued, running, or done.',
  {
    status: z.enum(['all', 'plan', 'in_progress', 'done']).optional(),
    id: z.string().optional(),
    includeLogs: z.boolean().optional(),
  },
  async (args) => {
    const plans = loadPlans();
    if (args.id) {
      const plan = plans.tasks.find((t) => t.id === args.id);
      if (!plan) {
        return { content: [{ type: 'text', text: `Plan #${args.id} not found` }], isError: true };
      }

      const content = readPlanDoc(plan);
      const logs = args.includeLogs ? readPlanLogs(plan.id, 20) : [];
      const lines = [
        `#${plan.id} [${plan.status}] (${plan.type}) ${plan.title}`,
        `Run state: ${plan.runState}`,
        plan.error ? `Error: ${plan.error}` : '',
        plan.result ? `Result: ${plan.result}` : '',
        plan.roadmapItemId ? `Roadmap item: ${plan.roadmapItemId}` : '',
        '',
        content ? `Plan Doc:\n${content}` : '',
      ].filter(Boolean);

      if (logs.length) {
        lines.push('', 'Recent Logs:');
        for (const log of logs.reverse()) {
          lines.push(`- [${log.createdAt}] ${log.eventType}: ${log.message}`);
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    const status = args.status || 'all';
    const filtered = status === 'all' ? plans.tasks : plans.tasks.filter((t) => t.status === status);
    if (filtered.length === 0) {
      return { content: [{ type: 'text', text: status === 'all' ? 'No plans found.' : `No plans with status: ${status}` }] };
    }

    const list = filtered
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((plan) => {
        const tags = plan.tags?.length ? ` [${plan.tags.join(', ')}]` : '';
        return `#${plan.id} [${plan.status}/${plan.runState}] (${plan.type}) ${plan.title}${tags}`;
      })
      .join('\n');

    return { content: [{ type: 'text', text: `Plans (${filtered.length}):\n\n${list}` }] };
  },
);

export const planAddTool = tool(
  'plan_add',
  'Create a new plan. Plans should usually be created from roadmap items.',
  {
    title: z.string(),
    description: z.string().optional(),
    type: z.enum(['feature', 'bug', 'chore']).optional(),
    roadmapItemId: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    const plan = upsertPlan({
      title: args.title,
      description: args.description,
      type: args.type,
      roadmapItemId: args.roadmapItemId,
      source: args.roadmapItemId ? 'roadmap' : 'agent',
      tags: args.tags,
    });
    appendPlanLog(plan.id, 'plan_add', `Plan created: ${plan.title}`, { title: plan.title });

    return { content: [{ type: 'text', text: `Plan #${plan.id} created: ${plan.title}` }] };
  },
);

export const planUpdateTool = tool(
  'plan_update',
  'Update plan metadata or execution progress while working.',
  {
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    type: z.enum(['feature', 'bug', 'chore']).optional(),
    status: z.enum(['plan', 'in_progress', 'done']).optional(),
    runState: z.enum(['idle', 'running', 'failed']).optional(),
    error: z.string().optional(),
    result: z.string().optional(),
    sessionKey: z.string().optional(),
    worktreePath: z.string().optional(),
    branch: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    const state = loadPlans();
    const plan = state.tasks.find((p) => p.id === args.id);
    if (!plan) {
      return { content: [{ type: 'text', text: `Plan #${args.id} not found` }], isError: true };
    }

    if (args.title !== undefined) plan.title = args.title;
    if (args.description !== undefined) plan.description = args.description;
    if (args.type !== undefined) plan.type = args.type;
    if (args.status !== undefined) plan.status = args.status;
    if (args.runState !== undefined) plan.runState = args.runState;
    if (args.error !== undefined) plan.error = args.error;
    if (args.result !== undefined) plan.result = args.result;
    if (args.sessionKey !== undefined) plan.sessionKey = args.sessionKey;
    if (args.worktreePath !== undefined) plan.worktreePath = args.worktreePath;
    if (args.branch !== undefined) plan.branch = args.branch;
    if (args.tags !== undefined) plan.tags = args.tags;
    plan.updatedAt = new Date().toISOString();
    if (plan.status === 'done' && !plan.completedAt) plan.completedAt = plan.updatedAt;
    if (plan.status !== 'done') plan.completedAt = undefined;
    ensurePlanDoc(plan);
    savePlans(state);

    appendPlanLog(plan.id, 'plan_update', `Plan updated: ${plan.title}`, {
      status: plan.status,
      runState: plan.runState,
      hasError: Boolean(plan.error),
    });

    return { content: [{ type: 'text', text: `Plan #${plan.id} updated` }] };
  },
);

export const planStartTool = tool(
  'plan_start',
  'Mark a plan as in_progress/running before execution starts.',
  {
    id: z.string(),
    sessionKey: z.string().optional(),
  },
  async (args) => {
    const state = loadPlans();
    const plan = state.tasks.find((p) => p.id === args.id);
    if (!plan) {
      return { content: [{ type: 'text', text: `Plan #${args.id} not found` }], isError: true };
    }

    const now = new Date().toISOString();
    plan.status = 'in_progress';
    plan.runState = 'running';
    plan.error = undefined;
    if (args.sessionKey) plan.sessionKey = args.sessionKey;
    plan.updatedAt = now;
    savePlans(state);
    appendPlanLog(plan.id, 'plan_start', `Plan started: ${plan.title}`, { sessionKey: plan.sessionKey });

    return { content: [{ type: 'text', text: `Plan #${plan.id} started` }] };
  },
);

export const plansTools = [
  planViewTool,
  planAddTool,
  planUpdateTool,
  planStartTool,
];
