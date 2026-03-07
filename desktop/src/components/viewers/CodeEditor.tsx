import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  content: string;
  filePath: string;
  onSave: (content: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

const TAB_SIZE = 2;

export function CodeEditor({ content, filePath, onSave, onDirtyChange }: Props) {
  const [value, setValue] = useState(content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);

  // Sync if external content changes (e.g. file watcher reload)
  useEffect(() => {
    if (!dirty) {
      setValue(content);
    }
  }, [content, dirty]);

  // Track dirty state
  useEffect(() => {
    const isDirty = value !== content;
    setDirty(isDirty);
    onDirtyChange?.(isDirty);
  }, [value, content, onDirtyChange]);

  // Cmd+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave(value);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, value, onSave]);

  // Sync scroll between textarea and line numbers
  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumberRef.current) {
      lineNumberRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // Handle Tab key (insert spaces) and auto-indent on Enter
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;

    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const spaces = ' '.repeat(TAB_SIZE);

      if (e.shiftKey) {
        // Shift+Tab: dedent selected lines
        const before = value.slice(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const linePrefix = value.slice(lineStart, start);
        if (linePrefix.startsWith(spaces)) {
          const newValue = value.slice(0, lineStart) + value.slice(lineStart + TAB_SIZE);
          setValue(newValue);
          setTimeout(() => {
            ta.selectionStart = Math.max(start - TAB_SIZE, lineStart);
            ta.selectionEnd = Math.max(end - TAB_SIZE, lineStart);
          }, 0);
        }
      } else if (start === end) {
        // No selection: insert spaces
        const newValue = value.slice(0, start) + spaces + value.slice(end);
        setValue(newValue);
        setTimeout(() => {
          ta.selectionStart = ta.selectionEnd = start + TAB_SIZE;
        }, 0);
      } else {
        // Selection: indent all selected lines
        const before = value.slice(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const selected = value.slice(lineStart, end);
        const indented = selected.replace(/^/gm, spaces);
        const newValue = value.slice(0, lineStart) + indented + value.slice(end);
        setValue(newValue);
        setTimeout(() => {
          ta.selectionStart = start + TAB_SIZE;
          ta.selectionEnd = end + (indented.length - selected.length);
        }, 0);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const start = ta.selectionStart;
      const before = value.slice(0, start);
      const currentLineStart = before.lastIndexOf('\n') + 1;
      const currentLine = before.slice(currentLineStart);
      const indent = currentLine.match(/^\s*/)?.[0] || '';
      // Extra indent after { or : at end of line
      const trimmed = currentLine.trimEnd();
      const extraIndent = (trimmed.endsWith('{') || trimmed.endsWith(':') || trimmed.endsWith('('))
        ? ' '.repeat(TAB_SIZE) : '';
      const insertion = '\n' + indent + extraIndent;
      const newValue = value.slice(0, start) + insertion + value.slice(ta.selectionEnd);
      setValue(newValue);
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + insertion.length;
      }, 0);
    }

    // Auto-close brackets
    const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']', '"': '"', "'": "'", '`': '`' };
    if (pairs[e.key] && ta.selectionStart === ta.selectionEnd) {
      const start = ta.selectionStart;
      const close = pairs[e.key];
      // Don't auto-close quotes if next char is alphanumeric
      if ((e.key === '"' || e.key === "'" || e.key === '`') && /\w/.test(value[start] || '')) return;
      e.preventDefault();
      const newValue = value.slice(0, start) + e.key + close + value.slice(start);
      setValue(newValue);
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + 1;
      }, 0);
    }
  }, [value]);

  const lines = value.split('\n');
  const lineCount = lines.length;
  const gutterWidth = Math.max(String(lineCount).length * 8 + 16, 40);

  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* status bar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border shrink-0 bg-background">
        <span className="text-[10px] text-muted-foreground">{ext.toUpperCase()}</span>
        <span className="text-[10px] text-muted-foreground">
          {lineCount} line{lineCount !== 1 ? 's' : ''}
        </span>
        <span className="flex-1" />
        {savedFlash && (
          <span className="text-[10px] text-success animate-in fade-in">Saved</span>
        )}
        {dirty && !saving && (
          <span className="text-[10px] text-warning">Modified</span>
        )}
        {saving && (
          <span className="text-[10px] text-primary animate-pulse">Saving...</span>
        )}
        <kbd className="text-[9px] text-muted-foreground/60 border border-border/50 rounded px-1">
          {navigator.platform.includes('Mac') ? '⌘S' : 'Ctrl+S'}
        </kbd>
      </div>

      {/* editor area */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* line numbers */}
        <div
          ref={lineNumberRef}
          className="absolute top-0 left-0 bottom-0 overflow-hidden select-none pointer-events-none border-r border-border/30 bg-secondary/20"
          style={{ width: gutterWidth }}
        >
          <div className="py-[1rem]">
            {lines.map((_, i) => (
              <div
                key={i}
                className="text-[13px] leading-[1.5] text-right pr-2 text-muted-foreground/40"
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* textarea */}
        <textarea
          ref={textareaRef}
          className={cn(
            'absolute inset-0 resize-none outline-none bg-transparent text-foreground font-mono',
            'text-[13px] leading-[1.5] p-[1rem] overflow-auto',
            'caret-primary selection:bg-primary/20',
          )}
          style={{ paddingLeft: gutterWidth + 12 }}
          value={value}
          onChange={e => setValue(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
        />
      </div>
    </div>
  );
}
