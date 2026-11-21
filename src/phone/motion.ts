import { prefersReducedMotion } from "../lib/ui";

/**
 * The phone shell's motion, measured off 60 fps iPhone recordings of Netflix (frame by frame):
 * a title opening out of its poster follows a critically damped spring, ω ≈ 16.2 rad/s
 * (`1 − (1 + ωt)·e^(−ωt)`), the same at 183, 267 and 367 ms after the tap. Everything here is
 * sampled into Web Animations keyframes so it runs on the compositor, whatever the main thread
 * is doing (the sheet's content mounts while it opens).
 */
export const OPEN_OMEGA = 16.2;
/** Where the spring above is within half a percent of rest. */
export const OPEN_MS = 460;
/** Closing back into the poster: an ease-out (easeOutSamples) with a long, soft landing. */
export const CLOSE_TAU = 118;
export const CLOSE_MS = 620;

/** Progress of a critically damped spring released from rest, `t` in ms. */
export function spring(omega: number, t: number) {
  const u = (omega * t) / 1000;
  return 1 - (1 + u) * Math.exp(-u);
}

export type Rect = { x: number; y: number; w: number; h: number };

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const lerpRect = (a: Rect, b: Rect, p: number): Rect => ({
  x: lerp(a.x, b.x, p),
  y: lerp(a.y, b.y, p),
  w: lerp(a.w, b.w, p),
  h: lerp(a.h, b.h, p),
});

/** `n + 1` points in time over `ms`, with the spring's progress at each. */
export function samples(omega: number, ms: number, n = 36) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (ms * i) / n;
    return { offset: i / n, t, p: i === n ? 1 : spring(omega, t) };
  });
}

/**
 * An exponential ease-out over `ms` (time constant `tau` ms), normalised to land on 1: it leaves at speed and
 * spends its last third barely moving, so what it carries settles into place instead of arriving. Netflix's close
 * back into a poster moves this way.
 */
export function easeOutSamples(tau: number, ms: number, n = 40) {
  const end = 1 - Math.exp(-ms / tau);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (ms * i) / n;
    return { offset: i / n, t, p: i === n ? 1 : (1 - Math.exp(-t / tau)) / end };
  });
}

/** Linear opacity between `t0` and `t1` ms (held before and after), for keyframes sampled at `t`. */
export function ramp(t: number, t0: number, t1: number, from: number, to: number) {
  if (t <= t0) return from;
  if (t >= t1) return to;
  return from + ((to - from) * (t - t0)) / (t1 - t0);
}

/** Runs `frames` on `el` with linear timing (the curve is in the samples), filling forwards. */
export function play(el: Element | null | undefined, frames: Keyframe[], ms: number, id?: string) {
  if (!el) return undefined;
  return el.animate(frames, { duration: prefersReducedMotion() ? 1 : ms, easing: "linear", fill: "forwards", id });
}

export const reduced = () => prefersReducedMotion();
