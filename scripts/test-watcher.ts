import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main(): Promise<void> {
  const tempHome = mkdtempSync(join(tmpdir(), 'dorabot-test-watcher-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  mkdirSync(join(tempHome, '.dorabot'), { recursive: true });

  try {
    const { addWatch, cancelWatch, getWatch, startWatcher, runShellCommand, formatWatchEvent } = await import('../src/watch/watcher.js');
    type Ev = { id: string; reason: string; output: string };
    const events: Ev[] = [];
    const outputs = new Map<string, string[]>();
    const watcher = startWatcher({
      tickIntervalMs: 3_600_000,
      silent: true,
      runCommand: async (w) => {
        const q = outputs.get(w.id) || [];
        const output = q.length > 1 ? q.shift()! : q[0] ?? '';
        return { output, exitCode: 0 };
      },
      onEvent: (e) => { events.push({ id: e.watch.id, reason: e.reason, output: e.output }); },
    });
    // the start tick ran with no watches; everything below drives ticks by hand
    const { saveWatch } = await import('../src/watch/watcher.js');
    const makeDue = (id: string) => { const w = getWatch(id)!; w.lastRunAt = new Date(0).toISOString(); saveWatch(w); };

    // interval floor + defaults
    const a = addWatch({ summary: 'a', command: 'true', intervalSec: 1 });
    assert.equal(a.intervalSec, 30);
    assert.equal(a.notify, 'change');
    assert.equal(a.wake, false);

    // change: first tick is the baseline (no push), second tick with same output stays quiet, third with new output pushes
    outputs.set(a.id, ['step 1', 'step 1', 'step 2']);
    await watcher.tick();
    assert.equal(events.length, 0, 'first tick is baseline');
    makeDue(a.id); await watcher.tick();
    assert.equal(events.length, 0, 'same output, no push');
    makeDue(a.id); await watcher.tick();
    assert.deepEqual(events.map(e => e.reason), ['change']);
    assert.equal(events[0].output, 'step 2');
    assert.equal(getWatch(a.id)!.ticks, 3);
    assert.equal(getWatch(a.id)!.pushes, 1);

    // not due: no run
    await watcher.tick();
    assert.equal(getWatch(a.id)!.ticks, 3, 'interval respected');

    // until: done on the first tick that matches, even on the baseline tick; status flips, no further runs
    events.length = 0;
    const b = addWatch({ summary: 'b', command: 'true', until: '^DONE', notify: 'done' });
    outputs.set(b.id, ['running', 'running', 'DONE 40/40']);
    await watcher.tick();
    makeDue(b.id); await watcher.tick();
    assert.equal(events.length, 0, 'notify=done stays quiet on change');
    makeDue(b.id); await watcher.tick();
    assert.deepEqual(events.map(e => [e.id, e.reason]), [[b.id, 'done']]);
    assert.equal(getWatch(b.id)!.status, 'done');
    makeDue(b.id); await watcher.tick();
    assert.equal(getWatch(b.id)!.ticks, 3, 'done watches stop running');

    // expiry pushes once and stops
    events.length = 0;
    const c = addWatch({ summary: 'c', command: 'true', expiresInSec: 0 });
    outputs.set(c.id, ['x']);
    await watcher.tick();
    assert.deepEqual(events.map(e => e.reason), ['expired']);
    assert.equal(getWatch(c.id)!.status, 'expired');
    await watcher.tick();
    assert.equal(events.length, 1);

    // cancel
    const d = addWatch({ summary: 'd', command: 'true' });
    assert.equal(cancelWatch(d.id)!.status, 'cancelled');
    outputs.set(d.id, ['x']);
    await watcher.tick();
    assert.equal(getWatch(d.id)!.ticks, 0);

    // bad regex rejected up front
    assert.throws(() => addWatch({ summary: 'e', command: 'true', until: '(' }));

    // real shell: stdout + exit code
    const real = await runShellCommand({ ...a, command: 'printf "one\\ntwo"; exit 3' });
    assert.equal(real.output, 'one\ntwo');
    assert.equal(real.exitCode, 3);

    // push text shows the tail, done wording
    const text = formatWatchEvent({ watch: getWatch(b.id)!, reason: 'done', output: 'DONE 40/40' });
    assert.match(text, /"b" done/);
    assert.match(text, /DONE 40\/40/);

    watcher.stop();
    console.log('ok - watcher: baseline, change, interval, until/done, expiry, cancel, shell');
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
