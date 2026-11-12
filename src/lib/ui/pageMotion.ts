import { useEffect, useState } from "react";
import type { Entry, TabRoute } from "../router";
import { tabId } from "../navTabs";
import { prefersReducedMotion } from "./reducedMotion";

/** The sections in the order the tab bars show them (NavBar's links), then the top bar's Calendar and Search. */
const ORDER = ["home", "discover:series", "discover:movie", "anime", "library", "calendar", "search"];

/** How long a change's pages keep their motion: the entrance (shell.css), and a frame to spare. */
const SETTLE = 300;
/** The same for a title's page growing out of its card (shell.css: 620ms out, 540ms back), which takes longer. */
const SETTLE_CARD = 660;

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
 * Notes the card a click lands on (its art, not the caption under it), for the page it opens to grow out of. The
 * featured banner (Home's and the Anime tab's) counts as one (#214): its page grows out of the banner, the
 * picture showing on it riding along.
 */
export function watchCardTaps() {
  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    const banner = target?.closest(".hero-card");
    const card = banner ?? target?.closest(".card");
    const frame = banner ?? card?.querySelector(".card-frame") ?? card;
    const r = frame?.getBoundingClientRect();
    const img = banner ? banner.querySelector<HTMLImageElement>('.hero-backdrop[data-current="true"]') : frame?.querySelector("img");
    const src = img?.complete && img.naturalWidth > 0 ? img.currentSrc || img.src : undefined;
    tapped = r && r.width > 0 ? { rect: { x: r.left, y: r.top, w: r.width, h: r.height, src }, at: performance.now() } : undefined;
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

const isTitlePage = (e: Entry) => e.route.name === "detail" || e.route.name === "anime-detail";

/**
 * What shell.css needs to play a card's motion on a page `width` × `height`: where the page's top left corner is
 * at the card, how much smaller the page is there across and down (exactly the card's box), and the corner radius
 * that looks like the card's at that size.
 */
export function cardMotionVars(card: CardRect, width: number, height: number): Record<string, string> {
  const sx = card.w / width;
  const sy = card.h / height;
  return {
    "--card-x": `${card.x}px`,
    "--card-y": `${card.y}px`,
    "--card-sx": String(sx),
    "--card-sy": String(sy),
    "--card-r": `${8 / sx}px / ${8 / sy}px`,
  };
}

let skipNext = false;

/** The next page change plays no motion: the pages are already where it would take them (pageDrag.ts). */
export function skipNextPageMotion() {
  skipNext = true;
}

type Seen = { top?: Entry; keys: number[]; root?: TabRoute; motion?: PageMotion };

/**
 * Pages on a phone move as a pair, so a change reads as one gesture: the new page fades in from one side while the
 * old one fades out towards the other. Forward is from the right: a title opened, or a section further along the
 * tab bar; back is from the left. The pair moves together; nothing waits for the other.
 */
export function usePageMotion(pages: Entry[], enabled: boolean): PageMotion | undefined {
  const top = pages[pages.length - 1];
  const [seen, setSeen] = useState<Seen>(() => ({ top, keys: pages.map((e) => e.key), root: pages[0]?.route as TabRoute | undefined }));
  let now = seen;
  if (top?.key !== seen.top?.key) {
    now = { top, keys: pages.map((e) => e.key), root: pages[0]?.route as TabRoute | undefined };
    const skip = skipNext;
    skipNext = false;
    if (enabled && top && seen.top && !skip) now.motion = motionOf(seen, seen.top, top, pages);
    setSeen(now); // during render: this render already draws the change with its motion
  }

  // The pair moves on the next frame, once the new page is laid out: the change answers the tap at once. What the
  // new page is still loading comes in together afterwards, behind its placeholders (together.ts, Detail.tsx).
  const [gone, setGone] = useState<Seen>();
  useEffect(() => {
    const motion = seen.motion;
    if (!motion) return;
    let live = true;
    let timer = 0;
    const start = () => {
      if (!live) return;
      setGone(seen);
      timer = window.setTimeout(() => setSeen((s) => (s === seen ? { ...s, motion: undefined } : s)), motion.card ? SETTLE_CARD : SETTLE);
    };
    const frames = requestAnimationFrame(start);
    return () => {
      live = false;
      cancelAnimationFrame(frames);
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
  // Another section: towards it along the tab bar. Replaced in place: a crossfade.
  const from = seen.root ? ORDER.indexOf(tabId(seen.root)) : -1;
  const to = ORDER.indexOf(tabId(pages[0].route as TabRoute));
  const dir = pages.length > 1 || from < 0 || to < 0 || from === to ? 0 : to > from ? 1 : -1;
  return { ...base, dir, leaving: prev };
}
