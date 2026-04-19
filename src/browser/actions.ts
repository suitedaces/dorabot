/**
 * actions — 26 browser actions, all driven through raw CDP via sendCdp().
 *
 * Replaces the previous Playwright-backed implementation. Every action is
 * page-scoped: it takes a pageId (defaults to the user's focused tab) and
 * calls the browser host via the gateway's browser-host-registry.
 *
 * Refs (e1, e2, ...) are anchored to CDP backendNodeIds so they survive
 * reflows and re-renders. See ./snapshot.ts and ./refs.ts for details.
 */
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  sendCdp,
  createPage as cdpCreatePage,
  destroyPage as cdpDestroyPage,
  listPages as cdpListPages,
  navigatePage as cdpNavigatePage,
  printPdfViaHost,
  requirePageId,
  type PageId,
  type TabSummary,
} from './cdp-backend.js';
import { invokeBrowserHost } from '../gateway/browser-host-registry.js';
import { buildSnapshot } from './snapshot.js';
import { resolveRef, resolveRefToObjectId, clearRefs } from './refs.js';
import { constrainImageSize } from '../image-utils.js';

export type ActionResult = {
  text: string;
  isError?: boolean;
  image?: string;           // raw base64 image data (no data: prefix)
  mimeType?: string;
  structured?: Record<string, unknown>;
};

// ─── helpers ───────────────────────────────────────────────────────────

function ok(text: string, extra: Partial<ActionResult> = {}): ActionResult {
  return { text, ...extra };
}

function err(text: string): ActionResult {
  return { text, isError: true };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// compact single-line JSON, used for eval returns where type fidelity matters.
function compactJson(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

// compact, agent-readable yaml-ish emitter. not a full yaml impl — we own both
// sides, so we skip edge cases (document markers, tags, explicit null, complex
// keys) and optimize for token count and scannability. rules:
//   - skip null/undefined keys (they're noise)
//   - inline short arrays/objects (< 60 chars on one line)
//   - single-line strings unquoted; multiline strings use "|" block scalars
//   - preserve numbers, booleans, arrays of primitives as-is
function formatYaml(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return formatScalarString(value, depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inline = tryInlineArray(value);
    if (inline) return inline;
    return value.map((item) => {
      const formatted = formatYaml(item, depth + 1);
      if (!formatted.includes('\n')) return `${pad}- ${formatted}`;
      // object/array spans multiple lines — hang first line after "- "
      const [first, ...rest] = formatted.split('\n');
      return `${pad}- ${first.trimStart()}\n${rest.join('\n')}`;
    }).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined,
    );
    if (entries.length === 0) return '{}';
    const inline = tryInlineObject(entries);
    if (inline) return inline;
    return entries.map(([k, v]) => {
      const formatted = formatYaml(v, depth + 1);
      if (formatted.includes('\n')) return `${pad}${k}:\n${formatted}`;
      return `${pad}${k}: ${formatted}`;
    }).join('\n');
  }
  return String(value);
}

function formatScalarString(s: string, depth: number): string {
  if (s === '') return '""';
  if (s.includes('\n')) {
    const pad = '  '.repeat(depth + 1);
    return `|\n${s.split('\n').map((l) => pad + l).join('\n')}`;
  }
  // quote only when needed: leading/trailing space, yaml-sensitive starters, colons with space, or '#'
  if (/^(\s|["'&*!|>%@`])/.test(s) || /(\s#|:\s)/.test(s) || /\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function tryInlineArray(arr: unknown[]): string | null {
  if (arr.some((v) => v && typeof v === 'object')) return null;
  const parts = arr.map((v) => formatYaml(v, 0));
  if (parts.some((p) => p.includes('\n'))) return null;
  const joined = `[${parts.join(', ')}]`;
  return joined.length <= 60 ? joined : null;
}

function tryInlineObject(entries: Array<[string, unknown]>): string | null {
  if (entries.some(([, v]) => v && typeof v === 'object')) return null;
  const parts = entries.map(([k, v]) => `${k}: ${formatYaml(v, 0)}`);
  if (parts.some((p) => p.includes('\n'))) return null;
  const joined = `{${parts.join(', ')}}`;
  return joined.length <= 60 ? joined : null;
}

function paginate<T>(items: T[], pageIdx?: number, pageSize?: number): T[] {
  const idx = pageIdx ?? 0;
  if (idx < 0) return [];
  if (!pageSize || pageSize <= 0) return idx === 0 ? items : [];
  const start = idx * pageSize;
  return items.slice(start, start + pageSize);
}

function truncate(value: string, max = 20_000): { value: string; truncated: boolean } {
  if (value.length <= max) return { value, truncated: false };
  return { value: `${value.slice(0, max)}\n... [truncated ${value.length - max} chars]`, truncated: true };
}

/**
 * Resolve a ref to its center (x, y) in viewport coords, and scroll it into
 * view first. Throws if the node is unknown or detached.
 */
async function locateRef(pageId: PageId, ref: string): Promise<{ x: number; y: number; backendNodeId: number }> {
  const backendNodeId = resolveRef(pageId, ref);
  if (backendNodeId == null) throw new Error(`unknown ref "${ref}" — call snapshot first`);
  await sendCdp(pageId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
  const { model } = await sendCdp<{ model: { content: number[] } }>(pageId, 'DOM.getBoxModel', { backendNodeId });
  // content polygon is [x0,y0, x1,y1, x2,y2, x3,y3]; center = avg of top-left and bottom-right
  const cx = (model.content[0] + model.content[4]) / 2;
  const cy = (model.content[1] + model.content[5]) / 2;
  return { x: cx, y: cy, backendNodeId };
}

async function focusRef(pageId: PageId, ref: string): Promise<void> {
  const objectId = await resolveRefToObjectId(pageId, ref);
  await sendCdp(pageId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function(){ this.focus && this.focus(); }',
    returnByValue: true,
  });
}

async function clickAt(pageId: PageId, x: number, y: number, opts: { clickCount?: number; button?: 'left' | 'right' | 'middle' } = {}): Promise<void> {
  const button = opts.button || 'left';
  const clickCount = opts.clickCount || 1;
  await sendCdp(pageId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, button: 'none', buttons: 0,
  });
  await sendCdp(pageId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button, clickCount,
  });
  await sendCdp(pageId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button, clickCount,
  });
}

async function typeText(pageId: PageId, text: string): Promise<void> {
  // Input.insertText is simpler and faster than per-key dispatch for most
  // cases (doesn't generate keydown/keyup events, but inputs get an 'input'
  // event which is what most pages listen for).
  await sendCdp(pageId, 'Input.insertText', { text });
}

async function pressKey(pageId: PageId, key: string): Promise<void> {
  const { code, windowsVirtualKeyCode, modifiers, text } = mapKey(key);
  // text is critical for Enter/Tab/Space/Backspace — chromium routes text-
  // producing keydowns through a different path that fires implicit form
  // submission and typing behaviors. without it, keydown fires but the
  // default action (e.g. submit on Enter) never runs.
  await sendCdp(pageId, 'Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode,
    ...(text ? { text, unmodifiedText: text } : {}),
  });
  await sendCdp(pageId, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode,
  });
}

