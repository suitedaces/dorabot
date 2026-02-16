import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main(): Promise<void> {
  const tempHome = mkdtempSync(join(tmpdir(), 'dorabot-test-event-log-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const { insertEvent, queryEvents } = await import('../src/gateway/event-log.js');

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

    console.log('ok - event log replay ordering and cursor filtering');
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
