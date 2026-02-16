import { getDb } from '../db.js';
import type Database from 'better-sqlite3';

let insertStmt: Database.Statement | null = null;
let deleteStmt: Database.Statement | null = null;
let deleteUpToSeqStmt: Database.Statement | null = null;
let cleanupStmt: Database.Statement | null = null;
const queryByCursorStmtCache = new Map<number, Database.Statement>();

function ensureStatements(): void {
  if (insertStmt) return;
  const db = getDb();
  insertStmt = db.prepare('INSERT INTO stream_events (session_key, event_type, data) VALUES (?, ?, ?)');
  deleteStmt = db.prepare('DELETE FROM stream_events WHERE session_key = ?');
  deleteUpToSeqStmt = db.prepare('DELETE FROM stream_events WHERE session_key = ? AND seq <= ?');
  cleanupStmt = db.prepare('DELETE FROM stream_events WHERE created_at < ?');
}

export function insertEvent(sessionKey: string, eventType: string, data: string): number {
  ensureStatements();
  const result = insertStmt!.run(sessionKey, eventType, data);
  return Number(result.lastInsertRowid);
}

export function queryEvents(sessionKeys: string[], afterSeq: number): Array<{ seq: number; event_type: string; data: string }> {
  if (sessionKeys.length === 0) return [];
  const cursorBySession = new Map<string, number>();
  for (const sessionKey of sessionKeys) cursorBySession.set(sessionKey, afterSeq);
  const out: Array<{ seq: number; event_type: string; data: string }> = [];
  const batchLimit = 2000;
  while (true) {
    const rows = queryEventsBySessionCursor(
      sessionKeys.map((sessionKey) => ({
        sessionKey,
        afterSeq: cursorBySession.get(sessionKey) || 0,
      })),
      batchLimit,
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      out.push({
        seq: row.seq,
        event_type: row.event_type,
        data: row.data,
      });
      cursorBySession.set(row.session_key, row.seq);
    }
    if (rows.length < batchLimit) break;
  }
  return out;
}

function getQueryByCursorStmt(sessionCount: number): Database.Statement {
  ensureStatements();
  const cached = queryByCursorStmtCache.get(sessionCount);
  if (cached) return cached;
  const where = Array.from({ length: sessionCount }, () => '(session_key = ? AND seq > ?)').join(' OR ');
  const stmt = getDb().prepare(
    `SELECT seq, session_key, event_type, data FROM stream_events WHERE ${where} ORDER BY seq LIMIT ?`,
  );
  queryByCursorStmtCache.set(sessionCount, stmt);
  return stmt;
}

export function queryEventsBySessionCursor(
  cursors: Array<{ sessionKey: string; afterSeq: number }>,
  limit: number,
): Array<{ seq: number; session_key: string; event_type: string; data: string }> {
  ensureStatements();
  if (cursors.length === 0) return [];
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50_000));
  const stmt = getQueryByCursorStmt(cursors.length);
  const args: Array<string | number> = [];
  for (const cursor of cursors) {
    args.push(cursor.sessionKey, cursor.afterSeq);
  }
  args.push(boundedLimit);
  return stmt.all(...args) as Array<{ seq: number; session_key: string; event_type: string; data: string }>;
}

export function deleteEventsForSession(sessionKey: string): void {
  ensureStatements();
  deleteStmt!.run(sessionKey);
}

export function deleteEventsUpToSeq(sessionKey: string, maxSeqInclusive: number): void {
  ensureStatements();
  deleteUpToSeqStmt!.run(sessionKey, maxSeqInclusive);
}

export function cleanupOldEvents(maxAgeSeconds: number = 3600): void {
  ensureStatements();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  cleanupStmt!.run(cutoff);
}
