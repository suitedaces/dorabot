import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// every palette keeps its text readable: main and secondary text at least 7:1 on the background
const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8');
const MIN = 7;

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function luminance(value: string): number {
  const v = value.trim();
  let rgb: number[];
  const ok = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(v);
  const hex = /^#([0-9a-f]{6})/i.exec(v);
  if (ok) rgb = oklchToLinear(+ok[1], +ok[2], +ok[3]).map(c => Math.min(1, Math.max(0, c)));
  else if (hex) rgb = [0, 2, 4].map(i => toLin(parseInt(hex[1].slice(i, i + 2), 16) / 255));
  else throw new Error(`unparsed color ${v}`);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const palettes = [...css.matchAll(/(:root|\.dark|\[data-palette="([a-z-]+)"\])\s*\{([\s\S]*?)\n\}/g)]
  .map(m => ({ name: m[2] || m[1], vars: Object.fromEntries([...m[3].matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(v => [v[1], v[2]])) }))
  .filter(p => p.vars['background'] && p.vars['muted-foreground'] && p.vars['foreground']);

describe('palette contrast', () => {
  it('finds every palette', () => {
    expect(palettes.length).toBeGreaterThanOrEqual(20);
  });

  for (const p of palettes) {
    it(`${p.name}: text and secondary text are at least ${MIN}:1`, () => {
      expect(ratio(p.vars['foreground'], p.vars['background'])).toBeGreaterThanOrEqual(MIN);
      expect(ratio(p.vars['muted-foreground'], p.vars['background'])).toBeGreaterThanOrEqual(MIN);
    });
  }
});
