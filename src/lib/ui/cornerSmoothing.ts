import { useLayoutEffect, useState, type RefObject } from "react";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Generates an Apple/iOS continuous corner-smoothing SVG path (default 60% Figma parity).
 * Clamps radius to `min(width, height) / 2` so shapes never self-intersect at any size.
 */
export function appleCornerPath({
  width,
  height,
  radius,
  smoothing = 60,
  inset = 0,
}: {
  width: number;
  height: number;
  radius: number;
  smoothing?: number;
  inset?: number;
}): string {
  const w = Math.max(0, width - inset * 2);
  const h = Math.max(0, height - inset * 2);
  const r = clamp(radius - inset, 0, Math.min(w, h) / 2);
  const s = clamp(smoothing, 0, 100) / 100;
  const ox = inset;
  const oy = inset;

  if (!w || !h) return "";
  if (!r) return `M${ox} ${oy}H${ox + w}V${oy + h}H${ox}Z`;

  if (s <= 0.001) {
    const c = r * 0.5522847498307936;
    return [
      `M${ox + r} ${oy}`,
      `H${ox + w - r}`,
      `C${ox + w - r + c} ${oy} ${ox + w} ${oy + r - c} ${ox + w} ${oy + r}`,
      `V${oy + h - r}`,
      `C${ox + w} ${oy + h - r + c} ${ox + w - r + c} ${oy + h} ${ox + w - r} ${oy + h}`,
      `H${ox + r}`,
      `C${ox + r - c} ${oy + h} ${ox} ${oy + h - r + c} ${ox} ${oy + h - r}`,
      `V${oy + r}`,
      `C${ox} ${oy + r - c} ${ox + r - c} ${oy} ${ox + r} ${oy}Z`,
    ].join("");
  }

  const exponent = 2 + s * 3.35;
  const steps = 22;
  const points: [number, number][] = [];

  const corner = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= steps; i += 1) {
      const a = a0 + (a1 - a0) * (i / steps);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const x = ox + cx + r * Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
      const y = oy + cy + r * Math.sign(sin) * Math.abs(sin) ** (2 / exponent);
      points.push([+x.toFixed(3), +y.toFixed(3)]);
    }
  };

  points.push([+(ox + r).toFixed(3), +oy.toFixed(3)], [+(ox + w - r).toFixed(3), +oy.toFixed(3)]);
  corner(w - r, r, -Math.PI / 2, 0);
  points.push([+(ox + w).toFixed(3), +(oy + h - r).toFixed(3)]);
  corner(w - r, h - r, 0, Math.PI / 2);
  points.push([+(ox + r).toFixed(3), +(oy + h).toFixed(3)]);
  corner(r, h - r, Math.PI / 2, Math.PI);
  points.push([+ox.toFixed(3), +(oy + r).toFixed(3)]);
  corner(r, r, Math.PI, Math.PI * 1.5);

  const deduped = points.filter((point, index, all) => {
    if (index === 0) return true;
    const prev = all[index - 1];
    return point[0] !== prev[0] || point[1] !== prev[1];
  });

  return `M${deduped.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
}

/**
 * Measures an element live via ResizeObserver and returns Apple 60% corner-smoothed
 * clip-path and SVG stroke geometry. Preserves element layout and degrades cleanly
 * to standard CSS border-radius when unmeasured (e.g. SSR/jsdom).
 */
export function useAppleCorners(
  ref: RefObject<HTMLElement | null>,
  radius: number,
  smoothing = 60,
  enabled = true,
) {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      // Use unscaled layout dimensions so entrance transforms (e.g. scale 0.97 -> 1) never shrink the clip path.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);

  const active = enabled && size.w > 0 && size.h > 0;
  const d = active ? appleCornerPath({ width: size.w, height: size.h, radius, smoothing }) : "";
  return {
    active,
    width: size.w,
    height: size.h,
    clipPath: d ? `path("${d}")` : undefined,
    strokePath: (inset: number) => (active ? appleCornerPath({ width: size.w, height: size.h, radius, smoothing, inset }) : ""),
  };
}
