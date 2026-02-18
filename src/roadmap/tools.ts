import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getDb } from '../db.js';
import {
  createPlanFromRoadmapItem,
  type Plan,
  type PlanType,
} from '../tools/plans.js';

export type RoadmapLane = 'now' | 'next' | 'later' | 'done';

export type RoadmapItem = {
  id: string;
  title: string;
  description?: string;
  lane: RoadmapLane;
  impact?: string;
  effort?: string;
  problem?: string;
  outcome?: string;
  audience?: string;
  risks?: string;
  notes?: string;
  tags?: string[];
  linkedPlanIds: string[];
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
};

export type RoadmapState = {
  items: RoadmapItem[];
  version: number;
};

function parseRoadmapRow(raw: string): RoadmapItem {
  const item = JSON.parse(raw) as RoadmapItem;
  return {
    ...item,
    linkedPlanIds: Array.isArray(item.linkedPlanIds) ? item.linkedPlanIds : [],
    lane: item.lane || 'next',
    sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : 0,
  };
}

function nextId(items: RoadmapItem[]): string {
  const ids = items
    .map((i) => Number.parseInt(i.id, 10))
    .filter((n) => Number.isFinite(n));
  return String((ids.length ? Math.max(...ids) : 0) + 1);
}

function nextSortOrder(items: RoadmapItem[], lane: RoadmapLane): number {
  const laneItems = items.filter((item) => item.lane === lane);
  if (!laneItems.length) return 1;
  return Math.max(...laneItems.map((item) => item.sortOrder || 0)) + 1;
}

export function loadRoadmap(): RoadmapState {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM roadmap_items').all() as { data: string }[];
  const items = rows.map((row) => parseRoadmapRow(row.data));
  const versionRow = db.prepare("SELECT value FROM roadmap_meta WHERE key = 'version'").get() as { value: string } | undefined;
  return {
    items,
    version: versionRow ? Number.parseInt(versionRow.value, 10) : 1,
  };
}

export function saveRoadmap(state: RoadmapState): void {
  const db = getDb();
  state.version = (state.version || 0) + 1;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM roadmap_items').run();
    const insert = db.prepare('INSERT INTO roadmap_items (id, data) VALUES (?, ?)');
    for (const item of state.items) {
      insert.run(item.id, JSON.stringify(item));
    }
    db.prepare("INSERT OR REPLACE INTO roadmap_meta (key, value) VALUES ('version', ?)").run(String(state.version));
  });

  tx();
}

function ideaSummary(item: RoadmapItem): string {
  const outcome = item.outcome ? ` -> ${item.outcome}` : '';
  return `#${item.id} [${item.lane}] ${item.title}${outcome}`;
}

