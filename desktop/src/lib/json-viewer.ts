export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonPathSegment = string | number;

export type JsonParseResult =
  | { ok: true; value: JsonValue }
  | { ok: false; message: string; line?: number; column?: number };

export function formatJsonPath(path: JsonPathSegment[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`;
    if (/^[A-Za-z_$][\w$]*$/.test(segment)) return `${result}.${segment}`;
    return `${result}[${JSON.stringify(segment)}]`;
  }, '$');
}

export function jsonPathKey(path: JsonPathSegment[]): string {
  return JSON.stringify(path);
}

export function parseJson(content: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(content) as JsonValue };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lineColumn = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineColumn) {
      return {
        ok: false,
        message,
        line: Number(lineColumn[1]),
        column: Number(lineColumn[2]),
      };
    }

    const position = message.match(/position\s+(\d+)/i);
    if (!position) return { ok: false, message };

    const offset = Math.min(Number(position[1]), content.length);
    const before = content.slice(0, offset);
    const lines = before.split('\n');
    return {
      ok: false,
      message,
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
    };
  }
}

export function serializeJsonValue(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return String(value);
  return JSON.stringify(value, null, 2);
}
