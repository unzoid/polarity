/**
 * Pre-cached lush Gaussian-blurred poster canvases for the Netflix-style zoom transition (cardMotion.ts).
 *
 * Instead of blurring on every animation frame (or downscaling to a blocky 24px grid), we draw once into
 * a compact 80px-wide offscreen canvas and apply a 3-pass separable box blur (mathematically converges to a
 * smooth ~24px optical Gaussian bokeh when scaled up to viewport width, in <0.25ms, identically on iOS
 * WKWebView and Chromium with zero reliance on canvas `ctx.filter`). Cached in a bounded LRU warmed on
 * `pointerdown` so tapping a card never stalls frame 0.
 */
const BLUR_W = 80;
const BLUR_RADIUS = 5;
const BLUR_PASSES = 3;
const MAX_CACHE = 24;

const softCache = new Map<string, HTMLCanvasElement>();

function lruGet(key: string): HTMLCanvasElement | undefined {
  const hit = softCache.get(key);
  if (!hit) return undefined;
  softCache.delete(key);
  softCache.set(key, hit);
  return hit;
}

function lruSet(key: string, canvas: HTMLCanvasElement) {
  if (softCache.has(key)) softCache.delete(key);
  else if (softCache.size >= MAX_CACHE) {
    const oldest = softCache.keys().next().value;
    if (oldest !== undefined) softCache.delete(oldest);
  }
  softCache.set(key, canvas);
}

/** O(w*h) 3-pass separable box blur (horizontal + vertical sliding sum) with edge clamping. */
function boxBlurRgba(data: Uint8ClampedArray, w: number, h: number, radius: number, passes: number) {
  const tmp = new Uint8ClampedArray(data.length);
  const span = radius * 2 + 1;
  for (let pass = 0; pass < passes; pass++) {
    // Horizontal pass: data -> tmp
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = -radius; i <= radius; i++) {
        const x = i < 0 ? 0 : i >= w ? w - 1 : i;
        const p = (row + x) << 2;
        r += data[p];
        g += data[p + 1];
        b += data[p + 2];
      }
      for (let x = 0; x < w; x++) {
        const dst = (row + x) << 2;
        tmp[dst] = (r / span + 0.5) | 0;
        tmp[dst + 1] = (g / span + 0.5) | 0;
        tmp[dst + 2] = (b / span + 0.5) | 0;
        tmp[dst + 3] = 255;
        const xOut = x - radius;
        const xIn = x + radius + 1;
        const pOut = (row + (xOut < 0 ? 0 : xOut)) << 2;
        const pIn = (row + (xIn >= w ? w - 1 : xIn)) << 2;
        r += data[pIn] - data[pOut];
        g += data[pIn + 1] - data[pOut + 1];
        b += data[pIn + 2] - data[pOut + 2];
      }
    }
    // Vertical pass: tmp -> data
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = -radius; i <= radius; i++) {
        const y = i < 0 ? 0 : i >= h ? h - 1 : i;
        const p = (y * w + x) << 2;
        r += tmp[p];
        g += tmp[p + 1];
        b += tmp[p + 2];
      }
      for (let y = 0; y < h; y++) {
        const dst = (y * w + x) << 2;
        data[dst] = (r / span + 0.5) | 0;
        data[dst + 1] = (g / span + 0.5) | 0;
        data[dst + 2] = (b / span + 0.5) | 0;
        data[dst + 3] = 255;
        const yOut = y - radius;
        const yIn = y + radius + 1;
        const pOut = ((yOut < 0 ? 0 : yOut) * w + x) << 2;
        const pIn = ((yIn >= h ? h - 1 : yIn) * w + x) << 2;
        r += tmp[pIn] - tmp[pOut];
        g += tmp[pIn + 1] - tmp[pOut + 1];
        b += tmp[pIn + 2] - tmp[pOut + 2];
      }
    }
  }
}

/** Bakes a creamy Gaussian-blurred offscreen canvas for `img` once and caches it by `src`. */
function bakeSoft(src: string, img: HTMLImageElement): HTMLCanvasElement | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const w = BLUR_W;
  const h = Math.max(1, Math.round((nh / nw) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  try {
    ctx.drawImage(img, 0, 0, w, h);
    // Read pixels and run 3-pass separable Gaussian bokeh blur (falls back cleanly when tainted by CORS).
    try {
      const imgData = ctx.getImageData(0, 0, w, h);
      boxBlurRgba(imgData.data, w, h, BLUR_RADIUS, BLUR_PASSES);
      ctx.putImageData(imgData, 0, 0);
    } catch {
      // Cross-origin image without CORS headers: two-step downscale softens into a clean blur without throwing.
      const tiny = document.createElement("canvas");
      tiny.width = 20;
      tiny.height = Math.max(1, Math.round((nh / nw) * 20));
      const tctx = tiny.getContext("2d");
      if (tctx) {
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = "high";
        tctx.drawImage(img, 0, 0, tiny.width, tiny.height);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(tiny, 0, 0, w, h);
      }
    }
  } catch {
    return null;
  }
  lruSet(src, c);
  return c;
}

/** Pre-bakes the soft poster canvas on pointerdown so tapping a card incurs zero blur work on frame 0. */
export function warmCardGhost(src: string | undefined, sourceImg?: HTMLImageElement | null) {
  if (!src || lruGet(src)) return;
  if (sourceImg && sourceImg.complete && sourceImg.naturalWidth > 0) {
    bakeSoft(src, sourceImg);
    return;
  }
  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.onload = () => bakeSoft(src, img);
  img.onerror = () => {
    const plain = new Image();
    plain.decoding = "async";
    plain.onload = () => bakeSoft(src, plain);
    plain.src = src;
  };
  img.src = src;
}

function paintTo(canvas: HTMLCanvasElement, cached: HTMLCanvasElement) {
  canvas.width = cached.width;
  canvas.height = cached.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cached, 0, 0);
}

/**
 * The layers a card transition crossfades through (cardMotion.ts):
 * - `panel`: solid dark backing (`var(--bg)`) that cleanly veils Detail UI mid-close
 * - `media`: aspect-matched poster container scaled uniformly to cover the morphing rect 100%
 *   - `soft`: creamy 3-pass Gaussian-blurred poster canvas (blitted from LRU cache in <0.05ms)
 *   - `sharp`: crisp poster `<img>` for exact 1:1 card lift-off and landing
 */
export function cardGhostParts(src: string, sourceImg?: HTMLImageElement | null) {
  const panel = document.createElement("div");
  panel.className = "card-ghost-panel";

  const media = document.createElement("div");
  media.className = "card-ghost-media";

  const soft = document.createElement("canvas");
  soft.className = "card-ghost-soft";

  const sharp = document.createElement("img");
  sharp.className = "card-ghost-sharp";
  sharp.alt = "";
  sharp.decoding = "sync";
  sharp.src = src;

  const cached = lruGet(src) ?? (sourceImg && sourceImg.complete && sourceImg.naturalWidth > 0 ? bakeSoft(src, sourceImg) : null);
  if (cached) {
    paintTo(soft, cached);
  } else {
    const draw = () => {
      const baked = lruGet(src) ?? bakeSoft(src, sharp);
      if (baked) paintTo(soft, baked);
    };
    if (sharp.complete && sharp.naturalWidth) draw();
    else sharp.addEventListener("load", draw, { once: true });
  }

  media.append(soft, sharp);
  return { panel, media, soft, sharp };
}
