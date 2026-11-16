import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { addWatch, cancelWatch, loadWatches, MIN_INTERVAL_SEC, DEFAULT_INTERVAL_SEC } from '../watch/watcher.js';

export const watchTool = tool(
  'watch',
  `Watch a long-running job without polling it yourself. The gateway re-runs a cheap status command every intervalSec with no LLM, and pushes to the chat that set the watch (and to the channel, if given) only when the output changes, or when \`until\` matches. Use it whenever a command you started outlives this turn (modal run, training script, long build, deploy, download): set the watch, then end your turn. Do not sleep-and-recheck in a loop and do not ask the user to check back. The status command must be cheap and finish in under 60 s (a log tail, a status call, a file count). Set \`wake: true\` when you need to act on completion (the gateway starts a new turn in this chat with the final output); leave it false for plain progress pushes.`,
  {
    summary: z.string().describe('What is being watched, a few words, e.g. "probe eval on Modal"'),
    command: z.string().describe('Cheap shell command that prints the current state (zsh -lc)'),
    intervalSec: z.number().optional().describe(`Seconds between runs (min ${MIN_INTERVAL_SEC}, default ${DEFAULT_INTERVAL_SEC})`),
    until: z.string().optional().describe('Regex; when the output matches, the watch is done and pushes once more'),
    notify: z.enum(['change', 'done']).optional().describe('change (default): push every time the output differs; done: push only when until matches'),
    wake: z.boolean().optional().describe('On done, start a new agent turn in this chat with the final output (default false)'),
    cwd: z.string().optional().describe('Working directory for the command'),
    expiresInSec: z.number().optional().describe('Stop watching after this long (default 24 h)'),
    channel: z.string().optional().describe('Also push to this messaging channel (telegram, whatsapp). Defaults to the channel this chat came from.'),
    chatId: z.string().optional().describe('Chat id on that channel'),
    sessionKey: z.string().optional().describe('Filled in by the gateway, leave empty'),
  },
  async (args) => {
    try {
      const w = addWatch(args);
      return {
        content: [{
          type: 'text' as const,
          text: `Watching.\nID: ${w.id}\nEvery ${w.intervalSec}s${w.until ? `, done when /${w.until}/ matches` : ''}, pushes on ${w.notify}${w.wake ? ', wakes you on done' : ''}. Expires ${w.expiresAt}.\nYou can end the turn now; the gateway takes it from here.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Failed to set watch: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

export const listWatchesTool = tool(
  'list_watches',
  'List active watches (and recently finished ones) with their last output.',
  {},
  async () => {
    const watches = loadWatches().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (watches.length === 0) return { content: [{ type: 'text' as const, text: 'No watches.' }] };
    const text = watches.map(w => {
      const last = w.lastOutput ? w.lastOutput.trimEnd().split('\n').slice(-3).join('\n') : '(not run yet)';
      return `${w.id} - ${w.summary} [${w.status}]\n  every ${w.intervalSec}s${w.until ? `, until /${w.until}/` : ''}, ${w.ticks} runs, ${w.pushes} pushes\n  command: ${w.command}\n  last: ${last}`;
    }).join('\n\n');
    return { content: [{ type: 'text' as const, text }] };
  }
);

export const cancelWatchTool = tool(
  'cancel_watch',
  'Stop a watch by ID.',
  { id: z.string().describe('The watch ID') },
  async (args) => {
    const w = cancelWatch(args.id);
    if (!w) return { content: [{ type: 'text' as const, text: `Watch not found: ${args.id}` }], isError: true };
    return { content: [{ type: 'text' as const, text: `Cancelled: ${w.id} (${w.summary})` }] };
  }
);

export const watchTools = [watchTool, listWatchesTool, cancelWatchTool];
