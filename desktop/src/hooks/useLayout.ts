import { useState, useCallback, useMemo, useEffect } from 'react';

// --- Types ---

export type Pane = {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
};

export type Column = {
  id: string;
  panes: Pane[];
  sizes: number[];  // heights, sum to 100
};

export type LayoutState = {
  columns: Column[];
  sizes: number[];  // widths, sum to 100
  activePaneId: string;
};

// Backwards compat: callers that used GroupId now use string
export type GroupId = string;

export type EditorGroup = Pane;

const LAYOUT_STORAGE_KEY = 'dorabot:layout';

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function makePane(): Pane {
  return { id: uid(), tabIds: [], activeTabId: null };
}

function makeColumn(panes?: Pane[]): Column {
  const p = panes || [makePane()];
  return { id: uid(), panes: p, sizes: equalSizes(p.length) };
}

function equalSizes(n: number): number[] {
  const base = Math.floor(100 / n);
  const sizes = Array(n).fill(base);
  sizes[0] += 100 - base * n; // absorb remainder
  return sizes;
}

// --- Flat helpers ---

function allPanes(state: LayoutState): Pane[] {
  return state.columns.flatMap(c => c.panes);
}

function findPaneColumn(state: LayoutState, paneId: string): { col: Column; colIdx: number; paneIdx: number } | null {
  for (let ci = 0; ci < state.columns.length; ci++) {
    const col = state.columns[ci];
    for (let pi = 0; pi < col.panes.length; pi++) {
      if (col.panes[pi].id === paneId) return { col, colIdx: ci, paneIdx: pi };
    }
  }
  return null;
}

// --- Migration from old format ---

type OldLayoutState = {
  mode: 'single' | '2-col' | '2-row' | '2x2';
  groups: { id: string; tabIds: string[]; activeTabId: string | null }[];
  activeGroupId: string;
};

function migrateOldLayout(old: OldLayoutState): LayoutState {
  const g = old.groups;
  const pane = (i: number): Pane => ({
    id: g[i]?.id || uid(),
    tabIds: g[i]?.tabIds || [],
    activeTabId: g[i]?.activeTabId || null,
  });

  switch (old.mode) {
    case '2-col':
      return {
        columns: [makeColumn([pane(0)]), makeColumn([pane(1)])],
        sizes: [50, 50],
        activePaneId: old.activeGroupId,
      };
    case '2-row':
      return {
        columns: [makeColumn([pane(0), pane(1)])],
        sizes: [100],
        activePaneId: old.activeGroupId,
      };
    case '2x2':
      return {
        columns: [
          makeColumn([pane(0), pane(2)]),
          makeColumn([pane(1), pane(3)]),
        ],
        sizes: [50, 50],
        activePaneId: old.activeGroupId,
      };
    default: {
      // single
      const p = pane(0);
      return {
        columns: [makeColumn([p])],
        sizes: [100],
        activePaneId: p.id,
      };
    }
  }
}

function loadFromStorage(): LayoutState | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // New format
    if (Array.isArray(parsed.columns)) {
      const st = parsed as LayoutState;
      if (st.columns.length === 0 || !st.activePaneId) return null;
      // Ensure every column has at least one pane
      if (st.columns.some(c => !Array.isArray(c.panes) || c.panes.length === 0)) return null;
      // Ensure activePaneId points to an existing pane
      const allIds = st.columns.flatMap(c => c.panes.map(p => p.id));
      if (!allIds.includes(st.activePaneId)) {
        st.activePaneId = allIds[0];
      }
      return st;
    }

    // Old format (mode + groups)
    if (parsed.mode && Array.isArray(parsed.groups)) {
      return migrateOldLayout(parsed as OldLayoutState);
    }

    return null;
  } catch {
    return null;
  }
}

function defaultLayout(): LayoutState {
  const p = makePane();
  return {
    columns: [makeColumn([p])],
    sizes: [100],
    activePaneId: p.id,
  };
}