// Minimal key → code / keyCode mapping. Covers the keys an agent typically
// sends (Enter, Tab, Escape, arrows, etc.). For anything else we fall back
// to insertText for the character itself. `text` is set for keys that
// produce a character — chromium needs it to fire implicit form submission
// on Enter, tab-key focus moves, backspace deletions, etc.
function mapKey(key: string): { code: string; windowsVirtualKeyCode?: number; modifiers: number; text?: string } {
  const modifiers = 0;
  const map: Record<string, { code: string; windowsVirtualKeyCode?: number; text?: string }> = {
    Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
    Tab: { code: 'Tab', windowsVirtualKeyCode: 9, text: '\t' },
    Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
    Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8, text: '\b' },
    Delete: { code: 'Delete', windowsVirtualKeyCode: 46 },
    ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    Home: { code: 'Home', windowsVirtualKeyCode: 36 },
    End: { code: 'End', windowsVirtualKeyCode: 35 },
    PageUp: { code: 'PageUp', windowsVirtualKeyCode: 33 },
    PageDown: { code: 'PageDown', windowsVirtualKeyCode: 34 },
    Space: { code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  };
  const entry = map[key] || { code: `Key${key.toUpperCase()}` };
  return { ...entry, modifiers };
}

// Brief wait after actions that may trigger navigation/XHR. Not perfect but
// keeps behavior close to Playwright's waitForEventsAfterAction.
async function settle(pageId: PageId, ms = 200): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  // Also wait until document.readyState === 'complete' (best-effort, short timeout)
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { result } = await sendCdp<{ result: { value: string } }>(pageId, 'Runtime.evaluate', {
        expression: 'document.readyState', returnByValue: true,
      });
      if (result?.value === 'complete' || result?.value === 'interactive') return;
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch {}
}

async function appendSnapshotIfNeeded(pageId: PageId, include?: boolean): Promise<string> {
  if (!include) return '';
  try {
    const snap = await buildSnapshot(pageId);
    return `\n\nSnapshot:\n${snap.yaml}`;
  } catch (e) {
    return `\n\n(snapshot failed: ${errorMessage(e)})`;
  }
}

