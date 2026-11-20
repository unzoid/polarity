import type { BackDrag } from "../platform/back";
import { cardGhostParts } from "./cardGhost";
import { CARD_CANCEL_EASE, playCardRelease } from "./cardMotion";
import { liveCard, skipNextPageMotion, type CardRect } from "./pageMotion";

/** How far left the page under starts, as a share of the width, the way iOS's comes in. */
const UNDER_FROM = 0.3;
/** How long non-card pages (or a cancelled card swipe) take to settle once the finger lifts. */
export const DRAG_SETTLE_MS = 220;

/** A title page from a card: uniform shrink & follow during the interactive swipe-back track phase. */
const CARD_SHRINK = 0.24;
const CARD_FOLLOW = 0.42;
/** Constant rounded corner set ONCE on drag begin (never mutated per frame, avoiding per-frame rasterization). */
const CARD_DRAG_RADIUS = 28;
const SCRIM_MAX = 0.36;

/** `card`: the card the top page grew out of (`cardOrigin`); `scrim`: dedicated leaf overlay (0 children = 0 style recalc on under). */
export type DragPages = { top: HTMLElement; under: HTMLElement; card?: CardRect; scrim?: HTMLElement | null };

/**
 * Interactive Back following the finger (iOS edge swipe & Android predictive back):
 * - Track phase: pure 1:1 compositor writes (`transform` on `top` and `opacity` on the empty leaf `scrim`,
 *   never mutating inherited CSS variables on `under` or `border-radius` per frame).
 * - Release phase: for a card-opened title page, launches the unified Netflix uniform-scale + clip-path
 *   zoom-into-card spring seeded with the user's actual release velocity (`playCardRelease`).
 */
