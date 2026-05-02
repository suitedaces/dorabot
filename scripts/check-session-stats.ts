import { getDb } from '../src/db.js';

type DriftRow = {
  id: string;
  channel: string | null;
  chat_id: string | null;
  stored_count: number;
  stored_last: number | null;
  actual_count: number;
  actual_last: string | null;
};

type DriftEntry = {
  id: string;
  channel: string | null;
  chatId: string | null;
  storedCount: number;
  actualCount: number;
  storedLast: number | null;
  actualLast: number | null;
};

function readDrift(): DriftEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      s.id,
      s.channel,
      s.chat_id,
      s.message_count AS stored_count,
      s.last_message_at AS stored_last,
      IFNULL(m.cnt, 0) AS actual_count,
      m.last_ts AS actual_last
    FROM sessions s
    LEFT JOIN (
      SELECT session_id, COUNT(*) AS cnt, MAX(timestamp) AS last_ts
      FROM messages
      GROUP BY session_id
    ) m ON m.session_id = s.id
  `).all() as DriftRow[];

  return rows
    .map((row) => ({
      id: row.id,
      channel: row.channel,
      chatId: row.chat_id,
      storedCount: row.stored_count,
      actualCount: row.actual_count,
      storedLast: row.stored_last,
      actualLast: row.actual_last ? Date.parse(row.actual_last) : null,
    }))
    .filter((row) => {
      const hasCountDrift = row.storedCount !== row.actualCount;
      const hasLastDrift = row.actualLast !== null && row.storedLast !== row.actualLast;
      return hasCountDrift || hasLastDrift;
    })
    .sort((a, b) => Math.abs(b.actualCount - b.storedCount) - Math.abs(a.actualCount - a.storedCount));
}

function repair(rows: DriftEntry[]): number {
  if (rows.length === 0) return 0;

  const db = getDb();
  const update = db.prepare(`
    UPDATE sessions
    SET message_count = ?, last_message_at = ?
    WHERE id = ?
  `);

  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const lastMessageAt = row.actualLast ?? row.storedLast;
      const result = update.run(row.actualCount, lastMessageAt, row.id);
      changed += result.changes;
    }
  })();

  return changed;
}

function summarize(rows: DriftEntry[]) {
  const countMismatches = rows.filter((row) => row.storedCount !== row.actualCount);
  return {
    mismatchedSessions: rows.length,
    countMismatches: countMismatches.length,
    messageDelta: countMismatches.reduce((sum, row) => sum + (row.actualCount - row.storedCount), 0),
    rows: rows.slice(0, 20),
  };
}

const shouldRepair = process.argv.includes('--repair');
const before = readDrift();

console.log(JSON.stringify({ mode: shouldRepair ? 'repair' : 'check', ...summarize(before) }, null, 2));

if (!shouldRepair) process.exit(0);

const repaired = repair(before);
const after = readDrift();

console.log(JSON.stringify({
  repairedSessions: repaired,
  remainingMismatchedSessions: after.length,
  remainingCountMismatches: after.filter((row) => row.storedCount !== row.actualCount).length,
}, null, 2));

process.exit(after.length === 0 ? 0 : 1);
