// url validation — only http/https/about are allowed to reach the browser.
// javascript: and file: and data: are rejected everywhere a url comes from
// outside the user (agent tool output, custom events, chat transcript clicks).
// main-process sinks (browser-controller, browser-ipc) have their own copy
// of this; keep the two in sync.

export function isSafeUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'about:';
  } catch {
    return false;
  }
}

// canonical form for equality checks (tab lookup by url). collapses
// trailing slash, lowercases host, strips default port.
export function normalizeUrl(url: string | undefined | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.toString();
  } catch {
    return url;
  }
}
