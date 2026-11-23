import { describe, expect, it } from 'vitest';
import { sessionMessagesToChatItems } from './useGateway';

const ts = (n: number) => new Date(1_790_000_000_000 + n * 1000).toISOString();
const user = (n: number, text: string) => ({ type: 'user' as const, timestamp: ts(n), content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } } });
const toolUse = (n: number, id: string, name = 'Bash') => ({ type: 'assistant' as const, timestamp: ts(n), content: { type: 'assistant', uuid: `a${n}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] } } });
const toolResult = (n: number, id: string, text: string) => ({ type: 'user' as const, timestamp: ts(n), content: { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } } });
const taskStarted = (n: number, task: string, id: string) => ({ type: 'system' as const, timestamp: ts(n), content: { type: 'system', subtype: 'task_started', task_id: task, tool_use_id: id } });
const taskUpdated = (n: number, task: string) => ({ type: 'system' as const, timestamp: ts(n), content: { type: 'system', subtype: 'task_updated', task_id: task, patch: { status: 'completed' } } });

// pages start at a message the user typed, the way sessions.get cuts them
function stitch(messages: any[], cuts: number[]) {
  const pages = [0, ...cuts].map((start, i, all) => messages.slice(start, all[i + 1] ?? messages.length)).reverse();
  let { items, carry } = sessionMessagesToChatItems(pages[0]);
  for (const page of pages.slice(1)) {
    const r = sessionMessagesToChatItems([...page, ...carry], true);
    items = [...r.items, ...items];
    carry = r.carry;
  }
  return items;
}

describe('history pages', () => {
  it('a result that lands after your next message still reaches its call', () => {
    const messages = [user(0, 'run it'), toolUse(1, 't1'), user(2, 'also this'), toolResult(3, 't1', 'done'), toolUse(4, 't2'), toolResult(5, 't2', 'ok')];
    expect(stitch(messages, [2])).toEqual(sessionMessagesToChatItems(messages).items);
    expect(stitch(messages, [2]).find(i => i.type === 'tool_use' && i.id === 't1')).toMatchObject({ output: 'done' });
  });

  it('a background task that ends in a later page is marked ended', () => {
    const messages = [user(0, 'start'), toolUse(1, 'bg'), toolResult(2, 'bg', 'started'), taskStarted(3, 'k1', 'bg'), user(4, 'next'), taskUpdated(5, 'k1')];
    const items = stitch(messages, [4]);
    expect(items).toEqual(sessionMessagesToChatItems(messages).items);
    expect(items.find(i => i.type === 'tool_use' && i.id === 'bg')).toMatchObject({ meta: { bgStatus: 'completed' } });
  });

  it('a subagent cut off by the page end closes like it would at your next message', () => {
    const messages = [user(0, 'go'), toolUse(1, 'ag', 'Agent'), user(2, 'stop')];
    expect(stitch(messages, [2])).toEqual(sessionMessagesToChatItems(messages).items);
  });
});
