/**
 * Window Management Edge Case Tests (POST-FIX)
 *
 * Models the fixed useLayout + useTabs state machine to verify all bugs are resolved.
 * Run: npx tsx src/hooks/__tests__/useLayout.edgecases.test.ts
 */

// ============================================================
// Minimal state machine (mirrors FIXED useLayout.ts)
// ============================================================

type Pane = { id: string; tabIds: string[]; activeTabId: string | null };
type Column = { id: string; panes: Pane[]; sizes: number[] };
type LayoutState = { columns: Column[]; sizes: number[]; activePaneId: string };

let _uid = 0;
function uid(): string { return `id_${++_uid}`; }
function resetUid() { _uid = 0; }

function equalSizes(n: number): number[] {
  const base = Math.floor(100 / n);
  const sizes = Array(n).fill(base);
  sizes[0] += 100 - base * n;
  return sizes;
}

function makePane(tabIds: string[] = []): Pane {
  return { id: uid(), tabIds, activeTabId: tabIds[0] || null };
}

function makeColumn(panes?: Pane[]): Column {
  const p = panes || [makePane()];
  return { id: uid(), panes: p, sizes: equalSizes(p.length) };
}

function allPanes(state: LayoutState): Pane[] {
  return state.columns.flatMap(c => c.panes);
}

function findPaneColumn(state: LayoutState, paneId: string) {
  for (let ci = 0; ci < state.columns.length; ci++) {
    const col = state.columns[ci];
    for (let pi = 0; pi < col.panes.length; pi++) {
      if (col.panes[pi].id === paneId) return { col, colIdx: ci, paneIdx: pi };
    }
  }
  return null;
}

// ============================================================
// FIXED state transition functions
// ============================================================

function addColumn(state: LayoutState): LayoutState {
  const newCol = makeColumn();
  const cols = [...state.columns, newCol];
  return { ...state, columns: cols, sizes: equalSizes(cols.length), activePaneId: newCol.panes[0].id };
}

function addRow(state: LayoutState): LayoutState {
  const loc = findPaneColumn(state, state.activePaneId);
  if (!loc) return state;
  const newPane = makePane();
  const col = { ...loc.col, panes: [...loc.col.panes] };
  col.panes.splice(loc.paneIdx + 1, 0, newPane);
  col.sizes = equalSizes(col.panes.length);
  const columns = state.columns.map(c => c.id === col.id ? col : c);
  return { ...state, columns, activePaneId: newPane.id };
}

// FIX #3: addTabToGroup strips tab from other panes before adding to target
function addTabToGroup(state: LayoutState, tabId: string, paneId?: string): LayoutState {
  const targetId = paneId || state.activePaneId;
  const columns = state.columns.map(c => ({
    ...c,
    panes: c.panes.map(p => {
      if (p.id === targetId) {
        if (p.tabIds.includes(tabId)) return { ...p, activeTabId: tabId };
        return { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId };
      }
      // Strip from non-target panes (prevents cross-pane duplication)
      if (p.tabIds.includes(tabId)) {
        const filtered = p.tabIds.filter(id => id !== tabId);
        return {
          ...p,
          tabIds: filtered,
          activeTabId: p.activeTabId === tabId ? (filtered[0] || null) : p.activeTabId,
        };
      }
      return p;
    }),
  }));
  return { ...state, columns };
}

// FIX #1 & #2: removeTabFromGroup only removes from ONE pane (fromPaneId or first match)
function removeTabFromGroup(state: LayoutState, tabId: string, fromPaneId?: string): {
  state: LayoutState;
  groupId: string;
  wasActive: boolean;
  neighborTabId: string | null;
} {
  const panes = allPanes(state);
  const pane = fromPaneId
    ? panes.find(p => p.id === fromPaneId && p.tabIds.includes(tabId))
    : panes.find(p => p.tabIds.includes(tabId));
  if (!pane) return { state, groupId: '', wasActive: false, neighborTabId: null };

  const idx = pane.tabIds.indexOf(tabId);
  const wasActive = pane.activeTabId === tabId;
  const newTabIds = pane.tabIds.filter(id => id !== tabId);
  const neighborIdx = Math.min(idx, newTabIds.length - 1);
  const neighborTabId = newTabIds[neighborIdx] || null;

  const newState: LayoutState = {
    ...state,
    columns: state.columns.map(c => ({
      ...c,
      panes: c.panes.map(p => {
        // Only remove from the specific pane, not all panes
        if (p.id !== pane.id) return p;
        return {
          ...p,
          tabIds: newTabIds,
          activeTabId: p.activeTabId === tabId
            ? (newTabIds[neighborIdx] || null)
            : p.activeTabId,
        };
      }),
    })),
  };

  return { state: newState, groupId: pane.id, wasActive, neighborTabId };
}

