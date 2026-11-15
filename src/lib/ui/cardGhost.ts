/** Pixels across the canvas a blurred copy is drawn back up into, smoothly, so the screen's own stretch adds no steps. */
const SOFT_W = 64;

/**
 * The blurred copies of a card's picture, from the most blurred: pixels across the picture once shrunk (the fewer,
 * the softer it is when drawn the page's size), and how much darker it is than the card's. Faded one over the other
 * they read as the picture coming into focus, or going out of it, rather than one copy swapped for another.
 */
const BLURS = { soft: { across: 10, dim: 0.55 }, medium: { across: 30, dim: 0.2 } };

/**
 * A blurred, darkened copy of a card's picture for its title page's motion (shell.css `.card-ghost`), painted once
 * into `canvas`: the picture shrunk to a few pixels and drawn back up, which blurs it. A blur filter on the picture
 * instead would be worked out again on every frame as the page scales, over the whole screen; this is a still
 * picture the compositor only stretches. A canvas shows a picture from another site as well (only reading its
 * pixels back is barred), so any card's works. Waits for `img` to load when it hasn't yet.
 */
function paintBlurred(canvas: HTMLCanvasElement, img: HTMLImageElement, across: number, dim: number) {
  const paint = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const h = Math.max(1, Math.round((across * img.naturalHeight) / img.naturalWidth));
    const small = document.createElement("canvas");
    small.width = across;
    small.height = h;
    const s = small.getContext("2d");
    if (!s) return;
    s.imageSmoothingQuality = "high";
    s.drawImage(img, 0, 0, across, h);
    canvas.width = SOFT_W;
    canvas.height = Math.max(1, Math.round((SOFT_W * h) / across));
    const c = canvas.getContext("2d");
    if (!c) return;
    c.imageSmoothingQuality = "high";
    c.drawImage(small, 0, 0, canvas.width, canvas.height);
    c.fillStyle = `rgba(0, 0, 0, ${dim})`;
    c.fillRect(0, 0, canvas.width, canvas.height);
  };
  if (img.complete && img.naturalWidth) paint();
  else img.addEventListener("load", paint, { once: true });
}

/**
 * The card's picture for a title page's motion (cardMotion.ts), bottom to top: a plain panel in the page's grey,
 * the picture blurred a lot, blurred a little, and sharp, each faded by the motion.
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
  const blurred = (kind: keyof typeof BLURS) => {
    const canvas = document.createElement("canvas");
    canvas.className = `card-ghost-${kind}`;
    paintBlurred(canvas, sharp, BLURS[kind].across, BLURS[kind].dim);
    return canvas;
  };
  return { panel, soft: blurred("soft"), medium: blurred("medium"), sharp };
}
