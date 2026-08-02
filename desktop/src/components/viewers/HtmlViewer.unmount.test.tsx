import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';
import { HtmlViewer } from './HtmlViewer';

// The original bug: HtmlViewer used an Electron <webview>, whose
// getWebContentsId() throws until the guest attaches and fires dom-ready.
// Cmd+W / Cmd+D unmounted it mid-flight, the effect cleanup threw, and the
// whole React root went down.
//
// The iframe rewrite has no attach lifecycle to lose a race against, so the
// class is gone rather than guarded. These tests hold that line: no <webview>
// is ever created, and unmounting at any point in the async grant is safe.

let resolveOpen: ((url: string | null) => void) | null = null;
let closed: string[] = [];

beforeEach(() => {
  closed = [];
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    openHtmlPreview: () => new Promise<string | null>(res => { resolveOpen = res; }),
    closeHtmlPreview: async (url: string) => { closed.push(url); return true; },
  };
});

afterEach(() => {
  cleanup();
  resolveOpen = null;
  vi.restoreAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('HtmlViewer', () => {
  it('never creates a <webview>', async () => {
    const view = render(<HtmlViewer filePath="/tmp/a.html" />);
    await act(async () => { resolveOpen?.('dorabot-preview://tok/a.html'); });
    expect(view.container.querySelector('webview')).toBeNull();
    expect(view.container.querySelector('iframe')).not.toBeNull();
  });

  it('sandboxes the frame so scripts cannot reach the app origin', async () => {
    const view = render(<HtmlViewer filePath="/tmp/a.html" />);
    await act(async () => { resolveOpen?.('dorabot-preview://tok/a.html'); });
    const sandbox = view.container.querySelector('iframe')!.getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts allow-same-origin');
  });

  it('does not throw when unmounted before the grant resolves (Cmd+W)', () => {
    const view = render(<HtmlViewer filePath="/tmp/a.html" />);
    expect(() => view.unmount()).not.toThrow();
  });

  it('releases the origin it was granted', async () => {
    const view = render(<HtmlViewer filePath="/tmp/a.html" />);
    await act(async () => { resolveOpen?.('dorabot-preview://tok/a.html'); });
    view.unmount();
    expect(closed).toContain('dorabot-preview://tok/a.html');
  });

  it('releases even when the grant lands after unmount', async () => {
    const view = render(<HtmlViewer filePath="/tmp/a.html" />);
    view.unmount();
    await act(async () => { resolveOpen?.('dorabot-preview://late/a.html'); });
    expect(closed).toContain('dorabot-preview://late/a.html');
  });

  it('survives repeated open/close churn', () => {
    expect(() => {
      for (let i = 0; i < 10; i++) render(<HtmlViewer filePath={`/tmp/f${i}.html`} />).unmount();
    }).not.toThrow();
  });

  it('a boundary inside the closing subtree is never asked to catch anything', () => {
    const view = render(
      <ErrorBoundary>
        <HtmlViewer filePath="/tmp/a.html" />
      </ErrorBoundary>,
    );
    expect(() => view.unmount()).not.toThrow();
  });
});