// ─── Navigation ────────────────────────────────────────────────────────

export async function browserListPages(): Promise<ActionResult> {
  const pages = await cdpListPages();
  if (pages.length === 0) return ok('No open tabs');
  return ok(formatYaml({ pages }));
}

export async function browserNewPage(
  url: string,
  opts: { background?: boolean } = {},
): Promise<ActionResult> {
  const pageId = await cdpCreatePage({ url, background: opts.background });
  return ok(`New tab: ${url}`, { structured: { pageId } });
}

export async function browserClosePage(pageId?: PageId): Promise<ActionResult> {
  const id = pageId ?? await requirePageId();
  await cdpDestroyPage(id);
  clearRefs(id);
  return ok(`Closed tab ${id}`);
}

export async function browserNavigatePage(opts: {
  pageId?: PageId;
  type?: 'url' | 'back' | 'forward' | 'reload';
  url?: string;
  includeSnapshot?: boolean;
}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const type = opts.type || 'url';
    if (type === 'url' && !opts.url) return err('url required for navigate type=url');
    await cdpNavigatePage(id, type, opts.url);
    clearRefs(id);
    await settle(id, 500);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    const page = await cdpListPages().then((ps) => ps.find((p) => p.pageId === id));
    return ok(`Navigation (${type}) complete. URL: ${page?.url || '(unknown)'}${suffix}`);
  } catch (e) {
    return err(`Navigate failed: ${errorMessage(e)}`);
  }
}

// alias: open
export async function browserOpen(url: string, opts: { pageId?: PageId; includeSnapshot?: boolean } = {}): Promise<ActionResult> {
  return browserNavigatePage({ pageId: opts.pageId, type: 'url', url, includeSnapshot: opts.includeSnapshot });
}

// ─── Observation ───────────────────────────────────────────────────────

export async function browserSnapshot(opts: {
  pageId?: PageId;
  selector?: string;
  filePath?: string;
  interactiveOnly?: boolean;
} = {}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const snap = await buildSnapshot(id, {
      selector: opts.selector,
      interactiveOnly: opts.interactiveOnly,
    });
    if (opts.filePath) {
      const out = resolve(opts.filePath);
      await writeFile(out, snap.yaml, 'utf-8');
      return ok(`Snapshot saved: ${out}`);
    }
    return ok(`${snap.title}\n${snap.url}\n\n${snap.yaml}`, {
      structured: { refCount: snap.refCount, url: snap.url, title: snap.title },
    });
  } catch (e) {
    return err(`Snapshot failed: ${errorMessage(e)}`);
  }
}

export async function browserScreenshot(opts: {
  pageId?: PageId;
  fullPage?: boolean;
  ref?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
  filePath?: string;
} = {}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    if (opts.ref && opts.fullPage) return err('Cannot set both ref and fullPage');
    const format = (opts.format === 'jpeg' ? 'jpeg' : 'png') as 'png' | 'jpeg';
    const params: Record<string, unknown> = {
      format,
      captureBeyondViewport: !!opts.fullPage,
    };
    if (format === 'jpeg' && opts.quality) params.quality = opts.quality;

    if (opts.ref) {
      const loc = await locateRef(id, opts.ref);
      const { model } = await sendCdp<{ model: { content: number[]; width: number; height: number } }>(
        id, 'DOM.getBoxModel', { backendNodeId: loc.backendNodeId },
      );
      params.clip = {
        x: model.content[0],
        y: model.content[1],
        width: model.width,
        height: model.height,
        scale: 1,
      };
    }

    const { data } = await sendCdp<{ data: string }>(id, 'Page.captureScreenshot', params);
    const buffer = Buffer.from(data, 'base64');
    const resized = await constrainImageSize(buffer);

    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const out = opts.filePath
      ? resolve(opts.filePath)
      : join(tmpdir(), `browser-screenshot-${Date.now()}.${ext}`);
    await writeFile(out, resized);

    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return {
      text: `Screenshot saved: ${out}`,
      image: resized.toString('base64'),
      mimeType,
    };
  } catch (e) {
    return err(`Screenshot failed: ${errorMessage(e)}`);
  }
}

export async function browserPdf(opts: { pageId?: PageId; filePath?: string } = {}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const buffer = await printPdfViaHost(id);
    const out = opts.filePath ? resolve(opts.filePath) : join(tmpdir(), `browser-pdf-${Date.now()}.pdf`);
    await writeFile(out, buffer);
    return ok(`PDF saved: ${out}`);
  } catch (e) {
    return err(`PDF failed: ${errorMessage(e)}`);
  }
}

// ─── Interact ──────────────────────────────────────────────────────────

