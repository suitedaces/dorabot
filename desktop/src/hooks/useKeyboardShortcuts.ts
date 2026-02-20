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
  splitHorizontal: () => void;
  splitVertical: () => void;
  splitGrid: () => void;
  resetLayout: () => void;
  focusGroupLeft: () => void;
  focusGroupRight: () => void;
  focusGroupUp: () => void;
  focusGroupDown: () => void;
};

type ShortcutOptions = {
  isAgentRunning?: boolean;
};

export function useKeyboardShortcuts(actions: ShortcutActions, options: ShortcutOptions = {}) {
  const { isAgentRunning } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (!mod) {
        // Escape — abort agent
        // When agent is running: always abort (even from textarea)
        // When idle: only abort if not focused on an input/textarea
        if (e.key === 'Escape') {
          const tag = (e.target as HTMLElement)?.tagName;
          if (isAgentRunning || (tag !== 'INPUT' && tag !== 'TEXTAREA')) {
            e.preventDefault();
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
      if (!e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
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

      // Cmd+L — focus chat input
      if (e.key === 'l' && !e.shiftKey) {
        e.preventDefault();
        actions.focusInput();
        return;
      }

      // Cmd+D — split right (side by side)
      if (e.key === 'd' && !e.shiftKey) {
        e.preventDefault();
        actions.splitHorizontal();
        return;
      }

      // Cmd+Shift+D — split down (stacked)
      if (e.key === 'D' && e.shiftKey) {
        e.preventDefault();
        actions.splitVertical();
        return;
      }

      // Cmd+Shift+E — reset to single pane (merge all groups)
      if (e.key === 'E' && e.shiftKey) {
        e.preventDefault();
        actions.resetLayout();
        return;
      }

      // Cmd+Shift+Arrow — navigate between groups
      if (e.shiftKey && !e.altKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          actions.focusGroupLeft();
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          actions.focusGroupRight();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          actions.focusGroupUp();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          actions.focusGroupDown();
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions, isAgentRunning]);
}
