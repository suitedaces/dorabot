/**
 * Diff utilities for computing line-level and character-level diffs.
 * Used by FileStream (inline edit diffs) and DiffViewer (full-file diffs).
 */

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
 * Compute a line-level diff using LCS (Longest Common Subsequence).
 * Returns an array of DiffLines with line numbers.
 */
export function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'ctx', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'del', line: oldLines[i - 1] });
      i--;
    }
  }
  result.reverse();

  // Assign line numbers
  let oldNum = 0, newNum = 0;
  for (const d of result) {
    if (d.type === 'del' || d.type === 'ctx') oldNum++;
    if (d.type === 'add' || d.type === 'ctx') newNum++;
    d.oldNum = d.type !== 'add' ? oldNum : undefined;
    d.newNum = d.type !== 'del' ? newNum : undefined;
  }

  return result;
}

/**
 * Compute character-level diff between two strings.
 * Used to highlight the specific characters that changed within a line.
 */
export function computeCharDiff(oldStr: string, newStr: string): { oldParts: CharDiff[]; newParts: CharDiff[] } {
  const m = oldStr.length;
  const n = newStr.length;

  // For very long lines, skip char diff (too expensive)
  if (m * n > 100000) {
    return {
      oldParts: [{ type: 'del', text: oldStr }],
      newParts: [{ type: 'add', text: newStr }],
    };
  }

  // LCS on characters
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldStr[i - 1] === newStr[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // Backtrack
  const ops: Array<{ type: 'same' | 'del' | 'add'; char: string }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldStr[i - 1] === newStr[j - 1]) {
      ops.push({ type: 'same', char: oldStr[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', char: newStr[j - 1] });
      j--;
    } else {
      ops.push({ type: 'del', char: oldStr[i - 1] });
      i--;
    }
  }
  ops.reverse();

  // Merge consecutive same-type operations into parts
  const oldParts: CharDiff[] = [];
  const newParts: CharDiff[] = [];

  let oldBuf = '', oldType: 'same' | 'del' = 'same';
  let newBuf = '', newType: 'same' | 'add' = 'same';

  for (const op of ops) {
    if (op.type === 'same') {
      // Flush old del buffer
      if (oldType === 'del' && oldBuf) {
        oldParts.push({ type: 'del', text: oldBuf });
        oldBuf = '';
      }
      // Flush new add buffer
      if (newType === 'add' && newBuf) {
        newParts.push({ type: 'add', text: newBuf });
        newBuf = '';
      }
      oldBuf += op.char;
      newBuf += op.char;
      oldType = 'same';
      newType = 'same';
    } else if (op.type === 'del') {
      if (oldType === 'same' && oldBuf) {
        oldParts.push({ type: 'same', text: oldBuf });
        oldBuf = '';
      }
      oldBuf += op.char;
      oldType = 'del';
    } else {
      if (newType === 'same' && newBuf) {
        newParts.push({ type: 'same', text: newBuf });
        newBuf = '';
      }
      newBuf += op.char;
      newType = 'add';
    }
  }

  // Flush remaining
  if (oldBuf) oldParts.push({ type: oldType === 'del' ? 'del' : 'same', text: oldBuf });
  if (newBuf) newParts.push({ type: newType === 'add' ? 'add' : 'same', text: newBuf });

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