export async function browserClick(
  ref: string,
  opts: { pageId?: PageId; dblClick?: boolean; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const { x, y } = await locateRef(id, ref);
    await clickAt(id, x, y, { clickCount: opts.dblClick ? 2 : 1 });
    await settle(id);
    // refs anchor to backendNodeId which survives reflows/mutations. only clear
    // on navigation (handled by browserNavigatePage). clicks that cause nav will
    // produce "unknown ref" on the next action, which is the correct signal.
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`${opts.dblClick ? 'Double clicked' : 'Clicked'} ${ref}${suffix}`);
  } catch (e) {
    return err(`Click failed for ${ref}: ${errorMessage(e)}`);
  }
}

export async function browserClickAt(
  x: number,
  y: number,
  opts: { pageId?: PageId; dblClick?: boolean; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    await clickAt(id, x, y, { clickCount: opts.dblClick ? 2 : 1 });
    await settle(id);
    // same rationale as browserClick: don't clear refs on same-document clicks.
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`${opts.dblClick ? 'Double clicked' : 'Clicked'} at (${x}, ${y})${suffix}`);
  } catch (e) {
    return err(`Click at failed: ${errorMessage(e)}`);
  }
}

export async function browserDrag(
  fromRef: string,
  toRef: string,
  opts: { pageId?: PageId; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const from = await locateRef(id, fromRef);
    const to = await locateRef(id, toRef);
    await sendCdp(id, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: from.x, y: from.y, button: 'none',
    });
    await sendCdp(id, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1,
    });
    // interpolate a few steps for realistic drag
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      await sendCdp(id, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, button: 'left', buttons: 1,
      });
    }
    await sendCdp(id, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1,
    });
    await settle(id);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`Dragged ${fromRef} onto ${toRef}${suffix}`);
  } catch (e) {
    return err(`Drag failed: ${errorMessage(e)}`);
  }
}

export async function browserType(
  ref: string,
  text: string,
  opts: { pageId?: PageId; submit?: boolean; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    await focusRef(id, ref);
    await typeText(id, text);
    if (opts.submit) await pressKey(id, 'Enter');
    await settle(id);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`Typed into ${ref}${opts.submit ? ' and submitted' : ''}${suffix}`);
  } catch (e) {
    return err(`Type failed for ${ref}: ${errorMessage(e)}`);
  }
}

export async function browserFill(
  ref: string,
  value: string,
  opts: { pageId?: PageId; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const objectId = await resolveRefToObjectId(id, ref);
    // Clear then set value on the element. Works for inputs, textareas, and
    // contenteditable. Dispatches input+change so React etc. see the update.
    await sendCdp(id, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function(v){
        if (this.tagName === 'SELECT') {
          for (const o of this.options) {
            if (o.textContent?.trim() === v || o.value === v || o.label?.trim() === v) {
              this.value = o.value;
              this.dispatchEvent(new Event('input', {bubbles:true}));
              this.dispatchEvent(new Event('change', {bubbles:true}));
              return 'selected';
            }
          }
          return 'no-match';
        }
        this.focus?.();
        if (this.isContentEditable) {
          this.textContent = v;
        } else {
          // Use the native setter to ensure React's onChange fires
          const proto = Object.getPrototypeOf(this);
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) desc.set.call(this, v);
          else this.value = v;
        }
        this.dispatchEvent(new Event('input', {bubbles:true}));
        this.dispatchEvent(new Event('change', {bubbles:true}));
        return 'filled';
      }`,
      arguments: [{ value }],
      returnByValue: true,
    });
    await settle(id);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`Filled ${ref}${suffix}`);
  } catch (e) {
    return err(`Fill failed for ${ref}: ${errorMessage(e)}`);
  }
}

export async function browserFillForm(
  elements: { ref: string; value: string }[],
  opts: { pageId?: PageId; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  const id = await requirePageId(opts.pageId);
  const results: string[] = [];
  for (const el of elements) {
    const r = await browserFill(el.ref, el.value, { pageId: id });
    results.push(`${el.ref}: ${r.isError ? r.text : 'filled'}`);
  }
  const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
  return ok(`${results.join('\n')}${suffix}`);
}

export async function browserSelect(
  ref: string,
  values: string[],
  opts: { pageId?: PageId; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const objectId = await resolveRefToObjectId(id, ref);
    await sendCdp(id, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function(vs){
        if (this.tagName !== 'SELECT') throw new Error('not a <select>');
        const want = new Set(vs);
        let count = 0;
        for (const o of this.options) {
          const match = want.has(o.value) || want.has(o.textContent?.trim()) || want.has(o.label?.trim());
          o.selected = this.multiple ? match : match && count === 0;
          if (match) count++;
        }
        this.dispatchEvent(new Event('input', {bubbles:true}));
        this.dispatchEvent(new Event('change', {bubbles:true}));
        return count;
      }`,
      arguments: [{ value: values }],
      returnByValue: true,
    });
    await settle(id);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`Selected ${values.join(', ')} in ${ref}${suffix}`);
  } catch (e) {
    return err(`Select failed for ${ref}: ${errorMessage(e)}`);
  }
}

