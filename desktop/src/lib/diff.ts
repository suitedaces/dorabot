/**
 * Diff utilities using the 'diff' library (Myers' O(ND) algorithm).
 * Used by FileStream (inline edit diffs) and DiffViewer (full-file diffs).
 */
import { diffLines, diffChars } from 'diff';

export type DiffLineType = 'ctx' | 'del' | 'add';

export type DiffLine = {
  type: DiffLineType;
  line: string;
  oldNum?: number;
  newNum?: number;
};

export type DiffHunk = {
  lines: DiffLine[];
  oldStart: number;
  newStart: number;
};

export type CharDiff = {
  type: 'same' | 'del' | 'add';
  text: string;
};

/**
 * Compute a line-level diff using Myers' algorithm via the 'diff' library.
 * Returns an array of DiffLines with line numbers.
 */
export function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const changes = diffLines(oldStr, newStr);
  const result: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const change of changes) {
    // Split into individual lines, dropping the trailing empty string from final newline
    const lines = change.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();

    for (const line of lines) {
      if (change.added) {
        newNum++;
        result.push({ type: 'add', line, newNum });
      } else if (change.removed) {
        oldNum++;
        result.push({ type: 'del', line, oldNum });
      } else {
        oldNum++;
        newNum++;
        result.push({ type: 'ctx', line, oldNum, newNum });
      }
    }
  }

  return result;
}

/**
 * Compute character-level diff between two strings.
 * Used to highlight the specific characters that changed within a line.
 */
export function computeCharDiff(oldStr: string, newStr: string): { oldParts: CharDiff[]; newParts: CharDiff[] } {
  const changes = diffChars(oldStr, newStr);
  const oldParts: CharDiff[] = [];
  const newParts: CharDiff[] = [];

  for (const change of changes) {
    if (change.added) {
      newParts.push({ type: 'add', text: change.value });
    } else if (change.removed) {
      oldParts.push({ type: 'del', text: change.value });
    } else {
      oldParts.push({ type: 'same', text: change.value });
      newParts.push({ type: 'same', text: change.value });
    }
  }

  return { oldParts, newParts };
}

/**
 * Group diff lines into hunks with context.
 * Hunks are separated by regions of unchanged lines (collapsed in UI).
 * contextLines = number of unchanged lines to show around each change.
 */
export function groupIntoHunks(lines: DiffLine[], contextLines: number = 3): DiffHunk[] {
  // Find indices of changed lines
  const changeIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'ctx') changeIndices.push(i);
  }

  if (changeIndices.length === 0) return [];

  // Build ranges: each range is [start, end] inclusive, with context padding
  const ranges: Array<[number, number]> = [];
  let rangeStart = Math.max(0, changeIndices[0] - contextLines);
  let rangeEnd = Math.min(lines.length - 1, changeIndices[0] + contextLines);

  for (let i = 1; i < changeIndices.length; i++) {
    const nextStart = Math.max(0, changeIndices[i] - contextLines);
    const nextEnd = Math.min(lines.length - 1, changeIndices[i] + contextLines);

    if (nextStart <= rangeEnd + 1) {
      // Merge with current range
      rangeEnd = nextEnd;
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = nextStart;
      rangeEnd = nextEnd;
    }
  }
  ranges.push([rangeStart, rangeEnd]);

  // Convert ranges to hunks
  return ranges.map(([start, end]) => {
    const hunkLines = lines.slice(start, end + 1);
    const firstLine = hunkLines[0];
    return {
      lines: hunkLines,
      oldStart: firstLine.oldNum || 1,
      newStart: firstLine.newNum || 1,
    };
  });
}
