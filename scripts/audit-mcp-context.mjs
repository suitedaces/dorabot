// Attribute the MCP tool-schema context cost per server.
// usage: node scripts/audit-mcp-context.mjs [model]
import { ClaudeProvider } from '../dist/providers/claude.js';

const model = process.argv[2] || 'claude-sonnet-5';
const provider = new ClaudeProvider();

const auth = await provider.getAuthStatus();
if (!auth.authenticated) { console.log('not authenticated'); process.exit(0); }

let handle, usage = null;
const gen = provider.query({
  prompt: 'Reply with exactly: ok',
  systemPrompt: 'Answer exactly as asked.',
  model,
  config: { provider: { name: 'claude' }, model },
  cwd: process.cwd(),
  env: { ...process.env },
  maxTurns: 1,
  onRunReady: (h) => { handle = h; },
});

const timeout = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 180000);
let next = await gen.next();
while (!next.done) {
  if (next.value.type === 'result') {
    try { usage = await handle.getContextUsage('full'); }
    catch (e) { console.error('failed:', e?.message || e); }
    handle?.close();
  }
  next = await gen.next();
}
clearTimeout(timeout);
if (!usage) process.exit(1);

const fmt = (n) => n.toLocaleString();
console.log(`\nmodel: ${usage.model}`);
console.log(`total: ${fmt(usage.totalTokens)} / ${fmt(usage.rawMaxTokens)} (${usage.percentage}%)\n`);

console.log('--- categories ---');
for (const c of usage.categories) {
  console.log(`  ${String(c.tokens).padStart(8)}  ${c.name}${c.isDeferred ? '  [deferred]' : ''}`);
}

const byServer = new Map();
for (const t of usage.mcpTools) {
  const cur = byServer.get(t.serverName) || { tokens: 0, tools: 0, loaded: 0 };
  cur.tokens += t.tokens; cur.tools += 1; if (t.isLoaded) cur.loaded += 1;
  byServer.set(t.serverName, cur);
}
const rows = [...byServer.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
const mcpTotal = rows.reduce((s, [, v]) => s + v.tokens, 0);

console.log(`\n--- MCP tool schemas by server (${fmt(mcpTotal)} tokens, ${usage.mcpTools.length} tools) ---`);
for (const [server, v] of rows) {
  const pct = mcpTotal ? ((v.tokens / mcpTotal) * 100).toFixed(1) : '0';
  console.log(`  ${String(v.tokens).padStart(8)}  ${String(pct).padStart(5)}%  ${server}  (${v.tools} tools, ${v.loaded} loaded)`);
}

console.log('\n--- top 15 individual tools ---');
for (const t of [...usage.mcpTools].sort((a, b) => b.tokens - a.tokens).slice(0, 15)) {
  console.log(`  ${String(t.tokens).padStart(7)}  ${t.serverName}/${t.name}${t.isLoaded ? '' : '  [not loaded]'}`);
}

await provider.dispose?.();
process.exit(0);
