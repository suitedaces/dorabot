import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { MonacoEditor } from './viewers/MonacoEditor';
import { MarkdownViewer } from './viewers/MarkdownViewer';
const PDFViewer = lazy(() => import('./viewers/PDFViewer').then(m => ({ default: m.PDFViewer })));
import { ExcelViewer } from './viewers/ExcelViewer';
import { ImageViewer } from './viewers/ImageViewer';
import { VideoViewer } from './viewers/VideoViewer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { X, Pencil, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  filePath: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
  headerless?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};

type FileType = 'code' | 'markdown' | 'pdf' | 'excel' | 'image' | 'video' | 'audio' | 'unsupported';

const CODE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'css', 'html', 'json', 'xml', 'yaml', 'yml', 'toml', 'sh', 'bash', 'zsh',
  'rb', 'php', 'swift', 'kt', 'scala', 'sql', 'r', 'lua', 'vim', 'txt', 'log',
  'env', 'gitignore', 'dockerignore', 'Makefile', 'Dockerfile',
];

const EXCEL_EXTENSIONS = ['xlsx', 'xls', 'csv'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv', 'm4v'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'];

function getFileType(path: string): FileType {
  const ext = path.split('.').pop()?.toLowerCase();
  const name = path.split('/').pop() || '';
  if (!ext && !name) return 'code';
  // Handle extensionless files as code (plain text fallback)
  if (!ext) return 'code';
  if (ext === 'md') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (EXCEL_EXTENSIONS.includes(ext)) return 'excel';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (CODE_EXTENSIONS.includes(ext)) return 'code';
  // fallback: treat unknown extensions as code (plain text with line numbers)
  return 'code';
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function FileViewer({ filePath, rpc, onClose, headerless, onDirtyChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [editing, setEditing] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0); // bump to force reload
  const fileType = getFileType(filePath);
  const fileName = getFileName(filePath);
  const canEdit = fileType === 'code' || fileType === 'markdown';

  useEffect(() => {
    if (fileType === 'unsupported') {
      setLoading(false);
      setError('File type not supported for preview');
      return;
    }

    if (fileType === 'pdf' || fileType === 'excel' || fileType === 'image' || fileType === 'video' || fileType === 'audio') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    rpc('fs.read', { path: filePath })
      .then((res) => {
        const result = res as { content: string };
        setContent(result.content);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [filePath, rpc, fileType, version]);

  const handleSave = useCallback(async (newContent: string) => {
    await rpc('fs.write', { path: filePath, content: newContent });
    setContent(newContent);
    setDirty(false);
    onDirtyChange?.(false);
  }, [rpc, filePath, onDirtyChange]);

  const handleDirtyChange = useCallback((d: boolean) => {
    setDirty(d);
    onDirtyChange?.(d);
  }, [onDirtyChange]);

  // File watcher: reload content when file changes externally
  const dirtyRef = useRef(dirty);
  const editingRef = useRef(editing);
  dirtyRef.current = dirty;
  editingRef.current = editing;

  useEffect(() => {
    let cancelled = false;
    let lastMtime = 0;

    const checkForChanges = async () => {
      if (cancelled || dirtyRef.current || editingRef.current) return;
      try {
        const res = await rpc('fs.stat', { path: filePath }) as { mtime?: number } | null;
        if (cancelled) return;
        if (res?.mtime && lastMtime > 0 && res.mtime > lastMtime) {
          setVersion(v => v + 1);
        }
        if (res?.mtime) lastMtime = res.mtime;
      } catch { /* ignore */ }
    };

    checkForChanges();
    const interval = setInterval(checkForChanges, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [filePath, rpc]);

  const renderViewer = () => {
    if (loading) {
      return (
        <div className="p-4 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      );
    }

    if (error) {
      return <div className="p-4 text-destructive text-xs">{error}</div>;
    }

    switch (fileType) {
      case 'code':
        return (
          <MonacoEditor
            content={content}
            filePath={filePath}
            readOnly={!editing}
            onSave={handleSave}
            onDirtyChange={handleDirtyChange}
          />
        );
      case 'markdown':
        if (editing) {
          return (
            <MonacoEditor
              content={content}
              filePath={filePath}
              readOnly={false}
              onSave={handleSave}
              onDirtyChange={handleDirtyChange}
            />
          );
        }
        return <MarkdownViewer content={content} />;
      case 'pdf':
        return <Suspense fallback={<div className="p-4 text-xs text-muted-foreground">Loading PDF viewer...</div>}><PDFViewer filePath={filePath} rpc={rpc} /></Suspense>;
      case 'excel':
        return <ExcelViewer filePath={filePath} rpc={rpc} />;
      case 'image':
        return <ImageViewer filePath={filePath} rpc={rpc} />;
      case 'video':
        return <VideoViewer filePath={filePath} rpc={rpc} />;
      case 'audio':
        return <VideoViewer filePath={filePath} rpc={rpc} />;
      default:
        return <div className="p-4 text-muted-foreground text-xs">Unsupported file type</div>;
    }
  };

  if (headerless) {
    return (
      <div className="flex flex-col h-full min-h-0">
        {/* minimal toolbar for edit/view toggle */}
        {canEdit && (
          <div className="flex items-center gap-1 px-2 py-1 border-b border-border/50 shrink-0 bg-background">
            <button
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors',
                !editing ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
              )}
              onClick={() => setEditing(false)}
            >
              <Eye className="w-3 h-3" />
              View
            </button>
            <button
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors',
                editing ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
              )}
              onClick={() => setEditing(true)}
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
            {dirty && (
              <span className="w-2 h-2 rounded-full bg-warning ml-1 shrink-0" title="Unsaved changes" />
            )}
            <span className="flex-1" />
            <span className="text-[9px] text-muted-foreground/50 truncate">{filePath}</span>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          {renderViewer()}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-semibold text-sm flex-1 truncate">
          {fileName}
          {dirty && <span className="w-2 h-2 rounded-full bg-warning inline-block ml-2" />}
        </span>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setEditing(!editing)}
          >
            {editing ? <><Eye className="w-3 h-3 mr-1" />View</> : <><Pencil className="w-3 h-3 mr-1" />Edit</>}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {renderViewer()}
      </div>
    </div>
  );
}
