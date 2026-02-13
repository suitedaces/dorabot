import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

let db: Database.Database | null = null;

const DB_PATH = join(homedir(), '.dorabot', 'dorabot.db');

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(join(homedir(), '.dorabot'), { recursive: true });
  db = new Database(DB_PATH);
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

    CREATE TABLE IF NOT EXISTS goals_tasks (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- migrate from old board tables if they exist
    INSERT OR IGNORE INTO goals_tasks SELECT * FROM board_tasks WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='board_tasks');
    INSERT OR IGNORE INTO goals_meta SELECT * FROM board_meta WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='board_meta');
  `);

  return db;
}
