// mirror of src/gateway/tool-meta.ts for history loaded from the db (live results arrive already slimmed)
const DROP = new Set([
  'stdout', 'stderr', 'originalFile', 'content', 'file', 'result', 'prompt', 'oldString', 'newString',
  'staleReadFileStateHint', 'backgroundCwdHint',
]);

export type ToolMeta = Record<string, any>;

export function slimToolMeta(raw: unknown): ToolMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: ToolMeta = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (DROP.has(k) || v === undefined) continue;
    if (k === 'results' && Array.isArray(v)) {
      const links: Array<{ title: string; url: string }> = [];
      for (const r of v) {
        const content = r && typeof r === 'object' ? (r as any).content : null;
        if (!Array.isArray(content)) continue;
        for (const c of content) if (c && typeof c.url === 'string') links.push({ title: String(c.title || c.url), url: c.url });
      }
      out.links = links;
      continue;
    }
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
