import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getDb } from '../db.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { RESEARCH_DIR } from '../workspace.js';

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

export function writeResearchFile(item: ResearchItem, content: string): string {
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

function wordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function timeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return isoDate.slice(0, 10);
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

export function nextId(research: Research): string {
  const ids = research.items.map(t => parseInt(t.id, 10)).filter(n => !isNaN(n));
  return String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
}

// ── MCP Tools ──

export const researchViewTool = tool(
  'research_view',
  `View and search research docs. Use this to find, browse, and read research items.

Common patterns:
- research_view({}) → list all active research (paginated)
- research_view({ id: "45" }) → read research doc #45 in full
- research_view({ query: "dagster race condition" }) → full-text search across all content
- research_view({ topic: "ledger" }) → filter by topic
- research_view({ status: "all" }) → show everything including completed/archived
- research_view({ query: "MCP", status: "all" }) → search across all statuses
- research_view({ page: 2 }) → next page of results`,
  {
    id: z.string().optional().describe('Read a specific research item by ID (returns full content)'),
    query: z.string().optional().describe('Full-text search across titles, topics, tags, and file content. Keywords joined with implicit AND. Ranked by relevance.'),
    status: z.enum(['all', 'active', 'completed', 'archived']).optional()
      .describe('Filter by status. Default: active'),
    topic: z.string().optional().describe('Filter by topic (substring match)'),
    page: z.number().optional().describe('Page number, 1-indexed (default 1)'),
    page_size: z.number().optional().describe('Results per page (default 10, max 25)'),
  },
  async (args) => {
    const research = loadResearch();

    // single item read
    if (args.id) {
      const item = research.items.find(i => i.id === args.id);
      if (!item) return { content: [{ type: 'text', text: `Research #${args.id} not found` }], isError: true };
      const content = readResearchContent(item.filePath);
      const tags = item.tags?.length ? `\nTags: ${item.tags.join(', ')}` : '';
      const sources = item.sources?.length ? `\nSources: ${item.sources.join(', ')}` : '';
      const words = wordCount(content);
      return {
        content: [{
          type: 'text',
          text: `# #${item.id}: ${item.title}\nTopic: ${item.topic} | Status: ${item.status} | ${words} words\nCreated: ${item.createdAt.slice(0, 10)} | Updated: ${timeAgo(item.updatedAt)}${tags}${sources}\nFile: ${item.filePath}\n\n${content}`,
        }],
      };
    }

    const filter = args.status || 'active';
    const pageSize = Math.min(args.page_size || 10, 25);
    const page = Math.max(args.page || 1, 1);
    let items = research.items;

    // Status filter
    if (filter !== 'all') {
      items = items.filter(i => i.status === filter);
    }

    // Topic filter
    if (args.topic) {
      items = items.filter(i => i.topic.toLowerCase().includes(args.topic!.toLowerCase()));
    }

    // Full-text search
    if (args.query) {
      const queryWords = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (queryWords.length > 0) {
        type ScoredItem = { item: ResearchItem; score: number; matchSnippet: string; cachedContent: string };
        const scored: ScoredItem[] = [];

        for (const item of items) {
          const titleLower = item.title.toLowerCase();
          const topicLower = item.topic.toLowerCase();
          const tagsLower = (item.tags || []).join(' ').toLowerCase();
          const metadata = `${titleLower} ${topicLower} ${tagsLower}`;

          let score = 0;
          let matchSnippet = '';

          // Score metadata matches (higher weight)
          for (const w of queryWords) {
            if (titleLower.includes(w)) score += 3;
            if (topicLower.includes(w)) score += 2;
            if (tagsLower.includes(w)) score += 2;
          }

          // Score content matches (cache the read for reuse in formatting)
          const content = readResearchContent(item.filePath);
          if (content) {
            const contentLower = content.toLowerCase();
            for (const w of queryWords) {
              if (contentLower.includes(w)) score += 1;
            }

            // Find best matching line for snippet
            if (score > 0 && !metadata.includes(queryWords[0])) {
              const lines = content.split('\n');
              let bestLine = '';
              let bestScore = 0;
              for (const line of lines) {
                const lineLower = line.toLowerCase();
                const lineScore = queryWords.filter(w => lineLower.includes(w)).length;
                if (lineScore > bestScore) {
                  bestScore = lineScore;
                  bestLine = line;
                }
              }
              if (bestLine) {
                matchSnippet = bestLine.length > 150 ? bestLine.slice(0, 150) + '...' : bestLine;
              }
            }
          }

          if (score > 0) {
            scored.push({ item, score, matchSnippet, cachedContent: content });
          }
        }

        scored.sort((a, b) => b.score - a.score);

        if (scored.length === 0) {
          return { content: [{ type: 'text', text: `No research found matching "${args.query}"${filter !== 'all' ? ` (status: ${filter})` : ''}` }] };
        }

        const totalResults = scored.length;
        const totalPages = Math.ceil(totalResults / pageSize);
        const offset = (page - 1) * pageSize;
        const pageSlice = scored.slice(offset, offset + pageSize);

        const formatted = pageSlice.map(({ item: i, matchSnippet, cachedContent }) => {
          const tags = i.tags?.length ? ` [${i.tags.join(', ')}]` : '';
          const words = wordCount(cachedContent);
          const updated = timeAgo(i.updatedAt);
          const created = i.createdAt.slice(0, 10);
          let line = `#${i.id} [${i.status}] **${i.title}** (${i.topic})${tags}\n  ${words} words | created ${created} | updated ${updated}`;
          if (matchSnippet) {
            line += `\n  > ${matchSnippet}`;
          }
          return line;
        }).join('\n\n');

        const pagination = totalPages > 1
          ? `\n\n--- Page ${page}/${totalPages} (${totalResults} total). ${page < totalPages ? `Use page:${page + 1} for more.` : 'End of results.'} ---`
          : '';

        return {
          content: [{ type: 'text', text: `Research matching "${args.query}" (${totalResults} results):\n\n${formatted}${pagination}` }],
        };
      }
    }

    if (items.length === 0) {
      return { content: [{ type: 'text', text: filter === 'active' ? 'No active research.' : `No research with status: ${filter}` }] };
    }

    // Sort by most recently updated
    items = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const totalResults = items.length;
    const totalPages = Math.ceil(totalResults / pageSize);
    const offset = (page - 1) * pageSize;
    const pageSlice = items.slice(offset, offset + pageSize);

    const formatted = pageSlice.map(i => {
      const tags = i.tags?.length ? ` [${i.tags.join(', ')}]` : '';
      const content = readResearchContent(i.filePath);
      const words = wordCount(content);
      const updated = timeAgo(i.updatedAt);
      const created = i.createdAt.slice(0, 10);
      const preview = content
        ? (content.split('\n').find(l => l.trim().length > 10 && !l.startsWith('#') && !l.startsWith('---')) || content.slice(0, 100))
        : '';
      const previewStr = preview ? `\n  ${preview.length > 120 ? preview.slice(0, 120) + '...' : preview}` : '';
      return `#${i.id} [${i.status}] **${i.title}** (${i.topic})${tags}\n  ${words} words | created ${created} | updated ${updated}${previewStr}`;
    }).join('\n\n');

    const pagination = totalPages > 1
      ? `\n\n--- Page ${page}/${totalPages} (${totalResults} total). ${page < totalPages ? `Use page:${page + 1} for more.` : 'End of results.'} ---`
      : '';

    return {
      content: [{ type: 'text', text: `Research (${totalResults} items):\n\n${formatted}${pagination}` }],
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
  `Update an existing research item. Can replace content, append to it, or just update metadata.

Common patterns:
- research_update({ id: "45", content: "..." }) → replace all content
- research_update({ id: "45", append: "## New Section\\n..." }) → add to end of doc
- research_update({ id: "45", status: "completed" }) → mark as done
- research_update({ id: "45", tags: ["ledger", "ramp"] }) → update tags
- research_update({ id: "45", sources: ["https://..."] }) → add sources (replaces existing list)`,
  {
    id: z.string().describe('Research item ID'),
    content: z.string().optional().describe('New content (replaces entire file content). Use research_view with id first to read current content.'),
    append: z.string().optional().describe('Content to append to the end of the existing doc. Easier than read + replace for adding new sections.'),
    status: z.enum(['active', 'completed', 'archived']).optional().describe('New status'),
    title: z.string().optional().describe('Updated title'),
    sources: z.array(z.string()).optional().describe('Updated sources (replaces entire list)'),
    tags: z.array(z.string()).optional().describe('Updated tags (replaces entire list)'),
  },
  async (args) => {
    const research = loadResearch();
    const item = research.items.find(i => i.id === args.id);
    if (!item) {
      return { content: [{ type: 'text', text: `Research #${args.id} not found` }], isError: true };
    }

    if (args.content && args.append) {
      return { content: [{ type: 'text', text: 'Cannot use both content (replace) and append in the same call. Pick one.' }], isError: true };
    }

    if (args.status) item.status = args.status;
    if (args.title) item.title = args.title;
    if (args.sources) item.sources = args.sources;
    if (args.tags) item.tags = args.tags;
    item.updatedAt = new Date().toISOString();

    // Determine final content
    let finalContent: string;
    if (args.content !== undefined) {
      finalContent = args.content;
    } else if (args.append) {
      const existing = readResearchContent(item.filePath);
      finalContent = existing ? `${existing}\n\n${args.append}` : args.append;
    } else {
      finalContent = readResearchContent(item.filePath);
    }

    const oldPath = item.filePath;
    item.filePath = writeResearchFile(item, finalContent);
    // clean up old file if path changed (title rename)
    if (oldPath !== item.filePath && existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch {}
    }

    saveResearch(research);

    const words = wordCount(finalContent);
    return {
      content: [{ type: 'text', text: `Research #${item.id} updated: "${item.title}" [${item.status}] (${words} words)` }],
    };
  }
);

export const researchDeleteTool = tool(
  'research_delete',
  'Permanently delete a research item and its markdown file. Use research_update with status:"archived" to keep the content but hide it from default views.',
  {
    id: z.string().describe('Research item ID to delete'),
  },
  async (args) => {
    const research = loadResearch();
    const idx = research.items.findIndex(i => i.id === args.id);
    if (idx === -1) {
      return { content: [{ type: 'text', text: `Research #${args.id} not found` }], isError: true };
    }

    const item = research.items[idx];
    const title = item.title;

    // Remove file
    if (existsSync(item.filePath)) {
      try { unlinkSync(item.filePath); } catch {}
    }

    // Remove from list
    research.items.splice(idx, 1);
    saveResearch(research);

    return {
      content: [{ type: 'text', text: `Research #${args.id} deleted: "${title}"` }],
    };
  }
);

export const researchTools = [
  researchViewTool,
  researchAddTool,
  researchUpdateTool,
  researchDeleteTool,
];
