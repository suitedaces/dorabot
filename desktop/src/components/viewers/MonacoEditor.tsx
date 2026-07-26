import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useTheme } from '../../hooks/useTheme';
import { getPalette } from '../../lib/palettes';
import { getEditorPrefs } from '../../hooks/useEditorPrefs';

// Use bundled monaco-editor directly (no CDN, works offline in Electron)
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// Set up the base editor worker. Language-specific workers (TS, JSON, CSS, HTML)
// are not needed since we disable IntelliSense features (quickSuggestions, hover, etc.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  css: 'css', html: 'html', json: 'json', xml: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'ini',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  scala: 'scala', sql: 'sql', r: 'r', lua: 'lua',
  md: 'markdown', mdx: 'markdown',
  txt: 'plaintext', log: 'plaintext',
  env: 'ini', gitignore: 'plaintext', dockerignore: 'plaintext',
  Makefile: 'makefile', Dockerfile: 'dockerfile',
};

function getMonacoLanguage(filePath: string): string {
  const name = filePath.split('/').pop() || '';
  if (EXT_TO_LANG[name]) return EXT_TO_LANG[name];
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_LANG[ext] || 'plaintext';
}

type Props = {
  content: string;
  filePath: string;
  readOnly?: boolean;
  onSave?: (content: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

export function MonacoEditor({ content, filePath, readOnly = false, onSave, onDirtyChange }: Props) {
  const { theme, palette } = useTheme();
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const [monacoTheme, setMonacoTheme] = useState(theme === 'dark' ? 'vs-dark' : 'vs');
  const originalContentRef = useRef(content);
  // Read in handleMount, which is created once
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const onSaveRef = useRef(onSave);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onSaveRef.current = onSave;
  onDirtyChangeRef.current = onDirtyChange;

  // Track whether user has made edits (vs content prop changing)
  const userDirtyRef = useRef(false);

  // Build a Monaco theme from active CSS palette tokens so editor tracks palette changes.
  useEffect(() => {
    let cancelled = false;
    const themeName = `dorabot-${palette}`;
    const base = theme === 'dark' ? 'vs-dark' : 'vs';
    const defaultBackground = theme === 'dark' ? '#1e1e1e' : '#ffffff';
    const defaultForeground = theme === 'dark' ? '#d4d4d4' : '#383a42';

    void loader.init().then((m) => {
      const paletteTheme = getPalette(palette);
      const terminal = paletteTheme.terminal;
      const background = terminal.background || defaultBackground;
      const foreground = terminal.foreground || defaultForeground;
      const muted = terminal.brightBlack || (theme === 'dark' ? '#808080' : '#6b7280');
      const primary = terminal.blue || (theme === 'dark' ? '#7c9eff' : '#3b5bdb');
      const secondary = terminal.selectionBackground || (theme === 'dark' ? '#2a2a3a' : '#e5e7eb');
      const border = terminal.brightBlack || (theme === 'dark' ? '#3f3f46' : '#d1d5db');
      const popover = theme === 'dark'
        ? terminal.black || background
        : terminal.white || background;

      m.editor.defineTheme(themeName, {
        base,
        inherit: true,
        rules: [],
        colors: {
          'editor.background': background,
          'editor.foreground': foreground,
          'editorLineNumber.foreground': muted,
          'editorLineNumber.activeForeground': foreground,
          'editorCursor.foreground': primary,
          'editor.selectionBackground': secondary,
          'editor.inactiveSelectionBackground': secondary,
          'editorLineHighlightBackground': secondary,
          'editorLineHighlightBorder': border,
          'editorIndentGuide.background1': border,
          'editorIndentGuide.activeBackground1': muted,
          'editorGutter.background': background,
          'editorGutter.modifiedBackground': primary,
          'editorBracketMatch.border': primary,
          'editorBracketHighlight.foreground1': primary,
          'editorWidget.background': popover,
          'editorWidget.border': border,
          'editorSuggestWidget.background': popover,
          'editorSuggestWidget.border': border,
          'editorSuggestWidget.foreground': foreground,
          'editorSuggestWidget.selectedBackground': secondary,
          'editorHoverWidget.background': popover,
          'editorHoverWidget.border': border,
        },
      });

      if (cancelled) return;
      m.editor.setTheme(themeName);
      setMonacoTheme(themeName);
    }).catch(() => {
      if (!cancelled) {
        setMonacoTheme(base);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [theme, palette]);

  // Update content when prop changes (file watcher reload)
  useEffect(() => {
    originalContentRef.current = content;
    const editor = editorRef.current;
    if (!editor) return;

    const currentValue = editor.getValue();
    if (currentValue === content) return;

    // Only update if user hasn't made edits, or we're in readOnly mode
    if (!userDirtyRef.current || readOnly) {
      // Use executeEdits to preserve undo stack
      const model = editor.getModel();
      if (model) {
        editor.executeEdits('file-reload', [{
          range: model.getFullModelRange(),
          text: content,
          forceMoveMarkers: true,
        }]);
      }
      userDirtyRef.current = false;
    }
  }, [content, readOnly]);

  // Sync readOnly and related options when they change
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      readOnly,
      renderLineHighlight: readOnly ? 'none' : 'line',
      cursorStyle: readOnly ? 'line-thin' : 'line',
    });
  }, [readOnly]);

  // Dispose editor on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      const editor = editorRef.current;
      if (editor) {
        const model = editor.getModel();
        editor.dispose();
        if (model) model.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;

    // Cmd+S save
    editor.addCommand(
      // KeyMod.CtrlCmd | KeyCode.KeyS
      2048 | 49,
      () => {
        const value = editor.getValue();
        onSaveRef.current?.(value);
      }
    );

    // Track dirty state + autosave
    editor.onDidChangeModelContent(() => {
      const value = editor.getValue();
      const isDirty = value !== originalContentRef.current;
      userDirtyRef.current = isDirty;
      onDirtyChangeRef.current?.(isDirty);

      // Autosave after 1s of inactivity
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (isDirty) {
        autosaveTimerRef.current = setTimeout(() => {
          const currentValue = editorRef.current?.getValue();
          if (currentValue != null && currentValue !== originalContentRef.current) {
            onSaveRef.current?.(currentValue);
            originalContentRef.current = currentValue;
            userDirtyRef.current = false;
            onDirtyChangeRef.current?.(false);
          }
        }, 1000);
      }
    });

    // Only take focus when the file is actually editable. Clicking a file in
    // the tree opens it read-only, and stealing focus there sent cmd+C/X/D to
    // the editor instead of the explorer, which silently edited the file.
    if (!readOnlyRef.current) editor.focus();
  }, []);

  const language = getMonacoLanguage(filePath);

  // Memoize options, reading editor preferences from localStorage
  const options = useMemo<monacoEditor.IStandaloneEditorConstructionOptions>(() => {
    const prefs = getEditorPrefs();
    return {
      readOnly,
      fontSize: prefs.fontSize,
      lineHeight: 1.5,
      minimap: { enabled: prefs.minimap },
      scrollBeyondLastLine: false,
      wordWrap: prefs.wordWrap,
      automaticLayout: true,
      padding: { top: 8, bottom: 8 },
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      renderLineHighlight: readOnly ? 'none' : 'line',
      cursorStyle: readOnly ? 'line-thin' : 'line',
      lineNumbers: prefs.lineNumbers,
      folding: true,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      tabSize: prefs.tabSize,
      insertSpaces: true,
      smoothScrolling: true,
      contextmenu: true,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      parameterHints: { enabled: false },
      hover: { enabled: false },
    };
  }, [readOnly]);

  return (
    <Editor
      defaultValue={content}
      language={language}
      theme={monacoTheme}
      onMount={handleMount}
      options={options}
      loading={
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading editor...
        </div>
      }
    />
  );
}
