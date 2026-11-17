/** Hue buckets the art's pixels are counted in: 15° each. */
const BUCKETS = 24;
/** Darker pixels (HSV value) say nothing about the art's colour. */
const MIN_VALUE = 0.2;
/** Greyer pixels (HSV saturation) don't count towards a hue: a grey-green lawn isn't green. */
const MIN_SATURATION = 0.28;
/**
 * Below this share of the picture in colour, it's taken as grey: a dark, cool neutral, as Netflix gives a
 * blue-grey poster, rather than a hue picked from a few tinted pixels.
 */
const MIN_COLOURFUL = 0.18;
/** How much more a pixel at the picture's edge counts than one at its middle, where the subject (a face) usually is. */
const EDGE_WEIGHT = 3;

/**
 * Where the glow's colour is held (HSL): a dark shade, as Netflix's page colours are (lightness 0.08–0.21 measured
 * from its app), never more saturated than the art itself, and no less dark however bright it is.
 */
const SATURATION = [0.1, 0.55] as const;
const LIGHTNESS = [0.1, 0.2] as const;
/** A grey picture's shade: a near-neutral with a little blue, as Netflix's are. */
const NEUTRAL = { hue: 228, saturation: 0.12, lightness: 0.11 } as const;

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
  // Shares weighted by place, edges (the setting) above the middle (the subject): a red umbrella in the middle
  // of a grey, rainy picture doesn't make it a red one.
  let colourful = 0;
  let count = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (px[i + 3] < 128) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    // 0 at the middle, 1 at the edge (whichever of across and down is further out).
    const x = w > 1 ? Math.abs(((p % w) / (w - 1)) * 2 - 1) : 0;
    const y = h > 1 ? Math.abs((Math.floor(p / w) / (h - 1)) * 2 - 1) : 0;
    const place = 1 + (EDGE_WEIGHT - 1) * Math.max(x, y);
    count += place;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max / 255;
    const s = max ? (max - min) / max : 0;
    if (v < MIN_VALUE || s < MIN_SATURATION) continue;
    colourful += place;
    const k = place * (0.5 + 0.5 * s);
    const bucket = Math.floor((hue(r, g, b, max, min) / 360) * BUCKETS) % BUCKETS;
    weight[bucket] += k;
    sum[bucket][0] += r * k;
    sum[bucket][1] += g * k;
    sum[bucket][2] += b * k;
  }
  if (!count) return null;
  if (colourful / count < MIN_COLOURFUL) return fromHsl(NEUTRAL.hue, NEUTRAL.saturation, NEUTRAL.lightness);
  let best = 0;
  for (let b = 1; b < BUCKETS; b++) if (weight[b] > weight[best]) best = b;
  const total = weight[best];
  const [h0, s0, l0] = toHsl(sum[best][0] / total, sum[best][1] / total, sum[best][2] / total);
  // Muted by how little of the picture is in colour: a small coloured area tints, a colourful poster glows.
  const share = Math.min(1, colourful / count / 0.5);
  return fromHsl(h0, clamp(s0 * (0.4 + 0.4 * share), SATURATION[0], SATURATION[1]), clamp(l0 * 0.45, LIGHTNESS[0], LIGHTNESS[1]));
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
