// mirror of src/gateway/tool-meta.ts for history loaded from the db (live results arrive already slimmed)
const DROP = new Set([
  'stdout', 'stderr', 'originalFile', 'content', 'result', 'prompt', 'oldString', 'newString',
  'staleReadFileStateHint', 'backgroundCwdHint',
]);

export type ToolMeta = Record<string, any>;

export function slimToolMeta(raw: unknown): ToolMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: ToolMeta = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (DROP.has(k) || v === undefined) continue;
    if (k === 'file' && v && typeof v === 'object') {
      // read: keep path and line facts, drop the text or image bytes
      const { content: _c, base64: _b, ...facts } = v as Record<string, unknown>;
      out.file = facts;
      continue;
    }
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
