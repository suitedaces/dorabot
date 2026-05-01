import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export const SHORTCUTS = [
  { section: 'Tabs', items: [
    { keys: '⌘T', desc: 'New tab' },
    { keys: '⌘W', desc: 'Close tab' },
    { keys: '⌘⇧] / ⌘⌥→', desc: 'Next tab' },
    { keys: '⌘⇧[ / ⌘⌥←', desc: 'Previous tab' },
    { keys: '⌘1-9', desc: 'Jump to tab' },
  ]},
  { section: 'Navigation', items: [
    { keys: '⌘P', desc: 'Quick open file' },
    { keys: '⌘⇧F', desc: 'Search in files' },
    { keys: '⌘B', desc: 'Toggle file explorer' },
    { keys: '⌘N', desc: 'New file in explorer selection' },
    { keys: '⌘⇧N', desc: 'New folder in explorer selection' },
    { keys: '⌘L', desc: 'Focus chat input' },
    { keys: '⌘,', desc: 'Settings' },
  ]},
  { section: 'Editor', items: [
    { keys: '⌘S', desc: 'Save file' },
    { keys: '⌘⇧V', desc: 'Toggle markdown preview' },
    { keys: '⌃`', desc: 'Open terminal' },
    { keys: '⌘⇧B', desc: 'Open browser' },
    { keys: 'Esc', desc: 'Stop agent' },
  ]},
  { section: 'Layout', items: [
    { keys: '⌘D', desc: 'Add column' },
    { keys: '⌘⇧D', desc: 'Add row' },
    { keys: '⌘G', desc: 'Grid (2\u00d72)' },
    { keys: '⌘⇧E', desc: 'Reset layout' },
    { keys: '⌘⇧Arrow', desc: 'Focus pane' },
  ]},
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ShortcutHelp({ open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        ref={ref}
        className="relative w-[520px] max-h-[80vh] bg-popover border border-border rounded-lg shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-popover z-10">
          <span className="text-sm font-semibold">Keyboard Shortcuts</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 p-4">
          {SHORTCUTS.map(s => (
            <div key={s.section}>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{s.section}</div>
              <div className="space-y-1">
                {s.items.map(i => (
                  <div key={i.keys} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{i.desc}</span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">{i.keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
