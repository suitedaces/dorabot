import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

type Props = {
  shellId: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onShellEvent?: (listener: (data: { shellId: string; type: string; data?: string }) => void) => () => void;
  theme?: 'dark' | 'light';
};

const DARK_THEME = {
  background: '#1a1a1a',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1a1a1a',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#1a1a1a',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#d7ba7d',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#d7ba7d',
  brightBlue: '#569cd6',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff',
};

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#383a42',
  cursor: '#383a42',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  selectionForeground: '#000000',
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#fafafa',
  brightBlack: '#a0a1a7',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#ffffff',
};

export function TerminalView({ shellId, rpc, onShellEvent, theme = 'dark' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const spawnedRef = useRef(false);

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: theme === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    // Fit after a frame so container has dimensions
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* ignore */ }
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
    }
  }, [theme]);

  // Spawn shell and wire up I/O
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || spawnedRef.current) return;
    spawnedRef.current = true;

    // Spawn shell process
    const cols = term.cols;
    const rows = term.rows;
    rpc('shell.spawn', { shellId, cols, rows }).then(() => {
      setConnected(true);
    }).catch((err) => {
      term.writeln(`\r\n\x1b[31mFailed to spawn shell: ${err}\x1b[0m\r\n`);
    });

    // Send input to shell
    const disposable = term.onData((data) => {
      rpc('shell.write', { shellId, data }).catch(() => {});
    });

    // Send resize events
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      rpc('shell.resize', { shellId, cols, rows }).catch(() => {});
    });

    return () => {
      disposable.dispose();
      resizeDisposable.dispose();
    };
  }, [shellId, rpc]);

  // Receive output from shell
  useEffect(() => {
    if (!onShellEvent) return;

    const unsubscribe = onShellEvent((event) => {
      if (event.shellId !== shellId) return;
      const term = terminalRef.current;
      if (!term) return;

      if (event.type === 'data' && event.data) {
        term.write(event.data);
      } else if (event.type === 'exit') {
        term.writeln('\r\n\x1b[90m[Process exited]\x1b[0m');
        setConnected(false);
      }
    });

    return unsubscribe;
  }, [shellId, onShellEvent]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#1a1a1a]">
      <div
        ref={containerRef}
        className="flex-1 min-h-0 p-1"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
