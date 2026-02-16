import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

function bootstrapLegacyTables(tempHome: string): void {
  const dorabotDir = join(tempHome, '.dorabot');
  mkdirSync(dorabotDir, { recursive: true });
  const db = new Database(join(dorabotDir, 'dorabot.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS board_meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.close();
}

async function main(): Promise<void> {
  const tempHome = mkdtempSync(join(tmpdir(), 'dorabot-test-event-log-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    bootstrapLegacyTables(tempHome);
    const { insertEvent, queryEvents, queryEventsBySessionCursor, deleteEventsUpToSeq } = await import('../src/gateway/event-log.js');

    const s1 = 'desktop:dm:test-a';
    const s2 = 'desktop:dm:test-b';

    const seq1 = insertEvent(s1, 'agent.stream', JSON.stringify({ sessionKey: s1, chunk: 'a1' }));
    const seq2 = insertEvent(s2, 'agent.stream', JSON.stringify({ sessionKey: s2, chunk: 'b1' }));
    const seq3 = insertEvent(s1, 'agent.result', JSON.stringify({ sessionKey: s1, result: 'done' }));

    const all = queryEvents([s1, s2], 0);
    assert.equal(all.length, 3, 'should return all events across subscribed sessions');
    assert.deepEqual(all.map(r => r.seq), [seq1, seq2, seq3], 'events should be globally seq-sorted');

    const after = queryEvents([s1, s2], seq1);
    assert.equal(after.length, 2, 'afterSeq should exclude older events');
    assert.deepEqual(after.map(r => r.seq), [seq2, seq3], 'afterSeq should return strictly newer events');

    const cursorRows = queryEventsBySessionCursor([
      { sessionKey: s1, afterSeq: seq1 },
      { sessionKey: s2, afterSeq: 0 },
    ], 50);
    assert.deepEqual(cursorRows.map(r => r.seq), [seq2, seq3], 'per-session cursor query should merge global ordering');

    // Build a large mixed-session stream and replay it in paged batches.
    const mixedSessions = ['desktop:dm:mix-1', 'desktop:dm:mix-2', 'desktop:dm:mix-3'];
    const expectedSeqs: number[] = [];
    for (let i = 0; i < 1200; i++) {
      const sk = mixedSessions[i % mixedSessions.length];
      const seq = insertEvent(sk, 'agent.stream', JSON.stringify({ sessionKey: sk, idx: i }));
      expectedSeqs.push(seq);
    }

    const cursorBySession = new Map<string, number>(mixedSessions.map((sk) => [sk, 0]));
    const seenSeqs: number[] = [];
    const pageLimit = 137;
    while (true) {
      const batch = queryEventsBySessionCursor(
        mixedSessions.map((sessionKey) => ({
          sessionKey,
          afterSeq: cursorBySession.get(sessionKey) || 0,
        })),
        pageLimit,
      );
      if (batch.length === 0) break;
      for (const row of batch) {
        seenSeqs.push(row.seq);
        cursorBySession.set(row.session_key, row.seq);
      }
      if (batch.length < pageLimit) break;
    }

    assert.equal(seenSeqs.length, expectedSeqs.length, 'paged replay should include every event in the mixed stream');
    assert.deepEqual(seenSeqs, [...expectedSeqs].sort((a, b) => a - b), 'paged replay should remain globally sequence-ordered');

    // prune completed run material and ensure deleted rows are excluded
    const pruneCutoff = expectedSeqs[399];
    deleteEventsUpToSeq('desktop:dm:mix-1', pruneCutoff);
    const afterPrune = queryEventsBySessionCursor([{ sessionKey: 'desktop:dm:mix-1', afterSeq: 0 }], 5000);
    assert(afterPrune.every(row => row.seq > pruneCutoff), 'run-end prune should remove session rows up to cutoff seq');

    console.log('ok - event log cursor replay, paging, ordering, and pruning');
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