function collapseGroup(state: LayoutState, emptyPaneId: string): LayoutState {
  let columns = state.columns.map(c => {
    if (!c.panes.some(p => p.id === emptyPaneId)) return c;
    const panes = c.panes.filter(p => p.id !== emptyPaneId);
    return { ...c, panes, sizes: equalSizes(Math.max(panes.length, 1)) };
  });
  columns = columns.filter(c => c.panes.length > 0);
  if (columns.length === 0) {
    const p = makePane();
    return { columns: [makeColumn([p])], sizes: [100], activePaneId: p.id };
  }
  const sizes = equalSizes(columns.length);
  let activePaneId = state.activePaneId;
  if (activePaneId === emptyPaneId) {
    const all = allPanes({ columns, sizes, activePaneId: '' });
    activePaneId = all[0]?.id || '';
  }
  return { columns, sizes, activePaneId };
}

// FIX #6: splitGrid clones panes and validates activePaneId
function splitGrid(state: LayoutState): LayoutState {
  if (state.columns.length === 2 && state.columns[0].panes.length === 2 && state.columns[1].panes.length === 2) {
    return state;
  }
  const panes = allPanes(state);
  const clone = (p: Pane): Pane => ({ ...p, tabIds: [...p.tabIds] });
  const p0 = panes[0] ? clone(panes[0]) : makePane();
  const p1 = panes[1] ? clone(panes[1]) : makePane();
  const p2 = panes[2] ? clone(panes[2]) : makePane();
  const p3 = panes[3] ? clone(panes[3]) : makePane();
  const colId0 = state.columns[0]?.id || uid();
  const colId1 = state.columns[1]?.id || uid();
  const gridPaneIds = [p0.id, p1.id, p2.id, p3.id];
  const activePaneId = gridPaneIds.includes(state.activePaneId) ? state.activePaneId : p0.id;
  return {
    columns: [
      { id: colId0, panes: [p0, p2], sizes: [50, 50] },
      { id: colId1, panes: [p1, p3], sizes: [50, 50] },
    ],
    sizes: [50, 50],
    activePaneId,
  };
}

function resetToSingle(state: LayoutState): LayoutState {
  const panes = allPanes(state);
  if (panes.length === 1) return state;
  const allTabIds: string[] = [];
  const seen = new Set<string>();
  for (const p of panes) {
    for (const tid of p.tabIds) {
      if (!seen.has(tid)) { seen.add(tid); allTabIds.push(tid); }
    }
  }
  const activePane = panes.find(p => p.id === state.activePaneId);
  const activeTabId = activePane?.activeTabId || allTabIds[0] || null;
  const merged: Pane = { id: uid(), tabIds: allTabIds, activeTabId };
  return { columns: [makeColumn([merged])], sizes: [100], activePaneId: merged.id };
}

function moveTabToGroup(state: LayoutState, tabId: string, fromPaneId: string, toPaneId: string): LayoutState {
  if (fromPaneId === toPaneId) return state;
  const panes = allPanes(state);
  const from = panes.find(p => p.id === fromPaneId);
  const to = panes.find(p => p.id === toPaneId);
  if (!from || !to) return state;
  const idx = from.tabIds.indexOf(tabId);
  if (idx < 0) return state;
  const updatePane = (p: Pane): Pane => {
    if (p.id === fromPaneId) {
      const newTabIds = p.tabIds.filter(id => id !== tabId);
      return { ...p, tabIds: newTabIds, activeTabId: p.activeTabId === tabId ? (newTabIds[Math.min(idx, newTabIds.length - 1)] || null) : p.activeTabId };
    }
    if (p.id === toPaneId) {
      return { ...p, tabIds: p.tabIds.includes(tabId) ? p.tabIds : [...p.tabIds, tabId], activeTabId: tabId };
    }
    return p;
  };
  const columns = state.columns.map(c => ({ ...c, panes: c.panes.map(updatePane) }));
  return { ...state, columns, activePaneId: toPaneId };
}

