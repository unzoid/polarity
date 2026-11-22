import type { Rect } from "../phone/motion";

export { CLOSE_MS, CLOSE_TAU, easeOutSamples, lerp, lerpRect, OPEN_MS, OPEN_OMEGA, play, ramp, reduced, samples, type Rect } from "../phone/motion";

/** The box's own transform and corners drawing it at `r` (it's laid out at `S`, its origin at the top left). */
export function boxFrame(r: Rect, S: Rect, top: number, bottom: number) {
  const sx = r.w / S.w;
  const sy = r.h / S.h;
  const h = (v: number) => `${(v / sx).toFixed(2)}px`;
  const v = (n: number) => `${(n / sy).toFixed(2)}px`;
  return {
    transform: `translate(${(r.x - S.x).toFixed(2)}px, ${(r.y - S.y).toFixed(2)}px) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`,
    borderRadius: `${h(top)} ${h(top)} ${h(bottom)} ${h(bottom)} / ${v(top)} ${v(top)} ${v(bottom)} ${v(bottom)}`,
  };
}

/** The content inside the scaled box at one uniform scale (the width's), its top at the box's top. */
export function contentScale(r: Rect, S: Rect) {
  return `scale(1, ${(r.w / S.w / (r.h / S.h)).toFixed(5)})`;
}

/** The poster inside the scaled box: covering the box at `r`, centred, never squashed. */
export function ghostFrame(r: Rect, S: Rect, p: Rect) {
  const sx = r.w / S.w;
  const sy = r.h / S.h;
  const g = Math.max(r.w / p.w, r.h / p.h);
  const tx = (r.w - p.w * g) / (2 * sx);
  const ty = (r.h - p.h * g) / (2 * sy);
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${(g / sx).toFixed(5)}, ${(g / sy).toFixed(5)})`;
}
