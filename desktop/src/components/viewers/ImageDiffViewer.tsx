import { useState } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  oldSrc: string; // data URL or empty
  newSrc: string; // data URL or empty
  filePath: string;
};

type ViewMode = 'side-by-side' | 'slider' | 'toggle';

export function ImageDiffViewer({ oldSrc, newSrc, filePath }: Props) {
  const [mode, setMode] = useState<ViewMode>('side-by-side');
  const [sliderPos, setSliderPos] = useState(50);
  const [showOld, setShowOld] = useState(false);
  const fileName = filePath.split('/').pop() || filePath;

  const hasOld = !!oldSrc;
  const hasNew = !!newSrc;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border text-xs">
        <span className="font-medium text-foreground truncate">{fileName}</span>
        <span className="text-muted-foreground">
          {!hasOld ? '(new file)' : !hasNew ? '(deleted)' : '(modified)'}
        </span>
        <div className="ml-auto flex items-center gap-1 bg-muted rounded-md p-0.5">
          {(['side-by-side', 'slider', 'toggle'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] transition-colors',
                mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'side-by-side' ? 'Side by Side' : m === 'slider' ? 'Slider' : 'Toggle'}
            </button>
          ))}
        </div>
      </div>

      {/* content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {mode === 'side-by-side' && (
          <div className="flex h-full">
            <div className="flex-1 flex flex-col items-center justify-center p-4 border-r border-border min-w-0">
              <div className="text-[10px] text-muted-foreground mb-2 font-medium">HEAD</div>
              {hasOld ? (
                <img src={oldSrc} alt="old" className="max-w-full max-h-[calc(100%-2rem)] object-contain rounded border border-border/50" />
              ) : (
                <div className="text-xs text-muted-foreground/50">No previous version</div>
              )}
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-4 min-w-0">
              <div className="text-[10px] text-muted-foreground mb-2 font-medium">Working Copy</div>
              {hasNew ? (
                <img src={newSrc} alt="new" className="max-w-full max-h-[calc(100%-2rem)] object-contain rounded border border-border/50" />
              ) : (
                <div className="text-xs text-muted-foreground/50">File deleted</div>
              )}
            </div>
          </div>
        )}

        {mode === 'slider' && (
          <div className="relative h-full flex items-center justify-center p-4">
            <div className="relative inline-block">
              {hasNew && <img src={newSrc} alt="new" className="max-w-full max-h-[70vh] object-contain rounded" />}
              {hasOld && (
                <div
                  className="absolute top-0 left-0 h-full overflow-hidden"
                  style={{ width: `${sliderPos}%` }}
                >
                  <img src={oldSrc} alt="old" className="max-h-[70vh] object-contain rounded" style={{ maxWidth: 'none' }} />
                </div>
              )}
              <div
                className="absolute top-0 h-full w-0.5 bg-primary cursor-col-resize"
                style={{ left: `${sliderPos}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={sliderPos}
              onChange={e => setSliderPos(Number(e.target.value))}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 w-48 accent-primary"
            />
          </div>
        )}

        {mode === 'toggle' && (
          <div className="flex flex-col items-center justify-center h-full p-4 gap-3">
            <div className="text-[10px] text-muted-foreground font-medium">
              {showOld ? 'HEAD' : 'Working Copy'}
            </div>
            {(showOld ? hasOld : hasNew) ? (
              <img
                src={showOld ? oldSrc : newSrc}
                alt={showOld ? 'old' : 'new'}
                className="max-w-full max-h-[65vh] object-contain rounded border border-border/50"
              />
            ) : (
              <div className="text-xs text-muted-foreground/50">
                {showOld ? 'No previous version' : 'File deleted'}
              </div>
            )}
            <button
              onClick={() => setShowOld(v => !v)}
              className="px-3 py-1.5 rounded-md bg-muted text-xs text-foreground hover:bg-muted/80 transition-colors"
            >
              Show {showOld ? 'Working Copy' : 'HEAD'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
