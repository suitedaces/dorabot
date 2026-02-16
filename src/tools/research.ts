import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getDb } from '../db.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const RESEARCH_DIR = join(homedir(), '.dorabot', 'research');

// ── Types ──

export type ResearchItem = {
  id: string;
  topic: string;
  title: string;
  filePath: string;
  status: 'active' | 'completed' | 'archived';
  sources?: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

export type Research = {
  items: ResearchItem[];
  version: number;
};

// ── File helpers ──

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildFrontmatter(item: ResearchItem): string {
  const lines = [
    '---',
    `title: "${item.title.replace(/"/g, '\\"')}"`,
    `topic: "${item.topic.replace(/"/g, '\\"')}"`,
    `status: ${item.status}`,
    `created: ${item.createdAt}`,
    `updated: ${item.updatedAt}`,
  ];
  if (item.tags?.length) lines.push(`tags: [${item.tags.join(', ')}]`);
  if (item.sources?.length) {
    lines.push('sources:');
    for (const src of item.sources) lines.push(`  - ${src}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function writeResearchFile(item: ResearchItem, content: string): string {
  const topicDir = join(RESEARCH_DIR, slugify(item.topic));
  mkdirSync(topicDir, { recursive: true });
  const filename = `${slugify(item.title)}.md`;
  const filePath = join(topicDir, filename);
  writeFileSync(filePath, buildFrontmatter(item) + content, 'utf-8');
  return filePath;
}

export function readResearchContent(filePath: string): string {
  if (!existsSync(filePath)) return '';
  const raw = readFileSync(filePath, 'utf-8');
  // strip yaml frontmatter
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : raw.trim();
}

// ── DB I/O ──

export function loadResearch(): Research {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM research_items').all() as { data: string }[];
  const items = rows.map(r => JSON.parse(r.data) as ResearchItem);

  const versionRow = db.prepare("SELECT value FROM research_meta WHERE key = 'version'").get() as { value: string } | undefined;

  return {
    items,
    version: versionRow ? parseInt(versionRow.value, 10) : 1,
  };
}

export function saveResearch(research: Research): void {
  const db = getDb();
  research.version = (research.version || 0) + 1;

  const run = db.transaction(() => {
    db.prepare('DELETE FROM research_items').run();
    const insert = db.prepare('INSERT INTO research_items (id, data) VALUES (?, ?)');
    for (const item of research.items) {
      insert.run(item.id, JSON.stringify(item));
    }
    db.prepare("INSERT OR REPLACE INTO research_meta (key, value) VALUES ('version', ?)").run(String(research.version));
  });
  run();
}

function nextId(research: Research): string {
  const ids = research.items.map(t => parseInt(t.id, 10)).filter(n => !isNaN(n));
  return String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
}

// ── MCP Tools ──

export const researchViewTool = tool(
  'research_view',
  'View your research items. Shows all research organized by status.',
  {
    status: z.enum(['all', 'active', 'completed', 'archived']).optional()
      .describe('Filter by status. Default: active'),
    topic: z.string().optional().describe('Filter by topic'),
    id: z.string().optional().describe('Read a specific research item by ID (returns full content)'),
  },
  async (args) => {
    const research = loadResearch();

    // single item read
    if (args.id) {
      const item = research.items.find(i => i.id === args.id);
      if (!item) return { content: [{ type: 'text', text: `Research #${args.id} not found` }], isError: true };
      const content = readResearchContent(item.filePath);
      const tags = item.tags?.length ? ` [${item.tags.join(', ')}]` : '';
      const sources = item.sources?.length ? `\nSources: ${item.sources.join(', ')}` : '';
      return {
        content: [{ type: 'text', text: `#${item.id} [${item.status}] ${item.topic}: ${item.title}${tags}\n\n${content}${sources}` }],
      };
    }

    const filter = args.status || 'active';
    let items = research.items;
    if (filter !== 'all') {
      items = items.filter(i => i.status === filter);
    }
    if (args.topic) {
      items = items.filter(i => i.topic.toLowerCase().includes(args.topic!.toLowerCase()));
    }

    if (items.length === 0) {
      return { content: [{ type: 'text', text: filter === 'active' ? 'No active research.' : `No research with status: ${filter}` }] };
    }

    const formatted = items.map(i => {
      const tags = i.tags?.length ? ` [${i.tags.join(', ')}]` : '';
      return `#${i.id} [${i.status}] ${i.topic}: ${i.title}${tags} (${i.filePath})`;
    }).join('\n');

    return {
      content: [{ type: 'text', text: `Research (${items.length} items):\n\n${formatted}` }],
    };
  }
);

export const researchAddTool = tool(
  'research_add',
  'Add a new research item. Writes a markdown file with YAML frontmatter and registers it in the database.',
  {
    topic: z.string().describe('Research topic/category (e.g. "AI agents", "crypto markets")'),
    title: z.string().describe('Short title for this research entry'),
    content: z.string().describe('Research content in markdown format'),
    sources: z.array(z.string()).optional().describe('URLs or references'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
  },
  async (args) => {
    const research = loadResearch();
    const now = new Date().toISOString();

    const item: ResearchItem = {
      id: nextId(research),
      topic: args.topic,
      title: args.title,
      filePath: '', // set after write
      status: 'active',
      sources: args.sources,
      tags: args.tags,
      createdAt: now,
      updatedAt: now,
    };

    item.filePath = writeResearchFile(item, args.content);
    research.items.push(item);
    saveResearch(research);

    return {
      content: [{ type: 'text', text: `Research #${item.id} added: "${item.title}" [${item.topic}]\nFile: ${item.filePath}` }],
    };
  }
);

export const researchUpdateTool = tool(
  'research_update',
  'Update an existing research item. Rewrites the markdown file and updates metadata.',
  {
    id: z.string().describe('Research item ID'),
    content: z.string().optional().describe('New content (replaces file content). Use research_view with id first to read current content.'),
    status: z.enum(['active', 'completed', 'archived']).optional().describe('New status'),
    title: z.string().optional().describe('Updated title'),
    sources: z.array(z.string()).optional().describe('Updated sources'),
    tags: z.array(z.string()).optional().describe('Updated tags'),
  },
  async (args) => {
    const research = loadResearch();
    const item = research.items.find(i => i.id === args.id);
    if (!item) {
      return { content: [{ type: 'text', text: `Research #${args.id} not found` }], isError: true };
    }

    if (args.status) item.status = args.status;
    if (args.title) item.title = args.title;
    if (args.sources) item.sources = args.sources;
    if (args.tags) item.tags = args.tags;
    item.updatedAt = new Date().toISOString();

    // rewrite file (use new content or preserve existing)
    const content = args.content ?? readResearchContent(item.filePath);
    const oldPath = item.filePath;
    item.filePath = writeResearchFile(item, content);
    // clean up old file if path changed (title rename)
    if (oldPath !== item.filePath && existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch {}
    }

    saveResearch(research);

    return {
      content: [{ type: 'text', text: `Research #${item.id} updated: "${item.title}" [${item.status}]` }],
    };
  }
);

export const researchTools = [
  researchViewTool,
  researchAddTool,
  researchUpdateTool,
];
