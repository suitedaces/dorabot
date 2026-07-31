import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function ShortcutHarness({ actions }: { actions: Parameters<typeof useKeyboardShortcuts>[0] }) {
  useKeyboardShortcuts(actions);
  return null;
}

function makeActions(): Parameters<typeof useKeyboardShortcuts>[0] {
  return {
    newTab: vi.fn(),
    closeTab: vi.fn(),
    nextTab: vi.fn(),
    prevTab: vi.fn(),
    focusTabByIndex: vi.fn(),
    openQuickOpen: vi.fn(),
    previewFile: vi.fn(),
    toggleFiles: vi.fn(),
    openSettings: vi.fn(),
    focusInput: vi.fn(),
    abortAgent: vi.fn(),
    splitHorizontal: vi.fn(),
    splitVertical: vi.fn(),
    splitGrid: vi.fn(),
    resetLayout: vi.fn(),
    focusGroupLeft: vi.fn(),
    focusGroupRight: vi.fn(),
    focusGroupUp: vi.fn(),
    focusGroupDown: vi.fn(),
    openTerminal: vi.fn(),
    openGlobalSearch: vi.fn(),
    openShortcutHelp: vi.fn(),
  };
}

afterEach(cleanup);

describe('file preview shortcut', () => {
  it('routes cmd+shift+v through the universal preview action', () => {
    const actions = makeActions();
    render(<ShortcutHarness actions={actions} />);

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'v',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
    }));

    expect(actions.previewFile).toHaveBeenCalledOnce();
  });
});
