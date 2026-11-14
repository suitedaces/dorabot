import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const term = vi.hoisted(() => ({
  writes: [] as string[],
  onData: null as null | ((d: string) => void),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    loadAddon() {}
    open() {}
    write() {}
    writeln(s: string) { term.writes.push(s); }
    onData(cb: (d: string) => void) { term.onData = cb; return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
    focus() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} proposeDimensions() { return { cols: 80, rows: 24 }; } } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { TerminalView } from './TerminalView';

function spawns(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.filter(c => c[0] === 'shell.spawn');
}

describe('TerminalView across a gateway reconnect', () => {
  beforeEach(() => {
    term.writes = [];
    term.onData = null;
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
  });

  it('re-claims its shell when the connection comes back', async () => {
    const rpc = vi.fn(async (method: string) => (method === 'shell.spawn' ? { spawned: true, reclaimed: true } : {}));
    const { rerender } = render(<TerminalView shellId="sh-1" rpc={rpc} connectionState="connected" />);
    await waitFor(() => expect(spawns(rpc)).toHaveLength(1));

    rerender(<TerminalView shellId="sh-1" rpc={rpc} connectionState="disconnected" />);
    rerender(<TerminalView shellId="sh-1" rpc={rpc} connectionState="connected" />);
    await waitFor(() => expect(spawns(rpc)).toHaveLength(2));
    expect(spawns(rpc)[1][1]).toMatchObject({ shellId: 'sh-1' });
    expect(term.writes.join('')).not.toContain('restarted');
  });

  it('says so when the old shell was gone and a new one started', async () => {
    let n = 0;
    const rpc = vi.fn(async (method: string) => (method === 'shell.spawn' ? (n++ === 0 ? { spawned: true } : { spawned: true }) : {}));
    const { rerender } = render(<TerminalView shellId="sh-2" rpc={rpc} connectionState="connected" />);
    await waitFor(() => expect(spawns(rpc)).toHaveLength(1));
    rerender(<TerminalView shellId="sh-2" rpc={rpc} connectionState="reconnecting" />);
    rerender(<TerminalView shellId="sh-2" rpc={rpc} connectionState="connected" />);
    await waitFor(() => expect(term.writes.join('')).toContain('Shell restarted'));
  });

  it('tells the user once when typing into a dead shell', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'shell.write') throw new Error('shell not found');
      return { spawned: true };
    });
    render(<TerminalView shellId="sh-3" rpc={rpc} connectionState="connected" />);
    await waitFor(() => expect(term.onData).not.toBeNull());
    term.onData!('l');
    term.onData!('s');
    await waitFor(() => expect(term.writes.filter(w => w.includes('Shell ended'))).toHaveLength(1));
  });
});
