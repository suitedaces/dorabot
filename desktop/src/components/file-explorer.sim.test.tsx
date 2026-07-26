// Simulation over the real FileExplorer: selection model, clipboard, and the
// RPCs each gesture fires. The gateway is stubbed; assertions are on the calls
// the component actually makes.
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FileExplorer } from './FileExplorer';
import { TooltipProvider } from './ui/tooltip';

type Entry = { name: string; type: 'file' | 'directory'; size?: number };

const ROOT = '/repo';
const TREE: Record<string, Entry[]> = {
  '/repo': [
    { name: 'src', type: 'directory' },
    { name: 'a.ts', type: 'file', size: 10 },
    { name: 'b.ts', type: 'file', size: 20 },
    { name: 'c.ts', type: 'file', size: 30 },
  ],
  '/repo/src': [{ name: 'deep.ts', type: 'file', size: 5 }],
};

function makeRpc() {
  const calls: Array<{ method: string; params: any }> = [];
  const rpc = vi.fn(async (method: string, params?: any) => {
    calls.push({ method, params: params ?? {} });
    if (method === 'config.get') return { cwd: ROOT };
    if (method === 'fs.list') return TREE[params.path] ?? [];
    if (method === 'git.detect') return { root: null };
    return {};
  });
  return { rpc, calls };
}

function mutating(calls: Array<{ method: string; params: any }>) {
  return calls.filter(c => ['fs.copy', 'fs.rename', 'fs.delete'].includes(c.method));
}

async function setup() {
  const { rpc, calls } = makeRpc();
  const onFileClick = vi.fn();
  render(
    <TooltipProvider>
      <FileExplorer rpc={rpc as any} connected onFileClick={onFileClick} />
    </TooltipProvider>,
  );
  await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy());
  return { rpc, calls, onFileClick };
}

// rows are the clickable divs carrying data-path
const row = (name: string) => {
  const el = screen.getByText(name).closest('[data-path]');
  if (!el) throw new Error(`row not found: ${name}`);
  return el as HTMLElement;
};
const isSelected = (name: string) => row(name).getAttribute('aria-selected') === 'true';
const selectedNames = () =>
  ['src', 'a.ts', 'b.ts', 'c.ts'].filter(n => {
    try { return isSelected(n); } catch { return false; }
  });

// minimal DataTransfer good enough for the handlers under test
function dt(data: Record<string, string> = {}, files: any[] = []) {
  const store = { ...data };
  return {
    types: [...Object.keys(store), ...(files.length ? ['Files'] : [])],
    files,
    setData: (k: string, v: string) => { store[k] = v; },
    getData: (k: string) => store[k] ?? '',
    effectAllowed: '',
    dropEffect: '',
  };
}

const MIME = 'application/x-dorabot-paths';

// jsdom has no DragEvent, and fireEvent falls back to a plain Event which drops
// modifier keys. Build a MouseEvent (which carries altKey) and attach the
// dataTransfer so option-drag exercises the real code path.
function fireDrag(el: Element, type: string, transfer: any, altKey = false) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, altKey });
  Object.defineProperty(ev, 'dataTransfer', { value: transfer });
  el.dispatchEvent(ev);
}