export async function browserPressKey(
  key: string,
  opts: { pageId?: PageId; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    await pressKey(id, key);
    await settle(id);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`Pressed ${key}${suffix}`);
  } catch (e) {
    return err(`Press failed: ${errorMessage(e)}`);
  }
}

export async function browserHover(
  ref: string,
  opts: { pageId?: PageId; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const { x, y } = await locateRef(id, ref);
    await sendCdp(id, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none',
    });
    await settle(id, 100);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`Hovered ${ref}${suffix}`);
  } catch (e) {
    return err(`Hover failed for ${ref}: ${errorMessage(e)}`);
  }
}

export async function browserUploadFile(
  ref: string,
  filePath: string,
  opts: { pageId?: PageId; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const backendNodeId = resolveRef(id, ref);
    if (backendNodeId == null) return err(`unknown ref "${ref}" — call snapshot first`);
    const abs = resolve(filePath);
    await sendCdp(id, 'DOM.setFileInputFiles', { backendNodeId, files: [abs] });
    await settle(id);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    return ok(`File uploaded from ${abs}${suffix}`);
  } catch (e) {
    return err(`Upload failed: ${errorMessage(e)}`);
  }
}

export async function browserScroll(opts: {
  pageId?: PageId;
  deltaX?: number;
  deltaY?: number;
  ref?: string;
  includeSnapshot?: boolean;
} = {}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const deltaX = opts.deltaX ?? 0;
    const deltaY = opts.deltaY ?? 300;
    if (opts.ref) {
      const { x, y } = await locateRef(id, opts.ref);
      await sendCdp(id, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel', x, y, deltaX, deltaY,
      });
    } else {
      // Center of viewport. Evaluate viewport size first.
      const { result } = await sendCdp<{ result: { value: { w: number; h: number } } }>(id, 'Runtime.evaluate', {
        expression: 'JSON.stringify({w: innerWidth, h: innerHeight})',
        returnByValue: true,
      });
      const dims = JSON.parse(result.value as unknown as string);
      await sendCdp(id, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: dims.w / 2, y: dims.h / 2, deltaX, deltaY,
      });
    }
    await settle(id, 300);
    const suffix = await appendSnapshotIfNeeded(id, opts.includeSnapshot);
    const direction = deltaY > 0 ? 'down' : deltaY < 0 ? 'up' : deltaX > 0 ? 'right' : 'left';
    return ok(`Scrolled ${opts.ref ? `element ${opts.ref}` : 'page'} ${direction} by (${deltaX}, ${deltaY})${suffix}`);
  } catch (e) {
    return err(`Scroll failed: ${errorMessage(e)}`);
  }
}

// ─── Inspection ────────────────────────────────────────────────────────

