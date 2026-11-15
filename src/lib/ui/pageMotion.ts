import { useEffect, useState } from "react";
import type { Entry } from "../router";
import { CARD_CLOSE_MS, CARD_OPEN_MS } from "./cardMotion";
import { prefersReducedMotion } from "./reducedMotion";

/**
 * How long a change's pages keep their motion, and a couple of frames to spare: another section's crossfade
 * (shell.css --page-fade), a page pushed or taken off (--page-in), a title's page out of its card and back into it
 * (cardMotion.ts, which starts two frames before this clock does).
 */
const SETTLE = { fade: 200, push: 340, cardOpen: CARD_OPEN_MS, cardClose: CARD_CLOSE_MS };

function settleOf(m: PageMotion) {
  if (m.card) return m.dir === 1 ? SETTLE.cardOpen : SETTLE.cardClose;
  return m.dir === 0 ? SETTLE.fade : SETTLE.push;
}

/** A card's place on the screen, in CSS pixels, and the picture on it. */
export type CardRect = { x: number; y: number; w: number; h: number; src?: string };

/**
 * A page change on a phone, for shell.css to play: `enter` is the page coming in, `leave` the one going, `dir`
 * where the new one comes from (1: the right, -1: the left, 0: in place). `leaving`: the page going when it's
 * no longer in the stack (Back, a tab switch), to render once more while it leaves. `card`: the title's page
 * grows out of the card that opened it (dir 1), or goes back into it (dir -1), instead of coming from the side.
 */
export type PageMotion = {
  enter: number;
  leave: number;
  dir: -1 | 0 | 1;
  leaving?: Entry;
  card?: CardRect;
  /** The new page is laid out: the pair moves. Until then (a frame) the old page stays as it is. */
  go?: boolean;
};

/** A card pressed a moment ago opened the page that comes next. */
const TAP_FRESH = 800;
let tapped: { rect: CardRect; at: number } | undefined;
/** The card each open title page came from, by the page's key, for Back to return it there. */
const origins = new Map<number, CardRect>();

/** The card the title page `key` grew out of, while it's open, for iOS's swipe to take it back there (pageDrag.ts). */
export function cardOrigin(key: number): CardRect | undefined {
  return prefersReducedMotion() ? undefined : origins.get(key);
}

/**
 * The card a click on `target` lands in: its art's place (not the caption under it) and the picture on it, once
 * loaded. The featured banner (Home's and the Anime tab's) counts as one (#214): its page grows out of the banner,
 * the picture showing on it riding along.
 */
export function cardAt(target: Element | null): CardRect | undefined {
  const banner = target?.closest(".hero-card");
  const card = banner ?? target?.closest(".card");
  const frame = banner ?? card?.querySelector(".card-frame") ?? card;
  const r = frame?.getBoundingClientRect();
  if (!r || r.width <= 0) return undefined;
  const img = banner ? banner.querySelector<HTMLImageElement>('.hero-backdrop[data-current="true"]') : frame?.querySelector("img");
  const src = img?.complete && img.naturalWidth > 0 ? img.currentSrc || img.src : undefined;
  return { x: r.left, y: r.top, w: r.width, h: r.height, src };
}

/** Notes the card a click lands on (`cardAt`), for the page it opens to grow out of. */
export function watchCardTaps() {
  const onClick = (e: MouseEvent) => {
    const rect = cardAt(e.target instanceof Element ? e.target : null);
    tapped = rect ? { rect, at: performance.now() } : undefined;
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

const isTitlePage = (e: Entry) => e.route.name === "detail" || e.route.name === "anime-detail";

/**
 * What shell.css needs for a card's motion on a page `width` × `height` (cardMotion.ts moves it): the corner
 * radius that looks like the card's when the page is scaled down to the card's box.
 */
export function cardMotionVars(card: CardRect, width: number, height: number): Record<string, string> {
  return { "--card-r": `${(8 * width) / card.w}px / ${(8 * height) / card.h}px` };
}

let skipNext = false;

/** The next page change plays no motion: the pages are already where it would take them (pageDrag.ts). */
export function skipNextPageMotion() {
  skipNext = true;
}

type Seen = { top?: Entry; keys: number[]; motion?: PageMotion };

/**
 * Pages on a phone change as whole screens, so a change reads as one gesture. Whichever page is on top (the new
 * one pushed, or the old one going) is opaque and moves; the one under it holds still. A page pushed comes in from
 * the right and goes back out to it; another section crossfades in place, quickly, as Netflix's tabs do.
 */
export function usePageMotion(pages: Entry[], enabled: boolean): PageMotion | undefined {
  const top = pages[pages.length - 1];
  const [seen, setSeen] = useState<Seen>(() => ({ top, keys: pages.map((e) => e.key) }));
  let now = seen;
  if (top?.key !== seen.top?.key) {
    now = { top, keys: pages.map((e) => e.key) };
    const skip = skipNext;
    skipNext = false;
    if (enabled && top && seen.top && !skip) now.motion = motionOf(seen, seen.top, top, pages);
    setSeen(now); // during render: this render already draws the change with its motion
  }

  // The pair moves once a frame with both pages in it has been drawn (the one coming back under the one going is
  // drawn already, covered; shell.css): painting a whole page, Home's rows coming back from being skipped, is then
  // done before the motion's clock starts, not in its first frame, where it read as a jump. Two frames, because a
  // state change made in the first one's callback can land in that same frame. What the new page is still loading
  // comes in together afterwards, behind its placeholders (together.ts, Detail.tsx).
  const [gone, setGone] = useState<Seen>();
  useEffect(() => {
    const motion = seen.motion;
    if (!motion) return;
    let live = true;
    let timer = 0;
    let frame = 0;
    const start = () => {
      if (!live) return;
      setGone(seen);
      timer = window.setTimeout(() => setSeen((s) => (s === seen ? { ...s, motion: undefined } : s)), settleOf(motion));
    };
    frame = requestAnimationFrame(() => (frame = requestAnimationFrame(start)));
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [seen]);

  return now.motion && { ...now.motion, go: gone === now };
}

function motionOf(seen: Seen, prev: Entry, top: Entry, pages: Entry[]): PageMotion {
  const base = { enter: top.key, leave: prev.key };
  // Pushed: the page that was on top is still there, under the new one.
  if (pages.some((e) => e.key === prev.key)) {
    for (const key of origins.keys()) if (!pages.some((e) => e.key === key)) origins.delete(key);
    const from = tapped && performance.now() - tapped.at < TAP_FRESH && isTitlePage(top) && !prefersReducedMotion() ? tapped.rect : undefined;
    if (from) origins.set(top.key, from);
    return { ...base, dir: 1, card: from };
  }
  // Back: the page now on top was under the one that's gone.
  if (seen.keys.includes(top.key))
    return { ...base, dir: -1, leaving: prev, card: prefersReducedMotion() ? undefined : origins.get(prev.key) };
  // Another section, or a page replaced in place: a crossfade.
  return { ...base, dir: 0, leaving: prev };
}
