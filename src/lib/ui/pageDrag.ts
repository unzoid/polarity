import type { BackDrag } from "../platform/back";
import { skipNextPageMotion, type CardRect } from "./pageMotion";

/** How far left the page under starts, as a share of the width, the way iOS's comes in. */
const UNDER_FROM = 0.3;
/** How long the pages take to finish the move once the finger lifts (shell.css's `[data-drag-settle]` transition). */
export const DRAG_SETTLE_MS = 280;

/** A title page from a card: how much it shrinks across the swipe, how far it follows the finger, its corners. */
const CARD_SHRINK = 0.3;
const CARD_FOLLOW = 0.5;
const CARD_CORNER = 28;
/** Let go: back into the card, on the card motion's clock and curve (shell.css `--card-close`, `--card-ease`). */
const CARD_BACK_MS = 540;
const CARD_EASE = "cubic-bezier(0.3, 0.8, 0.2, 1)";

/** `card`: the card the top page grew out of (pageMotion.ts cardOrigin): the swipe takes it back there. */
export type DragPages = { top: HTMLElement; under: HTMLElement; card?: CardRect };

/**
 * iOS's Back as the finger moves (lib/platform/backSwipe.ts): the page on top slides right with it and the one under
 * it, kept rendered for this, comes in from a little to the left (shell.css draws both by `data-drag`). Let go far
 * enough and the top page carries on out, then `back` runs with the pages already where they end, so no page change
 * plays on top (skipNextPageMotion); let go early and both slide back. `pages` finds the two, or null when there's
 * nothing under the top page, and then the swipe isn't taken.
 *
 * A title page that grew out of a card (`card`) goes back the way it came instead, following the finger: it shrinks
 * as the finger moves, its corners rounding, with the page under it brightening in place. Let go far enough and it
 * carries on from there into the card, the card's picture coming up over it and the page fading out over the card
 * itself at the end, as Back does (shell.css card-page-back); let go early and it grows back.
 */
