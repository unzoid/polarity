/** Hue buckets the art's pixels are counted in: 15° each. */
const BUCKETS = 24;
/** Darker pixels (HSV value) say nothing about the art's colour. */
const MIN_VALUE = 0.15;
/** Greyer pixels (HSV saturation) don't count towards a hue. */
const MIN_SATURATION = 0.18;
/** Below this share of the picture in colour, it's taken as grey and its average tone is used. */
const MIN_COLOURFUL = 0.06;
/** How much more a pixel at the picture's edge counts than one at its middle, where the subject (a face) usually is. */
const EDGE_WEIGHT = 2;

/** Where the glow's colour is held (HSL): always a dark, muted shade, as Netflix's, however bright the art. */
const SATURATION = [0.25, 0.6] as const;
const LIGHTNESS = [0.16, 0.26] as const;

export type Rgb = [number, number, number];

/**
 * The art's most prominent colour, for the glow a phone's Home takes from its featured title (Netflix's): the hue
 * that covers most of the picture's colourful area, its edges (the setting) counting more than its middle (the
 * subject, often a face, whose skin would win otherwise), as the average of those pixels, then held to a dark, muted
 * shade. A mostly grey picture gives its average tone, kept grey. `px` is RGBA, as a canvas reads it, `width` pixels
 * across; null for no pixels.
 */
export function glowColor(px: ArrayLike<number>, width?: number): Rgb | null {
  const n = Math.floor(px.length / 4);
  const w = width && width > 0 ? width : n;
  const h = Math.max(1, Math.ceil(n / w));
  const weight = new Float64Array(BUCKETS);
  const sum = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
  let colourful = 0;
  let count = 0;
  const all = [0, 0, 0];
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (px[i + 3] < 128) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    count++;
    all[0] += r;
    all[1] += g;
    all[2] += b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max / 255;
    const s = max ? (max - min) / max : 0;
    if (v < MIN_VALUE || s < MIN_SATURATION) continue;
    colourful++;
    // 0 at the middle, 1 at the edge (whichever of across and down is further out).
    const x = w > 1 ? Math.abs(((p % w) / (w - 1)) * 2 - 1) : 0;
    const y = h > 1 ? Math.abs((Math.floor(p / w) / (h - 1)) * 2 - 1) : 0;
    const k = (1 + (EDGE_WEIGHT - 1) * Math.max(x, y)) * (0.5 + 0.5 * s);
    const bucket = Math.floor((hue(r, g, b, max, min) / 360) * BUCKETS) % BUCKETS;
    weight[bucket] += k;
    sum[bucket][0] += r * k;
    sum[bucket][1] += g * k;
    sum[bucket][2] += b * k;
  }
  if (!count) return null;
  if (colourful / count < MIN_COLOURFUL) {
    const [h0, s0, l0] = toHsl(all[0] / count, all[1] / count, all[2] / count);
    return fromHsl(h0, Math.min(s0, 0.06), clamp(l0, LIGHTNESS[0], LIGHTNESS[1]));
  }
  let best = 0;
  for (let b = 1; b < BUCKETS; b++) if (weight[b] > weight[best]) best = b;
  const total = weight[best];
  const [h0, s0, l0] = toHsl(sum[best][0] / total, sum[best][1] / total, sum[best][2] / total);
  return fromHsl(h0, clamp(s0, SATURATION[0], SATURATION[1]), clamp(l0, LIGHTNESS[0], LIGHTNESS[1]));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Hue in degrees, 0–360. */
function hue(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** [hue in degrees, saturation 0–1, lightness 0–1]. */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  const d = (max - min) / 255;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [hue(r, g, b, max, min), clamp(s, 0, 1), l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
