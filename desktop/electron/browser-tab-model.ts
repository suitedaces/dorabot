/**
 * browser-tab-model — single source of truth for "which native view goes where".
 *
 * Problem: letting React own WebContentsView visibility through per-component
 * useEffect cleanup is fragile. fast refresh skips cleanup, strict mode
 * double-fires effects, and pageIds can exist in the pool with no mounted
 * BrowserView component at all (agent-opened tab before its UI tab mounts,
 * pane collapse mid-animation). The result is ghost views painted on top of
 * whatever else the user is looking at.
 *
 * Fix: invert the flow. The renderer only reports pane-level state:
 *   setPaneState(paneId, { bounds, activeBrowserPageId, visible })
 *   removePane(paneId)
 *
 * The controller reports native view churn:
 *   'tab-created' -> knownPageIds.add
 *   'tab-closed'  -> knownPageIds.delete
 *
 * After any change we schedule one idempotent reconcile:
 *   for each known pageId:
 *     if claimed by a visible pane with non-zero bounds: setBounds + bringToFront
 *     else: hide
 *
 * Guarantee: any tab NOT claimed by any visible pane is hidden. No ghosts.
 */
import type { Rectangle } from 'electron';
import type { BrowserController, PageId } from './browser-controller';

export type PaneId = string;

export type PaneState = {
  bounds: Rectangle;
  activeBrowserPageId: PageId | null;
  visible: boolean;
};

const EMPTY_RECT: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

function boundsEqual(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function hasRenderableBounds(r: Rectangle): boolean {
  return r.width > 0 && r.height > 0;
}

export class BrowserTabModel {
  private panes = new Map<PaneId, PaneState>();
  private knownPageIds = new Set<PageId>();
  // last-applied bounds per tab — skip redundant setBounds calls
  private lastBounds = new Map<PageId, Rectangle>();
  // visibility latch per tab — only call bringToFront on hidden -> visible edge
  private tabVisible = new Map<PageId, boolean>();
  private controller: BrowserController;
  private reconcileScheduled = false;

  constructor(controller: BrowserController) {
    this.controller = controller;

    controller.on('tab-created', (summary: { pageId: PageId }) => {
      this.knownPageIds.add(summary.pageId);
      this.scheduleReconcile();
    });
    controller.on('tab-closed', ({ pageId }: { pageId: PageId }) => {
      this.knownPageIds.delete(pageId);
      this.lastBounds.delete(pageId);
      this.tabVisible.delete(pageId);
    });
  }

  // Upsert pane state. partial — only fields present in `patch` are updated,
  // everything else preserved. Triggers a reconcile.
  setPaneState(paneId: PaneId, patch: Partial<PaneState>): void {
    const prev = this.panes.get(paneId);
    const next: PaneState = {
      bounds: patch.bounds ?? prev?.bounds ?? EMPTY_RECT,
      activeBrowserPageId:
        patch.activeBrowserPageId !== undefined
          ? patch.activeBrowserPageId
          : prev?.activeBrowserPageId ?? null,
      visible: patch.visible !== undefined ? patch.visible : prev?.visible ?? true,
    };
    // skip reconcile if nothing actually changed
    if (
      prev &&
      boundsEqual(prev.bounds, next.bounds) &&
      prev.activeBrowserPageId === next.activeBrowserPageId &&
      prev.visible === next.visible
    ) {
      return;
    }
    this.panes.set(paneId, next);
    this.scheduleReconcile();
  }

  removePane(paneId: PaneId): void {
    if (!this.panes.delete(paneId)) return;
    this.scheduleReconcile();
  }

  // Force a reconcile pass. Useful after bulk events the model isn't directly
  // subscribed to (e.g. window restore, which is handled by the controller's
  // invalidateAllViews but may leave stale layering).
  reconcileNow(): void {
    this.reconcile();
  }

  private scheduleReconcile(): void {
    if (this.reconcileScheduled) return;
    this.reconcileScheduled = true;
    // setImmediate coalesces bursts (activeTab change + bounds push + pane
    // active change from a single UI layout event) into one reconcile.
    setImmediate(() => {
      this.reconcileScheduled = false;
      try { this.reconcile(); } catch (err) {
        console.error('[browser-tab-model] reconcile threw:', err);
      }
    });
  }

  private reconcile(): void {
    // Build claim map: which pageId is visible in which pane. First pane in
    // iteration order wins if the same pageId is somehow claimed twice.
    const claimedBy = new Map<PageId, PaneState>();
    for (const pane of this.panes.values()) {
      if (!pane.visible) continue;
      if (!pane.activeBrowserPageId) continue;
      if (claimedBy.has(pane.activeBrowserPageId)) continue;
      claimedBy.set(pane.activeBrowserPageId, pane);
    }

    for (const pageId of this.knownPageIds) {
      const pane = claimedBy.get(pageId);
      const wasVisible = this.tabVisible.get(pageId) ?? false;
      if (pane && hasRenderableBounds(pane.bounds)) {
        const prevBounds = this.lastBounds.get(pageId);
        if (!prevBounds || !boundsEqual(prevBounds, pane.bounds)) {
          this.controller.setBounds(pageId, pane.bounds);
          this.lastBounds.set(pageId, pane.bounds);
        }
        // Only kick z-order on the hidden -> visible edge. Calling every
        // reconcile would thrash layering when multiple tabs are live.
        if (!wasVisible) {
          this.controller.bringToFront(pageId);
        }
        this.tabVisible.set(pageId, true);
      } else {
        if (wasVisible) {
          this.controller.hide(pageId);
          this.lastBounds.delete(pageId);
        }
        this.tabVisible.set(pageId, false);
      }
    }
  }
}
