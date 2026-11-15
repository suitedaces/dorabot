// smoke test: codex auth, one turn that runs a real shell tool. usage: node scripts/smoke-codex.mjs [model] [--fast]
import { CodexProvider } from '../dist/providers/codex.js';

const model = process.argv.slice(2).find(a => !a.startsWith('--')) || 'gpt-6.1-sol';
const fastMode = process.argv.includes('--fast');
const provider = new CodexProvider();

const auth = await provider.getAuthStatus();
console.log('auth:', JSON.stringify({ authenticated: auth.authenticated, method: auth.method, health: auth.tokenHealth, error: auth.error }));
if (!auth.authenticated) process.exit(1);

// the provider reads the model from provider.codex.model, like the app does
const config = { provider: { name: 'codex', codex: { model } } };
const gen = provider.query({
  prompt: 'Run the shell command `echo tool-ok-$((6*7))` and reply with exactly what it printed.',
  systemPrompt: 'You are a smoke test.',
  config,
  cwd: process.cwd(),
  env: {},
  fastMode,
});

const timeout = setTimeout(() => { console.error('TIMEOUT after 180s'); process.exit(1); }, 180000);
let initModel = '';
const tools = [];
let next = await gen.next();
while (!next.done) {
  const m = next.value;
  if (m.type === 'system' && m.subtype === 'init') initModel = m.model;
  if (m.type === 'assistant') for (const b of m.message?.content || []) if (b.type === 'tool_use') tools.push(b.name);
  next = await gen.next();
}
clearTimeout(timeout);
const result = String(next.value?.result || '');
const checks = { model: initModel === model, ranTool: tools.length > 0, gotOutput: result.includes('tool-ok-42') };
console.log('result:', JSON.stringify(result.slice(0, 200)), 'tools:', tools.join(','));
console.log('checks:', JSON.stringify(checks));
await provider.dispose();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
