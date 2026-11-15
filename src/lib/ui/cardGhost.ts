/** Pixels across the picture once shrunk: the fewer, the softer it is when drawn the page's size. */
const SMALL_W = 12;
/** Pixels across the canvas it's drawn back up into, smoothly, so the screen's own stretch adds no steps. */
const SOFT_W = 48;
/** How much darker the soft picture is than the card's (it gives way to the title's dark page). */
const DIM = 0.55;

/**
 * The soft, dark copy of a card's picture for its title page's motion (shell.css `.card-ghost-soft`), painted once
 * into `canvas`: the picture shrunk to a few pixels and drawn back up, which blurs it, then darkened. A blur filter
 * on the picture instead would be worked out again on every frame as the page scales, over the whole screen; this
 * is a still picture the compositor only stretches. A canvas shows a picture from another site as well (only
 * reading its pixels back is barred), so any card's works. Waits for `img` to load when it hasn't yet.
 */
export function paintSoftGhost(canvas: HTMLCanvasElement, img: HTMLImageElement) {
  const paint = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const h = Math.max(1, Math.round((SMALL_W * img.naturalHeight) / img.naturalWidth));
    const small = document.createElement("canvas");
    small.width = SMALL_W;
    small.height = h;
    const s = small.getContext("2d");
    if (!s) return;
    s.imageSmoothingQuality = "high";
    s.drawImage(img, 0, 0, SMALL_W, h);
    canvas.width = SOFT_W;
    canvas.height = Math.max(1, Math.round((SOFT_W * h) / SMALL_W));
    const c = canvas.getContext("2d");
    if (!c) return;
    c.imageSmoothingQuality = "high";
    c.drawImage(small, 0, 0, canvas.width, canvas.height);
    c.fillStyle = `rgba(0, 0, 0, ${DIM})`;
    c.fillRect(0, 0, canvas.width, canvas.height);
  };
  if (img.complete && img.naturalWidth) paint();
  else img.addEventListener("load", paint, { once: true });
}

/**
 * The card's picture for a title page's motion (cardMotion.ts): a plain panel in the page's grey, a soft copy over
 * it and a sharp one over that, each faded by its motion.
 */
export function cardGhostParts(src: string) {
  const panel = document.createElement("div");
  panel.className = "card-ghost-panel";
  const sharp = document.createElement("img");
  sharp.className = "card-ghost-sharp";
  sharp.src = src;
  sharp.alt = "";
  sharp.draggable = false;
  // The card shows this picture already: drawn in the first frame, so the page under it at the card never shows.
  sharp.decoding = "sync";
  const soft = document.createElement("canvas");
  soft.className = "card-ghost-soft";
  paintSoftGhost(soft, sharp);
  return { panel, soft, sharp };
}
