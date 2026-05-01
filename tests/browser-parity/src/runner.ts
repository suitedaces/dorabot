// runner — drives test cases one at a time, isolates failures, collects results.
import type { BrowserController, PageId } from '../../../desktop/electron/browser-controller';
import { clearRefs } from '../../../src/browser/refs';

export type TestCtx = {
  controller: BrowserController;
  httpBase: string;
  pageId: PageId;
};

export type TestCase = {
  name: string;
  fixture?: string; // path relative to http base, e.g. "/basic.html"
  timeoutMs?: number;
  run: (ctx: TestCtx) => Promise<void>;
};

export type TestResult = {
  name: string;
  pass: boolean;
  error?: string;
  ms: number;
};

type RunAllOpts = {
  controller: BrowserController;
  httpBase: string;
  cases: TestCase[];
};

const DEFAULT_TIMEOUT_MS = 15_000;

export async function runAll(opts: RunAllOpts): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const tc of opts.cases) {
    const r = await runOne(tc, opts.controller, opts.httpBase);
    results.push(r);
    const tag = r.pass ? 'PASS' : 'FAIL';
    console.log(`[parity] ${tag}  ${tc.name}  (${r.ms}ms)`);
    if (!r.pass && r.error) console.log(`        ${r.error.split('\n')[0]}`);
  }
  return results;
}

async function runOne(
  tc: TestCase,
  controller: BrowserController,
  httpBase: string,
): Promise<TestResult> {
  const started = Date.now();
  let pageId: PageId | null = null;
  try {
    const startUrl = tc.fixture
      ? `${httpBase}${tc.fixture.startsWith('/') ? '' : '/'}${tc.fixture}`
      : 'about:blank';
    pageId = await controller.createPage({ url: startUrl });
    clearRefs(pageId); // fresh table per case

    // wait for the fixture page to be parsed & scripts run. createPage only
    // awaits the navigation start, not DOMContentLoaded.
    if (tc.fixture) await waitForPageReady(controller, pageId, 5000);

    const timeoutMs = tc.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    await withTimeout(tc.run({ controller, httpBase, pageId }), timeoutMs, tc.name);

    return { name: tc.name, pass: true, ms: Date.now() - started };
  } catch (err) {
    return {
      name: tc.name,
      pass: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  } finally {
    if (pageId) {
      try { await controller.destroyPage(pageId); } catch {}
    }
  }
}

// poll document.readyState via the debugger until 'complete' (or timeout).
async function waitForPageReady(
  controller: BrowserController,
  pageId: PageId,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = await controller.sendCdp(pageId, 'Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      }) as { result?: { value?: string } };
      if (out?.result?.value === 'complete') return;
    } catch {
      // page may still be initializing — retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`case "${label}" timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
