import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// follow new content while it streams. scrolling up stops following; scrolling back to the
// bottom (or calling resume) starts it again.
export function useStickToBottom<T extends HTMLElement>(content: unknown, active: boolean) {
  const ref = useRef<T | null>(null);
  const stuck = useRef(true);
  const [detached, setDetached] = useState(false);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 6;
    stuck.current = atBottom;
    setDetached(!atBottom);
  }, []);

  const resume = useCallback(() => {
    const el = ref.current;
    stuck.current = true;
    setDetached(false);
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active || !stuck.current) return;
    el.scrollTop = el.scrollHeight;
  }, [content, active]);

  return { ref, onScroll, detached: active && detached, resume };
}

export function useNow(running: boolean, everyMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [running, everyMs]);
  return now;
}

export function formatDuration(ms: number | undefined): string {
  if (ms == null || !isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}
