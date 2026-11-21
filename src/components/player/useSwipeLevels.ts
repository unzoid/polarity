import { useEffect, useRef, useState } from "react";

export type SwipeSide = "left" | "right";

/** How far a finger travels before its drag counts (px): past useHoldSpeed's slop, so the hold is cancelled first. */
export const SWIPE_START = 16;
/**
 * Where a press never starts a swipe (px from the picture's edges): the sides are the system's Back (iOS's swipe in
 * from the left, Android's from either side), the top its notifications and Control Centre, the bottom its home bar.
 */
export const SWIPE_EDGES = { side: 24, top: 40, bottom: 40 } as const;
/** A drag over this share of the picture's height goes from silent (or darkest) to full. */
export const SWIPE_SPAN = 0.6;

/** The half a press at (x, y) on a picture `width` by `height` swipes on; null in the edges the system keeps. */
export function swipeSide(x: number, y: number, width: number, height: number): SwipeSide | null {
  if (width <= 0 || height <= 0) return null;
  if (x < SWIPE_EDGES.side || x > width - SWIPE_EDGES.side) return null;
  if (y < SWIPE_EDGES.top || y > height - SWIPE_EDGES.bottom) return null;
  return x < width / 2 ? "left" : "right";
}

/** Whether a press that has moved (dx, dy) is a vertical swipe, some other drag, or still too short to tell. */
export function swipeAxis(dx: number, dy: number): "vertical" | "horizontal" | undefined {
  if (Math.hypot(dx, dy) < SWIPE_START) return undefined;
  return Math.abs(dy) > Math.abs(dx) * 1.2 ? "vertical" : "horizontal";
}

/** The level after the finger moved `dy` (down positive) from where the swipe began at `start`: up raises it. */
export function swipeLevel(start: number, dy: number, height: number, max = 1): number {
  if (height <= 0 || max <= 0) return start;
  const next = start - (dy / (height * SWIPE_SPAN)) * max;
  return Math.round(Math.min(max, Math.max(0, next)) * 100) / 100;
}

export type SwipeLevels = {
  /** Off: no press starts a swipe (TV mode, a mouse, the setting off, the screen locked). */
  enabled: boolean;
  /** The level a swipe on `side` starts from and its top, or null when that side does nothing now. */
  begin: (side: SwipeSide) => { level: number; max: number } | null;
  change: (side: SwipeSide, level: number) => void;
};

/**
 * One finger dragged up or down on the picture (phones and tablets): the right half sets the volume, the left the
 * screen's brightness, as phone players do. Fingers only; a second finger (a pinch) ends it, a drag that goes
 * sideways first does nothing, and presses in the edges the system keeps never start one. `active` is the side
 * being swiped; `swallowClick` says the click a swipe's release makes isn't a tap.
 */
export function useSwipeLevels(options: SwipeLevels) {
  const live = useRef(options);
  live.current = options;
  const fingers = useRef(new Set<number>());
  const press = useRef<{ id: number; x: number; y: number; side: SwipeSide; height: number } | null>(null);
  const swipe = useRef<{ side: SwipeSide; y: number; level: number; max: number; height: number } | null>(null);
  const swiped = useRef(false);
  const pending = useRef<{ side: SwipeSide; level: number } | null>(null);
  const raf = useRef(0);
  const [active, setActive] = useState<SwipeSide | null>(null);

  const flush = () => {
    raf.current = 0;
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    live.current.change(p.side, p.level);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const stop = () => {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      flush();
    }
    press.current = null;
    if (!swipe.current) return;
    swipe.current = null;
    setActive(null);
  };
  const up = (e: React.PointerEvent) => {
    fingers.current.delete(e.pointerId);
    if (press.current?.id === e.pointerId) stop();
  };

  return {
    active,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") return;
        fingers.current.add(e.pointerId);
        if (fingers.current.size > 1) return stop();
        swiped.current = false;
        if (!live.current.enabled) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const side = swipeSide(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        press.current = side ? { id: e.pointerId, x: e.clientX, y: e.clientY, side, height: rect.height } : null;
      },
      onPointerMove: (e: React.PointerEvent) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        const s = swipe.current;
        if (!s) {
          const axis = swipeAxis(e.clientX - p.x, e.clientY - p.y);
          if (!axis) return;
          const start = axis === "vertical" && live.current.enabled ? live.current.begin(p.side) : null;
          if (!start) return void (press.current = null);
          swipe.current = { side: p.side, y: e.clientY, level: start.level, max: start.max, height: p.height };
          swiped.current = true;
          setActive(p.side);
          return;
        }
        pending.current = { side: s.side, level: swipeLevel(s.level, e.clientY - s.y, s.height, s.max) };
        if (!raf.current) raf.current = requestAnimationFrame(flush);
      },
      onPointerUp: up,
      onPointerCancel: up,
    },
    /** Whether a click is the end of a swipe (and should do nothing); asking clears it. */
    swallowClick: () => {
      const was = swiped.current;
      swiped.current = false;
      return was;
    },
  };
}
