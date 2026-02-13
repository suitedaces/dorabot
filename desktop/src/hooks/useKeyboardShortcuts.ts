import { useEffect } from 'react';

type ShortcutActions = {
  newTab: () => void;
  closeTab: () => void;
  nextTab: () => void;
  prevTab: () => void;
  focusTabByIndex: (index: number) => void;
  toggleFiles: () => void;
  openSettings: () => void;
  focusInput: () => void;
  abortAgent: () => void;
};

export function useKeyboardShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (!mod) {
        // Escape — abort agent (only when not typing in an input/textarea)
        if (e.key === 'Escape') {
          const tag = (e.target as HTMLElement)?.tagName;
          if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
            actions.abortAgent();
          }
        }
        return;
      }

      // Cmd+T — new tab
      if (e.key === 't' && !e.shiftKey) {
        e.preventDefault();
        actions.newTab();
        return;
      }

      // Cmd+W — close tab
      if (e.key === 'w' && !e.shiftKey) {
        e.preventDefault();
        actions.closeTab();
        return;
      }

      // Cmd+Shift+] — next tab
      if (e.key === ']' && e.shiftKey) {
        e.preventDefault();
        actions.nextTab();
        return;
      }

      // Cmd+Shift+[ — prev tab
      if (e.key === '[' && e.shiftKey) {
        e.preventDefault();
        actions.prevTab();
        return;
      }

      // Cmd+1-9 — jump to tab by position
      if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        actions.focusTabByIndex(parseInt(e.key) - 1);
        return;
      }

      // Cmd+B — toggle file explorer
      if (e.key === 'b' && !e.shiftKey) {
        e.preventDefault();
        actions.toggleFiles();
        return;
      }

      // Cmd+, — open settings
      if (e.key === ',') {
        e.preventDefault();
        actions.openSettings();
        return;
      }

      // Cmd+K — focus chat input
      if (e.key === 'k' && !e.shiftKey) {
        e.preventDefault();
        actions.focusInput();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions]);
}
