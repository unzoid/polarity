/** Hue buckets the art's pixels are counted in: 15° each. */
const BUCKETS = 24;
/** Darker pixels (HSV value) say nothing about the art's colour. */
const MIN_VALUE = 0.18;
/** Greyer pixels (HSV saturation) don't count towards a hue. */
const MIN_SATURATION = 0.2;
/** Below this share of the picture in colour, it's taken as grey and its average tone is used. */
const MIN_COLOURFUL = 0.06;

/** Where the glow's colour is kept, so one picked off a dark or pale picture still glows (HSL). */
const SATURATION = [0.4, 0.85] as const;
const LIGHTNESS = [0.32, 0.46] as const;

export type Rgb = [number, number, number];

/**
 * The art's most prominent colour, for the glow a phone's Home takes from its featured title (Netflix's): the
 * hue that most of the picture's colourful pixels share, weighted by how vivid each is, as the average of those
 * pixels, then held to a saturation and lightness that glows on a dark page. A mostly grey picture gives its
 * average tone, kept grey. `px` is RGBA, as a canvas reads it; null for no pixels.
 */
export function glowColor(px: ArrayLike<number>): Rgb | null {
  const weight = new Float64Array(BUCKETS);
  const sum = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
  let colourful = 0;
  let count = 0;
  const all = [0, 0, 0];
  for (let i = 0; i + 3 < px.length; i += 4) {
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
    const bucket = Math.floor((hue(r, g, b, max, min) / 360) * BUCKETS) % BUCKETS;
    const w = s * v;
    weight[bucket] += w;
    sum[bucket][0] += r * w;
    sum[bucket][1] += g * w;
    sum[bucket][2] += b * w;
  }
  if (!count) return null;
  if (colourful / count < MIN_COLOURFUL) {
    const [h, s, l] = toHsl(all[0] / count, all[1] / count, all[2] / count);
    return fromHsl(h, Math.min(s, 0.08), clamp(l, LIGHTNESS[0], LIGHTNESS[1]));
  }
  let best = 0;
  for (let b = 1; b < BUCKETS; b++) if (weight[b] > weight[best]) best = b;
  const w = weight[best];
  const [h, s, l] = toHsl(sum[best][0] / w, sum[best][1] / w, sum[best][2] / w);
  return fromHsl(h, clamp(s, SATURATION[0], SATURATION[1]), clamp(l, LIGHTNESS[0], LIGHTNESS[1]));
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
