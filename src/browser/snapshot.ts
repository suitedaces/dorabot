/**
 * snapshot — build a YAML-shaped accessibility snapshot from CDP output.
 *
 * Produces output shaped like Playwright's _snapshotForAI / playwright-mcp so
 * the agent can keep using [ref=eN] markers. Refs are anchored to CDP
 * backendNodeIds, which survive reflows and re-renders — a fix for Playwright's
 * per-snapshot ref invalidation problem.
 *
 *   - button "Submit" [ref=e42]
 *   - textbox "Email" [ref=e43]: "ishan@..."
 *   - link "Docs" [ref=e44] /docs
 *     - generic [ref=e45]:
 *       - heading "Title" [level=1] [ref=e46]
 */
import { sendCdp, type PageId } from './cdp-backend.js';
import { getOrAssignRef, getRefTable, clearRefs, type RefTable } from './refs.js';

// CDP AX tree node shape (subset we use)
type AxNode = {
  nodeId: string;
  parentId?: string;
  backendDOMNodeId?: number;
  childIds?: string[];
  ignored?: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  value?: { type: string; value: unknown };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
};

type AxTree = { nodes: AxNode[] };

// Roles that are always emitted if named or interactive
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem',
  'option', 'cell', 'columnheader', 'rowheader',
]);

// Tighter set used for interactiveOnly mode — the flat "actionable" list the
// agent sees. Options live under a combobox and are addressed via select(),
// so flattening them out of context is noisy. Same logic for listbox items,
// tabs, etc. — they all have a parent container the agent acts on.
const FLAT_INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
  'switch', 'slider', 'spinbutton',
]);

// Roles worth emitting for structure (skipped if they have no named/interactive descendants)
const STRUCTURAL_ROLES = new Set([
  'heading', 'region', 'form', 'list', 'listitem', 'table', 'row',
  'dialog', 'alert', 'alertdialog', 'navigation', 'main', 'banner',
  'contentinfo', 'article', 'section', 'img', 'figure',
]);

export type SnapshotOptions = {
  selector?: string;
  /** If true, only emit interactive nodes — flat list, no structural scaffolding. */
  interactiveOnly?: boolean;
};

export type SnapshotResult = {
  yaml: string;
  url: string;
  title: string;
  refCount: number;
};

/**
 * Build a snapshot for a page. `selector` isn't supported yet (v1 always
 * returns full tree) — the option is kept for API compatibility.
 */
export async function buildSnapshot(
  pageId: PageId,
  opts: SnapshotOptions = {},
): Promise<SnapshotResult> {
  const tree = await sendCdp<AxTree>(pageId, 'Accessibility.getFullAXTree', {});

  // basic page info
  const { result: titleResult } = await sendCdp<{ result: { value: string } }>(
    pageId,
    'Runtime.evaluate',
    { expression: 'document.title', returnByValue: true },
  );
  const { result: urlResult } = await sendCdp<{ result: { value: string } }>(
    pageId,
    'Runtime.evaluate',
    { expression: 'location.href', returnByValue: true },
  );

  const refTable = getRefTable(pageId);

  // Build parent → children lookup and id → node lookup
  const byId = new Map<string, AxNode>();
  for (const n of tree.nodes) byId.set(n.nodeId, n);

  // Find roots — nodes whose parent isn't in the tree
  const roots: AxNode[] = tree.nodes.filter(
    (n) => !n.parentId || !byId.has(n.parentId),
  );

  const lines: string[] = [];
  let refCount = 0;

  const walk = (node: AxNode, depth: number): number => {
    const children = (node.childIds || []).map((id) => byId.get(id)).filter(Boolean) as AxNode[];

    if (opts.interactiveOnly) {
      // flat list: no indentation, no containers. strict whitelist — agents
      // want top-level actionable controls. options/tabs/menu items are
      // reached through their parent and would be noise here.
      const role = roleOf(node);
      if (role && FLAT_INTERACTIVE_ROLES.has(role)) {
        const line = formatNode(node, 0, refTable);
        if (line) { lines.push(line); refCount++; }
      }
      for (const c of children) walk(c, 0);
      return 0;
    }

    // Emit self if it passes the filter
    const selfRole = roleOf(node);
    const selfName = nameOf(node);
    const interactive = isInteractive(node);
    const structural = !!selfRole && STRUCTURAL_ROLES.has(selfRole);

    let emittedSelf = false;
    if (interactive || (structural && (selfName || children.length > 0))) {
      const line = formatNode(node, depth, refTable);
      if (line) { lines.push(line); refCount++; emittedSelf = true; }
    }

    for (const c of children) walk(c, emittedSelf ? depth + 1 : depth);
    return 0;
  };

  for (const root of roots) walk(root, 0);

  const yaml = lines.join('\n');
  return {
    yaml: yaml || '(empty page)',
    url: urlResult?.value || '',
    title: titleResult?.value || '',
    refCount,
  };
}

// -- helpers --

function roleOf(node: AxNode): string | null {
  if (node.ignored) return null;
  if (!node.role) return null;
  const v = node.role.value;
  if (!v || v === 'none' || v === 'presentation') return null;
  return v;
}

function nameOf(node: AxNode): string {
  if (!node.name) return '';
  const v = node.name.value;
  return typeof v === 'string' ? v.trim() : '';
}

function valueOf(node: AxNode): string {
  if (!node.value) return '';
  const v = node.value.value;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function propOf(node: AxNode, name: string): string | null {
  if (!node.properties) return null;
  for (const p of node.properties) {
    if (p.name === name) {
      const v = p.value.value;
      if (v === null || v === undefined) return null;
      return String(v);
    }
  }
  return null;
}

function isInteractive(node: AxNode): boolean {
  const role = roleOf(node);
  if (!role) return false;
  if (INTERACTIVE_ROLES.has(role)) return true;
  // Fallback: any node with an explicit focusable=true property
  return propOf(node, 'focusable') === 'true' && !!nameOf(node);
}

function formatNode(node: AxNode, depth: number, refTable: RefTable): string | null {
  const role = roleOf(node);
  if (!role) return null;
  if (!node.backendDOMNodeId) return null; // skip nodes without a DOM anchor

  const eId = getOrAssignRef(refTable, node.backendDOMNodeId);
  const name = nameOf(node);
  const value = valueOf(node);

  const parts: string[] = [role];
  if (name) parts.push(JSON.stringify(name));

  // role-specific attributes
  if (role === 'heading') {
    const level = propOf(node, 'level');
    if (level) parts.push(`[level=${level}]`);
  }
  if (propOf(node, 'checked') === 'true') parts.push('[checked]');
  if (propOf(node, 'expanded') === 'true') parts.push('[expanded]');
  if (propOf(node, 'expanded') === 'false') parts.push('[collapsed]');
  if (propOf(node, 'disabled') === 'true') parts.push('[disabled]');

  parts.push(`[ref=${eId}]`);

  const indent = '  '.repeat(depth);
  let line = `${indent}- ${parts.join(' ')}`;
  if (value && role !== 'heading') line += `: ${JSON.stringify(value)}`;
  return line;
}
