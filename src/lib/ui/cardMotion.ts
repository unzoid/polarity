import type { CardRect } from "./pageMotion";

/**
 * 1:1 Netflix / iOS 18 `UIViewController.Transition.zoom` for opening a title out of its card and closing
 * back into it on a phone, matched frame-by-frame against uncompressed 60fps/120fps iOS screen recordings.
 *
 * Key physics insight from frame-by-frame analysis:
 * A zero-initial-velocity spring `1 - (1 + ωt)e^(-ωt)` has `f'(0) = 0`, which causes ~45ms of dead startup
 * followed by a rushed linear middle. Apple's zoom transition uses an immediate-launch exponential decay
 * `p(t) = (1 - e^(-k·t)) / (1 - e^(-k·T))`:
 * - Frame 0 launches instantaneously (zero perceived lag on tap or back press),
 * - Velocity strictly decelerates from millisecond 0 through the finish (never linear),
 * - The final ~180–200ms forms a long, silky ease-out tail gently settling into the card slot or fullscreen.
 */
export const CARD_OPEN_MS = 480;
export const CARD_CLOSE_MS = 440;

/**
 * Normalized exponential ease-out curve from 0 to 1 over `ms` with decay rate `k` (1/s).
 * Immediate non-zero initial velocity (`f'(0) > 0`), monotonic deceleration, long silky settling tail.
 */
const expEaseOut = (k: number, ms: number) => {
  const end = 1 - Math.exp((-k * ms) / 1000) || 1;
  return (t: number) => (1 - Math.exp((-k * t) / 1000)) / end;
};

/** `n` samples of `curve` over `ms`, normalized so offset 0 is 0 and offset 1 is 1. */
function samples(curve: (t: number) => number, ms: number, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => ({
    offset: i / n,
    p: i === 0 ? 0 : i === n ? 1 : Math.min(1, Math.max(0, curve((ms * i) / n))),
  }));
}

/** Step-linear opacity keyframes over `ms`. */
const fade = (from: number, to: number, t0: number, t1: number, ms: number): Keyframe[] => [
  { offset: 0, opacity: from },
  { offset: Math.min(1, Math.max(0, t0 / ms)), opacity: from },
  { offset: Math.min(1, Math.max(0, t1 / ms)), opacity: to },
  { offset: 1, opacity: to },
];

/** Smooth ease-out curve for cancelling a swipe-back back to fullscreen. */
export const CARD_CANCEL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Uniform-scale + aspect-ratio clip geometry between a full-screen page (`width` × `height`) and `card`.
 * Because scale is always uniform (`sEnd = max(cw/W, ch/H)`), faces, logos, and buttons never squish.
 */
export function cardGeometry(card: CardRect, width: number, height: number) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const sEnd = Math.min(1, Math.max(card.w / w, card.h / h));
  const mediaW = Math.min(w, card.w / sEnd);
  const mediaH = Math.min(h, card.h / sEnd);
  const clipR = Math.max(0, w - mediaW);
  const clipB = Math.max(0, h - mediaH);
  const mediaCover = Math.max(w / Math.max(1, mediaW), h / Math.max(1, mediaH));
  const cardRadius = card.radius ?? 8;
  return { w, h, sEnd, mediaW, mediaH, clipR, clipB, mediaCover, cardRadius };
}

/** Sizes `.card-ghost-media` to the card's exact unscaled aspect box so at `k=1` it matches the card 1:1. */
function sizeGhostMedia(media: HTMLElement | null | undefined, mediaW: number, mediaH: number, clipR: number) {
  if (!media) return;
  media.style.width = `${mediaW.toFixed(2)}px`;
  media.style.height = `${mediaH.toFixed(2)}px`;
  media.style.transformOrigin = clipR > 0 ? "0% 50%" : "50% 0%";
}

/**
 * Visual corner radius curve matching iOS 18 zoom transition:
 * `0` at flush fullscreen (`k = 0`), ramping immediately to smooth iPhone display corner curvature (`~40px`
 * visual off the screen edges) and smoothly blending down to the card's exact corner radius (`8px`/`14px`) at `k = 1`.
 */
