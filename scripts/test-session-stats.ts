import assert from 'node:assert/strict';
import { repairSessionStats, getDb } from '../src/db.js';
import { SessionRegistry } from '../src/gateway/session-registry.js';
import { SessionManager, type SessionMessage } from '../src/session/manager.js';

const config = {} as any;
const sessionManager = new SessionManager(config);
const db = getDb();

const sessionId = 'session-stats-test';
const key = 'desktop:dm:session-stats-chat';
const lastTimestamp = '2026-05-01T00:00:01.000Z';

sessionManager.setMetadata(sessionId, {
  channel: 'desktop',
  chatId: 'session-stats-chat',
  chatType: 'dm',
});

const userMessage: SessionMessage = {
  type: 'user',
  timestamp: '2026-05-01T00:00:00.000Z',
  content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
};
const assistantMessage: SessionMessage = {
  type: 'assistant',
  timestamp: lastTimestamp,
  content: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
};

sessionManager.append(sessionId, userMessage);
sessionManager.append(sessionId, assistantMessage);

let row = db.prepare('SELECT message_count, last_message_at FROM sessions WHERE id = ?').get(sessionId) as {
  message_count: number;
  last_message_at: number | null;
};
assert.equal(row.message_count, 2);
assert.equal(row.last_message_at, Date.parse(lastTimestamp));

const registry = new SessionRegistry();
registry.loadFromDisk();
registry.incrementMessages(key);

row = db.prepare('SELECT message_count FROM sessions WHERE id = ?').get(sessionId) as {
  message_count: number;
};
assert.equal(row.message_count, 2);
assert.equal(registry.get(key)?.messageCount, 3);

db.prepare('UPDATE sessions SET message_count = 0, last_message_at = 0 WHERE id = ?').run(sessionId);
db.prepare("DELETE FROM db_meta WHERE key = 'session_stats_repair_v1'").run();

const repaired = repairSessionStats();
assert.ok(repaired >= 1);

row = db.prepare('SELECT message_count, last_message_at FROM sessions WHERE id = ?').get(sessionId) as {
  message_count: number;
  last_message_at: number | null;
};
assert.equal(row.message_count, 2);
assert.equal(row.last_message_at, Date.parse(lastTimestamp));

console.log('session stats ok');
