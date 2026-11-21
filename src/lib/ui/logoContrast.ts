// Whether a title logo reads on the picture behind it (#215), decided on contrast: the logo's ink against the
// backdrop where the logo sits, after the page's own gradient. Pure functions on RGBA pixels; TitleLogo measures.

/** How a logo is drawn: as it is, as a white or dark silhouette, or with a soft halo (light behind a dark logo, dark behind a light one). */
export type LogoLook = "as-is" | "silhouette" | "silhouette-dark" | "halo-light" | "halo-dark";
export type LogoScheme = "dark" | "light";

/** Number of luminance histogram bins stored per measured logo (256 bytes instead of per-pixel arrays). */
const LUM_BINS = 64;
/** Histogram resolution for O(N) weighted median calculation. */
const MEDIAN_BINS = 256;

/** A measured logo: compact luminance histogram (0-1) with total weight, and whether it's one ink throughout. */
export interface Ink {
  /** Weighted luminance histogram across `LUM_BINS` uniform buckets in [0, 1]. */
  bins: Float32Array;
  /** Sum of opaque pixel weights in `bins`. */
  total: number;
  /** Most of the ink is one tone with no strong colour: a silhouette keeps its shape and loses nothing. */
  single: boolean;
  /** The ink's median luminance. */
  median: number;
}

/** WCAG's level for graphics: a logo whose ink mostly reaches it against the backdrop reads as it is. */
export const LOGO_CONTRAST = 3;
/** The share of the ink that must reach `LOGO_CONTRAST` (a white logo with a heavy dark outline still reads). */
const LEGIBLE_SHARE = 0.4;
/** One ink: this share of it lies within `BAND` (in sRGB lightness) of the median, and at most `COLOURFUL` of it is saturated. */
const SINGLE_SHARE = 0.85;
const BAND = 0.15;
const COLOURFUL = 0.1;

/** Linear-light value of an sRGB channel (0-255). */
function linear(c: number) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance(r: number, g: number, b: number) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two relative luminances (1-21). */
export function contrast(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The ink of a logo's RGBA pixels (its mostly transparent surround left out); null when there's none. */
export function measureInk(px: ArrayLike<number>): Ink | null {
  const bins = new Float32Array(LUM_BINS);
  const lumHist = new Float32Array(MEDIAN_BINS);
  const lightHist = new Float32Array(MEDIAN_BINS);
  let total = 0;
  let colourful = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < 0.5) continue;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const l = luminance(r, g, b);
    const li = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    bins[Math.min(LUM_BINS - 1, Math.floor(l * LUM_BINS))] += a;
    lumHist[Math.min(MEDIAN_BINS - 1, Math.floor(l * MEDIAN_BINS))] += a;
    lightHist[Math.min(MEDIAN_BINS - 1, Math.floor(li * MEDIAN_BINS))] += a;
    total += a;
    if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 > 0.25) colourful += a;
  }
  if (total === 0) return null;
  const median = histogramMedian(lumHist, total);
  const mid = histogramMedian(lightHist, total);
  let near = 0;
  for (let i = 0; i < MEDIAN_BINS; i++) {
    const w = lightHist[i];
    if (w > 0 && Math.abs((i + 0.5) / MEDIAN_BINS - mid) <= BAND) near += w;
  }
  return { bins, total, median, single: near / total >= SINGLE_SHARE && colourful / total <= COLOURFUL };
}

function histogramMedian(hist: Float32Array, total: number) {
  const half = total / 2;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= half) return (i + 0.5) / hist.length;
  }
  return 1;
}

/**
 * Where a heading's logo sits over its backdrop (fractions of the picture, as `object-fit: cover` shows it on a wide
 * window) and how much of the page's gradient covers it there (`rgb(10 10 10 / scrim)`). They follow the scrims in
 * cards.css (.hero-scrim), detail.css (.detail-bg-scrim) and tv.css (the TV art fades out towards the logo).
 * `onPage`: the gradient is the page's colour, near-white in light mode (the detail page); the others stay dark.
 */
export const LOGO_SPOTS = {
  hero: { x0: 0.03, y0: 0.45, x1: 0.4, y1: 0.8, scrim: 0.5 },
  detail: { x0: 0.03, y0: 0.4, x1: 0.4, y1: 0.75, scrim: 0.7, onPage: true },
  /** A big screen's title page with Show page background off: its hero is dark in either scheme (title/darkHero.ts). */
  "detail-dark": { x0: 0.03, y0: 0.4, x1: 0.4, y1: 0.75, scrim: 0.7 },
  "tv-stage": { x0: 0.03, y0: 0.5, x1: 0.35, y1: 0.85, scrim: 0.8 },
  "tv-detail": { x0: 0, y0: 0.25, x1: 0.35, y1: 0.6, scrim: 0.9 },
  "tv-panel": { x0: 0, y0: 0.25, x1: 0.35, y1: 0.6, scrim: 0.9 },
} as const;

export type LogoSpot = { x0: number; y0: number; x1: number; y1: number; scrim: number; onPage?: boolean };

/** The scrim's colour (the dark page background, #0a0a0a). */
const SCRIM = 10;
/** The light page's grey (lib/theme LIGHT_BASE, #f4f4f6). */
const LIGHT_SCRIM = 244;

/** The active page scheme (`data-scheme` on `<html>`), defaulting to dark. */
export function currentLogoScheme(): LogoScheme {
  return typeof document !== "undefined" && document.documentElement.dataset.scheme === "light" ? "light" : "dark";
}

/** The grey a spot's gradient is made of right now: the light page's for an `onPage` spot in light mode. */
export function scrimLevel(spot: Pick<LogoSpot, "onPage">, scheme: LogoScheme = currentLogoScheme()): number {
  return spot.onPage && scheme === "light" ? LIGHT_SCRIM : SCRIM;
}

