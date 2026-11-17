import { useCallback, useEffect, useState } from "react";
import { screenBrightness, type ScreenBrightness } from "../../lib/platform";

/**
 * The screen's brightness while the player is open (the swipe on the left half): read once it opens, set as the
 * finger moves, and given back when it closes (the native side also gives it back while the app is in the
 * background). `level` stays null where there is none to set, or until it has been read.
 */
export function useScreenBrightness(enabled: boolean, screen: ScreenBrightness = screenBrightness) {
  const on = enabled && screen.available;
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    let gone = false;
    void screen.read().then((n) => !gone && setLevel(n));
    return () => {
      gone = true;
      setLevel(null);
      screen.restore();
    };
  }, [on, screen]);
  const set = useCallback(
    (n: number) => {
      setLevel(n);
      screen.set(n);
    },
    [screen],
  );
  return { available: on, level: on ? level : null, set };
}
