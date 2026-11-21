import { useCallback, useEffect, useMemo, useRef } from "react";
import { screenBrightness, type ScreenBrightness } from "../../lib/platform";

export interface ScreenBrightnessHandle {
  readonly available: boolean;
  /** Latest known brightness level (0–1), or null until read / unavailable. */
  readonly getLevel: () => number | null;
  /** Updates the ref, notifies subscribers immediately (for direct-DOM HUD), and throttles native IPC to rAF. */
  readonly set: (n: number) => void;
  /** Subscribe to level changes without triggering React re-renders in Player. */
  readonly subscribe: (fn: (n: number) => void) => () => void;
}

/**
 * The screen's brightness while the player is open (the swipe on the left half): read once it opens, set as the
 * finger moves, and given back when it closes (the native side also gives it back while the app is in the
 * background). Kept in a ref + listener set so 60–120 Hz swipes never re-render the 3,000-line Player screen.
 */
export function useScreenBrightness(enabled: boolean, screen: ScreenBrightness = screenBrightness): ScreenBrightnessHandle {
  const on = enabled && screen.available;
  const levelRef = useRef<number | null>(null);
  const listeners = useRef(new Set<(n: number) => void>());
  const rafRef = useRef(0);
  const pendingNative = useRef<number | null>(null);

  useEffect(() => {
    if (!on) {
      levelRef.current = null;
      return;
    }
    let gone = false;
    void screen.read().then((n) => {
      if (gone) return;
      levelRef.current = n;
      if (n != null) for (const fn of listeners.current) fn(n);
    });
    return () => {
      gone = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      pendingNative.current = null;
      levelRef.current = null;
      screen.restore();
    };
  }, [on, screen]);

  const getLevel = useCallback(() => (on ? levelRef.current : null), [on]);

  const set = useCallback(
    (n: number) => {
      if (!on) return;
      levelRef.current = n;
      for (const fn of listeners.current) fn(n);
      pendingNative.current = n;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const next = pendingNative.current;
          pendingNative.current = null;
          if (next != null) screen.set(next);
        });
      }
    },
    [on, screen],
  );

  const subscribe = useCallback((fn: (n: number) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return useMemo(() => ({ available: on, getLevel, set, subscribe }), [on, getLevel, set, subscribe]);
}
