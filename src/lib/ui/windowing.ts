import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const SCROLLER_SELECTOR = ".dk-dlg-content, .ps-content, .scroll, .dk-scroll, .ph-scroll";

/**
 * Virtualizes a horizontal flex list (`<ol>`/`<div>` with uniform item widths + flex `gap`) when
 * `count > threshold`. Keeps exact total scrollWidth and item positions using zero-cost leading/trailing
 * spacers so scrolling, scrollbar proportions, and `upNext` initial positioning are indistinguishable
 * from rendering every item in the DOM.
 */
export function useHorizontalWindow(
  ref: RefObject<HTMLElement | null>,
  count: number,
  {
    initialIndex = 0,
    estimateWidth = 230,
    estimateGap = 12,
    overscan = 6,
    threshold = 24,
  }: {
    initialIndex?: number;
    estimateWidth?: number;
    estimateGap?: number;
    overscan?: number;
    threshold?: number;
  } = {},
) {
  const active = count > threshold;
  const clampedInit = Math.max(0, Math.min(count - 1, initialIndex));
  const [metrics, setMetrics] = useState({ width: estimateWidth, gap: estimateGap });
  const [range, setRange] = useState(() => {
    if (!active) return { start: 0, end: count };
    const start = Math.max(0, clampedInit - overscan);
    const end = Math.min(count, Math.max(clampedInit + overscan + 8, overscan * 2 + 8));
    return { start, end };
  });

  // Reset range when the episode list length changes significantly (e.g. season switch without remount).
  const prevCount = useRef(count);
  if (prevCount.current !== count) {
    prevCount.current = count;
    if (!active) {
      if (range.start !== 0 || range.end !== count) setRange({ start: 0, end: count });
    } else {
      const start = Math.max(0, clampedInit - overscan);
      const end = Math.min(count, Math.max(clampedInit + overscan + 8, overscan * 2 + 8));
      if (range.start !== start || range.end !== end) setRange({ start, end });
    }
  }

  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  const updateRange = useCallback(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const { width, gap } = metricsRef.current;
    const stride = Math.max(1, width + gap);
    const visStart = Math.floor(el.scrollLeft / stride);
    const visCount = Math.ceil((el.clientWidth || 900) / stride);
    const nextStart = Math.max(0, visStart - overscan);
    const nextEnd = Math.min(count, visStart + visCount + overscan);
    setRange((prev) => {
      if (prev.start === nextStart && prev.end === nextEnd) return prev;
      // Avoid tiny 1-card churn while smoothly gliding, unless hitting an edge or moving >= 2 cards.
      if (
        nextStart > 0 &&
        nextEnd < count &&
        Math.abs(prev.start - nextStart) < 2 &&
        Math.abs(prev.end - nextEnd) < 2
      ) {
        return prev;
      }
      return { start: nextStart, end: nextEnd };
    });
  }, [active, count, overscan, ref]);

  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const sample = el.querySelector<HTMLElement>(":scope > :not([data-spacer])");
    if (sample) {
      const w = sample.offsetWidth;
      const cs = getComputedStyle(el);
      const g = parseFloat(cs.columnGap || cs.gap) || estimateGap;
      if (w > 0 && (Math.abs(w - metricsRef.current.width) > 1 || Math.abs(g - metricsRef.current.gap) > 0.5)) {
        metricsRef.current = { width: w, gap: g };
        setMetrics({ width: w, gap: g });
      }
    }
    updateRange();
  }, [active, estimateGap, ref, updateRange]);

  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (!active || rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      updateRange();
    });
  }, [active, updateRange]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  if (!active) {
    return { active: false, start: 0, end: count, leadPx: 0, trailPx: 0, onScroll };
  }
  const stride = metrics.width + metrics.gap;
  const start = Math.min(range.start, count);
  const end = Math.min(range.end, count);
  const leadPx = start > 0 ? Math.max(0, Math.round(start * stride - metrics.gap)) : 0;
  const trailPx = end < count ? Math.max(0, Math.round((count - end) * stride - metrics.gap)) : 0;
  return { active: true, start, end, leadPx, trailPx, onScroll };
}

/**
 * Virtualizes a tall vertical list (`<ol>`) inside its nearest scrolling ancestor when `count > threshold`.
 * Measures the first batch of rendered rows once to calibrate average row height and uses aria-hidden
 * top/bottom spacer `<li>` items so the list keeps its exact CSS padding and scrollbar proportions.
 */
export function useVerticalWindow(
  listRef: RefObject<HTMLElement | null>,
  count: number,
  {
    estimateRowHeight = 132,
    overscan = 8,
    threshold = 24,
  }: {
    estimateRowHeight?: number;
    overscan?: number;
    threshold?: number;
  } = {},
) {
  const active = count > threshold;
  const rowHRef = useRef(estimateRowHeight);
  const [range, setRange] = useState(() =>
    active ? { start: 0, end: Math.min(count, overscan * 2 + 8) } : { start: 0, end: count },
  );

  const prevCount = useRef(count);
  if (prevCount.current !== count) {
    prevCount.current = count;
    const nextEnd = active ? Math.min(count, overscan * 2 + 8) : count;
    if (range.start !== 0 || range.end !== nextEnd) setRange({ start: 0, end: nextEnd });
  }

  useEffect(() => {
    if (!active) return;
    const list = listRef.current;
    if (!list) return;
    const scroller = list.closest<HTMLElement>(SCROLLER_SELECTOR);
    if (!scroller) return;

    // Calibrate average row height from the rendered items once.
    const rows = list.querySelectorAll<HTMLElement>(":scope > :not([data-spacer])");
    if (rows.length >= 4) {
      let sum = 0;
      const n = Math.min(rows.length, 10);
      for (let i = 0; i < n; i++) sum += rows[i].offsetHeight;
      const avg = sum / n;
      if (avg > 40) rowHRef.current = avg;
    }

    let raf = 0;
    const compute = () => {
      raf = 0;
      const listRect = list.getBoundingClientRect();
      const scRect = scroller.getBoundingClientRect();
      const listTopInScroll = listRect.top - scRect.top + scroller.scrollTop;
      const relTop = Math.max(0, scroller.scrollTop - listTopInScroll);
      const rowH = Math.max(40, rowHRef.current);
      const visStart = Math.floor(relTop / rowH);
      const visCount = Math.ceil((scroller.clientHeight || 800) / rowH);
      const nextStart = Math.max(0, visStart - overscan);
      const nextEnd = Math.min(count, visStart + visCount + overscan);
      setRange((prev) => {
        if (prev.start === nextStart && prev.end === nextEnd) return prev;
        if (
          nextStart > 0 &&
          nextEnd < count &&
          Math.abs(prev.start - nextStart) < 2 &&
          Math.abs(prev.end - nextEnd) < 2
        ) {
          return prev;
        }
        return { start: nextStart, end: nextEnd };
      });
    };

    compute();
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(scroller);
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [active, count, listRef, overscan]);

  if (!active) {
    return { active: false, start: 0, end: count, topPx: 0, bottomPx: 0 };
  }
  const rowH = rowHRef.current;
  const start = Math.min(range.start, count);
  const end = Math.min(range.end, count);
  return {
    active: true,
    start,
    end,
    topPx: Math.round(start * rowH),
    bottomPx: Math.round((count - end) * rowH),
  };
}