export const ideasViewTool = tool(
  'ideas_view',
  'View ideas organized by lane (now/next/later/done).',
  {
    lane: z.enum(['all', 'now', 'next', 'later', 'done']).optional(),
    id: z.string().optional(),
  },
  async (args) => {
    const roadmap = loadRoadmap();

    if (args.id) {
      const item = roadmap.items.find((r) => r.id === args.id);
      if (!item) {
        return { content: [{ type: 'text', text: `Idea #${args.id} not found` }], isError: true };
      }

      const lines = [
        ideaSummary(item),
        item.description ? `Description: ${item.description}` : '',
        item.problem ? `Problem: ${item.problem}` : '',
        item.outcome ? `Outcome: ${item.outcome}` : '',
        item.audience ? `Audience: ${item.audience}` : '',
        item.impact ? `Impact: ${item.impact}` : '',
        item.effort ? `Effort: ${item.effort}` : '',
        item.tags?.length ? `Tags: ${item.tags.join(', ')}` : '',
        item.linkedPlanIds.length ? `Linked plans: ${item.linkedPlanIds.join(', ')}` : 'Linked plans: none',
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    const lane = args.lane || 'all';
    const items = lane === 'all'
      ? roadmap.items
      : roadmap.items.filter((item) => item.lane === lane);

    if (!items.length) {
      return { content: [{ type: 'text', text: lane === 'all' ? 'No ideas.' : `No ideas in lane: ${lane}` }] };
    }

    const sorted = [...items].sort((a, b) => {
      if (a.lane !== b.lane) return a.lane.localeCompare(b.lane);
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });

    const lines = sorted.map((item) => ideaSummary(item));
    return { content: [{ type: 'text', text: `Ideas (${lines.length}):\n\n${lines.join('\n')}` }] };
  },
);

export const ideasAddTool = tool(
  'ideas_add',
  'Add an idea to the ideas board.',
  {
    title: z.string(),
    description: z.string().optional(),
    lane: z.enum(['now', 'next', 'later']).optional(),
    impact: z.string().optional(),
    effort: z.string().optional(),
    problem: z.string().optional(),
    outcome: z.string().optional(),
    audience: z.string().optional(),
    risks: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    const roadmap = loadRoadmap();
    const now = new Date().toISOString();
    const lane = args.lane || 'next';

    const item: RoadmapItem = {
      id: nextId(roadmap.items),
      title: args.title,
      description: args.description,
      lane,
      impact: args.impact,
      effort: args.effort,
      problem: args.problem,
      outcome: args.outcome,
      audience: args.audience,
      risks: args.risks,
      notes: args.notes,
      tags: args.tags,
      linkedPlanIds: [],
      createdAt: now,
      updatedAt: now,
      sortOrder: nextSortOrder(roadmap.items, lane),
    };

    roadmap.items.push(item);
    saveRoadmap(roadmap);
    return { content: [{ type: 'text', text: `Idea #${item.id} added to ${item.lane}: ${item.title}` }] };
  },
);

export const ideasUpdateTool = tool(
  'ideas_update',
  'Update an idea\'s fields and lane position.',
  {
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    lane: z.enum(['now', 'next', 'later', 'done']).optional(),
    impact: z.string().optional(),
    effort: z.string().optional(),
    problem: z.string().optional(),
    outcome: z.string().optional(),
    audience: z.string().optional(),
    risks: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sortOrder: z.number().optional(),
    linkedPlanIds: z.array(z.string()).optional(),
  },
  async (args) => {
    const roadmap = loadRoadmap();
    const item = roadmap.items.find((r) => r.id === args.id);
    if (!item) {
      return { content: [{ type: 'text', text: `Idea #${args.id} not found` }], isError: true };
    }

    if (args.title !== undefined) item.title = args.title;
    if (args.description !== undefined) item.description = args.description;
    if (args.impact !== undefined) item.impact = args.impact;
    if (args.effort !== undefined) item.effort = args.effort;
    if (args.problem !== undefined) item.problem = args.problem;
    if (args.outcome !== undefined) item.outcome = args.outcome;
    if (args.audience !== undefined) item.audience = args.audience;
    if (args.risks !== undefined) item.risks = args.risks;
    if (args.notes !== undefined) item.notes = args.notes;
    if (args.tags !== undefined) item.tags = args.tags;
    if (args.linkedPlanIds !== undefined) item.linkedPlanIds = args.linkedPlanIds;
    if (args.lane !== undefined && args.lane !== item.lane) {
      item.lane = args.lane;
      item.sortOrder = nextSortOrder(roadmap.items.filter((r) => r.id !== item.id), item.lane);
    }
    if (args.sortOrder !== undefined) item.sortOrder = args.sortOrder;
    item.updatedAt = new Date().toISOString();
    saveRoadmap(roadmap);

    return { content: [{ type: 'text', text: `Idea #${item.id} updated` }] };
  },
);

export const ideasDeleteTool = tool(
  'ideas_delete',
  'Delete an idea from the board.',
  {
    id: z.string(),
  },
  async (args) => {
    const roadmap = loadRoadmap();
    const before = roadmap.items.length;
    roadmap.items = roadmap.items.filter((i) => i.id !== args.id);
    if (roadmap.items.length === before) {
      return { content: [{ type: 'text', text: `Idea #${args.id} not found` }], isError: true };
    }
    saveRoadmap(roadmap);
    return { content: [{ type: 'text', text: `Idea #${args.id} deleted` }] };
  },
);

export const ideasCreatePlanTool = tool(
  'ideas_create_plan',
  'Create a plan from an idea and link it back.',
  {
    ideaId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    type: z.enum(['feature', 'bug', 'chore']).optional(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    const roadmap = loadRoadmap();
    const item = roadmap.items.find((r) => r.id === args.ideaId);
    if (!item) {
      return { content: [{ type: 'text', text: `Idea #${args.ideaId} not found` }], isError: true };
    }

    const plan = createPlanFromRoadmapItem({
      roadmapItemId: item.id,
      title: args.title || item.title,
      description: args.description || item.description || item.outcome || item.problem,
      type: args.type || inferPlanType(item),
      tags: args.tags || item.tags,
    });

    if (!item.linkedPlanIds.includes(plan.id)) {
      item.linkedPlanIds.push(plan.id);
      item.updatedAt = new Date().toISOString();
      saveRoadmap(roadmap);
    }

    return { content: [{ type: 'text', text: `Created Plan #${plan.id} from Idea #${item.id}` }] };
  },
);

function inferPlanType(item: RoadmapItem): PlanType {
  const text = `${item.title} ${item.problem || ''} ${item.outcome || ''}`.toLowerCase();
  if (text.includes('bug') || text.includes('fix') || text.includes('error')) return 'bug';
  if (text.includes('cleanup') || text.includes('refactor') || text.includes('maintenance')) return 'chore';
  return 'feature';
}

// keep old names as aliases for backward compat with gateway RPCs
export const roadmapViewTool = ideasViewTool;
export const roadmapAddTool = ideasAddTool;
export const roadmapUpdateTool = ideasUpdateTool;
export const roadmapCreatePlanTool = ideasCreatePlanTool;

export const roadmapTools = [
  ideasViewTool,
  ideasAddTool,
  ideasUpdateTool,
  ideasDeleteTool,
  ideasCreatePlanTool,
];

export type RoadmapCreatePlanResult = {
  roadmapItem: RoadmapItem;
  plan: Plan;
};
