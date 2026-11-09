import type { BackDrag } from "../platform/back";
import { skipNextPageMotion } from "./pageMotion";

/** How far left the page under starts, as a share of the width, the way iOS's comes in. */
const UNDER_FROM = 0.3;
/** How long the pages take to finish the move once the finger lifts (shell.css's `[data-drag-settle]` transition). */
export const DRAG_SETTLE_MS = 280;

export type DragPages = { top: HTMLElement; under: HTMLElement };

/**
 * iOS's Back as the finger moves (lib/platform/backSwipe.ts): the page on top slides right with it and the one under
 * it, kept rendered for this, comes in from a little to the left (shell.css draws both by `data-drag`). Let go far
 * enough and the top page carries on out, then `back` runs with the pages already where they end, so no page change
 * plays on top (skipNextPageMotion); let go early and both slide back. `pages` finds the two, or null when there's
 * nothing under the top page, and then the swipe isn't taken.
 */
export function pageDrag(pages: () => DragPages | null, back: () => void, later: (fn: () => void, ms: number) => unknown = setTimeout): BackDrag {
  let held: (DragPages & { width: number }) | null = null;
  let settling = false;

  const place = (x: number, width: number) => {
    if (!held) return;
    const at = Math.min(Math.max(x, 0), width);
    held.top.style.transform = `translate3d(${at}px, 0, 0)`;
    held.under.style.transform = `translate3d(${Math.round((at - width) * UNDER_FROM * 10) / 10}px, 0, 0)`;
    held.under.style.setProperty("--drag-in", String(at / width));
  };

  const clear = (p: DragPages) => {
    for (const el of [p.top, p.under]) {
      delete el.dataset.drag;
      delete el.dataset.dragSettle;
      el.style.removeProperty("transform");
      el.style.removeProperty("--drag-in");
    }
  };

  return {
    begin() {
      if (held || settling) return false;
      const p = pages();
      if (!p) return false;
      held = { ...p, width: p.top.getBoundingClientRect().width || window.innerWidth };
      p.top.dataset.drag = "top";
      p.under.dataset.drag = "under";
      return true;
    },
    move(x, width) {
      if (held) place(x, width || held.width);
    },
    end(goBack) {
      const p = held;
      if (!p) return;
      settling = true;
      p.top.dataset.dragSettle = "";
      p.under.dataset.dragSettle = "";
      // Read before writing, so the transition starts from where the finger left the pages.
      void p.top.offsetWidth;
      place(goBack ? p.width : 0, p.width);
      held = null;
      later(() => {
        settling = false;
        if (goBack) {
          skipNextPageMotion();
          back();
          // The top page is gone once React has drawn the Back; the one under keeps its place until then.
          later(() => clear(p), 50);
        } else {
          clear(p);
        }
      }, DRAG_SETTLE_MS);
    },
  };
}