// --- Hook ---

export function useLayout() {
  const [state, setState] = useState<LayoutState>(() => {
    return loadFromStorage() || defaultLayout();
  });

  // Persist
  useEffect(() => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Derived
  const visibleGroups = useMemo(() => allPanes(state), [state]);

  const isMultiPane = visibleGroups.length > 1;

  const activeGroupId = state.activePaneId;

  // For compat: expose groups as flat array
  const groups = visibleGroups;

  // Also expose the columns-of-rows structure
  const columns = state.columns;
  const columnSizes = state.sizes;

  // --- Actions ---

  const focusGroup = useCallback((paneId: string) => {
    setState(prev => prev.activePaneId === paneId ? prev : { ...prev, activePaneId: paneId });
  }, []);

  // Add a column to the right with equal sizing
  const addColumn = useCallback(() => {
    setState(prev => {
      const newCol = makeColumn();
      const cols = [...prev.columns, newCol];
      return { ...prev, columns: cols, sizes: equalSizes(cols.length), activePaneId: newCol.panes[0].id };
    });
  }, []);

  // Add a row (pane) in the active pane's column
  const addRow = useCallback(() => {
    setState(prev => {
      const loc = findPaneColumn(prev, prev.activePaneId);
      if (!loc) return prev;
      const newPane = makePane();
      const col = { ...loc.col, panes: [...loc.col.panes] };
      col.panes.splice(loc.paneIdx + 1, 0, newPane);
      col.sizes = equalSizes(col.panes.length);
      const columns = prev.columns.map(c => c.id === col.id ? col : c);
      return { ...prev, columns, activePaneId: newPane.id };
    });
  }, []);

  // Add a column at a specific position (for drag: left/right of a target)
  // opts.activate defaults to true (moves focus to the new pane). Agent-triggered
  // splits pass activate:false so the user's pane stays focused.
  const addColumnAt = useCallback((targetPaneId: string, side: 'left' | 'right', opts?: { activate?: boolean }): string => {
    const activate = opts?.activate ?? true;
    const newPane = makePane();
    const newCol = makeColumn([newPane]);
    setState(prev => {
      const loc = findPaneColumn(prev, targetPaneId);
      if (!loc) return prev;
      const cols = [...prev.columns];
      const insertIdx = side === 'right' ? loc.colIdx + 1 : loc.colIdx;
      cols.splice(insertIdx, 0, newCol);
      return {
        ...prev,
        columns: cols,
        sizes: equalSizes(cols.length),
        activePaneId: activate ? newPane.id : prev.activePaneId,
      };
    });
    return newPane.id;
  }, []);

  // Atomically add a new column that already contains `tabId` in its pane.
  // This is the split-and-adopt path used by agent-initiated browser tabs —
  // doing it in a single setState prevents the fill-empty effect from racing
  // an empty pane and creating a ghost chat tab.
  const addColumnWithTab = useCallback((
    targetPaneId: string,
    side: 'left' | 'right',
    tabId: string,
    opts?: { activate?: boolean },
  ): string => {
    const activate = opts?.activate ?? false;
    const newPane: Pane = { id: uid(), tabIds: [tabId], activeTabId: tabId };
    const newCol: Column = { id: uid(), panes: [newPane], sizes: [100] };
    setState(prev => {
      const loc = findPaneColumn(prev, targetPaneId);
      if (!loc) return prev;
      // strip the tab from any pre-existing pane so we don't duplicate it
      const cleanedColumns = prev.columns.map(c => ({
        ...c,
        panes: c.panes.map(p => {
          if (!p.tabIds.includes(tabId)) return p;
          const filtered = p.tabIds.filter(id => id !== tabId);
          return {
            ...p,
            tabIds: filtered,
            activeTabId: p.activeTabId === tabId
              ? (filtered[0] || null)
              : p.activeTabId,
          };
        }),
      }));
      const insertIdx = side === 'right' ? loc.colIdx + 1 : loc.colIdx;
      const cols = [...cleanedColumns];
      cols.splice(insertIdx, 0, newCol);
      return {
        ...prev,
        columns: cols,
        sizes: equalSizes(cols.length),
        activePaneId: activate ? newPane.id : prev.activePaneId,
      };
    });
    return newPane.id;
  }, []);

  // Add a row at a specific position (for drag: above/below a target)
  const addRowAt = useCallback((targetPaneId: string, side: 'top' | 'bottom'): string => {
    const newPane = makePane();
    setState(prev => {
      const loc = findPaneColumn(prev, targetPaneId);
      if (!loc) return prev;
      const col = { ...loc.col, panes: [...loc.col.panes] };
      const insertIdx = side === 'bottom' ? loc.paneIdx + 1 : loc.paneIdx;
      col.panes.splice(insertIdx, 0, newPane);
      col.sizes = equalSizes(col.panes.length);
      const columns = prev.columns.map(c => c.id === col.id ? col : c);
      return { ...prev, columns, activePaneId: newPane.id };
    });
    return newPane.id;
  }, []);

  // 2x2 grid: ensure exactly 2 columns with 2 rows each
  const splitGrid = useCallback(() => {
    setState(prev => {
      // Already 2x2
      if (prev.columns.length === 2 && prev.columns[0].panes.length === 2 && prev.columns[1].panes.length === 2) {
        return prev;
      }
      const panes = allPanes(prev);
      // Clone existing panes so the new grid doesn't share references
      const clone = (p: Pane): Pane => ({ ...p, tabIds: [...p.tabIds] });
      const p0 = panes[0] ? clone(panes[0]) : makePane();
      const p1 = panes[1] ? clone(panes[1]) : makePane();
      const p2 = panes[2] ? clone(panes[2]) : makePane();
      const p3 = panes[3] ? clone(panes[3]) : makePane();
      // Reuse existing column IDs if available
      const colId0 = prev.columns[0]?.id || uid();
      const colId1 = prev.columns[1]?.id || uid();
      // Ensure activePaneId still exists in the new grid
      const gridPaneIds = [p0.id, p1.id, p2.id, p3.id];
      const activePaneId = gridPaneIds.includes(prev.activePaneId)
        ? prev.activePaneId
        : p0.id;
      return {
        columns: [
          { id: colId0, panes: [p0, p2], sizes: [50, 50] },
          { id: colId1, panes: [p1, p3], sizes: [50, 50] },
        ],
        sizes: [50, 50],
        activePaneId,
      };
    });
  }, []);

  // Compat: splitHorizontal = addColumn, splitVertical = addRow
  const splitHorizontal = addColumn;
  const splitVertical = addRow;

  const resetToSingle = useCallback(() => {
    setState(prev => {
      const panes = allPanes(prev);
      if (panes.length === 1) return prev;
      // Merge all tabs into one pane
      const allTabIds: string[] = [];
      const seen = new Set<string>();
      for (const p of panes) {
        for (const tid of p.tabIds) {
          if (!seen.has(tid)) { seen.add(tid); allTabIds.push(tid); }
        }
      }
      const activePane = panes.find(p => p.id === prev.activePaneId);
      const activeTabId = activePane?.activeTabId || allTabIds[0] || null;
      const merged: Pane = { id: uid(), tabIds: allTabIds, activeTabId };
      return {
        columns: [makeColumn([merged])],
        sizes: [100],
        activePaneId: merged.id,
      };
    });
  }, []);

  const moveTabToGroup = useCallback((tabId: string, fromPaneId: string, toPaneId: string) => {
    if (fromPaneId === toPaneId) return;
    setState(prev => {
      const panes = allPanes(prev);
      const from = panes.find(p => p.id === fromPaneId);
      const to = panes.find(p => p.id === toPaneId);
      if (!from || !to) return prev;

      const idx = from.tabIds.indexOf(tabId);
      if (idx < 0) return prev;

      const updatePane = (p: Pane): Pane => {
        if (p.id === fromPaneId) {
          const newTabIds = p.tabIds.filter(id => id !== tabId);
          return {
            ...p,
            tabIds: newTabIds,
            activeTabId: p.activeTabId === tabId
              ? (newTabIds[Math.min(idx, newTabIds.length - 1)] || null)
              : p.activeTabId,
          };
        }
        if (p.id === toPaneId) {
          return {
            ...p,
            tabIds: p.tabIds.includes(tabId) ? p.tabIds : [...p.tabIds, tabId],
            activeTabId: tabId,
          };
        }
        return p;
      };

      const columns = prev.columns.map(c => ({
        ...c,
        panes: c.panes.map(updatePane),
      }));

      return { ...prev, columns, activePaneId: toPaneId };
    });
  }, []);

  const addTabToGroup = useCallback((tabId: string, paneId?: string, opts?: { activate?: boolean }) => {
    const activate = opts?.activate ?? true;
    setState(prev => {
      const targetId = paneId || prev.activePaneId;
      // Remove from any other pane first (prevent cross-pane duplication),
      // then add to target pane.
      const columns = prev.columns.map(c => ({
        ...c,
        panes: c.panes.map(p => {
          if (p.id === targetId) {
            if (p.tabIds.includes(tabId)) {
              return activate ? { ...p, activeTabId: tabId } : p;
            }
            return {
              ...p,
              tabIds: [...p.tabIds, tabId],
              activeTabId: activate ? tabId : (p.activeTabId ?? tabId),
            };
          }
          // Strip from non-target panes
          if (p.tabIds.includes(tabId)) {
            const filtered = p.tabIds.filter(id => id !== tabId);
            return {
              ...p,
              tabIds: filtered,
              activeTabId: p.activeTabId === tabId
                ? (filtered[0] || null)
                : p.activeTabId,
            };
          }
          return p;
        }),
      }));
      return { ...prev, columns };
    });
  }, []);

  const removeTabFromGroup = useCallback((tabId: string, fromPaneId?: string): { groupId: string; wasActive: boolean; neighborTabId: string | null } => {
    // Compute result synchronously from derived state (visibleGroups) so it's
    // available immediately.  The setState updater uses the captured pane ID to
    // scope the removal to that single pane.
    const panes = visibleGroups;
    const pane = fromPaneId
      ? panes.find(p => p.id === fromPaneId && p.tabIds.includes(tabId))
      : panes.find(p => p.tabIds.includes(tabId));
    if (!pane) return { groupId: '', wasActive: false, neighborTabId: null };

    const idx = pane.tabIds.indexOf(tabId);
    const wasActive = pane.activeTabId === tabId;
    const newTabIds = pane.tabIds.filter(id => id !== tabId);
    const neighborIdx = Math.min(idx, newTabIds.length - 1);
    const neighborTabId = newTabIds[neighborIdx] || null;

    const targetPaneId = pane.id;
    setState(prev => ({
      ...prev,
      columns: prev.columns.map(c => ({
        ...c,
        panes: c.panes.map(p => {
          if (p.id !== targetPaneId) return p;
          const filtered = p.tabIds.filter(id => id !== tabId);
          return {
            ...p,
            tabIds: filtered,
            activeTabId: p.activeTabId === tabId
              ? (filtered[Math.min(idx, filtered.length - 1)] || null)
              : p.activeTabId,
          };
        }),
      })),
    }));

    return { groupId: pane.id, wasActive, neighborTabId };
  }, [visibleGroups]);

  const setGroupActiveTab = useCallback((paneId: string, tabId: string) => {
    setState(prev => ({
      ...prev,
      columns: prev.columns.map(c => ({
        ...c,
        panes: c.panes.map(p =>
          p.id === paneId ? { ...p, activeTabId: tabId } : p
        ),
      })),
    }));
  }, []);

  const findGroupForTab = useCallback((tabId: string): string | null => {
    for (const p of visibleGroups) {
      if (p.tabIds.includes(tabId)) return p.id;
    }
    return null;
  }, [visibleGroups]);

  // Collapse an empty pane: remove it, equalize sizes, collapse column if empty
  const collapseGroup = useCallback((emptyPaneId: string) => {
    setState(prev => {
      let columns = prev.columns.map(c => {
        if (!c.panes.some(p => p.id === emptyPaneId)) return c;
        const panes = c.panes.filter(p => p.id !== emptyPaneId);
        return { ...c, panes, sizes: equalSizes(Math.max(panes.length, 1)) };
      });

      // Remove empty columns
      columns = columns.filter(c => c.panes.length > 0);

      // If nothing left, make a default
      if (columns.length === 0) {
        const p = makePane();
        return { columns: [makeColumn([p])], sizes: [100], activePaneId: p.id };
      }

      const sizes = equalSizes(columns.length);

      // Fix activePaneId if it was the collapsed pane
      let activePaneId = prev.activePaneId;
      if (activePaneId === emptyPaneId) {
        const all = allPanes({ columns, sizes, activePaneId: '' });
        activePaneId = all[0]?.id || '';
      }

      return { columns, sizes, activePaneId };
    });
  }, []);

  // Navigate focus between panes spatially
  const focusGroupDirection = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    setState(prev => {
      const loc = findPaneColumn(prev, prev.activePaneId);
      if (!loc) return prev;

      let targetPaneId: string | null = null;

      if (direction === 'left') {
        if (loc.colIdx > 0) {
          const leftCol = prev.columns[loc.colIdx - 1];
          const pi = Math.min(loc.paneIdx, leftCol.panes.length - 1);
          targetPaneId = leftCol.panes[pi].id;
        }
      } else if (direction === 'right') {
        if (loc.colIdx < prev.columns.length - 1) {
          const rightCol = prev.columns[loc.colIdx + 1];
          const pi = Math.min(loc.paneIdx, rightCol.panes.length - 1);
          targetPaneId = rightCol.panes[pi].id;
        }
      } else if (direction === 'up') {
        if (loc.paneIdx > 0) {
          targetPaneId = loc.col.panes[loc.paneIdx - 1].id;
        }
      } else if (direction === 'down') {
        if (loc.paneIdx < loc.col.panes.length - 1) {
          targetPaneId = loc.col.panes[loc.paneIdx + 1].id;
        }
      }

      if (!targetPaneId || targetPaneId === prev.activePaneId) return prev;
      return { ...prev, activePaneId: targetPaneId };
    });
  }, []);

  const updateGroup = useCallback((paneId: string, patch: Partial<Pane>) => {
    setState(prev => ({
      ...prev,
      columns: prev.columns.map(c => ({
        ...c,
        panes: c.panes.map(p => p.id === paneId ? { ...p, ...patch } : p),
      })),
    }));
  }, []);

  return {
    // State
    columns,
    columnSizes,
    groups,
    activeGroupId,
    visibleGroups,
    isMultiPane,
    // Compat (old mode-based API still works for callers that check it)
    mode: (visibleGroups.length === 1 ? 'single' : 'multi') as string,
    // Actions
    focusGroup,
    addColumn,
    addRow,
    addColumnAt,
    addColumnWithTab,
    addRowAt,
    splitHorizontal,
    splitVertical,
    splitGrid,
    resetToSingle,
    moveTabToGroup,
    addTabToGroup,
    removeTabFromGroup,
    setGroupActiveTab,
    findGroupForTab,
    focusGroupDirection,
    collapseGroup,
    updateGroup,
  };
}
