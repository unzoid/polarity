import { useCallback, useEffect, useRef, useState } from "react";

/** How long a press on the picture lasts before it speeds playback up. */
export const HOLD_MS = 450;
/** A press that travels further than this (px) is a drag, a swipe or a pinch: it never speeds up. */
const HOLD_SLOP = 12;

/**
 * Press and hold on the picture to play faster until you let go, as phone players and YouTube do. The
 * press must start while playing; a second finger, moving, or leaving the picture cancels it. Once a hold
 * has sped up, its release doesn't count as a click (`swallowClick`), so play/pause and the controls stay
 * as they were. `enabled` off (a watch party plays at 1x for everyone, or the setting is off) does nothing.
 */
export function useHoldSpeed(enabled: boolean, playing: boolean) {
  const [held, setHeld] = useState(false);
  const heldNow = useRef(false);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const timer = useRef<number>(undefined);
  /** The last hold sped up: the click its release makes is the hold's, not a tap. */
  const justHeld = useRef(false);
  const live = useRef({ enabled, playing });
  live.current = { enabled, playing };

  const hold = useCallback((on: boolean) => {
    heldNow.current = on;
    setHeld(on);
  }, []);
  const release = useCallback(() => {
    window.clearTimeout(timer.current);
    press.current = null;
    if (!heldNow.current) return;
    justHeld.current = true;
    hold(false);
  }, [hold]);

  // Paused, or turned off mid-hold (the party started, the setting changed): back to the normal speed.
  useEffect(() => {
    if (!enabled || !playing) release();
  }, [enabled, playing, release]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    held,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        justHeld.current = false;
        // A second finger is a pinch; a mouse's other buttons aren't a press on the picture.
        if (press.current || (e.pointerType === "mouse" && e.button !== 0)) return release();
        if (!live.current.enabled || !live.current.playing) return;
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          if (press.current && live.current.enabled && live.current.playing) hold(true);
        }, HOLD_MS);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const p = press.current;
        if (heldNow.current || p?.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) <= HOLD_SLOP) return;
        window.clearTimeout(timer.current);
        press.current = null;
      },
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
    },
    /** Whether a click is the end of a hold (and should do nothing); asking clears it. */
    swallowClick: () => {
      const was = justHeld.current;
      justHeld.current = false;
      return was;
    },
  };
}