export async function browserEvaluateScript(
  functionDeclaration: string,
  opts: {
    pageId?: PageId;
    args?: Array<{ ref?: string; uid?: string }>;
  } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const objectIds: string[] = [];
    for (const arg of opts.args || []) {
      const ref = arg.ref || arg.uid;
      if (!ref) return err('each evaluate_script arg must include ref');
      objectIds.push(await resolveRefToObjectId(id, ref));
    }
    // Execute the function in the page, passing resolved object handles as arguments.
    const { result, exceptionDetails } = await sendCdp<{
      result: { value?: unknown; unserializableValue?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>(id, 'Runtime.evaluate', {
      // Wrap: invoke the user's function, inject arguments by objectId via a second evaluate step isn't supported
      // — instead we use callFunctionOn on the page object.
      expression: `(${functionDeclaration})()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      return err(`Evaluate threw: ${exceptionDetails.exception?.description || exceptionDetails.text || 'unknown'}`);
    }
    const value = result?.value ?? result?.unserializableValue ?? null;
    // evaluate returns a raw JS value — emit compact single-line JSON so the
    // agent can parse it back reliably. yaml loses type precision (numbers vs
    // numeric strings, empty vs null) which matters for expression results.
    const rendered = typeof value === 'string' ? JSON.stringify(value) : compactJson(value);
    return ok(`Script ran and returned: ${rendered}`, { structured: { value } });
  } catch (e) {
    return err(`Evaluate error: ${errorMessage(e)}`);
  }
}

export async function browserListConsoleMessages(opts: {
  pageId?: PageId;
  pageSize?: number;
  pageIdx?: number;
  types?: string[];
  includePreservedMessages?: boolean;
} = {}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const messages = await invokeBrowserHost<Array<Record<string, unknown>>>('browser.console_buffer', {
      pageId: id,
      includePreserved: !!opts.includePreservedMessages,
    });
    let filtered = messages;
    if (opts.types && opts.types.length > 0) {
      const set = new Set(opts.types);
      filtered = messages.filter((m) => set.has(m.type as string));
    }
    const paged = paginate(filtered, opts.pageIdx, opts.pageSize);
    if (paged.length === 0) return ok('No console messages');
    // one concise line per message: "#id type: text". full detail (location,
    // stack trace, timestamp) lives behind get_console_message.
    const lines = [`Console messages (${filtered.length} total):`];
    for (const m of paged) {
      const msgid = m.msgid ?? m.id ?? '?';
      const type = m.type ?? 'log';
      const text = typeof m.text === 'string' ? m.text : formatYaml(m.text);
      lines.push(`  #${msgid} ${type}: ${text}`);
    }
    return ok(lines.join('\n'), {
      structured: {
        total: filtered.length,
        pageIdx: opts.pageIdx ?? 0,
        pageSize: opts.pageSize ?? filtered.length,
        messages: paged,
      },
    });
  } catch (e) {
    return err(`Console fetch failed: ${errorMessage(e)}`);
  }
}

export async function browserGetConsoleMessage(msgid: number, opts: { pageId?: PageId } = {}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const entry = await invokeBrowserHost<Record<string, unknown> | null>('browser.console_get', { pageId: id, msgid });
    if (!entry) return err(`Console message ${msgid} not found`);
    return ok(formatYaml(entry), { structured: entry });
  } catch (e) {
    return err(`Console get failed: ${errorMessage(e)}`);
  }
}

export async function browserListNetworkRequests(opts: {
  pageId?: PageId;
  pageSize?: number;
  pageIdx?: number;
  resourceTypes?: string[];
  includePreservedRequests?: boolean;
} = {}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const result = await invokeBrowserHost<{ requests: Array<Record<string, unknown>>; latestReqId: number | null }>(
      'browser.network_buffer',
      { pageId: id, includePreserved: !!opts.includePreservedRequests },
    );
    let records = result.requests;
    if (opts.resourceTypes && opts.resourceTypes.length > 0) {
      const set = new Set(opts.resourceTypes);
      records = records.filter((r) => set.has(r.resourceType as string));
    }
    const paged = paginate(records, opts.pageIdx, opts.pageSize);
    if (paged.length === 0) return ok('No network requests');
    // one line per request: "#reqid METHOD status url", extra fields nested
    const lines = [`Network requests (${records.length} total${result.latestReqId != null ? `, latest=#${result.latestReqId}` : ''}):`];
    for (const r of paged) {
      const reqid = r.reqid ?? r.id ?? '?';
      const method = r.method ?? 'GET';
      const status = r.status ?? r.statusCode ?? '-';
      const url = r.url ?? '';
      const rtype = r.resourceType ? ` [${r.resourceType}]` : '';
      lines.push(`  #${reqid} ${method} ${status} ${url}${rtype}`);
    }
    return ok(lines.join('\n'), {
      structured: {
        total: records.length,
        pageIdx: opts.pageIdx ?? 0,
        pageSize: opts.pageSize ?? records.length,
        selectedReqId: result.latestReqId,
        requests: paged,
      },
    });
  } catch (e) {
    return err(`Network fetch failed: ${errorMessage(e)}`);
  }
}

export async function browserGetNetworkRequest(
  reqid: number | undefined,
  opts: {
    pageId?: PageId;
    requestFilePath?: string;
    responseFilePath?: string;
  } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const record = await invokeBrowserHost<{
      entry: Record<string, unknown>;
      requestBody: string | null;
      responseBody: { encoding: string; data: string } | null;
    } | null>('browser.network_get', { pageId: id, reqid });
    if (!record) return err(`Network request ${reqid ?? '(latest)'} not found`);

    const payload: Record<string, unknown> = { request: record.entry };

    if (record.requestBody) {
      if (opts.requestFilePath) {
        const out = resolve(opts.requestFilePath);
        await writeFile(out, record.requestBody, 'utf-8');
        payload.requestBodyFile = out;
      } else {
        const t = truncate(record.requestBody);
        payload.requestBody = { encoding: 'utf8', truncated: t.truncated, data: t.value };
      }
    }

    if (record.responseBody) {
      if (opts.responseFilePath) {
        const out = resolve(opts.responseFilePath);
        const buf = record.responseBody.encoding === 'base64'
          ? Buffer.from(record.responseBody.data, 'base64')
          : Buffer.from(record.responseBody.data, 'utf-8');
        await writeFile(out, buf);
        payload.responseBodyFile = out;
      } else {
        const t = truncate(record.responseBody.data);
        payload.responseBody = {
          encoding: record.responseBody.encoding,
          truncated: t.truncated,
          data: t.value,
        };
      }
    }

    return ok(formatYaml(payload), { structured: payload });
  } catch (e) {
    return err(`Network get failed: ${errorMessage(e)}`);
  }
}

