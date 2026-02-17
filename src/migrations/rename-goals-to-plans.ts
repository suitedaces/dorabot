import { getDb } from '../db.js';
import {
  ensurePlanDoc,
  getPlanDocPath,
  type Plan,
  type PlanRunState,
  type PlanStatus,
  type PlanType,
} from '../tools/plans.js';

const MIGRATION_KEY = 'migration_goals_to_plans_v1';
const LEGACY_REJECTED_ERROR = 'Migrated legacy rejected goal';

type LegacyGoal = {
  id: string;
  title: string;
  description?: string;
  status: 'proposed' | 'approved' | 'in_progress' | 'done' | 'rejected';
  priority?: 'high' | 'medium' | 'low';
  source?: 'agent' | 'user';
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  result?: string;
  tags?: string[];
};

function mapPlanType(goal: LegacyGoal): PlanType {
  const text = `${goal.title} ${goal.description || ''} ${goal.tags?.join(' ') || ''}`.toLowerCase();
  if (text.includes('bug') || text.includes('fix') || text.includes('error')) return 'bug';
  if (text.includes('cleanup') || text.includes('refactor') || text.includes('maintenance')) return 'chore';
  return 'feature';
}

function mapStatus(status: LegacyGoal['status']): { status: PlanStatus; runState: PlanRunState; error?: string } {
  switch (status) {
    case 'in_progress':
      return { status: 'in_progress', runState: 'idle' };
    case 'done':
      return { status: 'done', runState: 'idle' };
    case 'rejected':
      return { status: 'plan', runState: 'failed', error: LEGACY_REJECTED_ERROR };
    case 'approved':
    case 'proposed':
    default:
      return { status: 'plan', runState: 'idle' };
  }
}

function mapLegacyGoal(goal: LegacyGoal): Plan {
  const now = new Date().toISOString();
  const mapped = mapStatus(goal.status);
  const plan: Plan = {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    type: mapPlanType(goal),
    status: mapped.status,
    runState: mapped.runState,
    error: mapped.error,
    result: goal.result,
    planDocPath: getPlanDocPath(goal.id),
    roadmapItemId: undefined,
    sessionKey: undefined,
    worktreePath: undefined,
    branch: undefined,
    createdAt: goal.createdAt || now,
    updatedAt: goal.updatedAt || now,
    completedAt: mapped.status === 'done' ? (goal.completedAt || goal.updatedAt || now) : undefined,
    source: goal.source || 'agent',
    tags: goal.tags,
  };
  plan.planDocPath = ensurePlanDoc(plan);
  return plan;
}

function tableExists(name: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', name) as { name?: string } | undefined;
  return row?.name === name;
}

export function runGoalsToPlansMigration(): void {
  const db = getDb();
  const already = db.prepare('SELECT value FROM plans_meta WHERE key = ?').get(MIGRATION_KEY) as { value?: string } | undefined;
  if (already?.value === 'done') return;

  const hasLegacyTables = tableExists('goals_tasks') && tableExists('goals_meta');
  if (!hasLegacyTables) {
    db.prepare('INSERT OR REPLACE INTO plans_meta (key, value) VALUES (?, ?)').run(MIGRATION_KEY, 'done');
    return;
  }

  const existingPlans = db.prepare('SELECT COUNT(*) AS count FROM plans_tasks').get() as { count: number };
  const legacyRows = db.prepare('SELECT id, data FROM goals_tasks').all() as Array<{ id: string; data: string }>;
  const legacyMeta = db.prepare('SELECT key, value FROM goals_meta').all() as Array<{ key: string; value: string | null }>;

  const tx = db.transaction(() => {
    if (existingPlans.count === 0 && legacyRows.length > 0) {
      const insert = db.prepare('INSERT INTO plans_tasks (id, data) VALUES (?, ?)');
      for (const row of legacyRows) {
        try {
          const goal = JSON.parse(row.data) as LegacyGoal;
          const plan = mapLegacyGoal(goal);
          insert.run(plan.id, JSON.stringify(plan));
        } catch (err) {
          console.warn('[migration] skipping invalid goal row', row.id, err);
        }
      }
    }

    for (const row of legacyMeta) {
      if (!row.key || row.value == null) continue;
      if (row.key === MIGRATION_KEY) continue;
      db.prepare('INSERT OR IGNORE INTO plans_meta (key, value) VALUES (?, ?)').run(row.key, row.value);
    }

    db.prepare('INSERT OR REPLACE INTO plans_meta (key, value) VALUES (?, ?)').run(MIGRATION_KEY, 'done');
  });

  tx();
}

