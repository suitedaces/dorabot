import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getDb, extractMessageText } from '../db.js';
import { AUTONOMOUS_SCHEDULE_ID } from '../autonomous.js';
import { MEMORIES_DIR } from '../workspace.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Types & constants ──

const MEMORY_ORIGINS = [
  'pulse',
  'scheduled_task',
  'desktop_user',
  'telegram_user',
  'whatsapp_user',
  'user_initiated',
] as const;

type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

const MEMORY_SOURCES = ['all', 'sessions', 'journals'] as const;

// ── Helpers ──

function classifySessionOrigin(channel?: string | null, chatId?: string | null): MemoryOrigin | 'other' {
  if (channel === 'calendar') {
    return (chatId || '').startsWith(AUTONOMOUS_SCHEDULE_ID) ? 'pulse' : 'scheduled_task';
  }
  if (channel === 'desktop') return 'desktop_user';
  if (channel === 'telegram') return 'telegram_user';
  if (channel === 'whatsapp') return 'whatsapp_user';
  return 'other';
}

function originFilterSql(origin: MemoryOrigin): { clause: string; params: unknown[] } {
  switch (origin) {
    case 'pulse':
      return { clause: '(s.channel = ? AND s.chat_id LIKE ?)', params: ['calendar', `${AUTONOMOUS_SCHEDULE_ID}%`] };
    case 'scheduled_task':
      return { clause: '(s.channel = ? AND (s.chat_id IS NULL OR s.chat_id NOT LIKE ?))', params: ['calendar', `${AUTONOMOUS_SCHEDULE_ID}%`] };
    case 'desktop_user':
      return { clause: 's.channel = ?', params: ['desktop'] };
    case 'telegram_user':
      return { clause: 's.channel = ?', params: ['telegram'] };
    case 'whatsapp_user':
      return { clause: 's.channel = ?', params: ['whatsapp'] };
    case 'user_initiated':
      return { clause: "s.channel IN ('desktop','telegram','whatsapp')", params: [] };
  }
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

/** Resolve relative date strings like "today", "yesterday", "7d", "30d" to ISO date */
function resolveDate(input: string, timezone?: string): string {
  const lower = input.toLowerCase().trim();
  const now = new Date();

  const formatDate = (d: Date) => {
    if (timezone) {
      return d.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
    }
    return d.toISOString().slice(0, 10);
  };

  if (lower === 'today') return formatDate(now);
  if (lower === 'yesterday') {
    now.setDate(now.getDate() - 1);
    return formatDate(now);
  }
  // "7d", "30d", "14d" etc
  const daysMatch = lower.match(/^(\d+)d$/);
  if (daysMatch) {
    now.setDate(now.getDate() - parseInt(daysMatch[1], 10));
    return formatDate(now);
  }

  // already a date string, return as-is
  return input;
}

/** Extract only human-readable text (no tool calls) from a message content blob */
function extractConversationText(content: string): string | null {
  try {
    const parsed = JSON.parse(content);
    const blocks = parsed?.message?.content;
    if (!Array.isArray(blocks)) return null;

    const texts: string[] = [];
    for (const block of blocks) {
      if (typeof block === 'string') {
        texts.push(block);
      } else if (block?.type === 'text' && block.text) {
        texts.push(block.text);
      }
      // Skip tool_use, tool_result blocks entirely
    }
    const result = texts.join('\n').trim();
    return result || null;
  } catch {
    return null;
  }
}

/** Get the first user message text from a session (for title fallback) */
function getSessionFirstMessage(db: any, sessionId: string): string | null {
  const row = db.prepare(
    `SELECT content FROM messages WHERE session_id = ? AND type = 'user' ORDER BY id LIMIT 1`
  ).get(sessionId) as { content: string } | undefined;
  if (!row) return null;
  const text = extractConversationText(row.content);
  if (!text) return null;
  // First line, capped for title use
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
}

/** Get session time range */
function getSessionTimeRange(db: any, sessionId: string): { first: string | null; last: string | null; count: number } {
  const row = db.prepare(
    `SELECT MIN(timestamp) as first_ts, MAX(timestamp) as last_ts, COUNT(*) as cnt
     FROM messages WHERE session_id = ?`
  ).get(sessionId) as { first_ts: string | null; last_ts: string | null; cnt: number };
  return { first: row.first_ts, last: row.last_ts, count: row.cnt };
}

/** Format duration between two ISO timestamps */
function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60_000) return '<1m';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
}

