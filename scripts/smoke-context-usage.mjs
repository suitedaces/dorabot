// smoke test: getContextUsage() on a live run (SDK 0.3.258+)
// usage: node scripts/smoke-context-usage.mjs [model]
import { ClaudeProvider } from '../dist/providers/claude.js';

const model = process.argv[2] || 'claude-sonnet-5';
const provider = new ClaudeProvider();

const auth = await provider.getAuthStatus();
if (!auth.authenticated) {
  console.log('not authenticated — skipping');
  process.exit(0);
}

let handle;
let usage = null;
const gen = provider.query({
  prompt: 'Reply with exactly: ok-ctx',
  systemPrompt: 'You are a smoke test. Answer exactly as asked.',
  model,
  config: { provider: { name: 'claude' }, model },
  cwd: process.cwd(),
  env: { ...process.env },
  maxTurns: 1,
  onRunReady: (h) => { handle = h; },
});

const timeout = setTimeout(() => { console.error('TIMEOUT after 120s'); process.exit(1); }, 120000);

let next = await gen.next();
while (!next.done) {
  const m = next.value;
  if (m.type === 'result') {
    // read the breakdown while the run is still live — it comes from the CLI process
    try {
      usage = await handle.getContextUsage('summary');
    } catch (err) {
      console.error('getContextUsage FAILED:', err?.message || err);
    }
    handle?.close();
  }
  next = await gen.next();
}
clearTimeout(timeout);

if (!usage) {
  console.error('no usage returned');
  process.exit(1);
}
const used = usage.categories.filter(c => !c.isDeferred);
console.log('model:', usage.model);
console.log('total:', usage.totalTokens, '/', usage.rawMaxTokens, `(${usage.percentage}%)`);
console.log('categories:', JSON.stringify(used.map(c => [c.name, c.tokens])));
const ok = typeof usage.totalTokens === 'number' && usage.totalTokens > 0
  && typeof usage.percentage === 'number' && used.length > 0;
console.log('checks:', JSON.stringify({ hasTokens: usage.totalTokens > 0, hasCategories: used.length > 0, ok }));
await provider.dispose?.();
process.exit(ok ? 0 : 1);
