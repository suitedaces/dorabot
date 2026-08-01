import * as path from 'path';

// Pure path logic for the dorabot-preview:// handler, kept out of main.ts so it
// can be tested without booting Electron.

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// Resolve a request path inside the approved root, refusing anything that
// climbs out of it. A preview may only read the folder the user opened.
export function resolveWithinRoot(root: string, requestPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  rel = rel.replace(/^\/+/, '');
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  return abs === base || abs.startsWith(base + path.sep) ? abs : null;
}
