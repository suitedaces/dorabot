/**
 * BrowserView — the renderer-side tab UI for an embedded browser tab.
 *
 * The actual page renders in a native WebContentsView owned by the Electron
 * main process. This component:
 *   - Asks main to create a page on first mount (if the tab has no pageId).
 *   - Positions the WebContentsView to match this component's bounding box
 *     via `browser:set-bounds` IPC, tracked with ResizeObserver.
 *   - Renders the nav bar (back / forward / reload / URL + go) and pause toggle.
 *   - Mirrors `browser:tab-updated` events into local state + the tab label.
 *   - Calls `browser:hide` when it unmounts (tab switch) so the overlay doesn't
 *     bleed into whatever renders next. Destroy happens only from closeTab.
 *
 * The mount div is a positioning anchor only — it never actually contains a
 * DOM tree for the page. It just carves out screen space, and the main
 * process paints its WebContentsView on top at matching bounds.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BrowserTab } from '../hooks/useTabs';

type Props = {
  tab: BrowserTab;
  isActive: boolean;
  onPatch: (patch: Partial<Pick<BrowserTab, 'pageId' | 'url' | 'label'>>) => void;
};

type Bounds = { x: number; y: number; width: number; height: number };

function rectToBounds(rect: DOMRect): Bounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

export function BrowserView({ tab, isActive, onPatch }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pageId, setPageId] = useState<string | undefined>(tab.pageId);
  const [url, setUrl] = useState<string>(tab.url || '');
  const [urlDraft, setUrlDraft] = useState<string>(tab.url || '');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastBoundsRef = useRef<Bounds | null>(null);
  const creatingRef = useRef(false);

  const api = typeof window !== 'undefined' ? window.electronAPI?.browser : undefined;

  // Create a WebContentsView on first mount if we don't have one yet.
  useEffect(() => {
    if (pageId || creatingRef.current) return;
    if (!api) return;
    creatingRef.current = true;
    setLoading(true);
    api.create({ url: tab.url, background: false })
      .then(id => {
        setPageId(id);
        onPatch({ pageId: id });
      })
      .catch(err => {
        console.error('[BrowserView] create failed:', err);
      })
      .finally(() => { creatingRef.current = false; });
  }, [api, pageId, tab.url, onPatch]);

  // Subscribe to tab-updated events for OUR pageId and mirror into state +
  // the tab label. tab-created fires separately for freshly-created tabs.
  useEffect(() => {
    if (!api) return;
    const unsubCreated = api.onTabCreated?.((summary) => {
      if (summary.pageId !== pageId) return;
      setUrl(summary.url);
      setUrlDraft(summary.url);
      setCanGoBack(summary.canGoBack);
      setCanGoForward(summary.canGoForward);
      setPaused(summary.paused);
    });
    const unsubUpdated = api.onTabUpdated?.((summary) => {
      if (summary.pageId !== pageId) return;
      if (summary.url) {
        setUrl(summary.url);
        setUrlDraft(prev => (prev === url || !prev ? summary.url : prev));
        onPatch({ url: summary.url });
      }
      setCanGoBack(summary.canGoBack);
      setCanGoForward(summary.canGoForward);
      setPaused(summary.paused);
      const label = summary.title?.trim() || (summary.url ? new URL(summary.url).host : 'New Tab');
      onPatch({ label });
    });
    const unsubPaused = api.onTabPaused?.((payload) => {
      if (payload.pageId !== pageId) return;
      setPaused(payload.paused);
    });
    return () => {
      unsubCreated?.();
      unsubUpdated?.();
      unsubPaused?.();
    };
  }, [api, pageId, url, onPatch]);

  // Track container bounds and push them to main. Do it synchronously after
  // layout so the WebContentsView lands in the right place before first paint.
  const pushBounds = useCallback(() => {
    if (!api || !pageId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // not laid out yet
    const b = rectToBounds(rect);
    const prev = lastBoundsRef.current;
    if (prev && prev.x === b.x && prev.y === b.y && prev.width === b.width && prev.height === b.height) return;
    lastBoundsRef.current = b;
    api.setBounds(pageId, b).catch(() => {});
  }, [api, pageId]);

  useLayoutEffect(() => { pushBounds(); });

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => pushBounds());
    ro.observe(el);
    const onWinResize = () => pushBounds();
    window.addEventListener('resize', onWinResize);
    // Fire on scroll too — Electron positions WebContentsView in window coords,
    // so any scroll of an ancestor container changes our absolute rect.
    window.addEventListener('scroll', onWinResize, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
      window.removeEventListener('scroll', onWinResize, true);
    };
  }, [pushBounds]);

  // Tell main which tab the user is looking at (for userFocused flag on summaries).
  useEffect(() => {
    if (!api || !pageId) return;
    if (isActive) {
      api.setUserFocus(pageId).catch(() => {});
    }
  }, [api, pageId, isActive]);

  // When this component unmounts (tab switch), hide the overlay. Destroy
  // happens only when the tab is explicitly closed (handled in useTabs).
  useEffect(() => {
    return () => {
      if (!api || !pageId) return;
      api.hide(pageId).catch(() => {});
    };
  }, [api, pageId]);

  // Hide when NOT active so background browser tabs don't show through the
  // currently active non-browser tab. Show when active.
  useEffect(() => {
    if (!api || !pageId) return;
    if (!isActive) {
      api.hide(pageId).catch(() => {});
    } else {
      pushBounds(); // re-apply bounds, which also makes the view visible again
    }
  }, [api, pageId, isActive, pushBounds]);

  const go = useCallback((target: string) => {
    if (!api || !pageId) return;
    let normalized = target.trim();
    if (!normalized) return;
    // If it looks like "something.tld/..." or "localhost:...", assume https.
    // Otherwise, if it has no scheme and no dot, treat it as a search query.
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
      if (/^[^\s]+\.[^\s]+$/.test(normalized) || /^localhost(:\d+)?/.test(normalized)) {
        normalized = `https://${normalized}`;
      } else {
        normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`;
      }
    }
    setLoading(true);
    api.navigate(pageId, { type: 'url', url: normalized })
      .catch((err) => console.error('[BrowserView] navigate failed:', err))
      .finally(() => setLoading(false));
  }, [api, pageId]);

  const back = useCallback(() => {
    if (!api || !pageId) return;
    api.navigate(pageId, { type: 'back' }).catch(() => {});
  }, [api, pageId]);

  const forward = useCallback(() => {
    if (!api || !pageId) return;
    api.navigate(pageId, { type: 'forward' }).catch(() => {});
  }, [api, pageId]);

  const reload = useCallback(() => {
    if (!api || !pageId) return;
    api.navigate(pageId, { type: 'reload' }).catch(() => {});
  }, [api, pageId]);

  const togglePause = useCallback(() => {
    if (!api || !pageId) return;
    const next = !paused;
    setPaused(next);
    api.pause(pageId, next).catch(() => {});
  }, [api, pageId, paused]);

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 bg-background">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/30">
        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent text-sm"
          onClick={back}
          disabled={!canGoBack}
          title="Back"
        >←</button>
        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent text-sm"
          onClick={forward}
          disabled={!canGoForward}
          title="Forward"
        >→</button>
        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-muted text-sm"
          onClick={reload}
          title="Reload"
        >↻</button>
        <form
          className="flex-1 min-w-0"
          onSubmit={(e) => { e.preventDefault(); go(urlDraft); }}
        >
          <input
            type="text"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Enter URL or search"
            className="w-full px-3 py-1 rounded bg-background border border-border text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            spellCheck={false}
            autoComplete="off"
          />
        </form>
        <button
          type="button"
          onClick={togglePause}
          className={
            'px-2 py-1 rounded text-sm border ' +
            (paused
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-600 hover:bg-amber-500/30'
              : 'border-border text-muted-foreground hover:bg-muted')
          }
          title={paused ? 'Agent paused — click to resume' : 'Pause agent'}
        >{paused ? 'paused' : 'pause agent'}</button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 min-w-0 relative bg-background"
      >
        {!pageId && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {loading ? 'Opening browser tab...' : 'Initializing...'}
          </div>
        )}
      </div>
    </div>
  );
}
