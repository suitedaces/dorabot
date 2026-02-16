import { getDb } from '../db.js';
import type Database from 'better-sqlite3';

let insertStmt: Database.Statement | null = null;
let queryStmt: Database.Statement | null = null;
let deleteStmt: Database.Statement | null = null;
let cleanupStmt: Database.Statement | null = null;

function ensureStatements(): void {
  if (insertStmt) return;
  const db = getDb();
  insertStmt = db.prepare('INSERT INTO stream_events (session_key, event_type, data) VALUES (?, ?, ?)');
  queryStmt = db.prepare('SELECT seq, event_type, data FROM stream_events WHERE session_key = ? AND seq > ? ORDER BY seq');
  deleteStmt = db.prepare('DELETE FROM stream_events WHERE session_key = ?');
  cleanupStmt = db.prepare('DELETE FROM stream_events WHERE created_at < ?');
}

export function insertEvent(sessionKey: string, eventType: string, data: string): number {
  ensureStatements();
  const result = insertStmt!.run(sessionKey, eventType, data);
  return Number(result.lastInsertRowid);
}

export function queryEvents(sessionKeys: string[], afterSeq: number): Array<{ seq: number; event_type: string; data: string }> {
  ensureStatements();
  const results: Array<{ seq: number; event_type: string; data: string }> = [];
  for (const sk of sessionKeys) {
    const rows = queryStmt!.all(sk, afterSeq) as Array<{ seq: number; event_type: string; data: string }>;
    results.push(...rows);
  }
  results.sort((a, b) => a.seq - b.seq);
  return results;
}

export function deleteEventsForSession(sessionKey: string): void {
  ensureStatements();
  deleteStmt!.run(sessionKey);
}

export function cleanupOldEvents(maxAgeSeconds: number = 3600): void {
  ensureStatements();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  cleanupStmt!.run(cutoff);
}
