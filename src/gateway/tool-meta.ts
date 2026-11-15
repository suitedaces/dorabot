// structured tool result data for the desktop cards. the sdk attaches it to each tool result as
// `tool_use_result`; we drop fields that repeat the result text or the tool input (stdout, file
// contents, prompts) and keep the small facts the cards show.

const DROP = new Set([
  'stdout', 'stderr', 'originalFile', 'content', 'file', 'result', 'prompt', 'oldString', 'newString',
  'staleReadFileStateHint', 'backgroundCwdHint',
]);

export type ToolMeta = Record<string, unknown>;

export function slimToolMeta(raw: unknown): ToolMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: ToolMeta = {};
  for (const [k, v] of Object.entries(src)) {
    if (DROP.has(k) || v === undefined) continue;
    if (k === 'results' && Array.isArray(v)) {
      // websearch: keep the links, the summary text already is the tool result
      const links: Array<{ title: string; url: string }> = [];
      for (const r of v) {
        if (!r || typeof r !== 'object') continue;
        const content = (r as Record<string, unknown>).content;
        if (!Array.isArray(content)) continue;
        for (const c of content) {
          if (c && typeof c === 'object' && typeof (c as any).url === 'string') {
            links.push({ title: String((c as any).title || (c as any).url), url: (c as any).url });
          }
        }
      }
      out.links = links;
      continue;
    }
    out[k] = v;
  }
  // write: content lives in the tool input; keep only whether it created or replaced the file
  return Object.keys(out).length ? out : undefined;
}
