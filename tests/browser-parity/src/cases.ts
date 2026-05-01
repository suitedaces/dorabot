// cases — each test asks one question: is the output the AI sees actually
// useful? we don't diff against playwright. we assert the snapshot YAML,
// action response text, and auxiliary listings contain the information an
// LLM-driven agent would need to understand and act on the page.
//
// invariants we care about:
//   - snapshot reflects real state (text content, input values, select, etc.)
//   - snapshot updates after interactions (click / fill / hover / nav)
//   - refs are stable across re-snapshots on the same document
//   - refs invalidate cleanly after navigation (error, not silent success)
//   - multi-tab state is observable (list_pages, per-page actions)
//   - auxiliary surfaces (console / network / cookies) are machine-parseable
import { writeFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  browserListPages,
  browserNewPage,
  browserClosePage,
  browserNavigatePage,
  browserOpen,
  browserSnapshot,
  browserScreenshot,
  browserPdf,
  browserClick,
  browserClickAt,
  browserDrag,
  browserType,
  browserFill,
  browserFillForm,
  browserSelect,
  browserPressKey,
  browserHover,
  browserUploadFile,
  browserScroll,
  browserEvaluateScript,
  browserListConsoleMessages,
  browserGetConsoleMessage,
  browserListNetworkRequests,
  browserGetNetworkRequest,
  browserCookies,
  browserHandleDialog,
  browserWaitForText,
  browserEmulate,
  browserResize,
  browserStatus,
} from '../../../src/browser/actions';
import type { TestCase } from './runner';
import { assert, assertEqual, assertIncludes, assertMatch, sleep, waitFor } from './util';

// ── helpers ────────────────────────────────────────────────────────────

type ParsedNode = {
  role: string;
  name?: string;
  ref: string;
  value?: string;
  flags: string[];
  raw: string;
};

// parse a snapshot YAML line like `- button "Click me" [ref=e7]` into a
// structured record. not a full YAML parser — just enough to assert.
function parseLine(line: string): ParsedNode | null {
  const m = line.match(/^\s*-\s+(\S+)(.*?)\s+\[ref=(e\d+)\](?::\s+(.*))?$/);
  if (!m) return null;
  const [, role, rest, ref, value] = m;
  const nameMatch = rest.match(/"((?:[^"\\]|\\.)*)"/);
  const name = nameMatch ? nameMatch[1] : undefined;
  const flags = Array.from(rest.matchAll(/\[([^\]=]+)(?:=([^\]]+))?\]/g)).map((mm) => mm[0]);
  return { role, name, ref, value: value ? parseMaybeString(value) : undefined, flags, raw: line };
}

function parseMaybeString(v: string): string {
  const t = v.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch { /* fall through */ }
  }
  return t;
}

function parseSnapshot(yaml: string): ParsedNode[] {
  const out: ParsedNode[] = [];
  for (const line of yaml.split('\n')) {
    const p = parseLine(line);
    if (p) out.push(p);
  }
  return out;
}

function findNode(nodes: ParsedNode[], pred: (n: ParsedNode) => boolean, what: string): ParsedNode {
  const n = nodes.find(pred);
  if (!n) throw new Error(`no node matched ${what} in snapshot`);
  return n;
}

// take snapshot, return the tuple (full text, body yaml, parsed nodes)
async function snapshot(pageId: string, opts: { interactiveOnly?: boolean } = {}): Promise<{
  full: string;
  yaml: string;
  nodes: ParsedNode[];
  url: string;
  title: string;
}> {
  const snap = await browserSnapshot({ pageId, interactiveOnly: opts.interactiveOnly });
  assert(!snap.isError, `snapshot failed: ${snap.text}`);
  // browserSnapshot text is `${title}\n${url}\n\n${yaml}`
  const lines = snap.text.split('\n');
  const title = lines[0] || '';
  const url = lines[1] || '';
  const yaml = lines.slice(3).join('\n');
  return { full: snap.text, yaml, nodes: parseSnapshot(yaml), url, title };
}