function cornerRadius(k: number, s: number, cardRadius: number): number {
  if (k <= 0.001) return 0;
  const ramp = Math.min(1, k * 10);
  const visual = ramp * (cardRadius * k + 40 * (1 - k));
  return visual / Math.max(0.05, s);
}

/** Exact uniform scale so `.card-ghost-media` covers 100% of the live clipped box `(w - clipR*k) × (h - clipB*k)` at every `k`. */
function mediaScaleAt(k: number, w: number, h: number, mediaW: number, mediaH: number, clipR: number, clipB: number) {
  const visW = Math.max(1, w - clipR * k);
  const visH = Math.max(1, h - clipB * k);
  return Math.max(1, visW / Math.max(1, mediaW), visH / Math.max(1, mediaH));
}

type Parts = { page: HTMLElement; scrim: HTMLElement | null; card: CardRect; open: boolean; width: number; height: number };

/** Plays a title page's 1:1 Netflix zoom morph out of its card (`open`) or back into it; returns a stop callback. */
export function playCardMotion({ page, scrim, card, open, width, height }: Parts): () => void {
  if (typeof page.animate !== "function") return () => {};
  const { w, h, sEnd, mediaW, mediaH, clipR, clipB, cardRadius } = cardGeometry(card, width, height);
  const ms = open ? CARD_OPEN_MS : CARD_CLOSE_MS;
  const pts = samples(expEaseOut(open ? 8.4 : 8.2, ms), ms, 40);
  const opts: KeyframeAnimationOptions = { duration: ms, easing: "linear", fill: "both" };

  // Hide the source card in its shelf slot while in flight so a duplicate poster never shows underneath.
  const slot = card.el?.isConnected ? card.el : null;
  if (slot) slot.style.visibility = "hidden";

  const ghost = page.querySelector<HTMLElement>(":scope > .card-ghost");
  const panel = ghost?.querySelector<HTMLElement>(":scope > .card-ghost-panel");
  const media = ghost?.querySelector<HTMLElement>(":scope > .card-ghost-media");
  const soft = media?.querySelector<HTMLElement>(":scope > .card-ghost-soft");
  const sharp = media?.querySelector<HTMLElement>(":scope > .card-ghost-sharp");
  sizeGhostMedia(media, mediaW, mediaH, clipR);

  const running: Animation[] = [];
  const play = (el: HTMLElement | null | undefined, frames: Keyframe[]) => {
    if (el) running.push(el.animate(frames, opts));
  };

  play(
    page,
    pts.map(({ offset, p }) => {
      const k = open ? 1 - p : p; // 0 = fullscreen, 1 = seated on card
      const s = 1 - (1 - sEnd) * k;
      const tx = card.x * k;
      const ty = card.y * k;
      const r = cornerRadius(k, s, cardRadius);
      return {
        offset,
        transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(4)})`,
        clipPath: `inset(0px ${(clipR * k).toFixed(2)}px ${(clipB * k).toFixed(2)}px 0px round ${r.toFixed(2)}px)`,
      };
    }),
  );

  // Uniformly scale poster media so it fills 100% of the live clipped rect on every single frame.
  if (media) {
    play(
      media,
      pts.map(({ offset, p }) => {
        const k = open ? 1 - p : p;
        const msScale = mediaScaleAt(k, w, h, mediaW, mediaH, clipR, clipB);
        return { offset, transform: `scale(${msScale.toFixed(4)})` };
      }),
    );
  }

  if (open) {
    // Crisp card lifts -> true GPU Gaussian-blurred poster stays lush through expansion -> blooms into Detail.
    play(panel, fade(1, 1, 0, ms, ms));
    play(sharp, fade(1, 0, 8, 65, ms));
    play(soft, fade(1, 0, 155, 320, ms));
    play(ghost, fade(1, 0, 165, 370, ms));
    play(scrim, fade(0, 0.72, 0, 210, ms));
  } else {
    // Immediate launch -> opaque dark floor + Gaussian bokeh poster veil Detail -> gently sharpens into slot.
    play(ghost, fade(1, 1, 0, ms, ms));
    play(panel, fade(0, 1, 65, 160, ms));
    play(soft, fade(0, 1, 75, 175, ms));
    play(sharp, fade(0, 1, 185, 345, ms));
    play(scrim, fade(0.72, 0, 0, 280, ms));
  }

  return () => {
    running.forEach((a) => a.cancel());
    if (slot) slot.style.removeProperty("visibility");
  };
}

export type CardRelease = {
  page: HTMLElement;
  scrim: HTMLElement | null;
  ghost: HTMLElement | null;
  card: CardRect;
  width: number;
  height: number;
  from: { x: number; y: number; scale: number; radius: number; scrimOpacity: number };
  /** Horizontal release velocity in CSS px/s (rightwards positive). */
  velocity: number;
};

/**
 * Finishes an interactive swipe-back into `card` starting from the finger's exact live `(x, y, scale, radius)`
 * with velocity-weighted exponential ease-out so it launches immediately and glides gently into the card slot.
 */
export function playCardRelease({ page, scrim, ghost, card, width, height, from, velocity }: CardRelease): { ms: number; animations: Animation[] } {
  const { w, h, sEnd, mediaW, mediaH, clipR, clipB, cardRadius } = cardGeometry(card, width, height);
  const remain = Math.max(0.25, Math.min(1, (from.scale - sEnd) / Math.max(0.01, 1 - sEnd)));
  const speedBoost = Math.min(0.26, Math.max(0, velocity) / 4000);
  const ms = Math.round(Math.max(280, Math.min(CARD_CLOSE_MS, CARD_CLOSE_MS * (0.64 + 0.36 * remain) * (1 - speedBoost))));

  if (typeof page.animate !== "function") return { ms, animations: [] };

  // Higher flick velocity starts faster while preserving the long silky exponential settling tail.
  const k = 8.2 + Math.min(3.2, Math.max(0, velocity) / 600);
  const pts = samples(expEaseOut(k, ms), ms, 36);
  const opts: KeyframeAnimationOptions = { duration: ms, easing: "linear", fill: "forwards" };

  const panel = ghost?.querySelector<HTMLElement>(":scope > .card-ghost-panel");
  const media = ghost?.querySelector<HTMLElement>(":scope > .card-ghost-media");
  const soft = media?.querySelector<HTMLElement>(":scope > .card-ghost-soft");
  const sharp = media?.querySelector<HTMLElement>(":scope > .card-ghost-sharp");
  sizeGhostMedia(media, mediaW, mediaH, clipR);

  const animations: Animation[] = [];
  const play = (el: HTMLElement | null | undefined, frames: Keyframe[]) => {
    if (el) animations.push(el.animate(frames, opts));
  };

  const endRadius = cardRadius / Math.max(0.05, sEnd);
  play(
    page,
    pts.map(({ offset, p }) => {
      const tx = from.x + (card.x - from.x) * p;
      const ty = from.y + (card.y - from.y) * p;
      const s = from.scale + (sEnd - from.scale) * p;
      const r = from.radius + (endRadius - from.radius) * p;
      return {
        offset,
        transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(4)})`,
        clipPath: `inset(0px ${(clipR * p).toFixed(2)}px ${(clipB * p).toFixed(2)}px 0px round ${r.toFixed(2)}px)`,
      };
    }),
  );

  if (media) {
    play(
      media,
      pts.map(({ offset, p }) => {
        const msScale = mediaScaleAt(p, w, h, mediaW, mediaH, clipR, clipB);
        return { offset, transform: `scale(${msScale.toFixed(4)})` };
      }),
    );
  }

  play(ghost, fade(1, 1, 0, ms, ms));
  play(panel, fade(0, 1, ms * 0.1, ms * 0.38, ms));
  play(soft, fade(0, 1, ms * 0.12, ms * 0.42, ms));
  play(sharp, fade(0, 1, ms * 0.44, ms * 0.82, ms));
  if (scrim) {
    play(scrim, fade(from.scrimOpacity, 0, 0, ms * 0.72, ms));
  }

  return { ms, animations };
}
