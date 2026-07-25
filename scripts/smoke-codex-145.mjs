// smoke test: codex 0.145 upgrade — auth, model catalog, one tiny turn
import { CodexProvider } from '../dist/providers/codex.js';

const provider = new CodexProvider();

const auth = await provider.getAuthStatus();
console.log('auth:', JSON.stringify({ authenticated: auth.authenticated, method: auth.method, plan: auth.planType, health: auth.tokenHealth }));
if (!auth.authenticated) {
  console.log('not authenticated — skipping live turn');
  process.exit(0);
}

const config = {
  provider: { name: 'codex', codex: {} },
  model: 'gpt-5.6-terra',
};

let sawInit = false;
let sawText = false;
let finalResult = '';
const gen = provider.query({
  prompt: 'Reply with exactly: ok-145',
  systemPrompt: 'You are a smoke test. Answer exactly as asked.',
  model: 'gpt-5.6-terra',
  config,
  cwd: process.cwd(),
  env: {},
});

const timeout = setTimeout(() => { console.error('TIMEOUT after 120s'); process.exit(1); }, 120000);

let next = await gen.next();
while (!next.done) {
  const m = next.value;
  if (m.type === 'system' && m.subtype === 'init') { sawInit = true; console.log('init: session', m.session_id, 'model', m.model); }
  if (m.type === 'stream_event' && m.event?.delta?.type === 'text_delta') sawText = true;
  if (m.type === 'result' && !m.subtype?.startsWith('tool')) console.log('result event:', JSON.stringify(m).slice(0, 300));
  next = await gen.next();
}
clearTimeout(timeout);
finalResult = next.value?.result || '';
console.log('final:', JSON.stringify({ result: finalResult, sessionId: next.value?.sessionId, usage: next.value?.usage }));
console.log('checks:', JSON.stringify({ sawInit, sawText, gotOk: finalResult.includes('ok-145') }));
await provider.dispose();
process.exit(finalResult.includes('ok-145') ? 0 : 1);
