import { useEffect, useState } from 'react';
import { ShieldAlert, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  filePath: string;
  // Test seam. Browsers refuse to frame file:// from an http page, so the
  // harness swaps in an http URL for the same bytes.
  resolveSrc?: (path: string) => string;
};

type PreviewApi = {
  openHtmlPreview?: (filePath: string, allowRemote: boolean) => Promise<string | null>;
  closeHtmlPreview?: (url: string) => Promise<boolean>;
};

// A plain iframe on a per-file dorabot-preview:// origin.
//
// The origin is what confines it: the protocol handler only serves files under
// the folder the user opened, so a script here cannot read the rest of the disk
// the way a file:// page can. Remote loading is one CSP header, set by that same
// handler. `sandbox` is the script switch.
//
// Deliberately NOT a <webview>: that carries an attach/dom-ready lifecycle whose
// getWebContentsId() throws before it completes, and an unmount mid-flight took
// the whole render tree down with it.
export function HtmlViewer({ filePath, resolveSrc }: Props) {
  const api = (window as unknown as { electronAPI?: PreviewApi }).electronAPI;
  const [allowRemote, setAllowRemote] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => { setAllowRemote(false); }, [filePath]);

  useEffect(() => {
    if (!api?.openHtmlPreview) return;
    let alive = true;
    let granted: string | null = null;
    void api.openHtmlPreview(filePath, allowRemote).then(url => {
      if (!alive) { if (url) void api.closeHtmlPreview?.(url); return; }
      granted = url;
      setSrc(url);
    });
    return () => {
      alive = false;
      if (granted) void api.closeHtmlPreview?.(granted);
    };
  }, [api, filePath, allowRemote]);

  const outside = resolveSrc ? resolveSrc(filePath) : null;
  const url = outside ?? src;

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 border-b shrink-0 text-[10px]',
        allowRemote ? 'bg-warning/10 border-warning/40 text-warning' : 'bg-secondary border-border text-muted-foreground',
      )}>
        {allowRemote ? <Globe className="w-3 h-3 shrink-0" /> : <ShieldAlert className="w-3 h-3 shrink-0" />}
        <span className="flex-1 truncate">
          {allowRemote
            ? 'Remote content allowed for this preview'
            : 'Remote content blocked. Pages that load fonts, scripts or images from the web will look incomplete.'}
        </span>
        <button
          className="px-1.5 py-0.5 rounded hover:bg-background/60 transition-colors shrink-0"
          onClick={() => setAllowRemote(v => !v)}
        >
          {allowRemote ? 'Block again' : 'Allow'}
        </button>
      </div>
      {url ? (
        <iframe
          title="preview"
          src={url}
          // scripts run, but only against this file's own folder origin
          sandbox="allow-scripts allow-same-origin"
          className="flex-1 min-h-0 w-full border-0 bg-white"
        />
      ) : (
        <div className="flex-1 min-h-0" />
      )}
    </div>
  );
}
