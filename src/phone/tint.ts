import { useEffect, useState } from "react";
import { loadReadable, pixelsOf } from "../components/TitleLogo";

/**
 * A picture's colour as a page takes it: `dark` for the page in dark mode, `light` in light mode. The page fades
 * from it to its own background down the screen (phone.css).
 */
export type Tint = { dark: string; light: string };

const tints = new Map<string, Tint | null>();

/**
 * The colour Home's page takes from its featured title, as Netflix's does: not the picture's average (which lands
 * on greys and browns) but its dominant colour, the hue its most colourful part shares, deep and still saturated
 * (measured off Netflix: The Office's page top is rgb(51 15 20), a blue-pink poster's rgb(18 22 41), a grey one's
 * rgb(12 13 14)). Undefined until the picture is read, or when it can't be.
 */
export function useArtTint(src: string | undefined): Tint | undefined {
  const [tint, setTint] = useState<Tint | undefined>(() => (src ? (tints.get(src) ?? undefined) : undefined));
  useEffect(() => {
    if (!src) return setTint(undefined);
    if (tints.has(src)) return setTint(tints.get(src) ?? undefined);
    let live = true;
    void loadReadable(src).then((img) => {
      const px = img ? pixelsOf(img, 32) : null;
      const value = px ? tintOf(px) : null;
      tints.set(src, value);
      if (live) setTint(value ?? undefined);
    });
    return () => {
      live = false;
    };
  }, [src]);
  return tint;
}

type Hsl = { h: number; s: number; l: number };

function hsl(r: number, g: number, b: number): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

const BINS = 24;

/**
 * The hue with the most colour in it (each pixel weighted by its chroma, so a red coat outweighs a grey sky of the
 * same size), how saturated that part is, and how much colour the picture has at all.
 */
export function tintOf(px: ArrayLike<number>): Tint {
  const weight = new Float64Array(BINS);
  const satSum = new Float64Array(BINS);
  let chroma = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const c = hsl(r, g, b);
    // Near-black and near-white say nothing about the colour.
    if (c.l < 0.06 || c.l > 0.94) continue;
    const w = c.s * (1 - Math.abs(2 * c.l - 1));
    const bin = Math.floor((c.h / 360) * BINS) % BINS;
    weight[bin] += w;
    satSum[bin] += w * c.s;
    chroma += w;
    n++;
  }
  // The strongest hue, with its neighbours (a hue spread over two bins is still one colour).
  let best = 0;
  let bestW = -1;
  for (let i = 0; i < BINS; i++) {
    const w = weight[(i + BINS - 1) % BINS] * 0.5 + weight[i] + weight[(i + 1) % BINS] * 0.5;
    if (w > bestW) {
      bestW = w;
      best = i;
    }
  }
  const hue = Math.round(((best + 0.5) / BINS) * 360);
  const sat = weight[best] ? satSum[best] / weight[best] : 0;
  // How colourful the picture is overall: a grey one gives a near-neutral, darker page, as Netflix's does.
  const colourful = n ? Math.min(1, (chroma / n) * 4) : 0;
  const s = Math.min(0.62, sat * (0.35 + 0.65 * colourful));
  const l = 0.05 + 0.08 * colourful;
  return {
    dark: `hsl(${hue} ${Math.round(s * 100)}% ${Math.round(l * 1000) / 10}%)`,
    light: `hsl(${hue} ${Math.round(Math.min(0.5, s) * 100)}% ${Math.round((0.9 - 0.04 * colourful) * 1000) / 10}%)`,
  };
}
