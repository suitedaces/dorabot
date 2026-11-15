// lets a tool card open a specific research doc: the research view picks it up on mount or live
let pending: string | null = null;
const listeners = new Set<(id: string) => void>();

export function focusResearch(id: string) {
  pending = id;
  listeners.forEach(fn => fn(id));
}

export function takePendingResearch(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export function onResearchFocus(fn: (id: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
