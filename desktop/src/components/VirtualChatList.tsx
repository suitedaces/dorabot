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
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);

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

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setScrollTop(viewport.scrollTop);
    const distanceFromBottom = layout.total - (viewport.scrollTop + viewport.clientHeight);
    nearBottomRef.current = distanceFromBottom <= bottomThresholdPx;
  }, [bottomThresholdPx, layout.total]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      setViewportHeight(viewport.clientHeight);
      onScroll();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [onScroll]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !nearBottomRef.current) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: scrollBehavior });
    onScrollBehaviorConsumed?.();
  }, [items.length, layout.total, onScrollBehaviorConsumed, scrollBehavior]);

  const measureRow = useCallback((index: number, element: HTMLDivElement | null) => {
    if (!element) return;
    const height = Math.ceil(element.getBoundingClientRect().height);
    const prev = heightsRef.current.get(index);
    if (prev === height) return;
    heightsRef.current.set(index, Math.max(20, height));
    setMeasureVersion(v => v + 1);
  }, []);

  return (
    <div
      ref={viewportRef}
      className={className || 'flex-1 overflow-auto'}
      onScroll={onScroll}
    >
      <div style={{ position: 'relative', height: `${layout.total}px` }}>
        {items.slice(visibleRange.start, visibleRange.end).map((item, offset) => {
          const index = visibleRange.start + offset;
          return (
            <div
              key={index}
              ref={(el) => measureRow(index, el)}
              className={itemClassName}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${layout.offsets[index]}px`,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
