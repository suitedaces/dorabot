// test utilities: minimal assert helpers. no framework dep.
export class AssertError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AssertError';
  }
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new AssertError(msg);
}

export function assertEqual<T>(actual: T, expected: T, label = 'value'): void {
  if (actual !== expected) {
    throw new AssertError(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertIncludes(haystack: string, needle: string, label = 'string'): void {
  if (!haystack.includes(needle)) {
    throw new AssertError(`${label}: expected to include ${JSON.stringify(needle)}, got ${JSON.stringify(haystack.slice(0, 200))}`);
  }
}

export function assertMatch(s: string, re: RegExp, label = 'string'): void {
  if (!re.test(s)) {
    throw new AssertError(`${label}: expected to match ${re}, got ${JSON.stringify(s.slice(0, 200))}`);
  }
}

export function assertTruthy<T>(v: T, label = 'value'): asserts v is NonNullable<T> {
  if (v === null || v === undefined || v === '' || v === 0 || v === false) {
    throw new AssertError(`${label}: expected truthy, got ${JSON.stringify(v)}`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// poll a predicate until it returns truthy or we hit the deadline
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 50;
  const label = opts.label ?? 'condition';
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(intervalMs);
  }
  throw new AssertError(`waitFor ${label}: timed out after ${timeoutMs}ms (last=${JSON.stringify(last)})`);
}
