import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Props<T> = {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  itemClassName?: string;
  estimateItemHeight?: number;
  overscanPx?: number;
  bottomThresholdPx?: number;
  scrollBehavior?: ScrollBehavior;
  onScrollBehaviorConsumed?: () => void;
};

export function VirtualChatList<T>({
  items,
  renderItem,
  className,
  itemClassName,
  estimateItemHeight = 88,
  overscanPx = 420,
  bottomThresholdPx = 140,
  scrollBehavior = 'auto',
  onScrollBehaviorConsumed,
}: Props<T>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef<Map<number, number>>(new Map());
  const nearBottomRef = useRef(true);
  const measureRafRef = useRef<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const rowRefs = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);

  const queueMeasureRecalc = useCallback(() => {
    if (measureRafRef.current !== null) return;
    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = null;
      setMeasureVersion(v => v + 1);
    });
  }, []);

  const updateHeight = useCallback((index: number, element: HTMLDivElement) => {
    const height = Math.ceil(element.getBoundingClientRect().height);
    const prev = heightsRef.current.get(index);
    if (prev === height) return;
    heightsRef.current.set(index, height);
    queueMeasureRecalc();
  }, [queueMeasureRecalc]);

  // Single ResizeObserver for all row elements
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement;
        const idx = Number(el.dataset.virtualIndex);
        if (!isNaN(idx)) {
          const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height);
          const prev = heightsRef.current.get(idx);
          if (prev !== height && height > 0) {
            heightsRef.current.set(idx, height);
            queueMeasureRecalc();
          }
          // rows sit in normal flow, so a row that grows pushes the scroll height in the same
          // frame. keep the bottom pinned now instead of on the next items change.
          if (nearBottomRef.current && viewportRef.current) {
            viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
          }
        }
      }
    });
    observerRef.current = ro;
    return () => {
      ro.disconnect();
      if (measureRafRef.current !== null) {
        cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
    };
  }, [queueMeasureRecalc]);

  const layout = useMemo(() => {
    const heights: number[] = new Array(items.length);
    const offsets: number[] = new Array(items.length);
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      offsets[i] = total;
      const h = heightsRef.current.get(i) ?? estimateItemHeight;
      heights[i] = h;
      total += h;
    }
    return { heights, offsets, total };
  }, [items.length, estimateItemHeight, measureVersion]);

  const visibleRange = useMemo(() => {
    if (items.length === 0) return { start: 0, end: 0 };
    const minY = Math.max(0, scrollTop - overscanPx);
    const maxY = scrollTop + viewportHeight + overscanPx;

    let start = 0;
    while (start < items.length) {
      const top = layout.offsets[start];
      const bottom = top + layout.heights[start];
      if (bottom >= minY) break;
      start += 1;
    }

    let end = start;
    while (end < items.length) {
      const top = layout.offsets[end];
      if (top > maxY) break;
      end += 1;
    }
    return { start, end };
  }, [items.length, layout.heights, layout.offsets, overscanPx, scrollTop, viewportHeight]);

  const topSpacer = items.length ? layout.offsets[visibleRange.start] ?? 0 : 0;
  const lastRendered = visibleRange.end - 1;
  const bottomSpacer = lastRendered >= visibleRange.start
    ? Math.max(0, layout.total - (layout.offsets[lastRendered] + layout.heights[lastRendered]))
    : 0;

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextScrollTop = viewport.scrollTop;
    setScrollTop(prev => (prev === nextScrollTop ? prev : nextScrollTop));
    const distanceFromBottom = viewport.scrollHeight - (nextScrollTop + viewport.clientHeight);
    nearBottomRef.current = distanceFromBottom <= bottomThresholdPx;
  }, [bottomThresholdPx]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const nextHeight = viewport.clientHeight;
      setViewportHeight(prev => (prev === nextHeight ? prev : nextHeight));
      onScroll();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [onScroll]);

  // Auto-scroll to bottom when near bottom and items change
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !nearBottomRef.current) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: scrollBehavior });
    onScrollBehaviorConsumed?.();
  }, [items, onScrollBehaviorConsumed, scrollBehavior]);

  // Ensure we start at the bottom on initial mount
  const initialScrollDoneRef = useRef(false);
  const hasItems = items.length > 0;
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport || !hasItems) return;
    let inner: number;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
        nearBottomRef.current = true;
        initialScrollDoneRef.current = true;
      });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [hasItems]);

  // one stable ref per index: an inline ref re-detaches and re-observes every row on every render
  const rowRef = (index: number) => {
    let ref = rowRefs.current.get(index);
    if (!ref) {
      ref = (el: HTMLDivElement | null) => attachRow(index, el);
      rowRefs.current.set(index, ref);
    }
    return ref;
  };

  const attachRow = useCallback((index: number, el: HTMLDivElement | null) => {
    const ro = observerRef.current;
    if (!ro) return;

    // Unobserve old element for this index
    const prev = observedRef.current.get(index);
    if (prev && prev !== el) {
      ro.unobserve(prev);
      observedRef.current.delete(index);
    }

    if (!el) return;

    // Tag element with index for the ResizeObserver callback
    el.dataset.virtualIndex = String(index);
    observedRef.current.set(index, el);
    ro.observe(el);

    // Initial measurement
    updateHeight(index, el);
  }, [updateHeight]);

  return (
    <div
      ref={viewportRef}
      className={className || 'flex-1 overflow-auto'}
      onScroll={onScroll}
    >
      {/* rendered rows stay in normal flow between two spacers, so a row that changes height
          moves the rows below it in the same frame instead of a frame later */}
      <div style={{ height: `${topSpacer}px` }} />
      {items.slice(visibleRange.start, visibleRange.end).map((item, offset) => {
        const index = visibleRange.start + offset;
        return (
          <div key={index} ref={rowRef(index)} className={itemClassName}>
            {renderItem(item, index)}
          </div>
        );
      })}
      <div style={{ height: `${bottomSpacer}px` }} />
    </div>
  );
}