// ============================================================
// FIXED effect simulations
// ============================================================

// FIX #4: Invariant effect skips multi-pane mode entirely (fill-empty handles it)
function simulateInvariantEffect(
  layoutState: LayoutState,
  tabs: string[],
): { layoutState: LayoutState; addedTabToPane: string | null } {
  if (tabs.length === 0) return { layoutState, addedTabToPane: null };
  // In multi-pane mode, skip (let fill-empty effect handle it)
  if (allPanes(layoutState).length > 1) return { layoutState, addedTabToPane: null };

  const visibleGroup = allPanes(layoutState)[0];
  if (!visibleGroup) return { layoutState, addedTabToPane: null };
  const tabIds = new Set(tabs);
  const hasRenderableTab = visibleGroup.tabIds.some(id => tabIds.has(id));
  if (hasRenderableTab) return { layoutState, addedTabToPane: null };

  // Single-pane only: safe to assign tabs[0]
  const fallback = tabs[0];
  const newLayout = addTabToGroup(layoutState, fallback, visibleGroup.id);
  return { layoutState: newLayout, addedTabToPane: visibleGroup.id };
}

// FIX #5: closingRef is now a counter
function simulateFillEmptyEffect(
  layoutState: LayoutState,
  tabs: string[],
  closingRef: { current: number },
): { layoutState: LayoutState; newTabs: string[] } {
  if (closingRef.current > 0) {
    closingRef.current--;
    return { layoutState, newTabs: [] };
  }
  const panes = allPanes(layoutState);
  if (panes.length <= 1) return { layoutState, newTabs: [] };
  const emptyGroups = panes.filter(g => g.tabIds.length === 0);
  if (emptyGroups.length === 0) return { layoutState, newTabs: [] };

  const newTabs: string[] = [];
  let state = layoutState;
  for (const group of emptyGroups) {
    const newTabId = `auto_${uid()}`;
    newTabs.push(newTabId);
    state = addTabToGroup(state, newTabId, group.id);
  }
  return { layoutState: state, newTabs };
}

// ============================================================
// Helpers
// ============================================================

function getTabLocations(state: LayoutState, tabId: string): string[] {
  return allPanes(state).filter(p => p.tabIds.includes(tabId)).map(p => p.id);
}

let _pass = 0, _fail = 0;
function assert(condition: boolean, label: string) {
  if (condition) { _pass++; console.log(`  [PASS] ${label}`); }
  else { _fail++; console.error(`  [FAIL] ${label}`); }
}

function assertNoDuplicateTabs(state: LayoutState, label: string) {
  const tabToPanes = new Map<string, string[]>();
  for (const pane of allPanes(state)) {
    for (const tabId of pane.tabIds) {
      if (!tabToPanes.has(tabId)) tabToPanes.set(tabId, []);
      tabToPanes.get(tabId)!.push(pane.id);
    }
  }
  const dupes = [...tabToPanes.entries()].filter(([_, p]) => p.length > 1);
  assert(dupes.length === 0, `${label}: no duplicate tabs`);
  if (dupes.length > 0) dupes.forEach(([t, p]) => console.error(`    "${t}" in [${p.join(', ')}]`));
}

function assertActivePaneExists(state: LayoutState, label: string) {
  const found = allPanes(state).find(p => p.id === state.activePaneId);
  assert(!!found, `${label}: activePaneId exists`);
}

function assertSizesValid(state: LayoutState, label: string) {
  const colSum = state.sizes.reduce((a, b) => a + b, 0);
  const rowsOk = state.columns.every(c => c.sizes.reduce((a, b) => a + b, 0) === 100);
  assert(colSum === 100 && rowsOk, `${label}: sizes sum to 100`);
}