/** Preprocess a query for FTS5: escape special chars, handle common patterns */
function preprocessFtsQuery(query: string): string {
  // If it already uses FTS5 syntax (quotes, OR, AND, NOT), pass through
  if (/["()]|(\bOR\b)|(\bAND\b)|(\bNOT\b)/.test(query)) return query;

  // Strip FTS5-special characters that aren't part of intentional syntax
  const cleaned = query.replace(/[*^:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return query;

  // Simple multi-word queries: join with spaces (implicit AND in FTS5)
  return cleaned;
}

// ── Journal & research helpers ──

function searchJournals(query: string | undefined, after?: string, before?: string): { date: string; snippet: string; path: string }[] {
  if (!existsSync(MEMORIES_DIR)) return [];
  const results: { date: string; snippet: string; path: string }[] = [];

  try {
    const dirs = readdirSync(MEMORIES_DIR)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();

    for (const dir of dirs) {
      if (after && dir < after) continue;
      if (before && dir > before) continue;

      const memPath = join(MEMORIES_DIR, dir, 'MEMORY.md');
      if (!existsSync(memPath)) continue;

      const content = readFileSync(memPath, 'utf-8').trim();
      if (!content) continue;

      if (query) {
        const lower = content.toLowerCase();
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const matchCount = queryWords.filter(w => lower.includes(w)).length;
        if (matchCount === 0) continue;

        // Find the best matching line for snippet
        const lines = content.split('\n');
        let bestLine = '';
        let bestScore = 0;
        for (const line of lines) {
          const lineLower = line.toLowerCase();
          const score = queryWords.filter(w => lineLower.includes(w)).length;
          if (score > bestScore) {
            bestScore = score;
            bestLine = line;
          }
        }
        const snippet = bestLine.length > 200 ? bestLine.slice(0, 200) + '...' : bestLine;
        results.push({ date: dir, snippet, path: memPath });
      } else {
        // No query: return first meaningful line as snippet
        const firstHeading = content.split('\n').find(l => l.startsWith('#') || (l.trim().length > 10 && !l.startsWith('---')));
        const snippet = firstHeading ? (firstHeading.length > 200 ? firstHeading.slice(0, 200) + '...' : firstHeading) : content.slice(0, 200);
        results.push({ date: dir, snippet, path: memPath });
      }
    }
  } catch { /* ignore fs errors */ }

  return results;
}

// ── memory_search ──

export const memorySearchTool = tool(
  'memory_search',
  `Search past conversations and journals. Returns session-level results grouped by conversation.

Common patterns:
- memory_search({}) → 10 most recent sessions
- memory_search({ after: "today" }) → today's sessions
- memory_search({ after: "7d" }) → last 7 days
- memory_search({ query: "prism plotly" }) → find sessions about prism/plotly
- memory_search({ query: "hover sync", after: "7d" }) → last week, filtered by topic
- memory_search({ source: "journals" }) → browse daily journal entries
- memory_search({ channel: "telegram", after: "3d" }) → recent telegram chats

Results show: title (or first message), date range, channel, message count, duration.
Use memory_read with the session ID to drill into a specific conversation.
For research docs, use research_view / research_add / research_update instead.`,
  {
    query: z.string().optional().describe('Search query. Omit for browse mode (list recent sessions). Keywords are joined with implicit AND.'),
    source: z.enum(MEMORY_SOURCES).optional().describe("What to search: 'all' (default), 'sessions' (conversations only), 'journals' (daily memory files)"),
    after: z.string().optional().describe('Only results after this date. Supports: "today", "yesterday", "7d", "30d", or ISO date "2026-04-10"'),
    before: z.string().optional().describe('Only results before this date. Same formats as after.'),
    channel: z.string().optional().describe('Filter sessions by channel: desktop, telegram, whatsapp'),
    origin: z.enum(MEMORY_ORIGINS).optional().describe('Filter by origin: desktop_user, telegram_user, whatsapp_user, pulse, scheduled_task, user_initiated'),
    limit: z.number().optional().describe('Max results to return (default 10, max 30)'),
    sort: z.enum(['recent', 'relevant']).optional().describe("Sort order. Default: 'relevant' when query provided, 'recent' when browsing"),
  },
  async (args) => {
    const db = getDb();
    const limit = Math.min(args.limit || 10, 30);
    const source = args.source || 'all';
    const sortMode = args.sort || (args.query ? 'relevant' : 'recent');

    const resolvedAfter = args.after ? resolveDate(args.after) : undefined;
    const resolvedBefore = args.before ? resolveDate(args.before) : undefined;

    const sections: string[] = [];

    // ── Session search ──
    if (source === 'all' || source === 'sessions') {
      try {
        if (args.query) {
          // FTS search, grouped by session
          const ftsQuery = preprocessFtsQuery(args.query);

          let sql = `
            SELECT
              m.session_id,
              m.type,
              m.timestamp,
              m.content,
              s.channel,
              s.chat_id,
              s.sender_name,
              s.title,
              s.summary,
              f.rank,
              ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY f.rank) as rn
            FROM messages_fts f
            JOIN messages m ON m.id = f.rowid
            LEFT JOIN sessions s ON s.id = m.session_id
            WHERE messages_fts MATCH ?
              AND m.type IN ('user', 'assistant')
          `;
          const params: unknown[] = [ftsQuery];

          if (args.channel) { sql += ' AND s.channel = ?'; params.push(args.channel); }
          if (args.origin) {
            const { clause, params: op } = originFilterSql(args.origin);
            sql += ` AND ${clause}`;
            params.push(...op);
          }
          if (resolvedAfter) { sql += ' AND m.timestamp >= ?'; params.push(resolvedAfter); }
          if (resolvedBefore) { sql += ' AND m.timestamp <= ?'; params.push(resolvedBefore); }

          // Wrap to get best match per session
          const wrappedSql = `
            SELECT * FROM (${sql}) sub
            WHERE rn <= 2
            ORDER BY ${sortMode === 'recent' ? 'timestamp DESC' : 'rank'}
          `;

          const rows = db.prepare(wrappedSql).all(...params) as any[];

          // Group by session
          const sessionMap = new Map<string, { rows: any[]; channel: string | null; chatId: string | null; title: string | null; summary: string | null }>();
          for (const row of rows) {
            if (!sessionMap.has(row.session_id)) {
              sessionMap.set(row.session_id, { rows: [], channel: row.channel, chatId: row.chat_id, title: row.title, summary: row.summary });
            }
            sessionMap.get(row.session_id)!.rows.push(row);
          }

          const sessionResults: string[] = [];
          let count = 0;
          for (const [sessionId, data] of sessionMap) {
            if (count >= limit) break;

            const range = getSessionTimeRange(db, sessionId);
            const title = data.title || getSessionFirstMessage(db, sessionId) || 'Untitled';
            const origin = classifySessionOrigin(data.channel, data.chatId);
            const dateStr = range.first ? range.first.slice(0, 10) : 'unknown';
            const duration = (range.first && range.last) ? formatDuration(range.first, range.last) : '';
            const durationStr = duration ? ` | ${duration}` : '';
            const channelStr = data.channel ? ` | ${data.channel}` : '';

            let result = `**${title}**\n  id: ${sessionId} | ${dateStr}${channelStr} | ${origin} | ${range.count} msgs${durationStr}`;

            // Show best matching snippets
            for (const row of data.rows) {
              const text = extractConversationText(row.content);
              if (text) {
                const preview = text.length > 300 ? text.slice(0, 300) + '...' : text;
                result += `\n  > [${row.type}] ${preview}`;
              }
            }

            sessionResults.push(result);
            count++;
          }

          if (sessionResults.length > 0) {
            sections.push(`## Sessions (${sessionResults.length} found)\n\n${sessionResults.join('\n\n')}`);
          } else {
            sections.push(`## Sessions\nNo sessions found for "${args.query}"`);
          }
        } else {
          // Browse mode: list recent sessions
          let sql = `
            SELECT s.id, s.channel, s.chat_id, s.sender_name, s.created_at, s.updated_at, s.title, s.summary,
                   s.message_count
            FROM sessions s
            WHERE 1=1
          `;
          const params: unknown[] = [];

          if (args.channel) { sql += ' AND s.channel = ?'; params.push(args.channel); }
          if (args.origin) {
            const { clause, params: op } = originFilterSql(args.origin);
            sql += ` AND ${clause}`;
            params.push(...op);
          }
          if (resolvedAfter) { sql += ' AND s.created_at >= ?'; params.push(resolvedAfter); }
          if (resolvedBefore) { sql += ' AND s.created_at <= ?'; params.push(resolvedBefore); }

          sql += ' ORDER BY s.updated_at DESC LIMIT ?';
          params.push(limit);

          const sessions = db.prepare(sql).all(...params) as any[];

          if (sessions.length > 0) {
            const lines = sessions.map((s: any) => {
              const range = getSessionTimeRange(db, s.id);
              const title = s.title || getSessionFirstMessage(db, s.id) || 'Untitled';
              const origin = classifySessionOrigin(s.channel, s.chat_id);
              const dateStr = s.created_at ? s.created_at.slice(0, 16).replace('T', ' ') : 'unknown';
              const duration = (range.first && range.last) ? formatDuration(range.first, range.last) : '';
              const durationStr = duration ? ` | ${duration}` : '';
              const channelStr = s.channel ? ` | ${s.channel}` : '';

              return `**${title}**\n  id: ${s.id} | ${dateStr}${channelStr} | ${origin} | ${range.count} msgs${durationStr}`;
            });
            sections.push(`## Sessions (${sessions.length})\n\n${lines.join('\n\n')}`);
          } else {
            sections.push('## Sessions\nNo sessions found matching filters.');
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('fts5: syntax error')) {
          sections.push(`## Sessions\nSearch syntax error. Try simpler keywords or quote exact phrases.`);
        } else {
          sections.push(`## Sessions\nSearch failed: ${msg}`);
        }
      }
    }

    // ── Journal search ──
    if (source === 'all' || source === 'journals') {
      const journals = searchJournals(args.query, resolvedAfter, resolvedBefore);
      const journalSlice = journals.slice(0, source === 'journals' ? limit : Math.min(limit, 5));
      if (journalSlice.length > 0) {
        const lines = journalSlice.map(j =>
          `**Journal: ${j.date}**\n  id: journal:${j.date}\n  ${j.snippet}`
        );
        sections.push(`## Journals (${journalSlice.length})\n\n${lines.join('\n\n')}`);
      } else if (source === 'journals') {
        sections.push('## Journals\nNo journal entries found.');
      }
    }

    const output = sections.join('\n\n---\n\n');
    return { content: [{ type: 'text', text: output || 'No results found.' }] };
  }
);


// ── memory_read ──

export const memoryReadTool = tool(
  'memory_read',
  `Read a past conversation or journal entry at different detail levels.

Modes:
- summary: quick overview (title, time range, message count, first message preview)
- highlights: just the human conversation, no tool calls or file reads (default)
- full: complete transcript including all tool calls, paginated

Common patterns:
- memory_read({ id: "session:..." }) → read conversation highlights
- memory_read({ id: "session:...", mode: "summary" }) → quick overview
- memory_read({ id: "session:...", query: "hover sync" }) → find specific topic within a session
- memory_read({ id: "session:...", after: "23:00" }) → jump to a specific time in the session
- memory_read({ id: "session:...", mode: "full", include_tools: true }) → everything, including tool calls
- memory_read({ id: "journal:2026-04-12" }) → read a daily journal

For research docs, use research_view with an ID instead.

Highlights mode strips all tool_use/tool_result noise. A 1400-message session
typically has ~80 actual conversation turns. Much more readable.`,
  {
    id: z.string().describe('What to read. Prefix with type: "session:<session_id>", "journal:<YYYY-MM-DD>". Plain IDs are treated as session IDs for backwards compatibility.'),
    mode: z.enum(['summary', 'highlights', 'full']).optional().describe("Detail level. 'summary' = quick overview. 'highlights' = conversation only, no tool calls (default). 'full' = complete transcript."),
    page: z.number().optional().describe('Page number, 1-indexed (default 1). Mainly useful in full mode.'),
    page_size: z.number().optional().describe('Messages per page (default 30 for highlights, 20 for full, max 50)'),
    query: z.string().optional().describe('Search within this session. Returns only messages matching this query with surrounding context.'),
    after: z.string().optional().describe('Show messages after this time within the session (HH:MM or ISO timestamp)'),
    before: z.string().optional().describe('Show messages before this time within the session'),
    include_tools: z.boolean().optional().describe('Include tool_use/tool_result in highlights mode (default: false). Always included in full mode.'),
  },
  async (args) => {
    const db = getDb();
    const mode = args.mode || 'highlights';

    // ── Parse ID ──
    let idType: 'session' | 'journal';
    let idValue: string;

    if (args.id.startsWith('journal:')) {
      idType = 'journal';
      idValue = args.id.slice('journal:'.length);
    } else if (args.id.startsWith('session:')) {
      idType = 'session';
      idValue = args.id.slice('session:'.length);
    } else {
      idType = 'session';
      idValue = args.id;
    }

    // ── Journal read ──
    if (idType === 'journal') {
      const memPath = join(MEMORIES_DIR, idValue, 'MEMORY.md');
      if (!existsSync(memPath)) {
        return { content: [{ type: 'text', text: `Journal for ${idValue} not found.` }], isError: true };
      }
      const content = readFileSync(memPath, 'utf-8').trim();
      return { content: [{ type: 'text', text: `# Journal: ${idValue}\n\n${content}` }] };
    }

    // ── Session read ──
    const session = db.prepare(
      'SELECT id, channel, chat_id, chat_type, sender_name, created_at, updated_at, title, summary FROM sessions WHERE id = ?'
    ).get(idValue) as any | undefined;

    if (!session) {
      // Partial match
      const partials = db.prepare('SELECT id FROM sessions WHERE id LIKE ? ORDER BY updated_at DESC LIMIT 5')
        .all(`%${idValue}%`) as { id: string }[];
      if (partials.length > 0) {
        return { content: [{ type: 'text', text: `Session not found. Did you mean:\n${partials.map(r => `  ${r.id}`).join('\n')}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Session "${idValue}" not found.` }], isError: true };
    }

    const range = getSessionTimeRange(db, session.id);
    const title = session.title || getSessionFirstMessage(db, session.id) || 'Untitled';
    const origin = classifySessionOrigin(session.channel, session.chat_id);
    const dateStr = range.first ? range.first.slice(0, 16).replace('T', ' ') : 'unknown';
    const endStr = range.last ? range.last.slice(11, 16) : '';
    const duration = (range.first && range.last) ? formatDuration(range.first, range.last) : '';

    const headerParts = [
      `**${title}**`,
      `Session: ${session.id}`,
      `${dateStr}${endStr ? ' - ' + endStr : ''} | ${duration} | ${range.count} msgs | ${session.channel || 'unknown'} | ${origin}`,
    ];
    if (session.summary) headerParts.push(`\nSummary: ${session.summary}`);
    const header = headerParts.join('\n');

    // ── Summary mode ──
    if (mode === 'summary') {
      const firstMsg = getSessionFirstMessage(db, session.id);
      const parts = [header];
      if (firstMsg) parts.push(`\nFirst message: ${firstMsg}`);

      // Get a sample of user messages to show topics discussed
      const userMsgs = db.prepare(
        `SELECT content FROM messages WHERE session_id = ? AND type = 'user' ORDER BY id`
      ).all(session.id) as { content: string }[];

      const topics: string[] = [];
      for (const msg of userMsgs.slice(0, 20)) {
        const text = extractConversationText(msg.content);
        if (text && text.length > 10 && !text.startsWith('[tool_result')) {
          const firstLine = text.split('\n')[0].trim();
          if (firstLine.length > 5) {
            topics.push(firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine);
          }
        }
      }
      if (topics.length > 0) {
        parts.push(`\nUser messages (${Math.min(topics.length, 10)} of ${userMsgs.length}):`);
        for (const t of topics.slice(0, 10)) {
          parts.push(`  - ${t}`);
        }
      }

      return { content: [{ type: 'text', text: parts.join('\n') }] };
    }

    // ── Build message query ──
    const includeTools = mode === 'full' || args.include_tools;
    const pageSize = Math.min(args.page_size || (mode === 'full' ? 20 : 30), 50);
    const page = Math.max(args.page || 1, 1);

    // Within-session search
    if (args.query) {
      // Search within this session: find matching messages and show context around them
      const queryWords = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

      const allRows = db.prepare(
        `SELECT id, type, content, timestamp FROM messages
         WHERE session_id = ? AND type IN ('user', 'assistant')
         ORDER BY id`
      ).all(session.id) as { id: number; type: string; content: string; timestamp: string }[];

      // Find matching message indices
      const matchIndices: number[] = [];
      for (let i = 0; i < allRows.length; i++) {
        const text = extractConversationText(allRows[i].content) || extractMessageText(allRows[i].content);
        const lower = text.toLowerCase();
        if (queryWords.some(w => lower.includes(w))) {
          matchIndices.push(i);
        }
      }

      if (matchIndices.length === 0) {
        return { content: [{ type: 'text', text: `${header}\n${'─'.repeat(50)}\n\nNo messages matching "${args.query}" in this session.` }] };
      }

      // Collect matches with 1 message of context on each side
      const contextSet = new Set<number>();
      for (const idx of matchIndices) {
        if (idx > 0) contextSet.add(idx - 1);
        contextSet.add(idx);
        if (idx < allRows.length - 1) contextSet.add(idx + 1);
      }
      const contextIndices = [...contextSet].sort((a, b) => a - b);

      const formatted = contextIndices.map(idx => {
        const row = allRows[idx];
        const isMatch = matchIndices.includes(idx);
        const text = extractConversationText(row.content) || extractMessageText(row.content);
        const time = row.timestamp.slice(11, 16);
        const prefix = isMatch ? '>>>' : '   ';
        const label = row.type.toUpperCase();
        const preview = text.length > 1000 ? text.slice(0, 1000) + '...' : text;
        return `${prefix} [${time}] ${label}: ${preview}`;
      });

      return {
        content: [{
          type: 'text',
          text: `${header}\n${'─'.repeat(50)}\nSearch: "${args.query}" (${matchIndices.length} matches)\n\n${formatted.join('\n\n')}`,
        }],
      };
    }

    // Time-range filter within session
    let timeFilter = '';
    const timeParams: unknown[] = [session.id];
    if (args.after) {
      // If just HH:MM, convert to a timestamp filter
      const timeStr = args.after.includes('T') ? args.after : `%T${args.after}%`;
      timeFilter += ' AND timestamp >= ?';
      timeParams.push(args.after.includes('T') ? args.after : (range.first?.slice(0, 11) || '') + args.after);
    }
    if (args.before) {
      timeFilter += ' AND timestamp <= ?';
      timeParams.push(args.before.includes('T') ? args.before : (range.first?.slice(0, 11) || '') + args.before);
    }

    // ── Highlights mode: conversation only ──
    if (mode === 'highlights') {
      // Get all messages, then filter to conversation-only
      const allRows = db.prepare(
        `SELECT id, type, content, timestamp FROM messages
         WHERE session_id = ?${timeFilter}
         ORDER BY id`
      ).all(...timeParams) as { id: number; type: string; content: string; timestamp: string }[];

      // Filter to conversation turns (messages with actual text, not just tool calls)
      const conversationRows: { id: number; type: string; text: string; timestamp: string; tools?: string[] }[] = [];

      for (const row of allRows) {
        if (row.type === 'result') continue; // Skip session result messages

        const parsed = safeJsonParse(row.content);
        const blocks = parsed?.message?.content;
        if (!Array.isArray(blocks)) continue;

        const textParts: string[] = [];
        const toolNames: string[] = [];

        for (const block of blocks) {
          if (block?.type === 'text' && block.text) {
            textParts.push(block.text);
          } else if (block?.type === 'tool_use' && block.name) {
            toolNames.push(block.name);
            if (includeTools) {
              const inputStr = block.input ? JSON.stringify(block.input) : '';
              const preview = inputStr.length > 300 ? inputStr.slice(0, 300) + '...' : inputStr;
              textParts.push(`[tool: ${block.name}] ${preview}`);
            }
          } else if (block?.type === 'tool_result') {
            // In highlights, skip tool results entirely unless include_tools
            if (includeTools) {
              const resultText = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
                  : '';
              if (resultText) {
                const preview = resultText.length > 500 ? resultText.slice(0, 500) + '...' : resultText;
                textParts.push(`[result] ${preview}`);
              }
            }
          }
        }

        const text = textParts.join('\n').trim();
        if (!text && toolNames.length === 0) continue;

        // Skip messages that are ONLY tool results with no text (user messages carrying tool_result blocks)
        if (!text && !includeTools) continue;

        if (text || includeTools) {
          conversationRows.push({
            id: row.id,
            type: row.type,
            text: text || `[${toolNames.join(', ')}]`,
            timestamp: row.timestamp,
            tools: toolNames.length > 0 && !includeTools ? toolNames : undefined,
          });
        }
      }

      const totalConv = conversationRows.length;
      const totalPages = Math.ceil(totalConv / pageSize);
      const offset = (page - 1) * pageSize;
      const pageRows = conversationRows.slice(offset, offset + pageSize);

      const formatted = pageRows.map(row => {
        const time = row.timestamp.slice(11, 16);
        const label = row.type === 'user' ? 'USER' : 'ASSISTANT';
        const toolTag = row.tools ? ` [used: ${row.tools.join(', ')}]` : '';
        const text = row.text.length > 2000 ? row.text.slice(0, 2000) + '...' : row.text;
        return `[${time}] ${label}:${toolTag}\n${text}`;
      });

      const footer = page < totalPages
        ? `\n--- Page ${page}/${totalPages} (${totalConv} conversation turns). Use page:${page + 1} for more. ---`
        : `\n--- End of conversation (${totalConv} turns from ${range.count} total messages) ---`;

      return {
        content: [{
          type: 'text',
          text: `${header}\n${'─'.repeat(50)}\n\n${formatted.join('\n\n')}\n${footer}`,
        }],
      };
    }

    // ── Full mode ──
    const types = ['user', 'assistant', 'result'];
    const placeholders = types.map(() => '?').join(',');

    const totalRow = db.prepare(
      `SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND type IN (${placeholders})${timeFilter}`
    ).get(session.id, ...types, ...timeParams.slice(1)) as { c: number };
    const total = totalRow.c;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;

    if (total === 0) {
      return { content: [{ type: 'text', text: `${header}\n\nNo messages in this range.` }] };
    }

    const rows = db.prepare(
      `SELECT id, type, content, timestamp FROM messages
       WHERE session_id = ? AND type IN (${placeholders})${timeFilter}
       ORDER BY id
       LIMIT ? OFFSET ?`
    ).all(session.id, ...types, ...timeParams.slice(1), pageSize, offset) as {
      id: number; type: string; content: string; timestamp: string;
    }[];

    const formatted = rows.map(row => {
      const time = row.timestamp.slice(11, 16);
      const parsed = safeJsonParse(row.content);
      const blocks = parsed?.message?.content;

      if (row.type === 'user' && Array.isArray(blocks)) {
        const parts: string[] = [];
        for (const block of blocks) {
          if (block?.type === 'text' && block.text) {
            parts.push(block.text);
          } else if (block?.type === 'tool_result') {
            const resultText = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
                : '';
            if (resultText) {
              const preview = resultText.length > 1000 ? resultText.slice(0, 1000) + '...' : resultText;
              parts.push(`[tool_result] ${preview}`);
            }
          }
        }
        return `[${time}] USER:\n${parts.join('\n')}`;
      }

      if (row.type === 'assistant' && Array.isArray(blocks)) {
        const parts: string[] = [];
        for (const block of blocks) {
          if (block?.type === 'text' && block.text) {
            parts.push(block.text);
          } else if (block?.type === 'tool_use') {
            const inputStr = block.input ? JSON.stringify(block.input) : '';
            const preview = inputStr.length > 500 ? inputStr.slice(0, 500) + '...' : inputStr;
            parts.push(`[tool: ${block.name}] ${preview}`);
          }
        }
        return `[${time}] ASSISTANT:\n${parts.join('\n')}`;
      }

      if (row.type === 'result') {
        const cost = parsed?.total_cost_usd ? ` ($${parsed.total_cost_usd.toFixed(4)})` : '';
        const dur = parsed?.duration_ms ? ` ${(parsed.duration_ms / 1000).toFixed(1)}s` : '';
        const text = extractMessageText(row.content);
        const preview = text.length > 500 ? text.slice(0, 500) + '...' : text;
        return `[${time}] RESULT:${dur}${cost} ${preview}`;
      }

      return `[${time}] ${row.type.toUpperCase()}: ${extractMessageText(row.content).slice(0, 500)}`;
    });

    const footer = page < totalPages
      ? `\n--- Page ${page}/${totalPages} (${total} messages). Use page:${page + 1} for more. ---`
      : `\n--- End of conversation (${total} messages) ---`;

    return {
      content: [{
        type: 'text',
        text: `${header}\n${'─'.repeat(50)}\n\n${formatted.join('\n\n')}\n${footer}`,
      }],
    };
  }
);


export const memoryTools = [memorySearchTool, memoryReadTool];
