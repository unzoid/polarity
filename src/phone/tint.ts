import { createElement, useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { loadReadable, pixelsOf } from "../components/TitleLogo";
import type { MetaPreview } from "../lib/types";
import { sizedArt } from "../lib/ui";

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

/**
 * Lightweight imperative bus connecting a carousel's active index to `<TintBackdrop>` (and its scrolled header's
 * background) without re-rendering the entire page or shelves every 8 seconds.
 */
export interface TintBus {
  readonly subscribe: (fn: (src: string | undefined) => void) => () => void;
  readonly getSrc: () => string | undefined;
  readonly onShown: (index: number) => void;
}

export function useTintBus(featured: readonly MetaPreview[]): TintBus {
  const itemsRef = useRef(featured);
  itemsRef.current = featured;
  const indexRef = useRef(0);
  const srcRef = useRef<string | undefined>(undefined);
  const listeners = useRef(new Set<(src: string | undefined) => void>());

  const emit = useCallback((idx: number) => {
    indexRef.current = idx;
    const item = itemsRef.current[Math.min(idx, Math.max(0, itemsRef.current.length - 1))];
    const next = item ? sizedArt(item.background ?? item.poster, "w300") : undefined;
    if (next === srcRef.current) return;
    srcRef.current = next;
    for (const fn of listeners.current) fn(next);
  }, []);

  // Re-evaluate when the featured list itself changes (e.g. initial load or switching Home view/filter).
  useEffect(() => {
    emit(0);
  }, [featured, emit]);

  const subscribe = useCallback((fn: (src: string | undefined) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const getSrc = useCallback(() => srcRef.current, []);

  return useRef<TintBus>({
    subscribe,
    getSrc,
    onShown: emit,
  }).current;
}

/**
 * Composite-only tint backdrop: swaps between two stacked gradient layers using `opacity` only (zero inherited
 * CSS variable recalcs across descendants), and mirrors `--tint-dark`/`--tint-light` onto the header's leaf
 * `.ph-head-bg` element if `headRef` is provided.
 */
export function TintBackdrop({ bus, headRef }: { bus: TintBus; headRef?: RefObject<HTMLElement | null> }) {
  const [src, setSrc] = useState<string | undefined>(() => bus.getSrc());
  useEffect(() => {
    setSrc(bus.getSrc());
    return bus.subscribe(setSrc);
  }, [bus]);

  const tint = useArtTint(src);
  const [pair, setPair] = useState<{ active: 0 | 1; slots: [Tint | undefined, Tint | undefined] }>(() => ({
    active: 0,
    slots: [tint, undefined],
  }));

  useEffect(() => {
    const bg = headRef?.current?.querySelector<HTMLElement>(".ph-head-bg") ?? headRef?.current;
    if (bg) {
      if (tint) {
        bg.style.setProperty("--tint-dark", tint.dark);
        bg.style.setProperty("--tint-light", tint.light);
      } else {
        bg.style.removeProperty("--tint-dark");
        bg.style.removeProperty("--tint-light");
      }
    }
    setPair((prev) => {
      const cur = prev.slots[prev.active];
      if (cur?.dark === tint?.dark && cur?.light === tint?.light) return prev;
      const nextActive: 0 | 1 = prev.active === 0 ? 1 : 0;
      const slots: [Tint | undefined, Tint | undefined] = [prev.slots[0], prev.slots[1]];
      slots[nextActive] = tint;
      return { active: nextActive, slots };
    });
  }, [tint, headRef]);

  const styleOf = (t: Tint | undefined): CSSProperties | undefined =>
    t ? ({ "--tint-dark": t.dark, "--tint-light": t.light } as CSSProperties) : undefined;

  return createElement(
    "div",
    { className: "ph-tint", "aria-hidden": true },
    createElement("div", { className: "ph-tint-layer", "data-active": pair.active === 0 ? "true" : "false", style: styleOf(pair.slots[0]) }),
    createElement("div", { className: "ph-tint-layer", "data-active": pair.active === 1 ? "true" : "false", style: styleOf(pair.slots[1]) }),
  );
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
