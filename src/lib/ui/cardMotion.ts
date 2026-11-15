import type { CardRect } from "./pageMotion";

/**
 * A title's page out of the card that opened it, and back into it, on a phone: Netflix's, measured frame by frame
 * from its app (51 frames a second).
 *
 * Open: the card lifts at once and grows to the screen on a critically damped spring (ω 13.4/s: half way at 125ms,
 * 80% at 225ms, 92% at 315ms). Its picture goes out of focus in the first 90ms, turns into a plain panel by 190ms,
 * and the title's page fades in over the panel from 300 to 480ms. What's behind goes dark in the first 200ms.
 * Back: on the open's pace (half way in about 105ms, 90% by 345ms), from a fast start as a dismissal has: the page
 * shrinks into the card, dimming under the panel, and the card's picture comes back into focus as it lands (very
 * soft, a little soft, sharp), ending exactly on the card, so the card simply takes its place. What's behind is lit
 * again in the first 150ms.
 *
 * Played with the Web Animations API from keyframes sampled off those curves, so the curves are exact and the
 * compositor plays them.
 */
export const CARD_OPEN_MS = 520;
export const CARD_CLOSE_MS = 540;

/** Critically damped spring from 0 to 1, ω in 1/s, t in ms. */
const spring = (omega: number) => (t: number) => {
  const u = (omega * t) / 1000;
  return 1 - (1 + u) * Math.exp(-u);
};
/** Exponential ease-out from 0 to 1, time constant `tau` ms. */
const decay = (tau: number) => (t: number) => 1 - Math.exp(-t / tau);

const OPEN = spring(13.4);
const CLOSE = decay(150);

/** `n` samples of `curve` over `ms`, the last one exactly 1. */
function samples(curve: (t: number) => number, ms: number, n = 30) {
  const end = curve(ms);
  return Array.from({ length: n + 1 }, (_, i) => ({ offset: i / n, p: i === n ? 1 : curve((ms * i) / n) / end }));
}

/** A step in opacity: `from` until `t0`, `to` from `t1`, linear between (ms within `ms`). */
const fade = (from: number, to: number, t0: number, t1: number, ms: number): Keyframe[] => [
  { offset: 0, opacity: from },
  { offset: t0 / ms, opacity: from },
  { offset: t1 / ms, opacity: to },
  { offset: 1, opacity: to },
];

/** The CSS easing of the swipe back's release (pageDrag.ts), close to `CLOSE` over `CARD_CLOSE_MS`. */
export const CARD_CLOSE_EASE = "cubic-bezier(0.16, 0.56, 0.3, 1)";

/** Back's ghost, also the swipe back's (pageDrag.ts) from the moment the finger lets go. */
export const ghostCloseFades = {
  panel: fade(0, 0.7, 30, 150, CARD_CLOSE_MS),
  soft: fade(0, 1, 120, 210, CARD_CLOSE_MS),
  medium: fade(0, 1, 210, 310, CARD_CLOSE_MS),
  sharp: fade(0, 1, 300, 440, CARD_CLOSE_MS),
};

type Parts = { page: HTMLElement; scrim: HTMLElement | null; card: CardRect; open: boolean; width: number; height: number };

/** Plays a title page's motion out of its card (`open`) or back into it; returns what stops it. */
export function playCardMotion({ page, scrim, card, open, width, height }: Parts): () => void {
  if (typeof page.animate !== "function") return () => {};
  const sx = card.w / width;
  const sy = card.h / height;
  const at = (p: number) => {
    const k = open ? 1 - p : p; // how far towards the card
    return `translate(${card.x * k}px, ${card.y * k}px) scale(${1 - (1 - sx) * k}, ${1 - (1 - sy) * k})`;
  };
  const ms = open ? CARD_OPEN_MS : CARD_CLOSE_MS;
  const opts: KeyframeAnimationOptions = { duration: ms, easing: "linear", fill: "both" };
  const ghost = page.querySelector<HTMLElement>(":scope > .card-ghost");
  const part = (name: string) => ghost?.querySelector<HTMLElement>(`:scope > .card-ghost-${name}`);
  const running: Animation[] = [];
  const play = (el: HTMLElement | null | undefined, frames: Keyframe[]) => el && running.push(el.animate(frames, opts));

  play(page, samples(open ? OPEN : CLOSE, ms).map(({ offset, p }) => ({ offset, transform: at(p) })));
  if (open) {
    play(part("panel"), fade(1, 1, 0, ms, ms));
    play(part("sharp"), fade(1, 0, 10, 45, ms));
    play(part("medium"), fade(1, 0, 45, 90, ms));
    play(part("soft"), fade(1, 0, 90, 190, ms));
    play(ghost, fade(1, 0, 300, 480, ms));
    play(scrim, samples(decay(80), ms).map(({ offset, p }) => ({ offset, opacity: 0.9 * p })));
  } else {
    for (const name of ["panel", "soft", "medium", "sharp"] as const) play(part(name), ghostCloseFades[name]);
    play(scrim, samples(decay(50), ms).map(({ offset, p }) => ({ offset, opacity: 0.35 * (1 - p) })));
  }
  return () => running.forEach((a) => a.cancel());
}