describe('file explorer selection + file ops', () => {
  beforeEach(() => {
    cleanup();
    (window as any).electronAPI = { getPathForFile: (f: any) => f.__path ?? '' };
  });

  it('1. plain click selects exactly one row', async () => {
    await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.click(row('b.ts'));
    console.log('  selected:', selectedNames());
    expect(selectedNames()).toEqual(['b.ts']);
  });

  it('2. cmd-click toggles rows in and out', async () => {
    await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.click(row('c.ts'), { metaKey: true });
    console.log('  after cmd-click:', selectedNames());
    expect(selectedNames()).toEqual(['a.ts', 'c.ts']);
    fireEvent.click(row('c.ts'), { metaKey: true });
    console.log('  after toggle off:', selectedNames());
    expect(selectedNames()).toEqual(['a.ts']);
  });

  it('3. shift-click selects the range in display order', async () => {
    await setup();
    fireEvent.click(row('src'));
    fireEvent.click(row('c.ts'), { shiftKey: true });
    console.log('  range:', selectedNames());
    expect(selectedNames()).toEqual(['src', 'a.ts', 'b.ts', 'c.ts']);
  });

  it('4. shift-click backwards works too', async () => {
    await setup();
    fireEvent.click(row('c.ts'));
    fireEvent.click(row('a.ts'), { shiftKey: true });
    console.log('  reverse range:', selectedNames());
    expect(selectedNames()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('5. delete acts on the whole selection and says how many', async () => {
    const { calls } = await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.click(row('c.ts'), { metaKey: true });
    fireEvent.keyDown(row('a.ts'), { key: 'Backspace' });
    const prompt = await screen.findByText(/Delete \d+ items\?|Delete this item\?/);
    console.log('  confirm text:', prompt.textContent);
    expect(prompt.textContent).toBe('Delete 2 items?');
    expect(screen.getByText('Moves to Trash.')).toBeTruthy();

    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(mutating(calls).length).toBe(2));
    console.log('  deleted:', mutating(calls).map(c => c.params.path));
    expect(mutating(calls).every(c => c.method === 'fs.delete')).toBe(true);
  });

  it('6. single delete keeps the singular wording', async () => {
    await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.keyDown(row('a.ts'), { key: 'Backspace' });
    const prompt = await screen.findByText(/Delete this item\?/);
    console.log('  confirm text:', prompt.textContent);
    expect(prompt.textContent).toBe('Delete this item?');
  });

  it('7. cmd+D duplicates every selected row', async () => {
    const { calls } = await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.click(row('b.ts'), { metaKey: true });
    fireEvent.keyDown(row('a.ts'), { key: 'd', metaKey: true });
    await waitFor(() => expect(mutating(calls).length).toBe(2));
    const copies = mutating(calls);
    console.log('  duplicate calls:', copies.map(c => `${c.params.sourcePath} -> ${c.params.destPath}`));
    // dest === source; the gateway appends " copy"
    expect(copies.every(c => c.method === 'fs.copy' && c.params.sourcePath === c.params.destPath)).toBe(true);
  });

  it('8. cmd+C then cmd+V copies into the selected folder', async () => {
    const { calls } = await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.keyDown(row('a.ts'), { key: 'c', metaKey: true });
    fireEvent.click(row('src'));
    fireEvent.keyDown(row('src'), { key: 'v', metaKey: true });
    await waitFor(() => expect(mutating(calls).length).toBe(1));
    const c = mutating(calls)[0];
    console.log('  paste:', c.method, c.params.sourcePath, '->', c.params.destPath);
    expect(c.method).toBe('fs.copy');
    expect(c.params.destPath).toBe('/repo/src/a.ts');
  });

  it('9. dragging a file onto a folder moves it', async () => {
    const { calls } = await setup();
    const transfer = dt();
    fireEvent.dragStart(row('a.ts'), { dataTransfer: transfer });
    console.log('  drag payload:', transfer.getData(MIME));
    expect(JSON.parse(transfer.getData(MIME))).toEqual(['/repo/a.ts']);

    fireEvent.drop(row('src'), { dataTransfer: transfer });
    await waitFor(() => expect(mutating(calls).length).toBe(1));
    const c = mutating(calls)[0];
    console.log('  drop:', c.method, c.params);
    expect(c.method).toBe('fs.rename');
    expect(c.params.newPath).toBe('/repo/src/a.ts');
    expect(c.params.onCollision).toBe('rename');
  });

  it('10. option-drag copies instead of moving', async () => {
    const { calls } = await setup();
    const transfer = dt();
    fireDrag(row('a.ts'), 'dragstart', transfer);
    fireDrag(row('src'), 'dragover', transfer, true);
    fireDrag(row('src'), 'drop', transfer, true);
    await waitFor(() => expect(mutating(calls).length).toBe(1));
    console.log('  option-drop method:', mutating(calls)[0].method);
    expect(mutating(calls)[0].method).toBe('fs.copy');
  });

  it('11. dragging a multi-selection moves every item', async () => {
    const { calls } = await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.click(row('b.ts'), { metaKey: true });
    const transfer = dt();
    fireEvent.dragStart(row('a.ts'), { dataTransfer: transfer });
    console.log('  dragging:', JSON.parse(transfer.getData(MIME)));
    fireEvent.drop(row('src'), { dataTransfer: transfer });
    await waitFor(() => expect(mutating(calls).length).toBe(2));
    console.log('  moved:', mutating(calls).map(c => c.params.newPath));
    expect(mutating(calls).map(c => c.params.newPath).sort()).toEqual(['/repo/src/a.ts', '/repo/src/b.ts']);
  });

  it('12. dragging an unselected row acts on that row only', async () => {
    const { calls } = await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.click(row('b.ts'), { metaKey: true });
    const transfer = dt();
    fireEvent.dragStart(row('c.ts'), { dataTransfer: transfer });
    console.log('  dragging:', JSON.parse(transfer.getData(MIME)));
    expect(JSON.parse(transfer.getData(MIME))).toEqual(['/repo/c.ts']);
    fireEvent.drop(row('src'), { dataTransfer: transfer });
    await waitFor(() => expect(mutating(calls).length).toBe(1));
    expect(mutating(calls)[0].params.oldPath).toBe('/repo/c.ts');
  });

  it('13. a folder cannot be dropped into itself', async () => {
    const { calls } = await setup();
    const transfer = dt({ [MIME]: JSON.stringify(['/repo/src']) });
    fireEvent.drop(row('src'), { dataTransfer: transfer });
    await new Promise(r => setTimeout(r, 30));
    console.log('  mutating calls:', mutating(calls).length);
    expect(mutating(calls).length).toBe(0);
  });

  it('14. dropping into the folder it already lives in is a no-op', async () => {
    const { calls } = await setup();
    const transfer = dt({ [MIME]: JSON.stringify(['/repo/a.ts']) });
    // dropping a.ts onto b.ts resolves to /repo, which is already its parent
    fireEvent.drop(row('b.ts'), { dataTransfer: transfer });
    await new Promise(r => setTimeout(r, 30));
    console.log('  mutating calls:', mutating(calls).length);
    expect(mutating(calls).length).toBe(0);
  });

  it('15. dropping files from Finder copies them in', async () => {
    const { calls } = await setup();
    const file: any = { name: 'outside.txt', __path: '/elsewhere/outside.txt' };
    const transfer = dt({}, [file]);
    fireEvent.drop(row('src'), { dataTransfer: transfer });
    await waitFor(() => expect(mutating(calls).length).toBe(1));
    const c = mutating(calls)[0];
    console.log('  finder drop:', c.method, c.params.sourcePath, '->', c.params.destPath);
    expect(c.method).toBe('fs.copy');
    expect(c.params.sourcePath).toBe('/elsewhere/outside.txt');
    expect(c.params.destPath).toBe('/repo/src/outside.txt');
  });

  it('16. shift+arrow extends the selection', async () => {
    await setup();
    fireEvent.click(row('src'));
    const tree = row('src').parentElement!;
    fireEvent.keyDown(tree, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(tree, { key: 'ArrowDown', shiftKey: true });
    console.log('  after shift+down x2:', selectedNames());
    expect(selectedNames()).toEqual(['src', 'a.ts', 'b.ts']);
  });

  it('17. plain arrow collapses back to one row', async () => {
    await setup();
    fireEvent.click(row('src'));
    const tree = row('src').parentElement!;
    fireEvent.keyDown(tree, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    console.log('  after plain down:', selectedNames());
    expect(selectedNames().length).toBe(1);
  });
  it('18. cmd+X then cmd+V moves instead of copying', async () => {
    const { calls } = await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.keyDown(row('a.ts'), { key: 'x', metaKey: true });
    fireEvent.click(row('src'));
    fireEvent.keyDown(row('src'), { key: 'v', metaKey: true });
    await waitFor(() => expect(mutating(calls).length).toBe(1));
    const c = mutating(calls)[0];
    console.log('  cut+paste:', c.method, '->', c.params.newPath);
    expect(c.method).toBe('fs.rename');
    expect(c.params.newPath).toBe('/repo/src/a.ts');
  });

  it('19. a cut is spent after one paste, a copy is not', async () => {
    const { calls } = await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.keyDown(row('a.ts'), { key: 'x', metaKey: true });
    fireEvent.click(row('src'));
    fireEvent.keyDown(row('src'), { key: 'v', metaKey: true });
    await waitFor(() => expect(mutating(calls).length).toBe(1));
    fireEvent.keyDown(row('src'), { key: 'v', metaKey: true });
    await new Promise(r => setTimeout(r, 30));
    console.log('  mutations after second paste:', mutating(calls).length);
    expect(mutating(calls).length).toBe(1);
  });

  it('20. cmd+opt+V moves a copied selection, Finder style', async () => {
    const { calls } = await setup();
    fireEvent.click(row('a.ts'));
    fireEvent.keyDown(row('a.ts'), { key: 'c', metaKey: true });
    fireEvent.click(row('src'));
    fireEvent.keyDown(row('src'), { key: 'v', metaKey: true, altKey: true });
    await waitFor(() => expect(mutating(calls).length).toBe(1));
    console.log('  cmd+opt+V method:', mutating(calls)[0].method);
    expect(mutating(calls)[0].method).toBe('fs.rename');
  });

  // The bug the isolated simulations could not see: global shortcuts live on
  // window, so a key the tree handles must never reach them.
  it('21. keys the tree owns do not reach window-level shortcuts', async () => {
    await setup();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key.toLowerCase());
    window.addEventListener('keydown', spy);
    try {
      fireEvent.click(row('a.ts'));
      for (const key of ['d', 'c', 'x', 'v']) {
        fireEvent.keyDown(row('a.ts'), { key, metaKey: true });
      }
      fireEvent.keyDown(row('a.ts'), { key: 'Backspace' });
      console.log('  keys that escaped to window:', seen);
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener('keydown', spy);
    }
  });

  it('22. clicking a file keeps focus in the tree', async () => {
    await setup();
    const tree = document.querySelector('[data-file-tree]') as HTMLElement;
    fireEvent.click(row('a.ts'));
    console.log('  activeElement is tree:', document.activeElement === tree);
    expect(document.activeElement).toBe(tree);
  });
});
