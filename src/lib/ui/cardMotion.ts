import type { CardRect } from "./pageMotion";

/**
 * A title's page out of the card that opened it, and back into it, on a phone: Netflix's, measured frame by frame
 * from its app (51 frames a second).
 *
 * Open: the card lifts at once and grows to the screen on a critically damped spring (ω 13.4/s: half way at 125ms,
 * 80% at 225ms, 92% at 315ms). Its picture softens within the first 60ms, turns into a plain panel by 190ms, and
 * the title's page fades in over the panel from 300 to 480ms. What's behind goes dark in the first 200ms.
 * Back: the page shrinks into the card on an exponential ease-out (63% of the way in 108ms), its contents dimming
 * under the panel, then the picture comes back soft (110–165ms) and sharp (170–240ms), and what's behind is lit
 * again in the first 150ms. About as long as the open, as Netflix's is.
 *
 * Played with the Web Animations API from keyframes sampled off those curves, so the curves are exact and the
 * compositor plays them, whatever the page's first render is doing, from the frame the page is committed.
 */
export const CARD_OPEN_MS = 520;
export const CARD_CLOSE_MS = 420;

/** Critically damped spring from 0 to 1, ω in 1/s, t in ms. */
const spring = (omega: number) => (t: number) => {
  const u = (omega * t) / 1000;
  return 1 - (1 + u) * Math.exp(-u);
};
/** Exponential ease-out from 0 to 1, time constant `tau` ms. */
const decay = (tau: number) => (t: number) => 1 - Math.exp(-t / tau);

const OPEN = spring(13.4);
const CLOSE = decay(108);

/** `n` samples of `curve` over `ms`, the last one exactly 1. */
function samples(curve: (t: number) => number, ms: number, n = 28) {
  const end = curve(ms);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (ms * i) / n;
    return { offset: i / n, p: i === n ? 1 : curve(t) / end };
  });
}

/** A step in opacity: `from` until `t0`, `to` from `t1`, linear between (ms within `ms`). */
const fade = (from: number, to: number, t0: number, t1: number, ms: number): Keyframe[] => [
  { offset: 0, opacity: from },
  { offset: t0 / ms, opacity: from },
  { offset: t1 / ms, opacity: to },
  { offset: 1, opacity: to },
];

/** The CSS easing of the swipe back's release (pageDrag.ts), close to `CLOSE` over `CARD_CLOSE_MS`. */
export const CARD_CLOSE_EASE = "cubic-bezier(0.15, 0.58, 0.3, 1)";

/** The swipe back's ghost (pageDrag.ts): Back's own fades, from the moment the finger lets go. */
export const ghostCloseFades = {
  panel: fade(0, 0.7, 30, 140, CARD_CLOSE_MS),
  soft: fade(0, 1, 110, 165, CARD_CLOSE_MS),
  sharp: fade(0, 1, 170, 240, CARD_CLOSE_MS),
  page: fade(1, 0, 370, CARD_CLOSE_MS, CARD_CLOSE_MS),
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
  const curve = samples(open ? OPEN : CLOSE, ms);
  const opts: KeyframeAnimationOptions = { duration: ms, easing: "linear", fill: "both" };
  const ghost = page.querySelector<HTMLElement>(":scope > .card-ghost");
  const part = (name: string) => ghost?.querySelector<HTMLElement>(`:scope > .card-ghost-${name}`);
  const running: Animation[] = [];
  const play = (el: HTMLElement | null | undefined, frames: Keyframe[]) => el && running.push(el.animate(frames, opts));

  play(page, curve.map(({ offset, p }) => ({ offset, transform: at(p) })));
  if (open) {
    play(part("panel"), fade(1, 1, 0, ms, ms));
    play(part("sharp"), fade(1, 0, 15, 60, ms));
    play(part("soft"), fade(1, 0, 80, 190, ms));
    play(ghost, fade(1, 0, 300, 480, ms));
    play(scrim, samples(decay(80), ms).map(({ offset, p }) => ({ offset, opacity: 0.9 * p })));
  } else {
    play(part("panel"), ghostCloseFades.panel);
    play(part("soft"), ghostCloseFades.soft);
    play(part("sharp"), ghostCloseFades.sharp);
    play(page, ghostCloseFades.page);
    play(scrim, samples(decay(50), ms).map(({ offset, p }) => ({ offset, opacity: 0.35 * (1 - p) })));
  }
  return () => running.forEach((a) => a.cancel());
}
