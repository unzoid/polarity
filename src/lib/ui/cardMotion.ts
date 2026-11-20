import type { CardRect } from "./pageMotion";

/**
 * Netflix / iOS 18 Zoom Transition for opening a title out of its card and closing back into it on a phone,
 * measured frame-by-frame at 50fps from Netflix's iOS app:
 *
 * - Open (380ms): critically damped zoom spring (ω = 16.5/s) expanding uniformly from the card's exact rect
 *   with a continuous aspect-ratio clip-path so content never squishes. Sharp poster dissolves into cached
 *   soft blur (10..55ms -> 55..165ms) -> calm dark surface -> detail page revealed cleanly (170..330ms).
 * - Close (280ms): snappy critically damped spring (ω = 19.5/s). The live detail page immediately shrinks
 *   uniformly with rounded corners (0..55ms), crossfades directly into the blurred poster (45..135ms) and
 *   sharp poster (105..195ms), landing pixel-exact on the card slot while Home brightens (0..130ms).
 * - Swipe-back release (`playCardRelease`): shares the exact same uniform-scale + clip-path morph from the
 *   live finger position, seeded with the user's release velocity so flicks land effortlessly in ~180..265ms.
 */
export const CARD_OPEN_MS = 380;
export const CARD_CLOSE_MS = 280;

/** Critically damped spring from 0 to 1 with optional normalized initial velocity `v0` (in 1/s), `t` in ms. */
const spring = (omega: number, v0 = 0) => {
  // Clamp v0 so the spring never overshoots past the target card slot.
  const vel = Math.max(0, Math.min(v0, omega * 1.1));
  return (t: number) => {
    const s = t / 1000;
    return 1 - (1 + (omega - vel) * s) * Math.exp(-omega * s);
  };
};

const OPEN_CURVE = spring(16.5);
const CLOSE_CURVE = spring(19.5);

/** `n` samples of `curve` over `ms`, normalized so offset 0 is 0 and offset 1 is 1. */
function samples(curve: (t: number) => number, ms: number, n = 24) {
  const end = curve(ms) || 1;
  return Array.from({ length: n + 1 }, (_, i) => ({
    offset: i / n,
    p: i === 0 ? 0 : i === n ? 1 : Math.min(1, Math.max(0, curve((ms * i) / n) / end)),
  }));
}

/** Step-linear opacity keyframes over `ms`. */
const fade = (from: number, to: number, t0: number, t1: number, ms: number): Keyframe[] => [
  { offset: 0, opacity: from },
  { offset: Math.min(1, Math.max(0, t0 / ms)), opacity: from },
  { offset: Math.min(1, Math.max(0, t1 / ms)), opacity: to },
  { offset: 1, opacity: to },
];

/** Fast ease-out curve for cancelling a swipe-back cleanly back to fullscreen. */
export const CARD_CANCEL_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

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
  return { sEnd, mediaW, mediaH, clipR, clipB, mediaCover, cardRadius };
}

/** Sizes `.card-ghost-media` to the card's exact unscaled aspect box so at `k=1` it matches the card 1:1. */
function sizeGhostMedia(media: HTMLElement | null | undefined, mediaW: number, mediaH: number, clipR: number) {
  if (!media) return;
  media.style.width = `${mediaW.toFixed(2)}px`;
  media.style.height = `${mediaH.toFixed(2)}px`;
  media.style.transformOrigin = clipR > 0 ? "0% 50%" : "50% 0%";
}

/** Smoothly interpolated visual corner radius (0 at fullscreen, soft iOS ~20px mid-flight, exact cardRadius at card). */
function cornerRadius(k: number, s: number, cardRadius: number): number {
  if (k <= 0.001) return 0;
  const ramp = Math.min(1, k * 8);
  const visual = ramp * (cardRadius * k + 22 * (1 - k));
  return visual / Math.max(0.05, s);
}

type Parts = { page: HTMLElement; scrim: HTMLElement | null; card: CardRect; open: boolean; width: number; height: number };

/** Plays a title page's Netflix zoom morph out of its card (`open`) or back into it; returns a stop callback. */
export function playCardMotion({ page, scrim, card, open, width, height }: Parts): () => void {
  if (typeof page.animate !== "function") return () => {};
  const { sEnd, mediaW, mediaH, clipR, clipB, mediaCover, cardRadius } = cardGeometry(card, width, height);
  const ms = open ? CARD_OPEN_MS : CARD_CLOSE_MS;
  const curve = open ? OPEN_CURVE : CLOSE_CURVE;
  const pts = samples(curve, ms);
  const opts: KeyframeAnimationOptions = { duration: ms, easing: "linear", fill: "both" };

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

  // Uniformly zoom the poster media inside the expanding/shrinking clipped box so the poster fills 100% with zero distortion.
  if (media) {
    play(
      media,
      pts.map(({ offset, p }) => {
        const k = open ? 1 - p : p;
        const msScale = 1 + (mediaCover - 1) * (1 - k);
        return { offset, transform: `scale(${msScale.toFixed(4)})` };
      }),
    );
  }

  if (open) {
    play(panel, fade(1, 1, 0, ms, ms));
    play(soft, fade(1, 0, 55, 165, ms));
    play(sharp, fade(1, 0, 10, 55, ms));
    play(ghost, fade(1, 0, 170, 330, ms));
    play(scrim, fade(0, 0.72, 0, 170, ms));
  } else {
    // Live detail page shrinks cleanly first, then dissolves directly into soft -> sharp poster (no heavy grey curtain).
    play(panel, fade(0, 0.45, 35, 110, ms));
    play(soft, fade(0, 1, 45, 135, ms));
    play(sharp, fade(0, 1, 105, 195, ms));
    play(scrim, fade(0.32, 0, 0, 130, ms));
  }

  return () => {
    running.forEach((a) => a.cancel());
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
 * with velocity handoff and the same uniform-scale + clip-path morph as tap-Back. Returns duration (ms) & animations.
 */
export function playCardRelease({ page, scrim, ghost, card, width, height, from, velocity }: CardRelease): { ms: number; animations: Animation[] } {
  const { sEnd, mediaW, mediaH, clipR, clipB, mediaCover, cardRadius } = cardGeometry(card, width, height);
  const remain = Math.max(0.15, Math.min(1, (from.scale - sEnd) / Math.max(0.01, 1 - sEnd)));
  const speedBoost = Math.min(0.32, Math.max(0, velocity) / 3600);
  const ms = Math.round(Math.max(175, Math.min(CARD_CLOSE_MS, CARD_CLOSE_MS * (0.55 + 0.45 * remain) * (1 - speedBoost))));

  if (typeof page.animate !== "function") return { ms, animations: [] };

  // Seed critically damped spring with normalized velocity along the remaining scale travel.
  const omega = 19.5;
  const v0 = Math.max(0, velocity / Math.max(200, width)) * 2.4;
  const pts = samples(spring(omega, v0), ms, 20);
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
        const msScale = mediaCover + (1 - mediaCover) * p;
        return { offset, transform: `scale(${msScale.toFixed(4)})` };
      }),
    );
  }

  play(panel, fade(0, 0.45, ms * 0.1, ms * 0.4, ms));
  play(soft, fade(0, 1, ms * 0.12, ms * 0.48, ms));
  play(sharp, fade(0, 1, ms * 0.35, ms * 0.72, ms));
  if (scrim) {
    play(scrim, fade(from.scrimOpacity, 0, 0, ms * 0.55, ms));
  }

  return { ms, animations };
}
