import { useEffect, useState } from "react";

/** Whether `el`'s text runs past its box (a line clamp cut it off). Hidden or not laid out: no. */
export function isClamped(el: HTMLElement | null): boolean {
  if (!el) return false;
  return el.scrollHeight > el.clientHeight + 1;
}

/**
 * Whether the text `find` returns is cut off, measured after layout and again when the box changes size or the
 * fonts arrive (a "More" shows only when there is more). `key` is the text: a new one measures afresh.
 */
export function useClamped(find: () => HTMLElement | null, key: unknown): boolean {
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = find();
    const check = () => setClamped(isClamped(el));
    check();
    if (!el) return;
    let live = true;
    void document.fonts?.ready.then(() => live && check());
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => {
      live = false;
      ro?.disconnect();
    };
    // `find` is new each render; what it finds follows `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return clamped;
}
