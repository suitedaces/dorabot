// smoke test: PostModelSwitch hook fires on a mid-run setModel (SDK 0.3.258+)
import { ClaudeProvider } from '../dist/providers/claude.js';

const from = process.argv[2] || 'claude-sonnet-5';
const to = process.argv[3] || 'claude-fable-5-1';
const provider = new ClaudeProvider();

const auth = await provider.getAuthStatus();
if (!auth.authenticated) {
  console.log('not authenticated — skipping');
  process.exit(0);
}

const fired = [];
const capture = async (input) => {
  if (input.hook_event_name === 'PreModelSwitch' || input.hook_event_name === 'PostModelSwitch') {
    fired.push({ event: input.hook_event_name, from: input.from_model, to: input.to_model, source: input.source });
  }
  return { continue: true };
};

let handle;
let switched = false;
const gen = provider.query({
  prompt: 'Reply with exactly: one',
  systemPrompt: 'You are a smoke test. Answer exactly as asked.',
  model: from,
  config: { provider: { name: 'claude' }, model: from },
  cwd: process.cwd(),
  env: { ...process.env },
  maxTurns: 2,
  hooks: {
    PreModelSwitch: [{ hooks: [capture] }],
    PostModelSwitch: [{ hooks: [capture] }],
  },
  onRunReady: (h) => { handle = h; },
});

const timeout = setTimeout(() => { console.error('TIMEOUT after 150s'); process.exit(1); }, 150000);

let next = await gen.next();
while (!next.done) {
  const m = next.value;
  if (m.type === 'result') {
    if (!switched) {
      switched = true;
      await handle.setModel(to);          // should trigger the hooks, source 'sdk'
      handle.inject('Reply with exactly: two');
    } else {
      handle?.close();
    }
  }
  next = await gen.next();
}
clearTimeout(timeout);

console.log('hooks fired:', JSON.stringify(fired, null, 2));
const gotPost = fired.some(f => f.event === 'PostModelSwitch' && f.to === to);
console.log('checks:', JSON.stringify({ anyFired: fired.length > 0, gotPostSwitchToTarget: gotPost }));
await provider.dispose?.();
process.exit(gotPost ? 0 : 1);
