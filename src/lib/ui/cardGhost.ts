/** Width of the cached tiny blur canvas: 24px across (~864 pixels), so painting and copying takes <0.05ms. */
const BLUR_W = 24;
/** Output canvas width drawn smoothly up from BLUR_W so GPU scaling has zero banding. */
const SOFT_W = 48;
const CACHE_LIMIT = 24;

/** Cached tiny pre-blurred canvases by image URL (copying a tainted canvas via drawImage never throws). */
const blurCache = new Map<string, HTMLCanvasElement>();

function cachePut(src: string, canvas: HTMLCanvasElement) {
  if (blurCache.has(src)) blurCache.delete(src);
  else if (blurCache.size >= CACHE_LIMIT) {
    const oldest = blurCache.keys().next().value;
    if (oldest !== undefined) blurCache.delete(oldest);
  }
  blurCache.set(src, canvas);
}

function buildBlurCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
  if (!img.naturalWidth || !img.naturalHeight) return null;
  const smallH = Math.max(1, Math.round((BLUR_W * img.naturalHeight) / img.naturalWidth));
  const small = document.createElement("canvas");
  small.width = BLUR_W;
  small.height = smallH;
  const s = small.getContext("2d");
  if (!s) return null;
  s.imageSmoothingQuality = "medium";
  s.drawImage(img, 0, 0, BLUR_W, smallH);
  s.fillStyle = "rgba(0, 0, 0, 0.28)";
  s.fillRect(0, 0, BLUR_W, smallH);
  return small;
}

function blitSoft(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  target.width = SOFT_W;
  target.height = Math.max(1, Math.round((SOFT_W * source.height) / source.width));
  const c = target.getContext("2d");
  if (!c) return;
  c.imageSmoothingQuality = "medium";
  c.drawImage(source, 0, 0, target.width, target.height);
}

/**
 * Pre-warms the tiny blurred poster copy on pointerdown (0 network requests, <0.05ms), using the
 * already-decoded <img> on the card so frame 0 of open and close never does decode/blur work.
 */
export function warmCardGhost(src: string, sourceImg?: HTMLImageElement | null) {
  if (!src || blurCache.has(src)) return;
  if (!sourceImg || !sourceImg.complete || !sourceImg.naturalWidth) return;
  const built = buildBlurCanvas(sourceImg);
  if (built) cachePut(src, built);
}

/**
 * The card's picture layers for the Netflix zoom transition (cardMotion.ts):
 * - `panel`: calm dark page surface behind the poster
 * - `media`: aspect-matched wrapper holding `soft` (cached blurred canvas) and `sharp` (card poster)
 *   that scales uniformly as the card expands/shrinks, eliminating vertical squash and per-frame blur cost.
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
  sharp.src = src;
  sharp.alt = "";
  sharp.draggable = false;
  sharp.decoding = "sync";

  const cached = blurCache.get(src);
  if (cached) {
    blitSoft(soft, cached);
  } else {
    const paint = (img: HTMLImageElement) => {
      const built = blurCache.get(src) ?? buildBlurCanvas(img);
      if (!built) return;
      cachePut(src, built);
      blitSoft(soft, built);
    };
    if (sourceImg?.complete && sourceImg.naturalWidth) paint(sourceImg);
    else if (sharp.complete && sharp.naturalWidth) paint(sharp);
    else sharp.addEventListener("load", () => paint(sharp), { once: true });
  }

  media.append(soft, sharp);
  return { panel, media, soft, sharp };
}
