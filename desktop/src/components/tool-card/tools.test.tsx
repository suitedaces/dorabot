import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatItem } from '@/hooks/useGateway';
import { buildDisplay } from './ToolList';
import { describeTool, type ToolCtx, type ToolItem } from './tools';

const ctx: ToolCtx = { live: false, turnRunning: false, backgroundRunning: new Set(), progressByToolUse: new Map(), depth: 0 };
const tool = (name: string, input: object, extra: Partial<ToolItem> = {}): ToolItem =>
  ({ type: 'tool_use', id: Math.random().toString(36).slice(2), name, input: JSON.stringify(input), timestamp: 1, ...extra });
const facts = (item: ToolItem, c: ToolCtx = ctx) => renderToStaticMarkup(<>{describeTool(item, c).facts}</>).replace(/<[^>]+>/g, '');

describe('buildDisplay', () => {
  it('groups back-to-back tools and thinking, text breaks the group', () => {
    const items: ChatItem[] = [
      { type: 'user', content: 'go', timestamp: 0 },
      tool('Bash', { command: 'ls' }, { output: 'a' }),
      { type: 'thinking', content: 'hm', timestamp: 2 },
      tool('Read', { file_path: '/x' }, { output: '1\tx' }),
      { type: 'text', content: 'done', timestamp: 3 },
      tool('Bash', { command: 'pwd' }, { output: '/' }),
    ];
    const d = buildDisplay(items);
    expect(d.map(x => x.type)).toEqual(['item', 'activity', 'item', 'activity']);
    const g = d[1] as Extract<typeof d[number], { type: 'activity' }>;
    expect(g.items).toHaveLength(3);
    expect([g.index, g.lastIndex]).toEqual([1, 3]);
  });

  it('leaves an unanswered question to the question panel', () => {
    const d = buildDisplay([tool('AskUserQuestion', { questions: [] })]);
    expect(d).toHaveLength(0);
  });
});

describe('describeTool', () => {
  it('reads the real exit code from the bash error text', () => {
    const item = tool('Bash', { command: 'python3 -c "import reportlab"' }, { output: "Exit code 1\nTraceback (most recent call last):", is_error: true });
    expect(describeTool(item, ctx).status).toBe('error');
    expect(facts(item)).toBe('exit 1');
  });

  it('names denials and interrupts instead of calling them failures', () => {
    const denied = tool('Bash', { command: 'rm -rf /tmp/x' }, { output: "The user doesn't want to proceed with this tool use. The tool use was rejected", is_error: true });
    expect(facts(denied)).toBe('denied by you');
    const stopped = tool('Bash', { command: 'sleep 9' }, { output: '[Request interrupted by user for tool use]', is_error: true });
    expect(facts(stopped)).toBe('you stopped it');
  });

  it('a tool with no result is running in a live turn and stopped after it', () => {
    const item = tool('Bash', { command: 'make' });
    expect(describeTool(item, { ...ctx, turnRunning: true }).status).toBe('running');
    expect(describeTool(item, ctx).status).toBe('stopped');
  });

  it('keeps every websearch source, from meta or from the result text', () => {
    const links = Array.from({ length: 19 }, (_, i) => ({ title: `t${i}`, url: `https://s${i}.example.com/a` }));
    expect(facts(tool('WebSearch', { query: 'q' }, { output: 'summary', meta: { links } }))).toBe('19 sources');
    const text = `Web search results for query: "q"\n\nLinks: ${JSON.stringify(links.slice(0, 12))}\n\nsummary`;
    expect(facts(tool('WebSearch', { query: 'q' }, { output: text }))).toBe('12 sources');
  });

  it('counts edit lines from the sdk patch', () => {
    const item = tool('Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' }, {
      output: 'updated',
      meta: { structuredPatch: [{ oldStart: 10, oldLines: 2, newStart: 10, newLines: 3, lines: [' x', '-a', '+b', '+c'] }] },
    });
    expect(facts(item)).toBe('+2 −1');
  });

  it('shows the read range and total from the file facts', () => {
    const item = tool('Read', { file_path: '/a.ts' }, { output: '40\tx\n41\ty', meta: { type: 'text', file: { filePath: '/a.ts', startLine: 40, numLines: 2, totalLines: 90 } } });
    const spec = describeTool(item, ctx);
    expect(spec.target).toBe('/a.ts  lines 40-41');
    expect(facts(item)).toBe('2 of 90 lines');
  });

  it('a background command is running while its task is', () => {
    const item = tool('Bash', { command: 'sleep 100', run_in_background: true }, { output: 'Command running in background with ID: b1. Output is being written to: /tmp/x.output', meta: { backgroundTaskId: 'b1' } });
    expect(describeTool(item, { ...ctx, backgroundRunning: new Set(['b1']) }).status).toBe('running');
    expect(describeTool(item, ctx).status).toBe('ok');
  });

  it('mcp tools get the server as a tag and a generic body', () => {
    const spec = describeTool(tool('mcp__Neon__run_sql', { sql: 'select 1' }, { output: '[{"n":1}]' }), ctx);
    expect(spec.verb).toBe('run sql');
    expect(spec.target).toBe('select 1');
    expect(renderToStaticMarkup(<>{spec.body!()}</>)).toContain('<table');
  });
});
