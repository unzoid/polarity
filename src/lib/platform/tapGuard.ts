import { SLOP_PX } from "./longPress";

/**
 * Only a deliberate tap opens something (#459). WebKit and Android's web view still send a click for a touch
 * that drifted a little while scrolling, and for a tap that stopped a list gliding on after a fling, so a
 * title opened on its own mid-scroll. Neither is a tap: the click such a touch makes is swallowed. Long
 * presses (`contextmenu`), mice and the TV remote (no touch) are untouched.
 */

/** A list that scrolled this recently (ms) is still moving: a touch then stops it, nothing more. */
export const MOVING_MS = 100;
/** How long a list may glide on after the finger that flung it lifts (ms): its scrolling still counts as the user's. */
export const GLIDE_MS = 3000;
/** How soon after the finger lifts its click comes (ms); a click later than that isn't this touch's. */
export const CLICK_MS = 600;

/**
 * Guard `target`'s clicks until the returned function is called. `now` is the clock (tests pass their own).
 * Only scrolling the user started counts as a moving list, so a carousel turning by itself never eats a tap.
 */
export function guardTaps(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  now: () => number = () => performance.now(),
): () => void {
  let from: { x: number; y: number } | null = null;
  let deliberate = true;
  /** This touch dragged (a scroll, maybe a fling): what scrolls after it is the user's. */
  let moved = false;
  let touching = false;
  let flungAt = -Infinity;
  let scrolledAt = -Infinity;
  let swallowUntil = -Infinity;

  const start = (e: TouchEvent) => {
    const t = e.touches[0];
    touching = true;
    moved = false;
    from = null;
    swallowUntil = -Infinity;
    if (!t || e.touches.length > 1) {
      deliberate = false;
      return;
    }
    from = { x: t.clientX, y: t.clientY };
    deliberate = now() - scrolledAt > MOVING_MS;
  };
  const move = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!from || !t || moved) return;
    if (e.touches.length > 1 || Math.hypot(t.clientX - from.x, t.clientY - from.y) > SLOP_PX) {
      moved = true;
      deliberate = false;
    }
  };
  const end = () => {
    touching = false;
    from = null;
    if (moved) flungAt = now();
    if (!deliberate) swallowUntil = now() + CLICK_MS;
  };
  const scroll = () => {
    if (touching || now() - flungAt < GLIDE_MS) scrolledAt = now();
  };
  const click = (e: Event) => {
    // A click from the keyboard or the remote has no pointer behind it (detail 0).
    if (now() > swallowUntil || (e as MouseEvent).detail === 0) return;
    swallowUntil = -Infinity;
    e.preventDefault();
    e.stopPropagation();
  };

  const passive = { passive: true, capture: true };
  const listeners = [
    ["touchstart", start, passive],
    ["touchmove", move, passive],
    ["touchend", end, passive],
    ["touchcancel", end, passive],
    // Scroll doesn't bubble: heard on the way down, from any list.
    ["scroll", scroll, passive],
    ["click", click, { capture: true }],
  ] as const;
  for (const [type, fn, opts] of listeners) target.addEventListener(type, fn as EventListener, opts);
  return () => {
    for (const [type, fn, opts] of listeners) target.removeEventListener(type, fn as EventListener, opts);
  };
}
