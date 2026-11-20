import { cardAt } from "../lib/ui";
import type { Rect } from "./motion";

/**
 * Where a title sheet grows from: the poster (or other art) a finger just tapped. The phone shell's own art
 * carries `data-origin` on the box that should grow; the shared screens' cards are found as the big screens
 * find them (`cardAt`).
 */
export type Origin = Rect & { src?: string; el?: HTMLElement; radius: number };

/** A tap this recent opened the sheet that comes next. */
const FRESH_MS = 900;
let last: { origin: Origin; at: number } | undefined;

function originOf(target: Element | null): Origin | undefined {
  const own = target?.closest<HTMLElement>("[data-origin]");
  if (own) {
    const r = own.getBoundingClientRect();
    if (r.width <= 0) return undefined;
    const img = own.querySelector("img");
    const loaded = img?.complete && img.naturalWidth > 0 ? img : undefined;
    return {
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
      src: loaded ? loaded.currentSrc || loaded.src : undefined,
      el: own,
      // The corners it's drawn with (the sheet lands on exactly these), else the ones it says.
      radius: parseFloat(getComputedStyle(own).borderTopLeftRadius) || Number(own.dataset.origin) || 4,
    };
  }
  const card = cardAt(target);
  return card ? { x: card.x, y: card.y, w: card.w, h: card.h, src: card.src, el: card.el, radius: card.radius ?? 6 } : undefined;
}

/** Notes every tap's art, for the sheet it opens. */
export function watchOrigins() {
  const onClick = (e: MouseEvent) => {
    const origin = originOf(e.target instanceof Element ? e.target : null);
    last = origin ? { origin, at: performance.now() } : undefined;
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

/** The art just tapped, once: the sheet opening now grows out of it. */
export function takeOrigin(): Origin | undefined {
  const fresh = last && performance.now() - last.at < FRESH_MS ? last.origin : undefined;
  last = undefined;
  return fresh;
}

/**
 * Where `origin` is now, for closing back into it: the row may have scrolled under the sheet. Undefined when
 * it's gone or off the screen, and the sheet just slides away instead.
 */
export function liveOrigin(origin: Origin | undefined): Origin | undefined {
  if (!origin?.el?.isConnected) return undefined;
  const r = origin.el.getBoundingClientRect();
  if (r.width <= 0 || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return undefined;
  return { ...origin, x: r.left, y: r.top, w: r.width, h: r.height };
}
