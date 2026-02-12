#!/usr/bin/env tsx
/**
 * Migration script: file-based storage → SQLite
 *
 * Reads existing JSONL sessions, _index.json, _registry.json, cron-jobs.json, and BOARD.md
 * and imports them into ~/.dorabot/dorabot.db
 *
 * Run with: npx tsx scripts/migrate-to-sqlite.ts
 */

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const DORABOT_DIR = join(homedir(), '.dorabot');
const SESSION_DIR = join(DORABOT_DIR, 'sessions');
const DB_PATH = join(DORABOT_DIR, 'dorabot.db');
const INDEX_PATH = join(SESSION_DIR, '_index.json');
const REGISTRY_PATH = join(SESSION_DIR, '_registry.json');
const CRON_PATH = join(DORABOT_DIR, 'cron-jobs.json');
const BOARD_PATH = join(DORABOT_DIR, 'workspace', 'BOARD.md');

function openDb(): Database.Database {
  const db = new Database(DB_PATH);
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

    CREATE TABLE IF NOT EXISTS board_tasks (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS board_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  return db;
}

function migrateSessions(db: Database.Database): void {
  // check if already migrated
  const count = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c;
  if (count > 0) {
    console.log(`  sessions: skipped (${count} messages already in db)`);
    return;
  }

  // load metadata sources
  let index: Record<string, { channel?: string; chatId?: string; chatType?: string; senderName?: string; sdkSessionId?: string }> = {};
  let registry: Record<string, {
    key?: string; channel?: string; chatId?: string; chatType?: string;
    sessionId?: string; sdkSessionId?: string; messageCount?: number; lastMessageAt?: number;
  }> = {};

  if (existsSync(INDEX_PATH)) {
    try { index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8')); } catch {}
  }
  if (existsSync(REGISTRY_PATH)) {
    try { registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')); } catch {}
  }

  // build registry lookup by sessionId
  const registryBySessionId: Record<string, typeof registry[string]> = {};
  for (const entry of Object.values(registry)) {
    if (entry.sessionId) {
      registryBySessionId[entry.sessionId] = entry;
    }
  }

  if (!existsSync(SESSION_DIR)) {
    console.log('  sessions: skipped (no sessions directory)');
    return;
  }

  const jsonlFiles = readdirSync(SESSION_DIR).filter(f => f.endsWith('.jsonl'));
  if (jsonlFiles.length === 0) {
    console.log('  sessions: skipped (no .jsonl files)');
    return;
  }

  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions (id, channel, chat_id, chat_type, sender_name, sdk_session_id, message_count, last_message_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMessage = db.prepare(`
    INSERT INTO messages (session_id, uuid, type, content, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let totalSessions = 0;
  let totalMessages = 0;

  const migrate = db.transaction(() => {
    for (const file of jsonlFiles) {
      const sessionId = basename(file, '.jsonl');
      const filePath = join(SESSION_DIR, file);
      const stat = statSync(filePath);

      // merge metadata from index and registry
      const meta = index[sessionId] || {};
      const reg = registryBySessionId[sessionId] || {};

      const channel = meta.channel || reg.channel || null;
      const chatId = meta.chatId || reg.chatId || null;
      const chatType = meta.chatType || reg.chatType || null;
      const senderName = meta.senderName || null;
      const sdkSessionId = meta.sdkSessionId || reg.sdkSessionId || null;

      // parse messages
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const messages: { type: string; uuid?: string; timestamp: string; content: unknown; metadata?: unknown }[] = [];

      for (const line of lines) {
        try {
          messages.push(JSON.parse(line));
        } catch {}
      }

      const lastMsg = messages[messages.length - 1];
      const lastMessageAt = lastMsg ? new Date(lastMsg.timestamp).getTime() : stat.mtimeMs;

      insertSession.run(
        sessionId,
        channel,
        chatId,
        chatType,
        senderName,
        sdkSessionId,
        messages.length,
        Math.round(lastMessageAt),
        stat.birthtime.toISOString(),
        stat.mtime.toISOString(),
      );

      for (const msg of messages) {
        insertMessage.run(
          sessionId,
          (msg as any).uuid || null,
          msg.type,
          JSON.stringify(msg.content),
          msg.metadata ? JSON.stringify(msg.metadata) : null,
          msg.timestamp,
        );
      }

      totalSessions++;
      totalMessages += messages.length;
    }
  });

  migrate();
  console.log(`  sessions: migrated ${totalSessions} sessions, ${totalMessages} messages`);
}

function migrateCronJobs(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM cron_jobs').get() as { c: number }).c;
  if (count > 0) {
    console.log(`  cron: skipped (${count} jobs already in db)`);
    return;
  }

  if (!existsSync(CRON_PATH)) {
    console.log('  cron: skipped (no cron-jobs.json)');
    return;
  }

  let jobs: any[];
  try {
    jobs = JSON.parse(readFileSync(CRON_PATH, 'utf-8'));
  } catch {
    console.log('  cron: skipped (failed to parse cron-jobs.json)');
    return;
  }

  const insert = db.prepare('INSERT OR REPLACE INTO cron_jobs (id, data) VALUES (?, ?)');
  const migrate = db.transaction(() => {
    for (const job of jobs) {
      insert.run(job.id, JSON.stringify(job));
    }
  });
  migrate();
  console.log(`  cron: migrated ${jobs.length} jobs`);
}

function migrateBoard(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM board_tasks').get() as { c: number }).c;
  if (count > 0) {
    console.log(`  board: skipped (${count} tasks already in db)`);
    return;
  }

  if (!existsSync(BOARD_PATH)) {
    console.log('  board: skipped (no BOARD.md)');
    return;
  }

  const raw = readFileSync(BOARD_PATH, 'utf-8');

  // inline parseBoard (same logic as src/tools/board.ts)
  type BoardTask = {
    id: string; title: string; description?: string;
    status: string; priority: string; source: string;
    createdAt: string; updatedAt: string; completedAt?: string;
    result?: string; tags?: string[];
  };

  const tasks: BoardTask[] = [];
  let lastPlanAt: string | undefined;
  const lines = raw.split('\n');
  let currentStatus: string | null = null;
  let currentTask: Partial<BoardTask> | null = null;

  const statusMap: Record<string, string> = {
    'proposed': 'proposed', 'approved': 'approved',
    'in progress': 'in_progress', 'in_progress': 'in_progress',
    'done': 'done', 'rejected': 'rejected',
  };

  for (const line of lines) {
    const planMatch = line.match(/^Last planned:\s*(.+)/);
    if (planMatch) { lastPlanAt = planMatch[1].trim(); continue; }

    const headerMatch = line.match(/^## (.+)/);
    if (headerMatch) {
      if (currentTask?.id) { tasks.push(currentTask as BoardTask); currentTask = null; }
      const headerText = headerMatch[1].toLowerCase();
      for (const [key, value] of Object.entries(statusMap)) {
        if (headerText.includes(key)) { currentStatus = value; break; }
      }
      continue;
    }

    const taskMatch = line.match(/^- \*\*#(\d+)\*\*\s+(.+)/);
    if (taskMatch) {
      if (currentTask?.id) tasks.push(currentTask as BoardTask);
      const titlePart = taskMatch[2];
      const priorityMatch = titlePart.match(/\(high\)|\(low\)/);
      const tagsMatch = titlePart.match(/\[([^\]]+)\]/);
      const title = titlePart.replace(/\s*\(high\)\s*/, ' ').replace(/\s*\(low\)\s*/, ' ').replace(/\s*\[[^\]]+\]\s*/, ' ').trim();
      currentTask = {
        id: taskMatch[1], title,
        status: currentStatus || 'proposed',
        priority: priorityMatch ? priorityMatch[0].replace(/[()]/g, '') : 'medium',
        source: 'agent',
        tags: tagsMatch ? tagsMatch[1].split(',').map(s => s.trim()) : undefined,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      continue;
    }

    if (currentTask && line.match(/^\s+source:/)) {
      const s = line.match(/source:(\w+)/); if (s) currentTask.source = s[1];
      const c = line.match(/created:(\S+)/); if (c) currentTask.createdAt = c[1];
      const u = line.match(/updated:(\S+)/); if (u) currentTask.updatedAt = u[1];
      const d = line.match(/completed:(\S+)/); if (d) currentTask.completedAt = d[1];
      continue;
    }

    if (currentTask && line.match(/^\s+Result:\s/)) {
      currentTask.result = line.replace(/^\s+Result:\s*/, '');
    } else if (currentTask && line.match(/^\s+\S/) && !line.match(/^\s+source:/)) {
      currentTask.description = (currentTask.description ? currentTask.description + ' ' : '') + line.trim();
    }
  }
  if (currentTask?.id) tasks.push(currentTask as BoardTask);

  const insertTask = db.prepare('INSERT OR REPLACE INTO board_tasks (id, data) VALUES (?, ?)');
  const migrate = db.transaction(() => {
    for (const task of tasks) {
      insertTask.run(task.id, JSON.stringify(task));
    }
    db.prepare("INSERT OR REPLACE INTO board_meta (key, value) VALUES ('version', '1')").run();
    if (lastPlanAt) {
      db.prepare("INSERT OR REPLACE INTO board_meta (key, value) VALUES ('last_plan_at', ?)").run(lastPlanAt);
    }
  });
  migrate();
  console.log(`  board: migrated ${tasks.length} tasks`);
}

// ── Main ──

console.log(`Migrating to SQLite: ${DB_PATH}\n`);

const db = openDb();

migrateSessions(db);
migrateCronJobs(db);
migrateBoard(db);

db.close();
console.log('\nDone.');
