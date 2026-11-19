import { useEffect, useRef, useState } from "react";

/** How many pixels across the wash is drawn when its blur is baked in: plenty for a gradient. */
const BAKED_WIDTH = 160;

/**
 * The CSS filter (`--wash`) for drawing once into a canvas `width` pixels across that shows
 * `shownWidth` CSS pixels wide: its blur scaled to the canvas's pixels. Null when there is nothing
 * to bake (no filter, or the canvas isn't laid out).
 */
export function bakedFilter(filter: string, shownWidth: number, width: number): string | null {
  const f = filter.trim();
  if (!shownWidth || !f || f === "none") return null;
  return f.replace(/blur\(([\d.]+)px\)/, (_, px: string) => `blur(${+((Number(px) * width) / shownWidth).toFixed(2)}px)`);
}

/**
 * The art shrunk to a few pixels: stretched back up, the browser's smoothing
 * turns it into one soft gradient of the image's main colours — no busy detail
 * showing through. Drawing a cross-origin image is fine; only reading its
 * pixels back would be blocked.
 *
 * The blur and tone (`--wash` in CSS) are drawn into the canvas once, where the
 * browser can filter a canvas (#36): as a CSS filter, a full-screen blur is
 * redone on every frame anything moves over it, and a held direction on TV
 * dropped to a few frames a second. Elsewhere the CSS filter applies as before.
 */
export function AmbientWash({ src, current }: { src?: string; current: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [baked, setBaked] = useState(false);

  useEffect(() => {
    setReady(false);
    setBaked(false);
    if (!src) return;
    const cv = canvas.current;
    let wash: HTMLCanvasElement | null = null;
    let bakedWidth = 0;

    const paint = () => {
      const el = canvas.current;
      const ctx = el?.getContext("2d");
      if (!el || !ctx || !wash) return;
      const shownWidth = el.clientWidth;
      const shownHeight = el.clientHeight;
      const filter = "filter" in ctx ? bakedFilter(getComputedStyle(el).getPropertyValue("--wash"), shownWidth, BAKED_WIDTH) : null;
      // Resizing resets the context, so the filter is set after.
      el.width = filter ? BAKED_WIDTH : wash.width;
      el.height = filter && shownWidth > 0 ? Math.max(1, Math.round((BAKED_WIDTH * shownHeight) / shownWidth)) : wash.height;
      if (filter) ctx.filter = filter;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(wash, 0, 0, el.width, el.height);
      bakedWidth = filter ? shownWidth : 0;
      setBaked(!!filter);
      setReady(true);
    };

    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      // Two steps so the tiny version averages the whole picture, not a few pixels of it.
      const mid = document.createElement("canvas");
      mid.width = 48;
      mid.height = 27;
      const tiny = document.createElement("canvas");
      tiny.width = 4;
      tiny.height = 3;
      const m = mid.getContext("2d");
      const t = tiny.getContext("2d");
      if (!m || !t) return;
      m.imageSmoothingQuality = "high";
      m.drawImage(img, 0, 0, mid.width, mid.height);
      t.imageSmoothingQuality = "high";
      t.drawImage(mid, 0, 0, tiny.width, tiny.height);
      wash = tiny;
      paint();
    };
    img.src = src;

    // Re-bake if the image loaded before layout gave the canvas a non-zero width, or on major resizes.
    const ro =
      cv && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!wash || cv.clientWidth <= 0) return;
            if (bakedWidth === 0 || Math.abs(cv.clientWidth - bakedWidth) > 64) paint();
          })
        : null;
    if (cv && ro) ro.observe(cv);

    return () => {
      img.onload = null;
      ro?.disconnect();
    };
  }, [src]);

  return <canvas ref={canvas} width={4} height={3} data-current={current && ready} data-baked={baked || undefined} />;
}
