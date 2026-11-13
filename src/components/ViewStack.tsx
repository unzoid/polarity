import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * A panel with views that replace each other in place: the profile menu (its Friends and Join views) and
 * the party menu (its settings). Styles in base.css (`.fit-height`, `[data-slide]`).
 */

/** Its content's height, changing with it: the panel grows and shrinks between views instead of jumping. */
export function FitHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="fit-height" style={{ height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/**
 * How the view coming in slides, for its `data-slide`: "forward" from the right, "back" (to `home`) from the
 * left. Only a change of view inside the open panel slides; on opening, the panel's own entrance is the motion.
 */
export function useViewSlide<V extends string>(open: boolean, view: V, home: V): "forward" | "back" | undefined {
  const [seen, setSeen] = useState({ open, view, slide: false });
  const slide = seen.open === open && seen.view === view ? seen.slide : seen.open && open && seen.view !== view;
  if (seen.open !== open || seen.view !== view) setSeen({ open, view, slide });
  return slide ? (view === home ? "back" : "forward") : undefined;
}

/**
 * Escape inside a view past the first goes back a view instead of closing the panel. Only from inside the view
 * itself: a menu opened from it (in its own portal) closes first.
 */
export function backOnEscape(back: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    back();
  };
}