/** The luminance behind a logo when the backdrop can't be measured, or there's none: the app's dark page. */
export const DARK_PAGE = luminance(SCRIM, SCRIM, SCRIM);
/** The luminance behind an `onPage` logo in light mode when there's no backdrop. */
export const LIGHT_PAGE = luminance(LIGHT_SCRIM, LIGHT_SCRIM, LIGHT_SCRIM);

export function pageLuminance(spot?: Pick<LogoSpot, "onPage">, scheme: LogoScheme = currentLogoScheme()): number {
  return spot?.onPage && scheme === "light" ? LIGHT_PAGE : DARK_PAGE;
}

/**
 * The mean luminance of a backdrop's pixels (already cut to the logo's spot) under the page's gradient of
 * `scrim` (0-1) in the grey `level`, blended in sRGB as CSS does.
 */
export function backdropLuminance(px: ArrayLike<number>, scrim: number, level = SCRIM) {
  let sum = 0;
  let n = 0;
  const over = (c: number) => c * (1 - scrim) + level * scrim;
  for (let i = 0; i < px.length; i += 4) {
    sum += luminance(over(px[i]), over(px[i + 1]), over(px[i + 2]));
    n++;
  }
  return n ? sum / n : DARK_PAGE;
}

/** The share of the ink that reaches `LOGO_CONTRAST` against a backdrop of luminance `behind`. */
export function legibleShare(ink: Ink, behind: number) {
  if (!ink.total) return 0;
  let ok = 0;
  for (let i = 0; i < ink.bins.length; i++) {
    const w = ink.bins[i];
    if (w > 0 && contrast((i + 0.5) / ink.bins.length, behind) >= LOGO_CONTRAST) ok += w;
  }
  return ok / ink.total;
}

export const readsOn = (ink: Ink, behind: number) => legibleShare(ink, behind) >= LEGIBLE_SHARE;

/**
 * How to draw a logo on a backdrop of luminance `behind`: as it is when it reads; a single ink as the white
 * silhouette (or crisp dark silhouette on a light-mode page), when that reads there; else a halo of the opposite
 * tone, which keeps a multicolour or detailed logo's artwork.
 */
export function logoLook(ink: Ink, behind: number, lightPage = false): LogoLook {
  if (readsOn(ink, behind)) return "as-is";
  if (ink.single && contrast(1, behind) >= LOGO_CONTRAST) return "silhouette";
  if (lightPage && ink.single && contrast(DARK_PAGE, behind) >= LOGO_CONTRAST) return "silhouette-dark";
  // Dark behind a light logo, light behind a dark one: whichever stands further from the ink's median.
  return contrast(ink.median, 0) > contrast(ink.median, 1) ? "halo-dark" : "halo-light";
}

/**
 * Which of a title's logos to show, in their order (the metadata language first): the first that reads on the
 * backdrop as it is; when none does, the first, drawn by `logoLook`. Logos that couldn't be measured (null) are
 * passed over unless none could be.
 */
export function pickLogo(inks: (Ink | null)[], behind: number, lightPage = false): { index: number; look: LogoLook } | null {
  const readable = inks.findIndex((ink) => ink && readsOn(ink, behind));
  if (readable >= 0) return { index: readable, look: "as-is" };
  const first = inks.findIndex((ink) => ink);
  if (first < 0) return null;
  return { index: first, look: logoLook(inks[first]!, behind, lightPage) };
}

/** A logo picture's size, and the share of its pixels that are see-through (null when they can't be read). */
export interface LogoShape {
  width: number;
  height: number;
  clear: number | null;
}

/** A logo is clearly wider than tall: at least this many times (a stacked two-line logo still is). */
export const LOGO_ASPECT = 1.2;
/** And mostly see-through around its lettering: at least this share of its pixels (a cover has none). */
export const LOGO_CLEAR = 0.25;

/**
 * Whether a picture handed over as a title's logo is shaped like one (#371): a cover or poster passed off as a
 * logo is square or upright, or has nothing see-through. Transparency counts only when the pixels could be read.
 */
export function logoShaped(shape: LogoShape): boolean {
  return shape.width >= LOGO_ASPECT * shape.height && (shape.clear === null || shape.clear >= LOGO_CLEAR);
}

/** The share of RGBA pixels that are mostly see-through. */
export function clearShare(px: ArrayLike<number>): number {
  let clear = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 128) clear++;
  return px.length ? clear / (px.length / 4) : 0;
}

/**
 * What a heading shows once measuring has answered: the logo to show and how, "none" when no candidate is shaped
 * like a logo (`shapes`, null where a picture couldn't be loaded at all), or "unsure" when neither the logos nor
 * the backdrop could be measured; for both the name shows in text. `behind` is null when the backdrop couldn't be;
 * with no backdrop to measure the caller passes `DARK_PAGE`, and an unmeasured logo is then left as it is.
 */
export function chooseLogo(
  candidates: string[],
  inks: (Ink | null)[],
  behind: number | null,
  shapes: (LogoShape | null)[] = [],
  lightPage = false,
): { src: string; look: LogoLook } | "unsure" | "none" {
  const kept = candidates.map((_, i) => i).filter((i) => !shapes[i] || logoShaped(shapes[i]));
  if (!kept.length) return "none";
  const picked = pickLogo(
    kept.map((i) => inks[i] ?? null),
    behind ?? (lightPage ? LIGHT_PAGE : DARK_PAGE),
    lightPage,
  );
  if (picked) return { src: candidates[kept[picked.index]], look: picked.look };
  return behind === null ? "unsure" : { src: candidates[kept[0]], look: "as-is" };
}
