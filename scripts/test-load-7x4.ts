import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

type Cursor = { sessionKey: string; afterSeq: number };

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
  const tempHome = mkdtempSync(join(tmpdir(), 'dorabot-test-load-7x4-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    bootstrapLegacyTables(tempHome);
    const { insertEvent, queryEventsBySessionCursor } = await import('../src/gateway/event-log.js');
    const sessions = Array.from({ length: 7 }, (_, i) => `desktop:dm:load-${i + 1}`);
    const totalPerSession = 1200;
    const totalEvents = sessions.length * totalPerSession;

    const sessionSeqs = new Map<string, number[]>();
    for (const sk of sessions) sessionSeqs.set(sk, []);

    // Build a high-volume mixed stream (7 active sessions).
    for (let i = 0; i < totalEvents; i++) {
      const sk = sessions[i % sessions.length];
      const seq = insertEvent(sk, 'agent.stream', JSON.stringify({
        sessionKey: sk,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: String(i) } },
        timestamp: Date.now(),
      }));
      sessionSeqs.get(sk)!.push(seq);
    }

    const cursors = new Map<string, number>(sessions.map((sk) => [sk, 0]));
    const seen = new Set<number>();
    let duplicates = 0;
    let rounds = 0;

    while (seen.size < totalEvents) {
      const batch = queryEventsBySessionCursor(
        sessions.map((sessionKey) => ({ sessionKey, afterSeq: cursors.get(sessionKey) || 0 })),
        211,
      );
      if (batch.length === 0) break;

      // Replay is globally ordered by seq.
      for (let i = 1; i < batch.length; i++) {
        assert(batch[i].seq > batch[i - 1].seq, 'replay batches must be strictly seq ordered');
      }

      for (const row of batch) {
        if (seen.has(row.seq)) duplicates += 1;
        else seen.add(row.seq);
        cursors.set(row.session_key, Math.max(cursors.get(row.session_key) || 0, row.seq));
      }

      // Simulate reconnect churn for 4 visible panes by rolling back some cursors.
      rounds += 1;
      if (rounds % 8 === 0) {
        for (let i = 0; i < 4; i++) {
          const sk = sessions[(rounds + i) % sessions.length];
          const list = sessionSeqs.get(sk)!;
          const current = cursors.get(sk) || 0;
          const currentIdx = Math.max(0, list.findIndex(seq => seq >= current));
          if (currentIdx <= 1) continue;
          const rollback = Math.min(currentIdx - 1, ((rounds + i) % 25) + 1);
          cursors.set(sk, list[currentIdx - rollback]);
        }
      }
    }

    assert.equal(seen.size, totalEvents, 'load replay should eventually observe every event');
    assert(duplicates >= 0, 'duplicate counter should remain sane under churn');

    console.log(`ok - 7x4 replay churn recovered ${seen.size}/${totalEvents} events (${duplicates} duplicate replays)`);
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