function printState(state: LayoutState, tabs: string[] = []) {
  for (const col of state.columns) {
    for (const pane of col.panes) {
      const m = pane.id === state.activePaneId ? ' (ACTIVE)' : '';
      console.log(`    col[${col.id}] pane[${pane.id}]${m}: tabs=[${pane.tabIds.join(',')}]`);
    }
  }
  if (tabs.length) console.log(`  tabs: [${tabs.join(', ')}]`);
}

// ============================================================
// TESTS
// ============================================================

function test_cmdD_no_duplication() {
  console.log('\n=== FIX #1: Cmd+D no longer duplicates tabs ===');
  resetUid();
  const pane1 = makePane(['tabA', 'tabB', 'tabC']);
  let layout: LayoutState = { columns: [makeColumn([pane1])], sizes: [100], activePaneId: pane1.id };
  const tabs = ['tabA', 'tabB', 'tabC'];

  layout = addColumn(layout);
  const closingRef = { current: 0 };

  // Invariant effect: should SKIP in multi-pane mode
  const inv = simulateInvariantEffect(layout, tabs);
  assert(inv.addedTabToPane === null, 'Invariant effect skips in multi-pane mode');
  layout = inv.layoutState;

  // Fill-empty effect: creates a new tab
  const fill = simulateFillEmptyEffect(layout, tabs, closingRef);
  layout = fill.layoutState;
  tabs.push(...fill.newTabs);

  printState(layout, tabs);
  assertNoDuplicateTabs(layout, 'After Cmd+D');
  assert(fill.newTabs.length === 1, 'Fill-empty created exactly 1 new tab');
}

function test_removeTabFromGroup_scoped() {
  console.log('\n=== FIX #2: removeTabFromGroup only removes from one pane ===');
  resetUid();
  const pane1 = makePane(['tabA', 'tabB']);
  const pane2 = makePane(['tabA', 'tabC']); // tabA in both (hypothetical legacy state)
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2])], sizes: [50, 50], activePaneId: pane2.id };

  // Remove from pane2 specifically
  const result = removeTabFromGroup(layout, 'tabA', pane2.id);
  layout = result.state;

  const loc = getTabLocations(layout, 'tabA');
  assert(loc.length === 1, 'tabA only removed from target pane, still in pane1');
  assert(loc[0] === pane1.id, 'tabA remains in pane1');
}

function test_addTabToGroup_deduplicates() {
  console.log('\n=== FIX #3: addTabToGroup strips from other panes ===');
  resetUid();
  const pane1 = makePane(['tabA', 'tabB']);
  const pane2 = makePane(['tabC']);
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2])], sizes: [50, 50], activePaneId: pane1.id };

  layout = addTabToGroup(layout, 'tabA', pane2.id);

  const loc = getTabLocations(layout, 'tabA');
  assert(loc.length === 1, 'tabA in exactly 1 pane after addTabToGroup');
  assert(loc[0] === pane2.id, 'tabA moved to pane2');
  assertNoDuplicateTabs(layout, 'After cross-pane add');
}

function test_invariant_single_pane_still_works() {
  console.log('\n=== FIX #4: Invariant effect still works in single-pane mode ===');
  resetUid();
  const pane1 = makePane([]); // empty pane
  let layout: LayoutState = { columns: [makeColumn([pane1])], sizes: [100], activePaneId: pane1.id };
  const tabs = ['tabA'];

  const result = simulateInvariantEffect(layout, tabs);
  layout = result.layoutState;

  assert(result.addedTabToPane === pane1.id, 'Invariant adds tab in single-pane mode');
  const loc = getTabLocations(layout, 'tabA');
  assert(loc.length === 1, 'tabA in exactly 1 pane');
}

