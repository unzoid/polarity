import { useEffect, useRef, type PointerEvent } from "react";

/**
 * Warms what a card opens once the pointer or focus has rested on it for `delay` ms (docs/ui-components.md
 * U1), or immediately on touch `pointerdown` so tapping a phone poster starts warming before click fires.
 */
export function useCardIntent(warm: () => void, delay: number) {
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const start = (e?: PointerEvent) => {
    if (e && e.pointerType === "touch") return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(warm, delay);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    window.clearTimeout(timer.current);
    warm();
  };
  const cancel = () => window.clearTimeout(timer.current);
  return { onPointerDown, onPointerEnter: start, onPointerLeave: cancel, onFocus: () => start(), onBlur: cancel };
}
