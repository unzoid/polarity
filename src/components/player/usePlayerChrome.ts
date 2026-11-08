import { useCallback, useEffect, useRef, useState } from "react";
import { appWindow } from "../../lib/platform";

/** While paused the controls wait at least this long before hiding (#334). */
export const PAUSED_HIDE_MS = 5000;

/**
 * Whether the player's controls show: any pointer movement or key brings them
 * back, and they hide after `hideAfter` ms unless the pointer rests on them
 * (`overControls`). While `paused` they wait at least PAUSED_HIDE_MS.
 * `instant` skips the fade (keyboard and wheel).
 */
export function usePlayerChrome(hideAfter: number, paused = false) {
  const [chrome, setChrome] = useState({ visible: true, instant: false });
  const hideTimer = useRef<number>(undefined);
  const overControls = useRef(false);
  const wait = useRef(hideAfter);
  wait.current = paused ? Math.max(PAUSED_HIDE_MS, hideAfter) : hideAfter;
  const arm = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!overControls.current) setChrome((c) => (c.visible ? { visible: false, instant: false } : c));
    }, wait.current);
  }, []);
  const poke = useCallback(
    (instant = false) => {
      // Called on every pointer move: keep the same object when nothing changed,
      // or the whole player re-renders for each pixel the mouse travels.
      setChrome((c) => (c.visible && c.instant === instant ? c : { visible: true, instant }));
      arm();
    },
    [arm],
  );
  // Pausing shows the controls (it may come from a headset button or the party,
  // not from input here); pausing or resuming restarts the wait at its new length.
  // The play handler's poke ran with the paused wait, hence this after the render.
  useEffect(() => {
    if (paused) setChrome((c) => (c.visible ? c : { visible: true, instant: false }));
    arm();
  }, [paused, arm]);
  const hide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    setChrome({ visible: false, instant: false });
  }, []);
  // Leaving the window (alt-tab, another app, the cursor off the edge) hides it
  // now: nothing is pointing at the controls any more, so don't wait out the timer.
  useEffect(() => {
    const away = () => {
      overControls.current = false;
      hide();
    };
    const onVisibility = () => document.hidden && away();
    const root = document.documentElement;
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", onVisibility);
    root.addEventListener("mouseleave", away);
    const unlisten = appWindow.onFocusChanged((focused) => !focused && away());
    return () => {
      window.clearTimeout(hideTimer.current);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", onVisibility);
      root.removeEventListener("mouseleave", away);
      void unlisten.then((f) => f());
    };
  }, [hide]);
  return { chrome, poke, hide, overControls };
}
