import yaml from 'js-yaml';

// yaml only. gray-matter eval'd `---js` frontmatter and skill files can come from the marketplace
const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(raw: string): { data: Record<string, any>; content: string } {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {}, content: text };
  const loaded = match[1] ? yaml.load(match[1]) : undefined;
  const data = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded as Record<string, any> : {};
  return { data, content: text.slice(match[0].length) };
}
