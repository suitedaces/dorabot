import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { computeDiff, computeCharDiff, groupIntoHunks, type DiffLine } from '../../lib/diff';
import { ShikiHighlighter, createHighlighterCore, createJavaScriptRegexEngine } from 'react-shiki/core';
import type { HighlighterCore } from 'shiki/core';
import { useTheme } from '../../hooks/useTheme';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';

// Reuse the same highlighter singleton from CodeViewer
let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import('@shikijs/themes/vitesse-dark'),
        import('@shikijs/themes/vitesse-light'),
      ],
      langs: [
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/tsx'),
        import('@shikijs/langs/jsx'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/rust'),
        import('@shikijs/langs/go'),
        import('@shikijs/langs/java'),
        import('@shikijs/langs/c'),
        import('@shikijs/langs/cpp'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/xml'),
        import('@shikijs/langs/yaml'),
        import('@shikijs/langs/toml'),
        import('@shikijs/langs/bash'),
        import('@shikijs/langs/ruby'),
        import('@shikijs/langs/php'),
        import('@shikijs/langs/swift'),
        import('@shikijs/langs/kotlin'),
        import('@shikijs/langs/scala'),
        import('@shikijs/langs/sql'),
        import('@shikijs/langs/r'),
        import('@shikijs/langs/lua'),
        import('@shikijs/langs/vim'),
        import('@shikijs/langs/markdown'),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

const extToLang: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  css: 'css', html: 'html', json: 'json', xml: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  scala: 'scala', sql: 'sql', r: 'r', lua: 'lua', vim: 'vim',
  md: 'markdown', mdx: 'markdown',
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return extToLang[ext || ''] || 'text';
}

type Props = {
  oldContent: string;
  newContent: string;
  filePath: string;
  contextLines?: number;
};

/**
 * VS Code-style inline unified diff viewer.
 * - Red background for deleted lines, green for added
 * - Darker red/green highlight on the specific changed characters
 * - Collapsed unchanged regions with "Show N more lines" expanders
 * - Line numbers for both old and new on each line
 * - Minimap bar on the right showing change locations
 */
export function DiffViewer({ oldContent, newContent, filePath, contextLines = 3 }: Props) {
  const { theme } = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentChangeIdx, setCurrentChangeIdx] = useState(0);

  const allLines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent]);
  const hunks = useMemo(() => groupIntoHunks(allLines, contextLines), [allLines, contextLines]);

  // Expanded collapsed regions (stored as "gap index" between hunks)
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set());

  // Compute stats
  const stats = useMemo(() => {
    let additions = 0, deletions = 0;
    for (const line of allLines) {
      if (line.type === 'add') additions++;
      if (line.type === 'del') deletions++;
    }
    return { additions, deletions, changes: hunks.length };
  }, [allLines, hunks]);

  // Build the rendered line list (hunks + collapsed indicators)
  type RenderedItem =
    | { kind: 'line'; line: DiffLine; hunkIdx: number }
    | { kind: 'collapsed'; count: number; gapIdx: number; lines: DiffLine[] };

  const rendered = useMemo(() => {
    const items: RenderedItem[] = [];
    let prevEnd = -1;

    for (let h = 0; h < hunks.length; h++) {
      const hunk = hunks[h];
      const hunkStartInAll = allLines.indexOf(hunk.lines[0]);
      const hunkEndInAll = hunkStartInAll + hunk.lines.length - 1;

      // Gap before this hunk
      const gapStart = prevEnd + 1;
      const gapEnd = hunkStartInAll - 1;
      if (gapStart <= gapEnd) {
        const gapLines = allLines.slice(gapStart, gapEnd + 1);
        if (expandedGaps.has(h)) {
          for (const line of gapLines) {
            items.push({ kind: 'line', line, hunkIdx: -1 });
          }
        } else {
          items.push({ kind: 'collapsed', count: gapLines.length, gapIdx: h, lines: gapLines });
        }
      }

      // Hunk lines
      for (const line of hunk.lines) {
        items.push({ kind: 'line', line, hunkIdx: h });
      }

      prevEnd = hunkEndInAll;
    }

    // Gap after last hunk
    if (hunks.length > 0) {
      const lastEnd = allLines.indexOf(hunks[hunks.length - 1].lines[0]) + hunks[hunks.length - 1].lines.length - 1;
      if (lastEnd < allLines.length - 1) {
        const gapLines = allLines.slice(lastEnd + 1);
        const gapIdx = hunks.length;
        if (expandedGaps.has(gapIdx)) {
          for (const line of gapLines) {
            items.push({ kind: 'line', line, hunkIdx: -1 });
          }
        } else {
          items.push({ kind: 'collapsed', count: gapLines.length, gapIdx, lines: gapLines });
        }
      }
    }

    // Gap before first hunk
    if (hunks.length > 0) {
      const firstStart = allLines.indexOf(hunks[0].lines[0]);
      if (firstStart > 0) {
        const gapLines = allLines.slice(0, firstStart);
        const gapIdx = -1; // special: before first hunk
        if (expandedGaps.has(gapIdx)) {
          const expanded = gapLines.map(line => ({ kind: 'line' as const, line, hunkIdx: -1 }));
          items.unshift(...expanded);
        } else {
          items.unshift({ kind: 'collapsed', count: gapLines.length, gapIdx, lines: gapLines });
        }
      }
    }

    return items;
  }, [hunks, allLines, expandedGaps]);

  // Collect change line indices for navigation
  const changeLineIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < rendered.length; i++) {
      const item = rendered[i];
      if (item.kind === 'line' && item.line.type !== 'ctx') {
        // Only track the first line of each consecutive change block
        if (indices.length === 0 || rendered[indices[indices.length - 1]].kind !== 'line' ||
            (rendered[indices[indices.length - 1]] as any).line.type === 'ctx' ||
            i - indices[indices.length - 1] > 1) {
          indices.push(i);
        }
      }
    }
    return indices;
  }, [rendered]);

  const expandGap = useCallback((gapIdx: number) => {
    setExpandedGaps(prev => {
      const next = new Set(prev);
      next.add(gapIdx);
      return next;
    });
  }, []);

  // Navigate between changes
  const navigateChange = useCallback((direction: 'next' | 'prev') => {
    if (changeLineIndices.length === 0) return;
    let nextIdx: number;
    if (direction === 'next') {
      nextIdx = currentChangeIdx + 1 >= changeLineIndices.length ? 0 : currentChangeIdx + 1;
    } else {
      nextIdx = currentChangeIdx - 1 < 0 ? changeLineIndices.length - 1 : currentChangeIdx - 1;
    }
    setCurrentChangeIdx(nextIdx);

    // Scroll to the change
    const lineIdx = changeLineIndices[nextIdx];
    const el = scrollRef.current?.querySelector(`[data-line-idx="${lineIdx}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [changeLineIndices, currentChangeIdx]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!scrollRef.current?.contains(document.activeElement) && document.activeElement !== scrollRef.current) return;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        navigateChange('next');
      }
      if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        navigateChange('prev');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigateChange]);

  // No changes
  if (allLines.every(l => l.type === 'ctx')) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No changes
      </div>
    );
  }

  // Gutter width based on max line number
  const maxLineNum = Math.max(
    allLines[allLines.length - 1]?.oldNum || 0,
    allLines[allLines.length - 1]?.newNum || 0,
  );
  const gutterWidth = Math.max(3, String(maxLineNum).length);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border shrink-0 bg-card text-[11px]">
        <span className="text-muted-foreground font-mono">{filePath.split('/').pop()}</span>
        <span className="text-success">+{stats.additions}</span>
        <span className="text-destructive">-{stats.deletions}</span>
        <span className="text-muted-foreground">{stats.changes} {stats.changes === 1 ? 'change' : 'changes'}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => navigateChange('prev')}
            title="Previous change (p)"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <span className="text-muted-foreground text-[10px] tabular-nums min-w-[3ch] text-center">
            {changeLineIndices.length > 0 ? `${currentChangeIdx + 1}/${changeLineIndices.length}` : '0/0'}
          </span>
          <button
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => navigateChange('next')}
            title="Next change (n)"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto font-mono text-[13px] leading-[20px] focus:outline-none"
        tabIndex={0}
      >
        {/* Minimap */}
        <div className="relative">
          {rendered.map((item, idx) => {
            if (item.kind === 'collapsed') {
              return (
                <CollapsedRegion
                  key={`gap-${item.gapIdx}`}
                  count={item.count}
                  onExpand={() => expandGap(item.gapIdx)}
                />
              );
            }

            return (
              <DiffLineRow
                key={idx}
                line={item.line}
                idx={idx}
                gutterWidth={gutterWidth}
                allLines={allLines}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Single diff line row with:
 * - Old line number gutter
 * - New line number gutter
 * - +/- prefix
 * - Line content with character-level highlighting for changes
 */
function DiffLineRow({ line, idx, gutterWidth, allLines }: {
  line: DiffLine;
  idx: number;
  gutterWidth: number;
  allLines: DiffLine[];
}) {
  // Character-level diff for changed lines
  const charHighlight = useMemo(() => {
    if (line.type === 'ctx') return null;

    // Find the paired line for character diff
    if (line.type === 'del') {
      const lineIdx = allLines.indexOf(line);
      if (lineIdx < 0) return null;
      // Find start of this del block
      let blockStart = lineIdx;
      while (blockStart > 0 && allLines[blockStart - 1]?.type === 'del') blockStart--;
      // Find end of del block, then start of add block
      let delEnd = lineIdx;
      while (delEnd < allLines.length && allLines[delEnd].type === 'del') delEnd++;
      // Pair this del with the corresponding add
      const posInBlock = lineIdx - blockStart;
      const pairedAdd = allLines[delEnd + posInBlock];
      if (pairedAdd?.type === 'add') {
        return computeCharDiff(line.line, pairedAdd.line);
      }
    }

    if (line.type === 'add') {
      // Look backwards for the paired del
      const lineIdx = allLines.indexOf(line);
      if (lineIdx < 0) return null;
      // Find start of add block
      let addBlockStart = lineIdx;
      while (addBlockStart > 0 && allLines[addBlockStart - 1]?.type === 'add') addBlockStart--;
      // Del block should be right before
      let delEnd = addBlockStart;
      let delStart = delEnd;
      while (delStart > 0 && allLines[delStart - 1]?.type === 'del') delStart--;
      const posInBlock = lineIdx - addBlockStart;
      const pairedDel = allLines[delStart + posInBlock];
      if (pairedDel?.type === 'del') {
        return computeCharDiff(pairedDel.line, line.line);
      }
    }

    return null;
  }, [line, allLines]);

  const isDel = line.type === 'del';
  const isAdd = line.type === 'add';

  return (
    <div
      data-line-idx={idx}
      className={cn(
        'flex whitespace-pre',
        isDel && 'diff-line-del',
        isAdd && 'diff-line-add',
      )}
    >
      {/* Old line number */}
      <span
        className={cn(
          'select-none shrink-0 text-right pr-2 border-r',
          isDel ? 'text-destructive/40 border-destructive/10' : isAdd ? 'border-success/10' : 'text-muted-foreground/30 border-border/30',
        )}
        style={{ width: `${gutterWidth + 1}ch`, minWidth: `${gutterWidth + 1}ch` }}
      >
        {line.oldNum ?? ''}
      </span>
      {/* New line number */}
      <span
        className={cn(
          'select-none shrink-0 text-right pr-2 border-r',
          isAdd ? 'text-success/40 border-success/10' : isDel ? 'border-destructive/10' : 'text-muted-foreground/30 border-border/30',
        )}
        style={{ width: `${gutterWidth + 1}ch`, minWidth: `${gutterWidth + 1}ch` }}
      >
        {line.newNum ?? ''}
      </span>
      {/* +/- prefix */}
      <span
        className={cn(
          'select-none shrink-0 w-[2ch] text-center',
          isDel ? 'text-destructive/60' : isAdd ? 'text-success/60' : 'text-muted-foreground/20',
        )}
      >
        {isDel ? '-' : isAdd ? '+' : ' '}
      </span>
      {/* Line content */}
      <span className="flex-1 px-2">
        {charHighlight && (isDel || isAdd) ? (
          <CharHighlightedLine
            parts={isDel ? charHighlight.oldParts : charHighlight.newParts}
            type={isDel ? 'del' : 'add'}
          />
        ) : (
          <span className={cn(
            isDel && 'text-foreground',
            isAdd && 'text-foreground',
            !isDel && !isAdd && 'text-foreground/70',
          )}>
            {line.line || '\u00A0'}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Renders a line with character-level diff highlighting.
 * Same characters: normal text on the line background.
 * Changed characters: darker background to show exactly what changed.
 */
function CharHighlightedLine({ parts, type }: {
  parts: Array<{ type: string; text: string }>;
  type: 'del' | 'add';
}) {
  return (
    <span>
      {parts.map((part, i) => {
        const isChanged = (type === 'del' && part.type === 'del') || (type === 'add' && part.type === 'add');
        return (
          <span
            key={i}
            className={cn(
              'text-foreground',
              isChanged && type === 'del' && 'diff-char-del',
              isChanged && type === 'add' && 'diff-char-add',
            )}
          >
            {part.text}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Collapsed region showing "Show N more lines".
 * VS Code style: centered text on a subtle background band.
 */
function CollapsedRegion({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <div
      className="flex items-center justify-center py-0.5 bg-secondary/30 border-y border-border/30 cursor-pointer hover:bg-secondary/50 transition-colors group"
      onClick={onExpand}
    >
      <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
        Show {count} unchanged {count === 1 ? 'line' : 'lines'}
      </span>
    </div>
  );
}
