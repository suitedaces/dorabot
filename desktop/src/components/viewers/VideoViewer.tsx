import { useState, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

type Props = {
  filePath: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  wma: 'audio/x-ms-wma',
  opus: 'audio/opus',
};

function getMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return MIME[ext] || 'video/mp4';
}

function isAudio(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'].includes(ext);
}

export function VideoViewer({ filePath, rpc }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = isAudio(filePath);

  useEffect(() => {
    rpc('fs.readBinary', { path: filePath })
      .then((res) => {
        const { content } = res as { content: string };
        setSrc(`data:${getMime(filePath)};base64,${content}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [filePath, rpc]);

  if (error) return <div className="p-4 text-destructive text-xs">{error}</div>;

  if (!src) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Skeleton className={audio ? 'w-96 h-12 rounded-md' : 'w-96 h-56 rounded-md'} />
      </div>
    );
  }

  if (audio) {
    return (
      <div className="flex items-center justify-center p-4">
        <audio src={src} controls className="w-full max-w-lg" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-4 min-h-0 h-full">
      <video
        src={src}
        controls
        className="max-w-full max-h-full rounded-md"
      />
    </div>
  );
}
