export type FsWatchEvent = {
  eventType: string;
  filename: string | null;
};

export function fsWatchDirectory(filename: string | null): string {
  const rel = filename?.replace(/\\/g, '/') || '';
  const lastSlash = rel.lastIndexOf('/');
  return lastSlash > 0 ? rel.slice(0, lastSlash) : '';
}

export function rememberFsWatchEvent(
  pending: Map<string, FsWatchEvent>,
  event: FsWatchEvent,
): void {
  pending.set(fsWatchDirectory(event.filename), event);
}
