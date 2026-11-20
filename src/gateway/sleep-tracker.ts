// the gateway's timers freeze while the mac sleeps. power nap dark-wakes it for a few seconds
// every ~16 minutes, so one sleep shows up as a train of clock jumps. this merges them into one
// period, and reports the period once the mac has stayed awake for a bit.

export type SleepPeriod = { start: number; end: number; ms: number };

export type SleepTick = {
  // the sweep that just ran saw a clock jump: the mac was asleep until `now`
  jumped: boolean;
  // a sleep period ended and the mac stayed awake long enough to call it over
  settled: SleepPeriod | null;
};

export type SleepStatus = {
  asleepSince: number | null;
  periods: SleepPeriod[];
};

// a tick this late past its interval means the process was frozen, not just busy
export const SLEEP_JUMP_MIN_MS = 60_000;
// wake windows shorter than this between two jumps belong to the same sleep
export const SLEEP_MERGE_WITHIN_MS = 60_000;
// awake this long after the last jump = the sleep is over
export const SLEEP_SETTLE_MS = 30_000;
const KEEP_PERIODS = 50;

export class SleepTracker {
  private lastTick: number;
  private open: SleepPeriod | null = null;
  private periods: SleepPeriod[] = [];

  constructor(now = Date.now()) {
    this.lastTick = now;
  }

  tick(now: number, intervalMs: number): SleepTick {
    const prev = this.lastTick;
    this.lastTick = now;
    const late = now - prev - intervalMs;

    if (late > SLEEP_JUMP_MIN_MS) {
      const start = prev;
      if (this.open && start - this.open.end <= SLEEP_MERGE_WITHIN_MS) {
        this.open.end = now;
        this.open.ms = this.open.end - this.open.start;
      } else {
        if (this.open) this.push(this.open);
        this.open = { start, end: now, ms: now - start };
      }
      return { jumped: true, settled: null };
    }

    if (this.open && now - this.open.end >= SLEEP_SETTLE_MS) {
      const settled = this.open;
      this.open = null;
      this.push(settled);
      return { jumped: false, settled };
    }
    return { jumped: false, settled: null };
  }

  status(): SleepStatus {
    return {
      asleepSince: this.open ? this.open.start : null,
      periods: [...this.periods],
    };
  }

  private push(p: SleepPeriod): void {
    this.periods.push(p);
    if (this.periods.length > KEEP_PERIODS) this.periods.splice(0, this.periods.length - KEEP_PERIODS);
  }
}

export function formatSleepPeriod(p: SleepPeriod): string {
  const mins = Math.round(p.ms / 60_000);
  const dur = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${dur} (${hhmm(p.start)}-${hhmm(p.end)})`;
}
