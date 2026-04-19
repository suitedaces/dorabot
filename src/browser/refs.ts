/**
 * refs — stable element references anchored to CDP backendNodeIds.
 *
 * Playwright's _snapshotForAI invalidates refs between snapshots. That's bad
 * for an agent: "click [ref=e5]" might refer to a different node two
 * snapshots later. We fix that by anchoring each eN to a CDP
 * `backendNodeId`, which is stable across reflows, re-renders, and even DOM
 * mutations (as long as the node isn't removed).
 *
 * One RefTable per page. The table is cleared on navigation (the browser
 * controller calls clearRefs(pageId) on main-frame navigated events).
 *
 *   refTable.byEId        eId -> backendNodeId
 *   refTable.byNodeId     backendNodeId -> eId
 *   refTable.counter      monotonic id allocator
 */
import type { PageId } from './cdp-backend.js';
import { sendCdp } from './cdp-backend.js';

export type RefTable = {
  byEId: Map<string, number>;
  byNodeId: Map<number, string>;
  counter: number;
};

const tables = new Map<PageId, RefTable>();

/** Get (or lazily create) the ref table for a page. */
export function getRefTable(pageId: PageId): RefTable {
  let t = tables.get(pageId);
  if (!t) {
    t = { byEId: new Map(), byNodeId: new Map(), counter: 0 };
    tables.set(pageId, t);
  }
  return t;
}

/**
 * Return an eN string for a backendNodeId, allocating a new one if unseen.
 * Same backendNodeId always returns the same eN for the life of the table.
 */
export function getOrAssignRef(table: RefTable, backendNodeId: number): string {
  const existing = table.byNodeId.get(backendNodeId);
  if (existing) return existing;
  const eId = `e${++table.counter}`;
  table.byEId.set(eId, backendNodeId);
  table.byNodeId.set(backendNodeId, eId);
  return eId;
}

/** Look up the backendNodeId for a ref. Returns null if unknown. */
export function resolveRef(pageId: PageId, ref: string): number | null {
  const t = tables.get(pageId);
  if (!t) return null;
  const key = ref.startsWith('e') ? ref : `e${ref}`;
  return t.byEId.get(key) ?? null;
}

/**
 * Resolve a ref to a CDP RemoteObject id, for use with Runtime.callFunctionOn.
 * Throws if the ref is unknown or the node is detached.
 */
export async function resolveRefToObjectId(pageId: PageId, ref: string): Promise<string> {
  const backendNodeId = resolveRef(pageId, ref);
  if (backendNodeId == null) throw new Error(`unknown ref "${ref}" — re-snapshot the page`);
  const { object } = await sendCdp<{ object: { objectId: string } }>(
    pageId,
    'DOM.resolveNode',
    { backendNodeId },
  );
  if (!object?.objectId) throw new Error(`ref "${ref}" no longer resolves — element may be detached`);
  return object.objectId;
}

/** Clear refs for a single page (called on navigation). */
export function clearRefs(pageId: PageId): void {
  tables.delete(pageId);
}

/** Clear all ref tables (called on full shutdown). */
export function clearAllRefs(): void {
  tables.clear();
}