export function pageDrag(pages: () => DragPages | null, back: () => void, later: (fn: () => void, ms: number) => unknown = setTimeout): BackDrag {
  let held: (DragPages & { width: number; height: number }) | null = null;
  let settling = false;
  /** The card motion's animations, cancelled once the pages are cleared. */
  let running: Animation[] = [];

  /** Where a card's page is at `at` px of the swipe: shrunk about its middle, moved along with the finger. */
  const cardPlace = (at: number, width: number, height: number) => {
    const p = at / width;
    const s = 1 - CARD_SHRINK * p;
    const r = (n: number) => Math.round(n * 10) / 10;
    return { transform: `translate(${r(at * CARD_FOLLOW + ((1 - s) * width) / 2)}px, ${r(((1 - s) * height) / 2)}px) scale(${r(s * 100) / 100}, ${r(s * 100) / 100})`, radius: r(CARD_CORNER * p), p };
  };

  const place = (x: number, width: number) => {
    if (!held) return;
    const at = Math.min(Math.max(x, 0), width);
    if (held.card) {
      const c = cardPlace(at, width, held.height);
      held.top.style.transform = c.transform;
      held.top.style.borderRadius = `${c.radius}px`;
      held.under.style.setProperty("--drag-in", String(c.p));
      return;
    }
    held.top.style.transform = `translate3d(${at}px, 0, 0)`;
    held.under.style.transform = `translate3d(${Math.round((at - width) * UNDER_FROM * 10) / 10}px, 0, 0)`;
    held.under.style.setProperty("--drag-in", String(at / width));
  };

  const clear = (p: DragPages) => {
    for (const el of [p.top, p.under]) {
      delete el.dataset.drag;
      delete el.dataset.dragSettle;
      el.style.removeProperty("transform");
      el.style.removeProperty("transform-origin");
      el.style.removeProperty("border-radius");
      el.style.removeProperty("--drag-in");
    }
    for (const a of running) a.cancel();
    running = [];
    p.top.querySelector(":scope > .card-ghost[data-drag-ghost]")?.remove();
  };

  /** The card's picture on the page as it goes back (shell.css `.card-ghost`): soft and dark first, then sharp. */
  const ghost = (top: HTMLElement, src: string, ms: number) => {
    const box = document.createElement("div");
    box.className = "card-ghost";
    box.dataset.dragGhost = "";
    box.setAttribute("aria-hidden", "true");
    for (const kind of ["soft", "sharp"]) {
      const img = document.createElement("img");
      img.className = `card-ghost-${kind}`;
      img.src = src;
      img.alt = "";
      box.append(img);
      running.push(img.animate(
        kind === "soft"
          ? [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1 }]
          : [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 0.75 }, { opacity: 1 }],
        { duration: ms, fill: "forwards" },
      ));
    }
    top.append(box);
  };

  const settleCard = (p: DragPages & { width: number; height: number }, card: CardRect, goBack: boolean) => {
    const from = p.top.style.transform;
    const fromRadius = p.top.style.borderRadius || "0px";
    if (typeof p.top.animate !== "function") return;
    if (goBack) {
      const sx = card.w / p.width;
      const sy = card.h / p.height;
      const to = `translate(${card.x}px, ${card.y}px) scale(${sx}, ${sy})`;
      running.push(
        p.top.animate(
          [
            { transform: from, borderRadius: fromRadius },
            { transform: to, borderRadius: `${8 / sx}px / ${8 / sy}px` },
          ],
          { duration: CARD_BACK_MS, easing: CARD_EASE, fill: "forwards" },
        ),
        p.top.animate([{ opacity: 1 }, { opacity: 1, offset: 0.78 }, { opacity: 0 }], { duration: CARD_BACK_MS, fill: "forwards" }),
      );
      // The page under brightens the rest of the way (shell.css fades its dim while settling).
      p.under.dataset.dragSettle = "";
      p.under.style.setProperty("--drag-in", "1");
      if (card.src) ghost(p.top, card.src, CARD_BACK_MS);
    } else {
      running.push(
        p.top.animate(
          [
            { transform: from, borderRadius: fromRadius },
            { transform: "translate(0px, 0px) scale(1, 1)", borderRadius: "0px" },
          ],
          { duration: DRAG_SETTLE_MS, easing: CARD_EASE, fill: "forwards" },
        ),
      );
      p.under.dataset.dragSettle = "";
      p.under.style.setProperty("--drag-in", "0");
    }
  };

  return {
    begin() {
      if (held || settling) return false;
      const p = pages();
      if (!p) return false;
      const box = p.top.getBoundingClientRect();
      held = { ...p, width: box.width || window.innerWidth, height: box.height || window.innerHeight };
      p.top.dataset.drag = p.card ? "card" : "top";
      p.under.dataset.drag = "under";
      if (p.card) p.top.style.transformOrigin = "0 0";
      return true;
    },
    move(x, width) {
      if (held) place(x, width || held.width);
    },
    end(goBack) {
      const p = held;
      if (!p) return;
      settling = true;
      held = null;
      const card = p.card;
      if (card) settleCard(p, card, goBack);
      else {
        p.top.dataset.dragSettle = "";
        p.under.dataset.dragSettle = "";
        // Read before writing, so the transition starts from where the finger left the pages.
        void p.top.offsetWidth;
        held = p;
        place(goBack ? p.width : 0, p.width);
        held = null;
      }
      later(
        () => {
          settling = false;
          if (goBack) {
            skipNextPageMotion();
            back();
            // The top page is gone once React has drawn the Back; the one under keeps its place until then.
            later(() => clear(p), 50);
          } else {
            clear(p);
          }
        },
        card && goBack ? CARD_BACK_MS : DRAG_SETTLE_MS,
      );
    },
  };
}