function test_closingRef_counter() {
  console.log('\n=== FIX #5: closingRef counter handles rapid closes ===');
  resetUid();
  const pane1 = makePane(['tabA', 'tabB']);
  const pane2 = makePane(['tabC']);
  const pane3 = makePane(['tabD']);
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2]), makeColumn([pane3])], sizes: equalSizes(3), activePaneId: pane2.id };
  let tabs = ['tabA', 'tabB', 'tabC', 'tabD'];
  const closingRef = { current: 0 };

  // Two rapid closes
  closingRef.current++;
  let r = removeTabFromGroup(layout, 'tabC');
  layout = r.state; tabs = tabs.filter(t => t !== 'tabC');
  layout = collapseGroup(layout, r.groupId);

  closingRef.current++;
  r = removeTabFromGroup(layout, 'tabD');
  layout = r.state; tabs = tabs.filter(t => t !== 'tabD');
  layout = collapseGroup(layout, r.groupId);

  assert(closingRef.current === 2, 'Counter is 2 after 2 closes');

  // First effect run: decrements, skips
  simulateFillEmptyEffect(layout, tabs, closingRef);
  assert(closingRef.current === 1, 'Counter decremented to 1');

  // Second effect run: decrements again, skips
  simulateFillEmptyEffect(layout, tabs, closingRef);
  assert(closingRef.current === 0, 'Counter decremented to 0');

  // Third effect run: counter is 0, normal behavior
  const fill = simulateFillEmptyEffect(layout, tabs, closingRef);
  assert(fill.newTabs.length === 0, 'No spurious tabs created (single pane, no empties)');
}

function test_splitGrid_cloned() {
  console.log('\n=== FIX #6: splitGrid clones panes and validates activePaneId ===');
  resetUid();
  const pane1 = makePane(['tabA']);
  const pane2 = makePane(['tabB']);
  const pane3 = makePane(['tabC']);
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2]), makeColumn([pane3])], sizes: equalSizes(3), activePaneId: pane3.id };

  layout = splitGrid(layout);

  const panes = allPanes(layout);
  const ids = panes.map(p => p.id);
  assert(new Set(ids).size === ids.length, 'All pane IDs unique after grid');
  assertActivePaneExists(layout, 'Grid');
  assertSizesValid(layout, 'Grid');
}

function test_view_tab_singleton_safe() {
  console.log('\n=== FIX #7: Singleton view tabs safe in multi-pane ===');
  resetUid();
  const pane1 = makePane(['view:settings', 'chat:1']);
  const pane2 = makePane([]); // Empty after Cmd+D
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2])], sizes: [50, 50], activePaneId: pane2.id };
  const tabs = ['view:settings', 'chat:1'];

  // Invariant should NOT fire in multi-pane
  const inv = simulateInvariantEffect(layout, tabs);
  assert(inv.addedTabToPane === null, 'Invariant skips multi-pane (no view:settings duplication)');

  // Fill-empty creates a new tab instead
  const closingRef = { current: 0 };
  const fill = simulateFillEmptyEffect(layout, tabs, closingRef);
  layout = fill.layoutState;

  assertNoDuplicateTabs(layout, 'Settings tab not duplicated');
  const loc = getTabLocations(layout, 'view:settings');
  assert(loc.length === 1, 'view:settings in exactly 1 pane');
}

function test_collapse_middle_column() {
  console.log('\n=== EDGE: Collapse middle column ===');
  resetUid();
  const pane1 = makePane(['tabA']);
  const pane2 = makePane(['tabB']);
  const pane3 = makePane(['tabC']);
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2]), makeColumn([pane3])], sizes: equalSizes(3), activePaneId: pane2.id };

  const r = removeTabFromGroup(layout, 'tabB');
  layout = r.state;
  layout = collapseGroup(layout, r.groupId);

  assert(layout.columns.length === 2, 'Reduced to 2 columns');
  assertActivePaneExists(layout, 'After middle collapse');
  assertSizesValid(layout, 'After middle collapse');
}

function test_collapse_to_zero() {
  console.log('\n=== EDGE: Collapse to zero then fallback ===');
  resetUid();
  const pane1 = makePane(['tabA']);
  const pane2 = makePane(['tabB']);
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2])], sizes: [50, 50], activePaneId: pane1.id };

  let r = removeTabFromGroup(layout, 'tabA');
  layout = r.state; layout = collapseGroup(layout, r.groupId);
  r = removeTabFromGroup(layout, 'tabB');
  layout = r.state; layout = collapseGroup(layout, r.groupId);

  assert(allPanes(layout).length >= 1, 'Fallback pane created');
  assertActivePaneExists(layout, 'After total collapse');
}