export async function browserCookies(
  action: 'get' | 'set' | 'clear',
  opts: { pageId?: PageId; name?: string; value?: string; url?: string } = {},
): Promise<ActionResult> {
  try {
    const id = opts.pageId ? opts.pageId : await requirePageId().catch(() => undefined);
    switch (action) {
      case 'get': {
        const params: Record<string, unknown> = {};
        if (opts.url) params.urls = [opts.url];
        const { cookies } = await sendCdp<{ cookies: Array<Record<string, unknown>> }>(id, 'Network.getCookies', params);
        if (cookies.length === 0) return ok('No cookies');
        // compact one-liner per cookie: "name = value (host=..., path=..., secure)"
        const lines = cookies.map((c) => {
          const flags = [
            c.domain ? `domain=${c.domain}` : '',
            c.path ? `path=${c.path}` : '',
            c.secure ? 'secure' : '',
            c.httpOnly ? 'httpOnly' : '',
            c.sameSite ? `sameSite=${c.sameSite}` : '',
          ].filter(Boolean).join(', ');
          return `  ${c.name} = ${c.value}${flags ? ` (${flags})` : ''}`;
        });
        return ok([`Cookies (${cookies.length}):`, ...lines].join('\n'), { structured: { cookies } });
      }
      case 'set': {
        if (!opts.name || !opts.value) return err('name and value are required');
        await sendCdp(id, 'Network.setCookie', {
          name: opts.name,
          value: opts.value,
          url: opts.url,
        });
        return ok(`Cookie ${opts.name} set`);
      }
      case 'clear': {
        await sendCdp(id, 'Network.clearBrowserCookies');
        return ok('Cookies cleared');
      }
      default:
        return err(`Unknown cookie action: ${action}`);
    }
  } catch (e) {
    return err(`Cookies ${action} failed: ${errorMessage(e)}`);
  }
}

export async function browserHandleDialog(
  action: 'accept' | 'dismiss',
  opts: { pageId?: PageId; promptText?: string } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    await sendCdp(id, 'Page.handleJavaScriptDialog', {
      accept: action === 'accept',
      promptText: opts.promptText,
    });
    return ok(`Handled dialog with ${action}`);
  } catch (e) {
    return err(`Dialog handling failed: ${errorMessage(e)}`);
  }
}

