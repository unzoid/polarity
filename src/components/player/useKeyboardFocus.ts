import { useEffect, useState } from "react";
import { isTvMode } from "../../tv/tvMode";

/**
 * Whether the focus got where it is by the keyboard (#329): true once a key press
 * moves the focus (Tab, the arrows in a menu, a shortcut that opens one), false
 * again at the next press of a mouse, finger or pen. The browser's :focus-visible
 * turns on for whatever has the focus at any key press, so a button clicked and
 * then used by its shortcut would show the ring; the player shows it only while
 * this is true. A TV is driven by its remote alone: always true there.
 */
export function useKeyboardFocus(): boolean {
  const [keyboard, setKeyboard] = useState(isTvMode);
  useEffect(() => {
    if (isTvMode()) return;
    let byKey = false;
    const onKey = () => (byKey = true);
    const onPointer = () => {
      byKey = false;
      setKeyboard(false);
    };
    const onFocus = () => byKey && setKeyboard(true);
    // Capture: a handler that stops the event still counts, and focus moves after keydown.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("focusin", onFocus, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("focusin", onFocus, true);
    };
  }, []);
  return keyboard;
}
