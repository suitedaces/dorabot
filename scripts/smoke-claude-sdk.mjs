// smoke test: claude-agent-sdk upgrade — auth, one tiny turn on the default model
import { ClaudeProvider } from '../dist/providers/claude.js';

const model = process.argv[2] || 'claude-sonnet-5';
const provider = new ClaudeProvider();

const auth = await provider.getAuthStatus();
console.log('auth:', JSON.stringify({ authenticated: auth.authenticated, method: auth.method, plan: auth.planType, cli: auth.cliVersion }));
if (!auth.authenticated) {
  console.log('not authenticated — skipping live turn');
  process.exit(0);
}

const config = { provider: { name: 'claude' }, model };

let sawInit = false;
let sawText = false;
let handle;
const gen = provider.query({
  prompt: 'Reply with exactly: ok-sdk',
  systemPrompt: 'You are a smoke test. Answer exactly as asked.',
  model,
  config,
  cwd: process.cwd(),
  env: { ...process.env },
  maxTurns: 1,
  onRunReady: (h) => { handle = h; },
});

const timeout = setTimeout(() => { console.error('TIMEOUT after 120s'); process.exit(1); }, 120000);

let next = await gen.next();
while (!next.done) {
  const m = next.value;
  if (m.type === 'system' && m.subtype === 'init') { sawInit = true; console.log('init: session', m.session_id, 'model', m.model, 'cli', m.slash_commands ? '' : '', m.capabilities ? `capabilities=${JSON.stringify(m.capabilities)}` : '(no capabilities field)'); }
  if (m.type === 'stream_event' && m.event?.delta?.type === 'text_delta') sawText = true;
  // close the input generator after the turn result so query() can finish
  if (m.type === 'result') handle?.close();
  next = await gen.next();
}
clearTimeout(timeout);
const finalResult = next.value?.result || '';
console.log('final:', JSON.stringify({ result: finalResult, sessionId: next.value?.sessionId, usage: next.value?.usage }));
console.log('checks:', JSON.stringify({ sawInit, sawText, gotOk: finalResult.includes('ok-sdk') }));
await provider.dispose?.();
process.exit(finalResult.includes('ok-sdk') ? 0 : 1);
