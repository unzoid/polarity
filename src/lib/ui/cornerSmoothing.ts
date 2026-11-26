import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * One corner of Apple's continuous ("squircle") corner, as Figma's corner smoothing builds it: a circular arc of the
 * given radius in the middle, shortened as smoothing grows, eased into each edge by a cubic that starts `p` from the
 * corner (`(1 + smoothing) × radius`, so a smoothed corner reaches further along its edges than a plain one). When
 * the box is too small for the full reach, smoothing gives way first, then the radius.
 */
function cornerParams(radius: number, smoothing: number, maxReach: number) {
  let s = clamp(smoothing, 0, 100) / 100;
  const r = clamp(radius, 0, maxReach);
  let p = (1 + s) * r;
  if (p > maxReach) {
    s = clamp(maxReach / r - 1, 0, s);
    p = Math.min(p, maxReach);
  }
  const arcMeasure = 90 * (1 - s);
  const arc = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3p4 = r * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p3p4 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  return { r, p, a, b, c, d, arc };
}

type Corner = ReturnType<typeof cornerParams>;

/** The top-right corner from (0, 0), the point `p` before it on the top edge, to (p, p), `p` down the right edge. */
function cornerPoints(k: Corner): [number, number][] {
  const { r, p, a, b, c, d, arc } = k;
  if (!r) return [[0, 0], [p, p]];
  const out: [number, number][] = [];
  const cubic = (p0: number[], p1: number[], p2: number[], p3: number[], steps: number) => {
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const m = 1 - t;
      out.push([
        m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
        m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  };
  out.push([0, 0]);
  const e1 = [a + b + c, d];
  cubic([0, 0], [a, 0], [a + b, 0], e1, 10);
  // The arc, on the circle of `r` round (p - r, r).
  const cx = p - r;
  const cy = r;
  const t0 = Math.atan2(e1[1] - cy, e1[0] - cx);
  const e2 = [e1[0] + arc, e1[1] + arc];
  const t1 = Math.atan2(e2[1] - cy, e2[0] - cx);
  for (let i = 1; i <= 8; i += 1) {
    const t = t0 + ((t1 - t0) * i) / 8;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  cubic(e2, [e2[0] + d, e2[1] + c], [e2[0] + d, e2[1] + b + c], [e2[0] + d, e2[1] + a + b + c], 10);
  return out;
}

/**
 * The outline of a w × h box with Apple's continuous corners (Figma's 60% smoothing by default), as points clockwise
 * from the top edge. Radius is clamped to half the shorter side.
 */
function appleCornerPoints(w: number, h: number, radius: number, smoothing: number): [number, number][] {
  const k = cornerParams(radius, smoothing, Math.min(w, h) / 2);
  const local = cornerPoints(k);
  const p = k.p;
  const pts: [number, number][] = [];
  // Each corner is the top-right one turned to its place.
  for (const [x, y] of local) pts.push([w - p + x, y]);
  for (const [x, y] of local) pts.push([w - y, h - p + x]);
  for (const [x, y] of local) pts.push([p - x, h - y]);
  for (const [x, y] of local) pts.push([y, p - x]);
  return pts.filter((pt, i, all) => {
    const q = all[(i + all.length - 1) % all.length];
    return Math.abs(pt[0] - q[0]) > 1e-4 || Math.abs(pt[1] - q[1]) > 1e-4;
  });
}

/**
 * An SVG path of a box with Apple/iOS continuous corners (default 60%, Figma parity), drawn exactly (cubics and arcs,
 * not points). `inset` draws it that far inside the box, for a stroke that sits on the edge.
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
  if (!w || !h) return "";
  const o = inset;
  const k = cornerParams(Math.max(0, radius - inset), smoothing, Math.min(w, h) / 2);
  const { r, p, a, b, c, d, arc } = k;
  const f = (n: number) => +n.toFixed(3);
  if (!r) return `M${o} ${o}H${f(o + w)}V${f(o + h)}H${o}Z`;
  return [
    `M${f(o + w - p)} ${o}`,
    `c${f(a)} 0 ${f(a + b)} 0 ${f(a + b + c)} ${f(d)}`,
    `a${f(r)} ${f(r)} 0 0 1 ${f(arc)} ${f(arc)}`,
    `c${f(d)} ${f(c)} ${f(d)} ${f(b + c)} ${f(d)} ${f(a + b + c)}`,
    `L${f(o + w)} ${f(o + h - p)}`,
    `c0 ${f(a)} 0 ${f(a + b)} ${f(-d)} ${f(a + b + c)}`,
    `a${f(r)} ${f(r)} 0 0 1 ${f(-arc)} ${f(arc)}`,
    `c${f(-c)} ${f(d)} ${f(-(b + c))} ${f(d)} ${f(-(a + b + c))} ${f(d)}`,
    `L${f(o + p)} ${f(o + h)}`,
    `c${f(-a)} 0 ${f(-(a + b))} 0 ${f(-(a + b + c))} ${f(-d)}`,
    `a${f(r)} ${f(r)} 0 0 1 ${f(-arc)} ${f(-arc)}`,
    `c${f(-d)} ${f(-c)} ${f(-d)} ${f(-(b + c))} ${f(-d)} ${f(-(a + b + c))}`,
    `L${o} ${f(o + p)}`,
    `c0 ${f(-a)} 0 ${f(-(a + b))} ${f(d)} ${f(-(a + b + c))}`,
    `a${f(r)} ${f(r)} 0 0 1 ${f(arc)} ${f(-arc)}`,
    `c${f(c)} ${f(-d)} ${f(b + c)} ${f(-d)} ${f(a + b + c)} ${f(-d)}`,
    "Z",
  ].join("");
}

/**
 * A smoothed shape's outline moved `offset` px outward along its normals (negative: inward), drawn in a box `shift`
 * px bigger on every side. It's a true parallel curve, so a ring around a smoothed tile keeps the same gap all the way
 * round its corners (concentric). A larger radius alone doesn't: smoothing stretches a corner in proportion to its
 * radius, so the gap would swell at the corners.
 */
export function appleCornerOffsetPath({
  width,
  height,
  radius,
  smoothing = 60,
  offset,
  shift = 0,
}: {
  width: number;
  height: number;
  radius: number;
  smoothing?: number;
  offset: number;
  shift?: number;
}): string {
  if (width <= 0 || height <= 0) return "";
  const pts = appleCornerPoints(width, height, radius, smoothing);
  const n = pts.length;
  const out = pts.map((p, i) => {
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    // Clockwise on screen (y down): the outward normal of a heading (tx, ty) is (ty, -tx).
    const x = p[0] + (ty / len) * offset + shift;
    const y = p[1] + (-tx / len) * offset + shift;
    return `${x.toFixed(3)} ${y.toFixed(3)}`;
  });
  return `M${out.join("L")}Z`;
}

/**
 * A CSS `mask-image` of a path in a w × h box. A mask is drawn as an image, so its edge is anti-aliased everywhere; a
 * `clip-path: path()` edge can come out hard-stepped on a composited layer (the pushed pages slide on the GPU).
 */
export function pathMask(d: string, w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** React style for an element shaped by `useAppleCorners(...).mask` (its CSS radius off: the mask is the shape). */
export function maskStyle(mask: string | undefined): CSSProperties | undefined {
  if (!mask) return undefined;
  return {
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    borderRadius: 0,
  };
}

function setMask(el: HTMLElement, mask: string) {
  for (const prefix of ["", "-webkit-"]) {
    el.style.setProperty(`${prefix}mask-image`, mask || null);
    el.style.setProperty(`${prefix}mask-size`, mask ? "100% 100%" : null);
    el.style.setProperty(`${prefix}mask-repeat`, mask ? "no-repeat" : null);
  }
}

/**
 * Gives every element under `ref` that matches `selector` Apple's continuous corners (a mask drawn to its size), kept
 * to size as each resizes, and picks up matches added later (a pushed page's cards). Elements keep their CSS
 * `border-radius` until they're measured; the smoothed outline sits inside a circle of the same radius, so it clips
 * nothing the mask doesn't.
 */
export function useSmoothCorners(ref: RefObject<HTMLElement | null>, selector: string, radius: number, smoothing = 60, active = true) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!active || !root || typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") return;
    const seen = new Set<HTMLElement>();
    const apply = (el: HTMLElement) => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) return;
      setMask(el, pathMask(appleCornerPath({ width: w, height: h, radius, smoothing }), w, h));
    };
    const ro = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target as HTMLElement)));
    const scan = () => {
      for (const el of seen)
        if (!el.isConnected) {
          ro.unobserve(el);
          seen.delete(el);
        }
      root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        ro.observe(el);
        apply(el);
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      ro.disconnect();
      seen.forEach((el) => setMask(el, ""));
    };
  }, [ref, selector, radius, smoothing, active]);
}

/**
 * Measures an element live via ResizeObserver and returns Apple 60% corner-smoothed
 * clip-path, mask and SVG stroke geometry. Preserves element layout and degrades cleanly
 * to standard CSS border-radius when unmeasured (e.g. SSR/jsdom). `radius` is the corner's
 * arc: at 60% smoothing the corner reaches 1.6 × radius along each edge.
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
    let raf = 0;
    const measure = () => {
      // Use unscaled layout dimensions so entrance transforms (e.g. scale 0.97 -> 1) never shrink the clip path.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ref, enabled]);

  const active = enabled && size.w > 0 && size.h > 0;
  const d = active ? appleCornerPath({ width: size.w, height: size.h, radius, smoothing }) : "";
  return {
    active,
    width: size.w,
    height: size.h,
    clipPath: d ? `path("${d}")` : undefined,
    /** The same outline as an anti-aliased mask (`mask-image`), for a shape whose edge should be soft at any scale. */
    mask: d ? pathMask(d, size.w, size.h) : undefined,
    strokePath: (inset: number) => (active ? appleCornerPath({ width: size.w, height: size.h, radius, smoothing, inset }) : ""),
  };
}