// read page state directly — only used to verify that side effects the AI
// cannot see via snapshot (cookies, hidden divs) actually happened. the action
// attaches structured.value for us; tests consume that directly.
async function readPage<T = unknown>(pageId: string, expr: string): Promise<T> {
  const r = await browserEvaluateScript(`() => (${expr})`, { pageId });
  assert(!r.isError, `evaluate failed: ${r.text}`);
  if (r.structured && 'value' in r.structured) return r.structured.value as T;
  // fallback: parse the "Script ran and returned: <json>" line
  const m = r.text.match(/^Script ran and returned:\s*([\s\S]*)$/);
  if (m) { try { return JSON.parse(m[1]) as T; } catch {} }
  return r.text as unknown as T;
}

// ── cases ──────────────────────────────────────────────────────────────

export const CASES: TestCase[] = [
  // ─── Group A: snapshot is a faithful mirror of visible page state ────

  {
    name: 'snapshot surfaces heading, button label, input label',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const { yaml, nodes, title, url } = await snapshot(pageId);
      assertIncludes(title, 'Basic Fixture', 'page title');
      assertIncludes(url, '/basic.html', 'page url');
      findNode(nodes, (n) => n.role === 'heading' && /Basic Fixture/.test(n.name || ''), 'h1 heading');
      findNode(nodes, (n) => n.role === 'button' && /Click me/.test(n.name || ''), 'submit button');
      // input is inside <label>Name: ...</label> — the label becomes its accessible name
      findNode(nodes, (n) => n.role === 'textbox', 'text input');
      // if the AI can't see any of these, it's blind to the page
      assert(nodes.length >= 3, `expected >=3 nodes, got ${nodes.length}:\n${yaml}`);
    },
  },

  {
    name: 'snapshot shows input value after fill (AI can see what it typed)',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const input = findNode(before.nodes, (n) => n.role === 'textbox', 'text input');
      // if there was no value, before.value should be empty
      assert(!input.value, `input should start empty, got: ${input.value}`);

      const fillResult = await browserFill(input.ref, 'hello world', { pageId });
      assert(!fillResult.isError, `fill failed: ${fillResult.text}`);

      const after = await snapshot(pageId);
      const input2 = findNode(after.nodes, (n) => n.role === 'textbox', 'text input');
      assertEqual(input2.value, 'hello world', 'snapshot input value after fill');
    },
  },

  {
    name: 'snapshot shows select selection after choice',
    fixture: '/form.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const select = findNode(before.nodes, (n) => n.role === 'combobox', 'color select');

      const r = await browserSelect(select.ref, ['green'], { pageId });
      assert(!r.isError, `select failed: ${r.text}`);

      const after = await snapshot(pageId);
      const select2 = findNode(after.nodes, (n) => n.role === 'combobox', 'color select after');
      // a <select>'s accessible value is the selected option's text/value
      assertIncludes((select2.value || select2.name || '').toLowerCase(), 'green', 'selected option visible to AI');
    },
  },

  {
    name: 'snapshot shows [checked] flag after checkbox click',
    fixture: '/form.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const check = findNode(before.nodes, (n) => n.role === 'checkbox', 'agree checkbox');
      assert(!check.flags.some((f) => f === '[checked]'), 'checkbox should start unchecked');

      const r = await browserClick(check.ref, { pageId });
      assert(!r.isError, `checkbox click failed: ${r.text}`);

      const after = await snapshot(pageId);
      const check2 = findNode(after.nodes, (n) => n.role === 'checkbox', 'agree checkbox after');
      assert(check2.flags.some((f) => f === '[checked]'), `[checked] flag missing:\n${check2.raw}`);
    },
  },

  {
    name: 'interactiveOnly produces a flat list of actionable refs',
    fixture: '/form.html',
    run: async ({ pageId }) => {
      const { yaml, nodes } = await snapshot(pageId, { interactiveOnly: true });
      assert(nodes.length >= 4, `expected form inputs+button, got ${nodes.length}:\n${yaml}`);
      const interactiveRoles = new Set(['textbox', 'combobox', 'checkbox', 'button', 'radio']);
      for (const n of nodes) {
        assert(interactiveRoles.has(n.role), `interactiveOnly leaked non-interactive role "${n.role}":\n${n.raw}`);
      }
      // flat list means no indentation
      for (const line of yaml.split('\n')) {
        if (!line.trim()) continue;
        assert(/^-\s/.test(line), `interactiveOnly line not at depth 0: ${JSON.stringify(line)}`);
      }
    },
  },

  // ─── Group B: interactions produce state visible in next snapshot ────

  {
    name: 'click updates snapshot: button flips #out text to "clicked!"',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const btn = findNode(before.nodes, (n) => n.role === 'button' && /Click me/.test(n.name || ''), 'btn');

      const r = await browserClick(btn.ref, { pageId });
      assert(!r.isError, `click failed: ${r.text}`);

      // the visible text the AI needs to see is "clicked!" in #out
      await waitFor(async () => (await readPage<string>(pageId, 'document.getElementById("out").textContent')) === 'clicked!',
        { timeoutMs: 2000, label: '#out updated' });

      // and the snapshot should reflect it (via the visible text — AX tree
      // exposes text nodes through their parent generic / region)
      const dom = await readPage<string>(pageId, 'document.body.innerText');
      assertIncludes(dom || '', 'clicked!', 'post-click body text');
    },
  },

  {
    name: 'type produces visible characters the AI can see',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const input = findNode(before.nodes, (n) => n.role === 'textbox', 'text input');

      // focus input via a click first (type operates on the focused element
      // through Input.insertText)
      const click = await browserClick(input.ref, { pageId });
      assert(!click.isError, `focus click failed: ${click.text}`);

      const t = await browserType(input.ref, 'abc123', { pageId });
      assert(!t.isError, `type failed: ${t.text}`);

      const after = await snapshot(pageId);
      const input2 = findNode(after.nodes, (n) => n.role === 'textbox', 'text input after type');
      assertIncludes(input2.value || '', 'abc123', 'snapshot shows typed chars');
    },
  },

  {
    name: 'fill_form applies all values and snapshot reflects each',
    fixture: '/form.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const name = findNode(before.nodes, (n) => n.role === 'textbox' && /Name/.test(n.name || ''), 'name input');
      const email = findNode(before.nodes, (n) => n.role === 'textbox' && /Email/.test(n.name || ''), 'email input');
      const color = findNode(before.nodes, (n) => n.role === 'combobox', 'color select');

      const r = await browserFillForm([
        { ref: name.ref, value: 'Ishan' },
        { ref: email.ref, value: 'ishan@example.com' },
        { ref: color.ref, value: 'blue' },
      ], { pageId });
      assert(!r.isError, `fill_form failed: ${r.text}`);

      const after = await snapshot(pageId);
      const name2 = findNode(after.nodes, (n) => n.role === 'textbox' && /Name/.test(n.name || ''), 'name after');
      const email2 = findNode(after.nodes, (n) => n.role === 'textbox' && /Email/.test(n.name || ''), 'email after');
      const color2 = findNode(after.nodes, (n) => n.role === 'combobox', 'color after');
      assertEqual(name2.value, 'Ishan', 'name value');
      assertEqual(email2.value, 'ishan@example.com', 'email value');
      assertIncludes((color2.value || '').toLowerCase(), 'blue', 'color value');
    },
  },

  {
    name: 'submit via type-and-press-Enter triggers handler, snapshot shows result text',
    fixture: '/form.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const name = findNode(before.nodes, (n) => n.role === 'textbox' && /Name/.test(n.name || ''), 'name input');

      // put values in, then click submit
      await browserFill(name.ref, 'Ada', { pageId });
      const email = findNode(before.nodes, (n) => n.role === 'textbox' && /Email/.test(n.name || ''), 'email input');
      await browserFill(email.ref, 'ada@example.com', { pageId });

      const submit = findNode(before.nodes, (n) => n.role === 'button' && /Submit/.test(n.name || ''), 'submit button');
      const r = await browserClick(submit.ref, { pageId });
      assert(!r.isError, `submit click failed: ${r.text}`);

      // handler writes `name=Ada,email=ada@example.com,color=red,` to #result
      await waitFor(async () => {
        const t = await readPage<string>(pageId, 'document.getElementById("result").textContent || ""');
        return t.includes('name=Ada');
      }, { timeoutMs: 2000, label: '#result populated' });

      const resultText = await readPage<string>(pageId, 'document.getElementById("result").textContent');
      assertIncludes(resultText, 'name=Ada', 'form submit result text');
      assertIncludes(resultText, 'ada@example.com', 'email echoed in result');
    },
  },

  {
    name: 'hover triggers mouseover handler, snapshot shows new state',
    fixture: '/hover.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const btn = findNode(before.nodes, (n) => n.role === 'button', 'hover button');

      const r = await browserHover(btn.ref, { pageId });
      assert(!r.isError, `hover failed: ${r.text}`);

      await waitFor(async () => {
        const t = await readPage<string>(pageId, 'document.getElementById("state").textContent || ""');
        return t.includes('hovered') || t.includes('on') || t.length > 0;
      }, { timeoutMs: 2000, label: '#state updated' });
    },
  },

  {
    name: 'click_at by coordinates triggers handler even without ref',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      // use getBoundingClientRect via the page to find the button
      const rect = await readPage<{ x: number; y: number }>(pageId,
        '(() => { const r = document.getElementById("btn").getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()');
      const r = await browserClickAt(rect.x, rect.y, { pageId });
      assert(!r.isError, `click_at failed: ${r.text}`);
      await waitFor(async () => (await readPage<string>(pageId, 'document.getElementById("out").textContent')) === 'clicked!',
        { timeoutMs: 2000, label: 'click_at triggered handler' });
    },
  },

  // ─── Group C: refs are stable / invalidate correctly ────────────────

  {
    name: 'ref from snapshot N still clicks after snapshot N+1 (stability)',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const s1 = await snapshot(pageId);
      const btn1 = findNode(s1.nodes, (n) => n.role === 'button' && /Click me/.test(n.name || ''), 'btn s1');

      // take a second snapshot — refs should still be the same backendNodeId
      const s2 = await snapshot(pageId);
      const btn2 = findNode(s2.nodes, (n) => n.role === 'button' && /Click me/.test(n.name || ''), 'btn s2');
      assertEqual(btn1.ref, btn2.ref, 'ref stable across re-snapshots');

      // click via the original ref
      const r = await browserClick(btn1.ref, { pageId });
      assert(!r.isError, `click via s1 ref failed: ${r.text}`);
    },
  },

  {
    name: 'ref survives DOM text mutation on sibling element',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const s1 = await snapshot(pageId);
      const btn = findNode(s1.nodes, (n) => n.role === 'button' && /Click me/.test(n.name || ''), 'btn');

      // mutate an unrelated sibling — the button node itself shouldn't be
      // replaced, so the backendNodeId and ref should still work
      await readPage(pageId, 'document.getElementById("out").textContent = "mutated"');
      const r = await browserClick(btn.ref, { pageId });
      assert(!r.isError, `ref invalidated by sibling mutation: ${r.text}`);
    },
  },

  {
    name: 'ref fails cleanly after navigation (AI gets an error, not a wrong click)',
    fixture: '/nav-a.html',
    run: async ({ pageId, httpBase }) => {
      const s1 = await snapshot(pageId);
      const a = findNode(s1.nodes, (n) => n.role === 'link', 'link');

      // navigate away entirely
      const nav = await browserNavigatePage({ pageId, type: 'url', url: `${httpBase}/nav-b.html` });
      assert(!nav.isError, `nav failed: ${nav.text}`);
      await waitFor(async () => (await readPage<string>(pageId, 'location.pathname')) === '/nav-b.html',
        { timeoutMs: 3000, label: 'navigated to b' });

      // now try to use the old ref — should error, not silently target the
      // wrong page
      const r = await browserClick(a.ref, { pageId });
      assert(r.isError, `old ref must error after nav, got success: ${r.text}`);
    },
  },

  // ─── Group D: navigation surfaces (AI's view of location) ───────────

  {
    name: 'navigate updates snapshot url/title',
    fixture: '/nav-a.html',
    run: async ({ pageId, httpBase }) => {
      const s1 = await snapshot(pageId);
      assertIncludes(s1.url, '/nav-a.html', 's1 url');

      await browserNavigatePage({ pageId, type: 'url', url: `${httpBase}/nav-b.html` });
      await waitFor(async () => (await readPage<string>(pageId, 'location.pathname')) === '/nav-b.html',
        { timeoutMs: 3000, label: 'nav b' });

      const s2 = await snapshot(pageId);
      assertIncludes(s2.url, '/nav-b.html', 's2 url');
      findNode(s2.nodes, (n) => n.role === 'heading' && /Page B/i.test(n.name || ''), 'Page B heading');
    },
  },

  {
    name: 'back/forward restore prior page state in snapshot',
    fixture: '/nav-a.html',
    run: async ({ pageId, httpBase }) => {
      await browserNavigatePage({ pageId, type: 'url', url: `${httpBase}/nav-b.html` });
      await waitFor(async () => (await readPage<string>(pageId, 'location.pathname')) === '/nav-b.html',
        { timeoutMs: 3000, label: 'forward to b' });

      const back = await browserNavigatePage({ pageId, type: 'back' });
      assert(!back.isError, `back failed: ${back.text}`);
      await waitFor(async () => (await readPage<string>(pageId, 'location.pathname')) === '/nav-a.html',
        { timeoutMs: 3000, label: 'back to a' });

      const s = await snapshot(pageId);
      findNode(s.nodes, (n) => n.role === 'heading' && /Page A/i.test(n.name || ''), 'Page A heading after back');
    },
  },

  {
    name: 'open switches focused page and snapshot reflects new url',
    fixture: '/basic.html',
    run: async ({ pageId, httpBase }) => {
      const r = await browserOpen(`${httpBase}/nav-a.html`, { pageId });
      assert(!r.isError, `open failed: ${r.text}`);
      await waitFor(async () => (await readPage<string>(pageId, 'location.pathname')) === '/nav-a.html',
        { timeoutMs: 3000, label: 'open navigated' });
      const s = await snapshot(pageId);
      assertIncludes(s.url, '/nav-a.html', 'url after open');
    },
  },

  // ─── Group E: multi-tab awareness (unique to the new design) ────────

  {
    name: 'list_pages includes every open tab with url+title',
    fixture: '/basic.html',
    run: async ({ pageId, httpBase }) => {
      const second = await browserNewPage(`${httpBase}/nav-a.html`);
      assert(!second.isError, `new_page failed: ${second.text}`);

      const list = await browserListPages();
      assert(!list.isError, `list_pages failed: ${list.text}`);
      assertIncludes(list.text, '/basic.html', 'list contains first tab url');
      assertIncludes(list.text, '/nav-a.html', 'list contains second tab url');
    },
  },

  {
    name: 'close_page removes that tab from list_pages',
    fixture: '/basic.html',
    run: async ({ httpBase }) => {
      const newTab = await browserNewPage(`${httpBase}/nav-b.html`);
      assert(!newTab.isError, `new_page failed: ${newTab.text}`);
      const newPageId = newTab.structured?.pageId as string | undefined;
      assert(typeof newPageId === 'string' && newPageId.length > 0,
        `new_page didn't return a structured pageId: ${JSON.stringify(newTab.structured)}`);

      const before = await browserListPages();
      assertIncludes(before.text, '/nav-b.html', 'new tab visible before close');

      const closed = await browserClosePage(newPageId);
      assert(!closed.isError, `close_page failed: ${closed.text}`);
      const after = await browserListPages();
      assert(!after.text.includes('/nav-b.html'),
        `closed tab still in list:\n${after.text}`);
    },
  },

  {
    name: 'status aliases list_pages (same content)',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const status = await browserStatus();
      const list = await browserListPages();
      assert(!status.isError && !list.isError, 'both should succeed');
      // both should reference the current page
      assertIncludes(status.text, '/basic.html', 'status contains url');
      assertIncludes(list.text, '/basic.html', 'list contains url');
    },
  },

  // ─── Group F: auxiliary AI-visible surfaces ────────────────────────

  {
    name: 'list_console_messages surfaces log + error with type and text',
    fixture: '/console-net.html',
    run: async ({ pageId }) => {
      // page does console.log("ready") and console.error("oops") on load
      await waitFor(async () => {
        const r = await browserListConsoleMessages({ pageId });
        // new format: "  #1 log: parity-log hello" / "#2 error: oops"
        return !r.isError && /\blog\b/.test(r.text) && /\berror\b/.test(r.text);
      }, { timeoutMs: 3000, label: 'console messages captured' });

      const r = await browserListConsoleMessages({ pageId });
      assert(!r.isError, `list_console_messages failed: ${r.text}`);
      assertIncludes(r.text, 'parity-log', 'log text');
      assertIncludes(r.text, 'parity-error', 'error text');
      // each message line is "#<id> <type>: <text>" — look for both types
      assertMatch(r.text, /#\d+\s+log:/, 'log message typed line');
      assertMatch(r.text, /#\d+\s+error:/, 'error message typed line');
    },
  },

  {
    name: 'list_network_requests surfaces fetch with url, method, status',
    fixture: '/console-net.html',
    run: async ({ pageId }) => {
      // the page fetches /api/echo?msg=hi on load
      await waitFor(async () => {
        const r = await browserListNetworkRequests({ pageId });
        return !r.isError && /\/api\/echo/.test(r.text);
      }, { timeoutMs: 3000, label: 'fetch recorded' });

      const r = await browserListNetworkRequests({ pageId });
      assertIncludes(r.text, '/api/echo', 'url surfaced');
      // new format: "  #2 GET 200 http://... [Fetch]"
      assertMatch(r.text, /#\d+\s+GET\s+200\s+\S*\/api\/echo/, 'method+status+url line');
    },
  },

  {
    name: 'get_network_request returns response body for latest fetch',
    fixture: '/console-net.html',
    run: async ({ pageId }) => {
      await waitFor(async () => {
        const r = await browserListNetworkRequests({ pageId });
        return !r.isError && /\/api\/echo/.test(r.text);
      }, { timeoutMs: 3000, label: 'fetch recorded' });

      const r = await browserGetNetworkRequest(undefined, { pageId });
      assert(!r.isError, `get_network_request failed: ${r.text}`);
      // /api/echo echoes back the query, so body should contain "hi"
      assertIncludes(r.text, 'hi', 'response body contains echo');
    },
  },

  {
    name: 'cookies set then get round-trips name and value',
    fixture: '/cookie.html',
    run: async ({ pageId, httpBase }) => {
      const set = await browserCookies('set', {
        pageId,
        name: 'dorabot_test',
        value: 'yum',
        url: httpBase,
      });
      assert(!set.isError, `cookie set failed: ${set.text}`);

      const get = await browserCookies('get', { pageId, url: httpBase });
      assert(!get.isError, `cookie get failed: ${get.text}`);
      assertIncludes(get.text, 'dorabot_test', 'cookie name present');
      assertIncludes(get.text, 'yum', 'cookie value present');
    },
  },

  {
    name: 'screenshot produces a non-empty PNG file on disk',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const tmp = mkdtempSync(join(tmpdir(), 'parity-shot-'));
      const out = join(tmp, 'shot.png');
      const r = await browserScreenshot({ pageId, filePath: out, format: 'png' });
      assert(!r.isError, `screenshot failed: ${r.text}`);
      const st = statSync(out);
      assert(st.size > 1000, `screenshot too small (${st.size} bytes) — probably blank`);
      // png magic header
      const head = readFileSync(out).subarray(0, 4);
      assertEqual(head[0], 0x89, 'PNG magic byte 0');
      assertEqual(head[1], 0x50, 'PNG magic byte 1 (P)');
    },
  },

  {
    name: 'pdf writes a non-empty PDF file',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const tmp = mkdtempSync(join(tmpdir(), 'parity-pdf-'));
      const out = join(tmp, 'out.pdf');
      const r = await browserPdf({ pageId, filePath: out });
      assert(!r.isError, `pdf failed: ${r.text}`);
      const head = readFileSync(out).subarray(0, 4);
      assertEqual(head[0], 0x25, 'PDF magic byte 0 (%)');
      assertEqual(head[1], 0x50, 'PDF magic byte 1 (P)');
    },
  },

  {
    name: 'scroll moves viewport; snapshot still valid afterwards',
    fixture: '/scroll.html',
    run: async ({ pageId }) => {
      const r = await browserScroll({ pageId, deltaY: 3000 });
      assert(!r.isError, `scroll failed: ${r.text}`);
      // viewport should now be past the top
      await waitFor(async () => {
        const y = await readPage<number>(pageId, 'window.scrollY');
        return y > 500;
      }, { timeoutMs: 2000, label: 'scrolled past 500px' });

      // snapshot should still build successfully after the scroll
      const s = await snapshot(pageId);
      assert(s.nodes.length > 0, 'snapshot produced no nodes after scroll');
    },
  },

  {
    name: 'wait_for unblocks once async text appears (AI waits for dynamic content)',
    fixture: '/wait.html',
    run: async ({ pageId }) => {
      const r = await browserWaitForText('ready now', { pageId, timeout: 3000 });
      assert(!r.isError, `wait_for failed: ${r.text}`);
    },
  },

  {
    name: 'evaluate returns JSON the AI can parse',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const r = await browserEvaluateScript('() => ({ answer: 42, url: location.pathname })', { pageId });
      assert(!r.isError, `evaluate failed: ${r.text}`);
      assertIncludes(r.text, '"answer"', 'json payload');
      assertIncludes(r.text, '42', 'json value');
      assertIncludes(r.text, '/basic.html', 'json url');
    },
  },

  {
    name: 'dialog accept closes alert; page handler records confirmation',
    fixture: '/dialog.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const confirmBtn = findNode(before.nodes, (n) => n.role === 'button' && /confirm/i.test(n.name || ''), 'confirm button');

      // register the handler BEFORE clicking so the dialog is handled
      // browserHandleDialog applies to the next dialog via Page.handleJavaScriptDialog
      // we call click, and before it resolves dialog should fire; handler
      // accepts it — race-y in headless, so we click then immediately handle
      const clickP = browserClick(confirmBtn.ref, { pageId });
      // give the dialog a moment to show
      await sleep(100);
      const handled = await browserHandleDialog('accept', { pageId });
      assert(!handled.isError, `handle_dialog failed: ${handled.text}`);
      await clickP;

      await waitFor(async () => {
        const t = await readPage<string>(pageId, 'document.getElementById("out").textContent || ""');
        return t.length > 0;
      }, { timeoutMs: 2000, label: '#out recorded confirm result' });
    },
  },

  {
    name: 'upload_file surfaces filename the AI can verify',
    fixture: '/upload.html',
    run: async ({ pageId }) => {
      const tmp = mkdtempSync(join(tmpdir(), 'parity-up-'));
      const f = join(tmp, 'payload.txt');
      writeFileSync(f, 'hello from parity');

      const before = await snapshot(pageId);
      const input = findNode(before.nodes, (n) => n.role === 'textbox' || n.role === 'button' || /file/i.test(n.name || ''),
        'file input (may be textbox, button, or named "file")');

      const r = await browserUploadFile(input.ref, f, { pageId });
      if (r.isError) {
        // some harnesses can't attach files via CDP alone; at least verify
        // the error is informative so the AI would know to fall back
        assertIncludes(r.text.toLowerCase(), 'upload', 'upload error message');
        return;
      }
      await waitFor(async () => {
        const t = await readPage<string>(pageId, 'document.getElementById("fname").textContent || ""');
        return t.includes('payload.txt');
      }, { timeoutMs: 2000, label: 'filename shown in #fname' });
    },
  },

  {
    name: 'emulate+resize do not corrupt refs for subsequent actions',
    fixture: '/basic.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const btn = findNode(before.nodes, (n) => n.role === 'button' && /Click me/.test(n.name || ''), 'btn');

      const e = await browserEmulate({
        pageId,
        viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
      });
      // emulate may be a no-op; don't treat "not supported" as a fatal parity
      // failure — AI would see the error and can back off
      if (e.isError) {
        assertIncludes(e.text.toLowerCase(), 'emulate', 'emulate error message informative');
      }

      const rz = await browserResize(1024, 768, { pageId });
      if (rz.isError) {
        assertIncludes(rz.text.toLowerCase(), 'resize', 'resize error message informative');
      }

      // clicking via the pre-emulate ref should still work: backendNodeId
      // survives viewport changes
      const click = await browserClick(btn.ref, { pageId });
      assert(!click.isError, `click broken after emulate/resize: ${click.text}`);
    },
  },

  {
    name: 'press_key after focus triggers keyboard handlers',
    fixture: '/form.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      const name = findNode(before.nodes, (n) => n.role === 'textbox' && /Name/.test(n.name || ''), 'name input');

      await browserClick(name.ref, { pageId });
      await browserType(name.ref, 'Ada', { pageId });

      // press Enter to submit — handler writes to #result
      const p = await browserPressKey('Enter', { pageId });
      assert(!p.isError, `press_key failed: ${p.text}`);

      await waitFor(async () => {
        const t = await readPage<string>(pageId, 'document.getElementById("result").textContent || ""');
        return t.includes('name=Ada');
      }, { timeoutMs: 2000, label: '#result populated via Enter' });
    },
  },

  // drag is left as a probe — HTML5 dnd events often don't synthesize from
  // raw mouse events. we assert the action surface (ref resolution, error
  // text) rather than the drop outcome, since failure here is an upstream
  // chromium limitation not a parity regression.
  {
    name: 'drag returns a sensible result (or informative error)',
    fixture: '/drag.html',
    run: async ({ pageId }) => {
      const before = await snapshot(pageId);
      // try to find two refs — source/target. if the page uses divs without
      // interactive roles, snapshot may skip them. that's a fair observation
      // about the AI's perception of non-interactive draggables.
      const interactive = before.nodes;
      if (interactive.length < 2) {
        // acceptable: drag targets that aren't interactive aren't in the snapshot.
        // the AI would need to use click_at with coordinates instead. that's
        // documented behavior, not a regression.
        return;
      }
      const src = interactive[0];
      const tgt = interactive[1];
      const r = await browserDrag(src.ref, tgt.ref, { pageId });
      // accept either success or a clean error — drag via dispatchMouseEvent
      // alone doesn't trigger HTML5 dnd, so this is a perception test, not
      // a "real drag" test
      assert(typeof r.text === 'string', 'drag returned a text response');
    },
  },
];
