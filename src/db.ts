import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { DORABOT_DB_PATH, DORABOT_DIR } from './workspace.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(DORABOT_DIR, { recursive: true });
  db = new Database(DORABOT_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      channel TEXT,
      chat_id TEXT,
      chat_type TEXT,
      sender_name TEXT,
      sdk_session_id TEXT,
      message_count INTEGER DEFAULT 0,
      last_message_at INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      uuid TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_items (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals_meta_v2 (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      event_type TEXT,
      message TEXT,
      data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_logs_task_id ON tasks_logs(task_id);

    -- reset deprecated planning tables (plans/ideas and pre-v2 goals schema)
    DROP TABLE IF EXISTS plans_tasks;
    DROP TABLE IF EXISTS plans_meta;
    DROP TABLE IF EXISTS plans_logs;
    DROP TABLE IF EXISTS ideas;
    DROP TABLE IF EXISTS ideas_meta;
    DROP TABLE IF EXISTS goals_tasks;
    DROP TABLE IF EXISTS goals_meta;

    -- append-only event log for WebSocket stream replay on reconnect
    CREATE TABLE IF NOT EXISTS stream_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_stream_events_session_seq ON stream_events(session_key, seq);

    CREATE TABLE IF NOT EXISTS research_items (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS research_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- checkpoint for fast cold-start recovery (skip full event replay)
    CREATE TABLE IF NOT EXISTS session_checkpoints (
      session_key TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- FTS5 index for memory search over messages
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text_content,
      content='',
      tokenize='porter unicode61'
    );
  `);

  // Migrations: add columns to existing tables (safe to re-run)
  try { db.exec(`ALTER TABLE sessions ADD COLUMN name TEXT`); } catch { /* already exists */ }

  return db;
}

// extract human-readable text from a message content blob (text blocks only, no tool calls)
export function extractMessageText(content: string): string {
  try {
    const parsed = JSON.parse(content);

    // user message: dig into content array for text blocks only
    if (parsed?.message?.content) {
      const blocks = Array.isArray(parsed.message.content) ? parsed.message.content : [parsed.message.content];
      const texts: string[] = [];
      for (const block of blocks) {
        if (typeof block === 'string') {
          texts.push(block);
        } else if (block?.type === 'text' && block.text) {
          texts.push(block.text);
        }
        // Skip tool_use and tool_result blocks: they pollute search with file paths, JSON blobs, etc.
      }
      return texts.join(' ').trim();
    }

    // result message: grab the result string
    if (parsed?.result && typeof parsed.result === 'string') {
      return parsed.result.trim();
    }

    // assistant with content blocks
    if (parsed?.type === 'assistant' && parsed?.message?.content) {
      const blocks = Array.isArray(parsed.message.content) ? parsed.message.content : [];
      const texts: string[] = [];
      for (const block of blocks) {
        if (block?.type === 'text' && block.text) {
          texts.push(block.text);
        }
        // Skip tool_use blocks: tool names and JSON inputs aren't useful search content
      }
      return texts.join(' ').trim();
    }

    return '';
  } catch {
    return '';
  }
}

// populate FTS index for a single message (call after inserting into messages table)
export function indexMessageForSearch(messageRowId: number, content: string, type: string): void {
  if (type !== 'user' && type !== 'assistant') return; // only index conversation messages
  const text = extractMessageText(content);
  if (!text || text.length < 5) return; // skip empty/trivial
  const d = getDb();
  d.prepare('INSERT INTO messages_fts(rowid, text_content) VALUES (?, ?)').run(messageRowId, text);
}

// FTS index version: bump this to force a full rebuild when extraction logic changes
const FTS_VERSION = 2; // v2: text-only extraction (no tool_use/tool_result noise)

// backfill FTS index from existing messages (run once on upgrade, then incremental)
export function backfillFtsIndex(): void {
  const d = getDb();

  // Check if index needs a full rebuild (version mismatch or empty)
  d.exec("CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT)");
  const versionRow = d.prepare("SELECT value FROM db_meta WHERE key = 'fts_version'").get() as { value: string } | undefined;
  const currentVersion = versionRow ? parseInt(versionRow.value, 10) : 0;
  const needsRebuild = currentVersion < FTS_VERSION;

  const sample = d.prepare("SELECT text_content FROM messages_fts LIMIT 1").get() as { text_content: string | null } | undefined;

  if (needsRebuild || !sample?.text_content) {
    // drop and recreate for clean rebuild
    d.exec('DROP TABLE IF EXISTS messages_fts');
    d.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(text_content, content='', tokenize='porter unicode61')");

    console.error(`[db] rebuilding FTS index (v${FTS_VERSION})...`);
    const rows = d.prepare('SELECT id, content, type FROM messages WHERE type IN (\'user\', \'assistant\') ORDER BY id').all() as { id: number; content: string; type: string }[];

    const insert = d.prepare('INSERT INTO messages_fts(rowid, text_content) VALUES (?, ?)');
    const tx = d.transaction(() => {
      let indexed = 0;
      for (const row of rows) {
        const text = extractMessageText(row.content);
        if (!text || text.length < 5) continue;
        insert.run(row.id, text);
        indexed++;
      }
      d.prepare("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('fts_version', ?)").run(String(FTS_VERSION));
      console.error(`[db] FTS rebuild complete (v${FTS_VERSION}): ${indexed}/${rows.length} messages indexed`);
    });
    tx();
    return;
  }

  // incremental: index any messages missing from FTS (only user + assistant, skip result)
  const missing = d.prepare(`
    SELECT m.id, m.content, m.type FROM messages m
    WHERE m.type IN ('user', 'assistant')
      AND m.id NOT IN (SELECT rowid FROM messages_fts)
    ORDER BY m.id
  `).all() as { id: number; content: string; type: string }[];

  if (missing.length === 0) return;

  console.error(`[db] incremental FTS backfill: ${missing.length} messages to index...`);
  const insert = d.prepare('INSERT INTO messages_fts(rowid, text_content) VALUES (?, ?)');
  const tx = d.transaction(() => {
    let indexed = 0;
    for (const row of missing) {
      const text = extractMessageText(row.content);
      if (!text || text.length < 5) continue;
      insert.run(row.id, text);
      indexed++;
    }
    console.error(`[db] incremental FTS backfill complete: ${indexed}/${missing.length} messages indexed`);
  });
  tx();
}
