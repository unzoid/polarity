import { useEffect, useState } from "react";

/** Whether `el`'s text runs past its box (a line clamp cut it off). Hidden or not laid out: no. */
export function isClamped(el: HTMLElement | null): boolean {
  if (!el) return false;
  return el.scrollHeight > el.clientHeight + 1;
}

const listeners = new Map<Element, () => void>();
let sharedRo: ResizeObserver | null | undefined;

function observeResize(el: Element, fn: () => void): () => void {
  if (sharedRo === undefined) {
    sharedRo =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            for (const e of entries) listeners.get(e.target)?.();
          });
  }
  if (!sharedRo) return () => {};
  listeners.set(el, fn);
  sharedRo.observe(el);
  return () => {
    listeners.delete(el);
    sharedRo?.unobserve(el);
  };
}

/**
 * Whether the text `find` returns is cut off, measured after layout and again when the box changes size or the
 * fonts arrive (a "More" shows only when there is more). `key` is the text: a new one measures afresh.
 */
export function useClamped(find: () => HTMLElement | null, key: unknown): boolean {
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = find();
    const check = () => {
      const next = isClamped(el);
      setClamped((prev) => (prev === next ? prev : next));
    };
    check();
    if (!el) return;
    let live = true;
    void document.fonts?.ready.then(() => live && check());
    const unobserve = observeResize(el, check);
    return () => {
      live = false;
      unobserve();
    };
    // `find` is new each render; what it finds follows `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return clamped;
}
