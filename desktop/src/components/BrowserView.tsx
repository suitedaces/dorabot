/**
 * BrowserView — the renderer-side chrome for an embedded browser tab.
 *
 * The actual page renders in a native WebContentsView owned by the Electron
 * main process. This component:
 *   - Asks main to create a page on first mount (if the tab has no pageId).
 *   - Renders the nav bar (back / forward / reload / URL + go) and pause toggle.
 *   - Mirrors `browser:tab-updated` events into local state + the tab label.
 *   - When the tab is active, observes the body div and pushes pane bounds
 *     through `paneUpdate` so the main-process BrowserTabModel can position
 *     the native view over it.
 *
 * show/hide/bringToFront is NOT this component's job — the model reconciles
 * visibility across all known tabs from pane state, so a missed React cleanup
 * can't leave a ghost WebContentsView.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Globe } from 'lucide-react';
import type { BrowserTab } from '../hooks/useTabs';

type Props = {
  tab: BrowserTab;
  isActive: boolean;
  paneId: string;
  onPatch: (patch: Partial<Pick<BrowserTab, 'pageId' | 'url' | 'label' | 'favicon'>>) => void;
};

export function BrowserView({ tab, isActive, paneId, onPatch }: Props) {
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [pageId, setPageId] = useState<string | undefined>(tab.pageId);
  const [url, setUrl] = useState<string>(tab.url || '');
  const [urlDraft, setUrlDraft] = useState<string>(tab.url || '');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [paused, setPaused] = useState(false);
  // creating: renderer-side pending flag for the initial createPage() call.
  // navLoading: authoritative per-navigation loading from TabSummary.loading
  // (wc.isLoading()). kept separate so "Opening browser tab..." only shows
  // before a pageId exists, and the thin progress bar shows on real loads.
  const [loading, setLoading] = useState(false);
  const [navLoading, setNavLoading] = useState(false);
  const [crashed, setCrashed] = useState<{ reason: string; recoverable: boolean } | null>(null);
  const [loadError, setLoadError] = useState<{ code: number; description: string; url: string } | null>(null);
  const [createFailed, setCreateFailed] = useState(false);
  const creatingRef = useRef(false);
  const mountedRef = useRef(true);

  const api = typeof window !== 'undefined' ? window.electronAPI?.browser : undefined;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Create a WebContentsView on first mount if we don't have one yet.
  useEffect(() => {
    if (pageId || creatingRef.current) return;
    if (!api) return;
    creatingRef.current = true;
    setLoading(true);
    setCreateFailed(false);
    api.create({ url: tab.url, background: false })
      .then(id => {
        // If the tab was closed while create was in flight, destroy the orphan
        // view — nobody in the UI is holding its pageId so it'd leak forever.
        if (!mountedRef.current) {
          api.destroy(id).catch(() => {});
          return;
        }
        setPageId(id);
        onPatch({ pageId: id });
      })
      .catch(err => {
        if (!mountedRef.current) return;
        console.error('[BrowserView] create failed:', err);
        setCreateFailed(true);
      })
      .finally(() => {
        creatingRef.current = false;
        if (mountedRef.current) setLoading(false);
      });
  }, [api, pageId, tab.url, onPatch]);

  // Manually recreate the WebContentsView (used by the retry button when create
  // failed outright — different from a renderer crash, which uses reload).
  const recreate = useCallback(() => {
    if (!api || creatingRef.current) return;
    creatingRef.current = true;
    setLoading(true);
    setCreateFailed(false);
    api.create({ url: tab.url, background: false })
      .then(id => {
        if (!mountedRef.current) {
          api.destroy(id).catch(() => {});
          return;
        }
        setPageId(id);
        onPatch({ pageId: id });
      })
      .catch(err => {
        if (!mountedRef.current) return;
        console.error('[BrowserView] recreate failed:', err);
        setCreateFailed(true);
      })
      .finally(() => {
        creatingRef.current = false;
        if (mountedRef.current) setLoading(false);
      });
  }, [api, tab.url, onPatch]);

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
      setNavLoading(summary.loading);
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
      setNavLoading(summary.loading);
      // a successful tab-updated after a crash means the auto-reload worked
      if (!summary.crashed && crashed) setCrashed(null);
      const label = summary.title?.trim() || (summary.url ? new URL(summary.url).host : 'New Tab');
      onPatch({ label, favicon: summary.favicon });
    });
    const unsubPaused = api.onTabPaused?.((payload) => {
      if (payload.pageId !== pageId) return;
      setPaused(payload.paused);
    });
    const unsubCrashed = api.onTabCrashed?.((payload) => {
      if (payload.pageId !== pageId) return;
      console.warn(`[BrowserView] tab crashed ${pageId} reason=${payload.reason} recoverable=${payload.recoverable}`);
      setCrashed({ reason: payload.reason, recoverable: payload.recoverable });
    });
    const unsubLoadFailed = api.onTabLoadFailed?.((payload) => {
      if (payload.pageId !== pageId) return;
      console.warn(`[BrowserView] load failed ${pageId} code=${payload.errorCode} desc=${payload.errorDescription}`);
      setLoadError({ code: payload.errorCode, description: payload.errorDescription, url: payload.url });
    });
    // Cmd+L inside a WebContentsView — main forwards it here. Only act if
    // it was fired on OUR tab.
    const unsubFocusUrl = api.onFocusUrlBar?.((payload) => {
      if (payload.pageId !== pageId) return;
      const el = urlInputRef.current;
      if (el) { el.focus(); el.select(); }
    });
    return () => {
      unsubCreated?.();
      unsubUpdated?.();
      unsubPaused?.();
      unsubCrashed?.();
      unsubLoadFailed?.();
      unsubFocusUrl?.();
    };
  }, [api, pageId, url, onPatch, crashed]);

  // Tell main which tab the user is currently looking at (for the focus-steal
  // guard in browser-controller.sendCdp). Not tied to visibility — that's the
  // pane's job now.
  useEffect(() => {
    if (!api || !pageId) return;
    if (isActive) {
      api.setUserFocus(pageId).catch(() => {});
    }
  }, [api, pageId, isActive]);

  // When this tab is the active tab in its pane, observe the body div and
  // push bounds + claim the pane for this pageId. The model uses the bounds
  // to setBounds on the native view and reconciles visibility globally.
  // When this tab is not active we don't push anything — the pane's other
  // tab (or EditorGroupPanel, if the active tab is non-browser) pushes the
  // claim, and the model hides any view not claimed by a visible pane.
  useEffect(() => {
    if (!api || !pageId || !isActive) return;
    const el = bodyRef.current;
    if (!el) return;

    const push = () => {
      const r = el.getBoundingClientRect();
      api.paneUpdate(paneId, {
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        activeBrowserPageId: pageId,
        visible: true,
      }).catch(() => {});
    };

    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, [api, pageId, isActive, paneId]);

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

  // used by the crash banner's retry button — clears crash state and forces
  // main to spawn a new renderer for this view.
  const retryAfterCrash = useCallback(() => {
    if (!api || !pageId) return;
    setCrashed(null);
    setLoadError(null);
    api.reload(pageId).catch((err) => {
      console.error('[BrowserView] retry reload failed:', err);
    });
  }, [api, pageId]);

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
          <div className="relative">
            {/* security chip — green lock for https, muted globe for anything
                else (http, about:, blank). intentionally omitted entirely for
                empty urls to avoid visual noise during tab boot. */}
            {url && (() => {
              let scheme = '';
              try { scheme = new URL(url).protocol; } catch {}
              if (scheme === 'https:') {
                return (
                  <Lock
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-emerald-500 pointer-events-none"
                    aria-label="Secure connection"
                  />
                );
              }
              if (scheme === 'http:') {
                return (
                  <Globe
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none"
                    aria-label="Insecure connection"
                  />
                );
              }
              return null;
            })()}
            <input
              ref={urlInputRef}
              type="text"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Enter URL or search"
              className="w-full pl-7 pr-3 py-1 rounded bg-background border border-border text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
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
      {/*
        The body is a pure positioning anchor. The native WebContentsView is
        painted over this rect (bounds observed above and pushed to the model
        via paneUpdate). Banners inside here stack on top with z-10.
      */}
      <div ref={bodyRef} className="flex-1 min-h-0 min-w-0 relative bg-background">
        {/* thin indeterminate progress bar while the page is loading. painted
            in the renderer's chrome area (above the WebContentsView) so it's
            visible even when the native view is covering the body. z-20 so
            it stacks above the crash/error banners (z-10). */}
        {pageId && navLoading && !crashed && (
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary/80 animate-pulse pointer-events-none z-20" />
        )}
        {!pageId && !createFailed && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {loading ? 'Opening browser tab...' : 'Initializing...'}
          </div>
        )}
        {!pageId && createFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm">
            <div className="text-muted-foreground">Couldn't open browser tab.</div>
            <button
              type="button"
              onClick={recreate}
              className="px-3 py-1 rounded border border-border hover:bg-muted"
            >Retry</button>
          </div>
        )}
        {pageId && crashed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/95 text-sm">
            <div className="text-foreground font-medium">This page crashed.</div>
            <div className="text-muted-foreground text-xs">Reason: {crashed.reason}</div>
            <button
              type="button"
              onClick={retryAfterCrash}
              className="px-3 py-1 rounded border border-border hover:bg-muted"
            >Reload</button>
          </div>
        )}
        {pageId && !crashed && loadError && (
          <div className="absolute top-2 right-2 z-10 max-w-sm px-3 py-2 rounded border border-amber-500/40 bg-amber-500/10 text-xs">
            <div className="font-medium text-amber-600">Load error ({loadError.code})</div>
            <div className="text-muted-foreground truncate">{loadError.description}</div>
            <button
              type="button"
              onClick={() => { setLoadError(null); reload(); }}
              className="mt-1 underline hover:opacity-80"
            >Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
