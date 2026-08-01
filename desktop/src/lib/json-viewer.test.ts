import { describe, expect, it } from 'vitest';
import { formatJsonPath, parseJson, serializeJsonValue } from './json-viewer';

describe('json viewer helpers', () => {
  it('formats identifiers, array indexes, and escaped keys as JSONPath', () => {
    expect(formatJsonPath(['users', 2, 'display name'])).toBe('$.users[2]["display name"]');
    expect(formatJsonPath(['quote"key'])).toBe('$["quote\\"key"]');
  });

  it('accepts every valid JSON root type without rewriting it', () => {
    expect(parseJson('null')).toEqual({ ok: true, value: null });
    expect(parseJson('[true, 3, "x"]')).toEqual({ ok: true, value: [true, 3, 'x'] });
  });

  it('reports an invalid document with a source location when available', () => {
    const result = parseJson('{\n  "ok": true,\n  nope\n}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.line).toBe(3);
    expect(result.column).toBeGreaterThan(0);
  });

  it('copies strings as text and containers as formatted JSON', () => {
    expect(serializeJsonValue('hello')).toBe('hello');
    expect(serializeJsonValue({ ok: true })).toBe('{\n  "ok": true\n}');
  });
});
