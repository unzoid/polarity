import { on, type Unlisten } from "./bridge";

/**
 * iOS's Back: a finger swiping in from the screen's left edge (src-tauri/src/ios/back.m). iOS's own recognizer
 * sees it, so it wins over the page's scrolling as in iOS's apps, and reports every step of it: `begin` once the
 * finger has moved in from the edge, `move` as it goes, then `end` when it lifts or `cancel`. `x` is how far it has
 * come and `width` the web view's, both in CSS pixels; `velocity` is in CSS pixels a second, rightwards positive.
 */
export type BackSwipe = { phase: "begin" | "move" | "end" | "cancel"; x: number; width: number; velocity: number };

/** A flick: lifted while still moving this fast (px/s), at least FLICK_MIN_PX in. */
export const FLICK_SPEED = 500;
export const FLICK_MIN_PX = 30;

/** Whether a swipe that ends here goes back, as iOS's own does: past half the width, or flicked; flicked back left, never. */
export function swipeGoesBack({ x, width, velocity }: Pick<BackSwipe, "x" | "width" | "velocity">): boolean {
  if (velocity <= -FLICK_SPEED) return false;
  return x >= width / 2 || (x >= FLICK_MIN_PX && velocity >= FLICK_SPEED);
}

/** Hear the swipe's steps until the returned function is called. */
export function onBackSwipe(handler: (swipe: BackSwipe) => void): Promise<Unlisten> {
  return on<BackSwipe>("native://back-swipe", handler);
}
