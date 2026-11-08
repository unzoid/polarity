import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * What of the player's bars fits the window (#396). As it narrows they give way in steps, each control
 * staying whole and clickable: the bottom actions drop their words (each keeps its name and tooltip),
 * then the volume slider folds into its icon, then pin and fill move into a "More" menu.
 */
export type BarFit = {
  /** The bottom actions show their words. */
  labels: boolean;
  /** The volume slider sits in the bar (else it opens from the volume icon). */
  slider: boolean;
  /** Pin and fill are in the "More" menu. */
  more: boolean;
};

export const FULL_FIT: BarFit = { labels: true, slider: true, more: false };

/**
 * The room the title keeps before the top bar gives way (px): about "S2:E13 “A Fairly Long Title”". A shorter
 * title needs only its own width; a longer one truncates in whatever room there is.
 */
export const TITLE_ROOM = 400;
/** The least space between two bottom actions (px) before their words go. */
export const ACTION_SPACE = 8;

/** Widths of the top bar's parts (px), as they'd be with the slider in the bar and nothing in "More". */
export type TopWidths = {
  /** The bar's inner width. */
  room: number;
  /** The gaps between back, title and the right-hand controls, together. */
  gaps: number;
  back: number;
  /** The title's (or the show's, if longer) whole width. */
  title: number;
  /** The right-hand controls with the slider in the bar and pin/fill as buttons. */
  end: number;
  /** What folding the slider saves. */
  slider: number;
  /** What moving pin and fill into "More" saves (0 when there's neither). */
  movable: number;
};

/** The top bar's step: the slider folds first, then pin and fill move into "More", while the title lacks its room. */
export function fitTop(w: TopWidths): Pick<BarFit, "slider" | "more"> {
  const want = Math.min(w.title, TITLE_ROOM);
  const free = (end: number) => w.room - w.gaps - w.back - end;
  if (free(w.end) >= want) return { slider: true, more: false };
  if (free(w.end - w.slider) >= want || w.movable <= 0) return { slider: false, more: false };
  return { slider: false, more: true };
}

/** Whether the bottom actions fit with their words: `widths` are each one's width with its words shown. */
export function fitLabels(widths: number[], room: number): boolean {
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * ACTION_SPACE;
  return total <= room;
}

const px = (v: string) => parseFloat(v) || 0;
/** A top-bar glyph button's width (`.player-icon`), when none is in the bar to measure. */
const ICON_W = 44;
const innerWidth = (el: HTMLElement) => {
  const s = getComputedStyle(el);
  return el.clientWidth - px(s.paddingLeft) - px(s.paddingRight);
};

/**
 * Measures the bars and returns the step that fits. `top` is `.player-top`, `actions` `.player-actions`; `movable`
 * is how many top controls "More" would take. `signature` changes whenever what's in the bars does (labels,
 * title, which controls show), so the bars are measured again; resizing the window measures them too.
 * Off (`enabled` false: a phone, a compact window, TV), everything shows and the layout's own rules apply.
 */
export function useBarFit(
  top: RefObject<HTMLElement | null>,
  actions: RefObject<HTMLElement | null>,
  movable: number,
  enabled: boolean,
  signature: string,
): BarFit {
  const [fit, setFit] = useState(FULL_FIT);
  const latest = useRef({ fit, movable });
  latest.current = { fit, movable };
  // The slider's width as last seen in the bar: folded, it's out of the bar's flow.
  const sliderWidth = useRef(100);

  useLayoutEffect(() => {
    if (!enabled) {
      setFit(FULL_FIT);
      return;
    }
    const measure = () => {
      const bar = top.current;
      const row = actions.current;
      if (!bar || !row) return;
      const { fit: now, movable } = latest.current;
      const next = { ...now };

      const back = bar.querySelector<HTMLElement>(":scope > .player-back");
      const end = bar.querySelector<HTMLElement>(".player-top-end");
      const cluster = bar.querySelector<HTMLElement>(".player-top-actions");
      if (back && end && cluster) {
        const gap = px(getComputedStyle(cluster).columnGap);
        const slider = bar.querySelector<HTMLElement>(".player-volume-slider");
        if (slider && now.slider) sliderWidth.current = slider.offsetWidth + gap;
        const sliderW = slider ? sliderWidth.current : 0;
        const moreButton = now.more ? (bar.querySelector<HTMLElement>(".player-more")?.offsetWidth ?? 0) + gap : 0;
        // Back stands at the navbar's spot (#348): its inset is part of what it takes.
        const backW = back.offsetWidth + px(getComputedStyle(back).marginLeft);
        const icon = cluster.querySelector<HTMLElement>(".player-icon")?.offsetWidth ?? ICON_W;
        const movableW = movable * (icon + gap);
        const title = Math.max(0, ...Array.from(bar.querySelectorAll<HTMLElement>(".player-heading > *"), (el) => el.scrollWidth));
        const s = getComputedStyle(bar);
        Object.assign(
          next,
          fitTop({
            room: innerWidth(bar),
            gaps: 2 * px(s.columnGap),
            back: backW,
            title,
            end: end.offsetWidth + (now.slider ? 0 : sliderW) + (now.more ? movableW - moreButton : 0),
            slider: sliderW,
            movable: movable ? movableW - (icon + gap) : 0,
          }),
        );
      }

      // Each action as it'd be with its words: a hidden label is out of the flow, so it adds its width and the gap.
      const widths = Array.from(row.querySelectorAll<HTMLElement>(":scope > .player-action"), (b) => {
        const label = b.querySelector<HTMLElement>(":scope > span");
        if (now.labels || !label) return b.offsetWidth;
        return b.offsetWidth + label.scrollWidth + px(getComputedStyle(b).columnGap);
      });
      next.labels = fitLabels(widths, innerWidth(row));

      if (next.labels !== now.labels || next.slider !== now.slider || next.more !== now.more) setFit(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (top.current) observer.observe(top.current);
    if (actions.current) observer.observe(actions.current);
    // The interface font arriving changes every width.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [top, actions, enabled, signature, fit]);

  return enabled ? fit : FULL_FIT;
}