function test_split_close_split_cycle() {
  console.log('\n=== EDGE: Split-close-split cycle integrity ===');
  resetUid();
  const pane1 = makePane(['tabA']);
  let layout: LayoutState = { columns: [makeColumn([pane1])], sizes: [100], activePaneId: pane1.id };
  let tabs = ['tabA'];
  const closingRef = { current: 0 };

  // Split
  layout = addColumn(layout);
  let fill = simulateFillEmptyEffect(layout, tabs, closingRef);
  layout = fill.layoutState; tabs.push(...fill.newTabs);

  // Close new pane's tab
  closingRef.current++;
  const r = removeTabFromGroup(layout, fill.newTabs[0]);
  layout = r.state; tabs = tabs.filter(t => t !== fill.newTabs[0]);
  layout = collapseGroup(layout, r.groupId);
  simulateFillEmptyEffect(layout, tabs, closingRef); // consumed by closingRef

  // Split again
  layout = addColumn(layout);
  fill = simulateFillEmptyEffect(layout, tabs, closingRef);
  layout = fill.layoutState; tabs.push(...fill.newTabs);

  assertNoDuplicateTabs(layout, 'After split-close-split');
  assertActivePaneExists(layout, 'After split-close-split');
  assertSizesValid(layout, 'After split-close-split');
}

function test_move_then_collapse() {
  console.log('\n=== EDGE: Move tab then collapse empty source ===');
  resetUid();
  const pane1 = makePane(['tabA']);
  const pane2 = makePane(['tabB']);
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2])], sizes: [50, 50], activePaneId: pane1.id };

  layout = moveTabToGroup(layout, 'tabA', pane1.id, pane2.id);
  layout = collapseGroup(layout, pane1.id);

  assert(layout.columns.length === 1, 'Collapsed to 1 column');
  assert(getTabLocations(layout, 'tabA').length === 1, 'tabA in exactly 1 pane');
  assertActivePaneExists(layout, 'After move + collapse');
}

function test_resetToSingle_deduplicates() {
  console.log('\n=== EDGE: resetToSingle deduplicates ===');
  resetUid();
  // Simulate legacy state with tabA in 2 panes
  const pane1 = makePane(['tabA', 'tabB']);
  const pane2 = makePane(['tabA', 'tabC']);
  let layout: LayoutState = { columns: [makeColumn([pane1]), makeColumn([pane2])], sizes: [50, 50], activePaneId: pane1.id };

  layout = resetToSingle(layout);

  const pane = allPanes(layout)[0];
  assert(pane.tabIds.filter(t => t === 'tabA').length === 1, 'tabA appears once after merge');
  assert(pane.tabIds.length === 3, 'All 3 unique tabs preserved');
}

function test_sizes_stress() {
  console.log('\n=== EDGE: Size consistency after many operations ===');
  resetUid();
  const pane1 = makePane(['tabA']);
  let layout: LayoutState = { columns: [makeColumn([pane1])], sizes: [100], activePaneId: pane1.id };

  for (let i = 0; i < 5; i++) layout = addColumn(layout);
  assertSizesValid(layout, '6 columns');

  layout = { ...layout, activePaneId: layout.columns[2].panes[0].id };
  for (let i = 0; i < 3; i++) layout = addRow(layout);
  assertSizesValid(layout, '6 cols, 4 rows in col3');

  layout = collapseGroup(layout, layout.columns[3].panes[0].id);
  assertSizesValid(layout, 'After collapse');
}

// ============================================================
// RUN
// ============================================================

console.log('================================================================');
console.log('  Window Management Post-Fix Verification');
console.log('================================================================');

test_cmdD_no_duplication();
test_removeTabFromGroup_scoped();
test_addTabToGroup_deduplicates();
test_invariant_single_pane_still_works();
test_closingRef_counter();
test_splitGrid_cloned();
test_view_tab_singleton_safe();
test_collapse_middle_column();
test_collapse_to_zero();
test_split_close_split_cycle();
test_move_then_collapse();
test_resetToSingle_deduplicates();
test_sizes_stress();

console.log(`\n================================================================`);
console.log(`  Results: ${_pass} passed, ${_fail} failed`);
console.log(`================================================================`);
if (_fail > 0) process.exit(1);