export async function browserWaitForText(
  text: string,
  opts: { pageId?: PageId; timeout?: number } = {},
): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const deadline = Date.now() + (opts.timeout ?? 15_000);
    while (Date.now() < deadline) {
      const { result } = await sendCdp<{ result: { value: boolean } }>(id, 'Runtime.evaluate', {
        expression: `(() => {
          const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
          let n; while ((n = walker.nextNode())) if (n.nodeValue && n.nodeValue.includes(${JSON.stringify(text)})) return true;
          return false;
        })()`,
        returnByValue: true,
      });
      if (result?.value) {
        const suffix = await appendSnapshotIfNeeded(id, true);
        return ok(`Found text "${text}"${suffix}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return err(`Timed out waiting for "${text}"`);
  } catch (e) {
    return err(`Wait failed: ${errorMessage(e)}`);
  }
}

// ─── Device ────────────────────────────────────────────────────────────

export async function browserEmulate(opts: {
  pageId?: PageId;
  userAgent?: string | null;
  colorScheme?: 'dark' | 'light' | 'auto';
  geolocation?: { latitude: number; longitude: number } | null;
  networkConditions?: 'No emulation' | 'Offline' | 'Slow 3G' | 'Fast 3G' | 'Slow 4G' | 'Fast 4G';
  cpuThrottlingRate?: number;
  viewport?: { width: number; height: number; deviceScaleFactor?: number; isMobile?: boolean; isLandscape?: boolean } | null;
}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    const summary: string[] = [];

    if (opts.userAgent !== undefined) {
      await sendCdp(id, 'Emulation.setUserAgentOverride', { userAgent: opts.userAgent ?? '' });
      summary.push(opts.userAgent ? `User agent: ${opts.userAgent}` : 'User agent reset');
    }
    if (opts.colorScheme) {
      if (opts.colorScheme === 'auto') {
        await sendCdp(id, 'Emulation.setEmulatedMedia', { features: [] });
      } else {
        await sendCdp(id, 'Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: opts.colorScheme }],
        });
      }
      summary.push(`Color scheme: ${opts.colorScheme}`);
    }
    if (opts.geolocation !== undefined) {
      if (opts.geolocation === null) {
        await sendCdp(id, 'Emulation.clearGeolocationOverride');
        summary.push('Geolocation cleared');
      } else {
        await sendCdp(id, 'Emulation.setGeolocationOverride', {
          latitude: opts.geolocation.latitude,
          longitude: opts.geolocation.longitude,
          accuracy: 1,
        });
        summary.push(`Geolocation: ${opts.geolocation.latitude}, ${opts.geolocation.longitude}`);
      }
    }
    if (opts.cpuThrottlingRate !== undefined) {
      await sendCdp(id, 'Emulation.setCPUThrottlingRate', { rate: opts.cpuThrottlingRate });
      summary.push(`CPU throttle: ${opts.cpuThrottlingRate}x`);
    }
    if (opts.networkConditions) {
      const presets: Record<string, { offline: boolean; latency: number; download: number; upload: number }> = {
        'No emulation': { offline: false, latency: 0, download: -1, upload: -1 },
        'Offline': { offline: true, latency: 0, download: 0, upload: 0 },
        'Slow 3G': { offline: false, latency: 400, download: 500 * 1024 / 8, upload: 500 * 1024 / 8 },
        'Fast 3G': { offline: false, latency: 150, download: 1.6 * 1024 * 1024 / 8, upload: 750 * 1024 / 8 },
        'Slow 4G': { offline: false, latency: 100, download: 4 * 1024 * 1024 / 8, upload: 3 * 1024 * 1024 / 8 },
        'Fast 4G': { offline: false, latency: 40, download: 9 * 1024 * 1024 / 8, upload: 9 * 1024 * 1024 / 8 },
      };
      const preset = presets[opts.networkConditions];
      if (!preset) return err(`Unknown networkConditions: ${opts.networkConditions}`);
      await sendCdp(id, 'Network.emulateNetworkConditions', {
        offline: preset.offline,
        latency: preset.latency,
        downloadThroughput: preset.download,
        uploadThroughput: preset.upload,
      });
      summary.push(`Network: ${opts.networkConditions}`);
    }
    if (opts.viewport !== undefined) {
      if (opts.viewport === null) {
        await sendCdp(id, 'Emulation.clearDeviceMetricsOverride');
        summary.push('Viewport cleared');
      } else {
        await sendCdp(id, 'Emulation.setDeviceMetricsOverride', {
          width: opts.viewport.width,
          height: opts.viewport.height,
          deviceScaleFactor: opts.viewport.deviceScaleFactor ?? 1,
          mobile: !!opts.viewport.isMobile,
          screenOrientation: opts.viewport.isLandscape
            ? { type: 'landscapePrimary', angle: 90 }
            : { type: 'portraitPrimary', angle: 0 },
        });
        summary.push(`Viewport: ${opts.viewport.width}x${opts.viewport.height}`);
      }
    }

    return ok(summary.length ? summary.join('\n') : 'No emulation changes');
  } catch (e) {
    return err(`Emulate failed: ${errorMessage(e)}`);
  }
}

export async function browserResize(width: number, height: number, opts: { pageId?: PageId } = {}): Promise<ActionResult> {
  try {
    const id = await requirePageId(opts.pageId);
    await sendCdp(id, 'Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    return ok(`Resized to ${width}x${height}`);
  } catch (e) {
    return err(`Resize failed: ${errorMessage(e)}`);
  }
}

// ─── Mutex (serialize browser actions across concurrent tool calls) ────

let mutexLocked = false;
const mutexQueue: Array<() => void> = [];

export async function acquireBrowserMutex(): Promise<() => void> {
  if (!mutexLocked) {
    mutexLocked = true;
    return () => {
      const next = mutexQueue.shift();
      if (next) next();
      else mutexLocked = false;
    };
  }
  return new Promise((resolve) => {
    mutexQueue.push(() => {
      resolve(() => {
        const next = mutexQueue.shift();
        if (next) next();
        else mutexLocked = false;
      });
    });
  });
}

// ─── Compat shim (removed actions that still exist in src/tools/browser.ts) ───

/** Stubs that return a helpful error for removed actions. */
export async function browserStatus(): Promise<ActionResult> {
  return browserListPages();
}
export async function browserStart(): Promise<ActionResult> {
  return ok('Browser is always running inside dorabot; no start needed. Use list_pages to see tabs.');
}
export async function browserStop(): Promise<ActionResult> {
  return ok('Browser stays running inside dorabot. Close individual tabs with close_page.');
}

// Re-export types consumers might want
export type { PageId, TabSummary };
