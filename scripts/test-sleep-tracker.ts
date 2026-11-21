import assert from 'node:assert/strict';
import { SleepTracker, SLEEP_SETTLE_MS, formatSleepPeriod } from '../src/gateway/sleep-tracker.js';

const SWEEP = 5_000;
const MIN = 60_000;

function run(): void {
  // steady sweeps: nothing
  {
    const t = new SleepTracker(0);
    let now = 0;
    for (let i = 0; i < 100; i++) {
      now += SWEEP;
      const r = t.tick(now, SWEEP);
      assert.equal(r.jumped, false);
      assert.equal(r.settled, null);
    }
    assert.deepEqual(t.status(), { asleepSince: null, periods: [] });
  }

  // a busy event loop that is 20 s late is not sleep
  {
    const t = new SleepTracker(0);
    const r = t.tick(SWEEP + 20_000, SWEEP);
    assert.equal(r.jumped, false);
    assert.equal(t.status().asleepSince, null);
  }

  // power nap: 16 min sleeps with 3 s dark wakes, one sweep per wake, then a real wake.
  // one merged period, reported once, 30 s after the last jump.
  {
    const t = new SleepTracker(0);
    let now = 0;
    const start = now;
    let jumps = 0;
    for (let i = 0; i < 6; i++) {
      now += 16 * MIN;
      const r = t.tick(now, SWEEP);
      assert.equal(r.jumped, true, `wake ${i} should register as a jump`);
      assert.equal(r.settled, null, 'no period reported while still napping');
      assert.equal(t.status().asleepSince, start, 'asleepSince stays at the first jump');
      jumps++;
      now += 3_000; // dark wake lasts 3 s, next sweep lands inside the next sleep
    }
    assert.equal(jumps, 6);
    const lastEnd = now - 3_000;

    // real wake: regular sweeps resume
    let settled = null;
    let ticks = 0;
    while (!settled && ticks < 20) {
      now += SWEEP;
      ticks++;
      settled = t.tick(now, SWEEP).settled;
    }
    assert.ok(settled, 'period should settle after the mac stays awake');
    assert.equal(settled!.start, start);
    assert.equal(settled!.end, lastEnd);
    assert.ok(now - lastEnd >= SLEEP_SETTLE_MS, 'settles only after SLEEP_SETTLE_MS awake');
    assert.ok(now - lastEnd < SLEEP_SETTLE_MS + SWEEP, 'and not much later');
    const s = t.status();
    assert.equal(s.asleepSince, null);
    assert.equal(s.periods.length, 1);
    assert.equal(s.periods[0].ms, lastEnd - start);
    assert.match(formatSleepPeriod(s.periods[0]), /^1h 36m \(/);

    // the next sweep reports nothing new
    now += SWEEP;
    assert.deepEqual(t.tick(now, SWEEP), { jumped: false, settled: null });
  }

  // two sleeps separated by a real 5 min wake are two periods
  {
    const t = new SleepTracker(0);
    let now = 0;
    now += 2 * 60 * MIN; // 2 h asleep
    assert.equal(t.tick(now, SWEEP).jumped, true);
    for (let i = 0; i < 60; i++) { now += SWEEP; t.tick(now, SWEEP); } // 5 min awake
    assert.equal(t.status().periods.length, 1);
    now += 30 * MIN; // 30 min asleep
    assert.equal(t.tick(now, SWEEP).jumped, true);
    for (let i = 0; i < 10; i++) { now += SWEEP; t.tick(now, SWEEP); }
    const s = t.status();
    assert.equal(s.periods.length, 2);
    assert.equal(s.periods[0].ms, 2 * 60 * MIN);
    assert.equal(s.periods[1].ms, 30 * MIN);
    assert.equal(formatSleepPeriod(s.periods[1]).slice(0, 3), '30m');
  }

  console.log('test-sleep-tracker: ok');
}

run();
