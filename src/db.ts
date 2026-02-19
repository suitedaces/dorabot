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

    -- FTS5 index for memory search over messages
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text_content,
      content='',
      tokenize='porter unicode61'
    );
  `);

  return db;
}

// extract human-readable text from a message content blob
export function extractMessageText(content: string): string {
  try {
    const parsed = JSON.parse(content);

    // user message: dig into content array for all blocks
    if (parsed?.message?.content) {
      const blocks = Array.isArray(parsed.message.content) ? parsed.message.content : [parsed.message.content];
      const texts: string[] = [];
      for (const block of blocks) {
        if (typeof block === 'string') {
          texts.push(block);
        } else if (block?.type === 'text' && block.text) {
          texts.push(block.text);
        } else if (block?.type === 'tool_result' && typeof block.content === 'string') {
          texts.push(block.content);
        } else if (block?.type === 'tool_result' && Array.isArray(block.content)) {
          for (const sub of block.content) {
            if (sub?.type === 'text' && sub.text) texts.push(sub.text);
          }
        } else if (block?.type === 'tool_use' && block.name) {
          // index tool name and stringified input for searchability
          texts.push(`[tool:${block.name}]`);
          if (block.input) {
            const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
            // only index if reasonably sized
            if (inputStr.length < 2000) texts.push(inputStr);
          }
        }
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
        } else if (block?.type === 'tool_use' && block.name) {
          texts.push(`[tool:${block.name}]`);
          if (block.input) {
            const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
            if (inputStr.length < 2000) texts.push(inputStr);
          }
        }
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
  if (type === 'system') return; // skip system init messages
  const text = extractMessageText(content);
  if (!text || text.length < 5) return; // skip empty/trivial
  const d = getDb();
  d.prepare('INSERT INTO messages_fts(rowid, text_content) VALUES (?, ?)').run(messageRowId, text);
}

// backfill FTS index from existing messages (run once on upgrade)
export function backfillFtsIndex(): void {
  const d = getDb();

  // check if already backfilled (with actual content, not empty rows from a broken build)
  const sample = d.prepare("SELECT text_content FROM messages_fts LIMIT 1").get() as { text_content: string | null } | undefined;
  if (sample?.text_content) return;

  // drop and recreate to clear empty rows from previous broken backfill
  d.exec('DROP TABLE IF EXISTS messages_fts');
  d.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(text_content, content='', tokenize='porter unicode61')");

  console.log('[db] backfilling FTS index...');
  const rows = d.prepare('SELECT id, content, type FROM messages WHERE type IN (\'user\', \'assistant\', \'result\') ORDER BY id').all() as { id: number; content: string; type: string }[];

  const insert = d.prepare('INSERT INTO messages_fts(rowid, text_content) VALUES (?, ?)');
  const tx = d.transaction(() => {
    let indexed = 0;
    for (const row of rows) {
      const text = extractMessageText(row.content);
      if (!text || text.length < 5) continue;
      insert.run(row.id, text);
      indexed++;
    }
    console.log(`[db] FTS backfill complete: ${indexed}/${rows.length} messages indexed`);
  });
  tx();
}
