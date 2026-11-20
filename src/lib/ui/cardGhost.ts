/**
 * Poster ghost layers for the Netflix-style zoom transition (cardMotion.ts).
 *
 * Uses the already-decoded full-resolution `<img>` for BOTH the blurred (`soft`) and crisp (`sharp`) layers.
 * `soft` applies a constant GPU-composited `filter: blur(18px)` in CSS (shell.css) while only animating
 * `opacity` on the compositor — producing true smooth optical Gaussian bokeh on EVERY cross-origin poster
 * with zero CORS errors, zero canvas allocation, and zero 20px-downscale pixelation.
 */

/** Pre-decodes `src` on pointerdown if not already loaded on the tapped card. */
export function warmCardGhost(src: string | undefined, sourceImg?: HTMLImageElement | null) {
  if (!src) return;
  if (sourceImg && sourceImg.complete && sourceImg.naturalWidth > 0) return;
  const img = new Image();
  img.decoding = "async";
  img.src = src;
}

/**
 * The layers a card transition crossfades through (cardMotion.ts):
 * - `panel`: solid dark backing (`var(--bg)`) that cleanly veils Detail UI mid-close
 * - `media`: aspect-matched poster container scaled uniformly to cover the morphing rect 100%
 *   - `soft`: full-res poster `<img>` with static GPU `filter: blur(18px)` (never pixelated, works cross-origin)
 *   - `sharp`: crisp poster `<img>` for exact 1:1 card lift-off and landing
 */
export function cardGhostParts(src: string, _sourceImg?: HTMLImageElement | null) {
  const panel = document.createElement("div");
  panel.className = "card-ghost-panel";

  const media = document.createElement("div");
  media.className = "card-ghost-media";

  const soft = document.createElement("img");
  soft.className = "card-ghost-soft";
  soft.alt = "";
  soft.decoding = "sync";
  soft.src = src;

  const sharp = document.createElement("img");
  sharp.className = "card-ghost-sharp";
  sharp.alt = "";
  sharp.decoding = "sync";
  sharp.src = src;

  media.append(soft, sharp);
  return { panel, media, soft, sharp };
}
