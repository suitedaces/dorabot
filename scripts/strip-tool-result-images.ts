import { getDb } from '../src/db.js';
import { sanitizeStoredSessionContent } from '../src/session/manager.js';

type CandidateRow = {
  id: number;
  session_id: string;
  content: string;
};

type SessionDelta = {
  sessionId: string;
  rows: number;
  reclaimBytes: number;
};

const shouldApply = process.argv.includes('--apply');
const db = getDb();

const rows = db.prepare(`
  SELECT id, session_id, content
  FROM messages
  WHERE type = 'user'
    AND content LIKE '%"tool_result"%'
    AND content LIKE '%"type":"image"%'
`).all() as CandidateRow[];

const update = db.prepare('UPDATE messages SET content = ? WHERE id = ?');

let changedRows = 0;
let beforeBytes = 0;
let afterBytes = 0;
const sessionDeltas = new Map<string, SessionDelta>();

const run = db.transaction(() => {
  for (const row of rows) {
    const parsed = JSON.parse(row.content);
    const sanitized = sanitizeStoredSessionContent(parsed);
    const sanitizedStr = JSON.stringify(sanitized);
    if (sanitizedStr === row.content) continue;

    changedRows++;
    beforeBytes += row.content.length;
    afterBytes += sanitizedStr.length;

    const delta = row.content.length - sanitizedStr.length;
    const session = sessionDeltas.get(row.session_id) || {
      sessionId: row.session_id,
      rows: 0,
      reclaimBytes: 0,
    };
    session.rows += 1;
    session.reclaimBytes += delta;
    sessionDeltas.set(row.session_id, session);

    if (shouldApply) {
      update.run(sanitizedStr, row.id);
    }
  }
});

run();

const topSessions = Array.from(sessionDeltas.values())
  .sort((a, b) => b.reclaimBytes - a.reclaimBytes)
  .slice(0, 10)
  .map((session) => ({
    sessionId: session.sessionId,
    rows: session.rows,
    reclaimMb: Number((session.reclaimBytes / 1048576).toFixed(1)),
  }));

console.log(JSON.stringify({
  mode: shouldApply ? 'apply' : 'dry-run',
  candidateRows: rows.length,
  changedRows,
  reclaimBytes: beforeBytes - afterBytes,
  reclaimMb: Number(((beforeBytes - afterBytes) / 1048576).toFixed(1)),
  topSessions,
  nextStep: shouldApply ? 'run VACUUM separately to shrink dorabot.db on disk' : 're-run with --apply to rewrite stored blobs',
}, null, 2));