export function pageDrag(pages: () => DragPages | null, back: () => void, later: (fn: () => void, ms: number) => unknown = setTimeout): BackDrag {
  let held: (DragPages & { width: number; height: number; x: number; y: number; scale: number; scrimOpacity: number }) | null = null;
  let settling = false;
  let running: Animation[] = [];

  const cardPlace = (at: number, width: number, height: number) => {
    const p = width > 0 ? at / width : 0;
    const s = 1 - CARD_SHRINK * p;
    const r = (n: number) => Math.round(n * 10) / 10;
    const tx = r(at * CARD_FOLLOW + ((1 - s) * width) / 2);
    const ty = r(((1 - s) * height) / 2.4);
    const scale = Math.round(s * 1000) / 1000;
    return { tx, ty, scale, p };
  };

  const setScrim = (p: DragPages, progress: number) => {
    const op = Math.max(0, Math.min(SCRIM_MAX, SCRIM_MAX * (1 - progress)));
    if (p.scrim) {
      p.scrim.style.opacity = op.toFixed(3);
    } else {
      p.under.style.setProperty("--drag-in", String(progress));
    }
    return op;
  };

  const place = (x: number, width: number) => {
    if (!held) return;
    const at = Math.min(Math.max(x, 0), width);
    if (held.card) {
      const c = cardPlace(at, width, held.height);
      held.x = c.tx;
      held.y = c.ty;
      held.scale = c.scale;
      held.top.style.transform = `translate3d(${c.tx}px, ${c.ty}px, 0) scale(${c.scale})`;
      held.scrimOpacity = setScrim(held, c.p);
      return;
    }
    held.top.style.transform = `translate3d(${at}px, 0, 0)`;
    held.under.style.transform = `translate3d(${Math.round((at - width) * UNDER_FROM * 10) / 10}px, 0, 0)`;
    held.scrimOpacity = setScrim(held, width > 0 ? at / width : 0);
  };

  const clear = (p: DragPages) => {
    for (const el of [p.top, p.under]) {
      delete el.dataset.drag;
      delete el.dataset.dragSettle;
      delete el.dataset.dragScrim;
      el.style.removeProperty("transform");
      el.style.removeProperty("transform-origin");
      el.style.removeProperty("border-radius");
      el.style.removeProperty("clip-path");
      el.style.removeProperty("--drag-in");
    }
    if (p.scrim) {
      delete p.scrim.dataset.dragSettle;
      p.scrim.style.removeProperty("opacity");
    }
    for (const a of running) a.cancel();
    running = [];
    p.top.querySelector(":scope > .card-ghost[data-drag-ghost]")?.remove();
  };

  const makeGhost = (top: HTMLElement, card: CardRect): HTMLElement | null => {
    if (!card.src) return null;
    const box = document.createElement("div");
    box.className = "card-ghost";
    box.dataset.dragGhost = "";
    box.setAttribute("aria-hidden", "true");
    const parts = cardGhostParts(card.src, card.img);
    box.append(parts.panel, parts.media);
    top.append(box);
    return box;
  };

  const settleCard = (
    p: DragPages & { width: number; height: number; x: number; y: number; scale: number; scrimOpacity: number },
    tapped: CardRect,
    goBack: boolean,
    velocity: number,
  ): number => {
    if (goBack) {
      const card = liveCard(tapped);
      const ghost = makeGhost(p.top, card);
      // Hand off corner clipping from static border-radius to continuous clip-path round with zero visual seam.
      p.top.style.removeProperty("border-radius");
      const { ms, animations } = playCardRelease({
        page: p.top,
        scrim: p.scrim ?? null,
        ghost,
        card,
        width: p.width,
        height: p.height,
        from: { x: p.x, y: p.y, scale: p.scale, radius: CARD_DRAG_RADIUS, scrimOpacity: p.scrimOpacity },
        velocity,
      });
      running.push(...animations);
      if (!p.scrim) {
        p.under.dataset.dragSettle = "";
        p.under.style.setProperty("--drag-in", "1");
      }
      return ms;
    }

    if (typeof p.top.animate === "function") {
      running.push(
        p.top.animate(
          [
            { transform: p.top.style.transform || `translate3d(${p.x}px, ${p.y}px, 0) scale(${p.scale})` },
            { transform: "translate3d(0px, 0px, 0) scale(1)" },
          ],
          { duration: DRAG_SETTLE_MS, easing: CARD_CANCEL_EASE, fill: "forwards" },
        ),
      );
      if (p.scrim) {
        running.push(
          p.scrim.animate([{ opacity: p.scrimOpacity }, { opacity: SCRIM_MAX }], {
            duration: DRAG_SETTLE_MS,
            easing: CARD_CANCEL_EASE,
            fill: "forwards",
          }),
        );
      }
    }
    if (!p.scrim) {
      p.under.dataset.dragSettle = "";
      p.under.style.setProperty("--drag-in", "0");
    }
    return DRAG_SETTLE_MS;
  };

  return {
    begin() {
      if (held || settling) return false;
      const p = pages();
      if (!p) return false;
      const box = p.top.getBoundingClientRect();
      held = {
        ...p,
        width: box.width || window.innerWidth,
        height: box.height || window.innerHeight,
        x: 0,
        y: 0,
        scale: 1,
        scrimOpacity: SCRIM_MAX,
      };
      p.top.dataset.drag = p.card ? "card" : "top";
      p.under.dataset.drag = "under";
      if (p.scrim) {
        p.under.dataset.dragScrim = "";
        p.scrim.style.opacity = String(SCRIM_MAX);
      }
      if (p.card) {
        p.top.style.transformOrigin = "0 0";
        p.top.style.borderRadius = `${CARD_DRAG_RADIUS}px`;
      }
      return true;
    },
    move(x, width) {
      if (held) place(x, width || held.width);
    },
    end(goBack, velocity = 0) {
      const p = held;
      if (!p) return;
      settling = true;
      held = null;
      let settleMs = DRAG_SETTLE_MS;
      if (p.card) {
        settleMs = settleCard(p, p.card, goBack, velocity);
      } else {
        p.top.dataset.dragSettle = "";
        p.under.dataset.dragSettle = "";
        if (p.scrim) p.scrim.dataset.dragSettle = "";
        // Read before writing, so the transition starts from where the finger left the pages.
        void p.top.offsetWidth;
        held = p;
        place(goBack ? p.width : 0, p.width);
        held = null;
      }
      later(() => {
        settling = false;
        if (goBack) {
          skipNextPageMotion();
          back();
          // Clear inline drag styles once React commits the Back route (next frame instead of 50ms stall).
          later(() => clear(p), 16);
        } else {
          clear(p);
        }
      }, settleMs);
    },
  };
}
