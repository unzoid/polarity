import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "../../lib/ui/dismiss";
import { Unlock } from "../icons";
import { Button } from "../ui/Button";

/** How long the Unlock chip stays after a tap on the locked screen. */
export const LOCK_CHIP_MS = 3000;

/**
 * The player's touch lock (phones and tablets): locked, the controls hide and every touch on the screen is
 * swallowed, so a pocket or a child can't pause, seek or leave. Playback, Up Next and the sleep timer carry on.
 * `available` off (TV mode, a mouse) unlocks it.
 */
export function useTouchLock(available: boolean) {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!available) setLocked(false);
  }, [available]);
  return {
    available,
    locked: available && locked,
    lock: useCallback(() => setLocked(true), []),
    unlock: useCallback(() => setLocked(false), []),
  };
}

const swallow = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Over the whole player while it's locked: a tap shows the Unlock chip for a moment, and pressing the chip
 * unlocks. The system's Back (Android's button and gesture, iOS's edge swipe) and Escape show the chip too,
 * rather than leaving the player.
 */
export function TouchLockLayer({ onUnlock }: { onUnlock: () => void }) {
  const [chip, setChip] = useState(false);
  const timer = useRef<number>(undefined);
  const show = useCallback(() => {
    setChip(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChip(false), LOCK_CHIP_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useDismiss(true, show);

  return (
    <div
      className="player-lock"
      aria-label="Screen locked"
      role="group"
      onPointerDown={swallow}
      onPointerMove={swallow}
      onPointerUp={swallow}
      onDoubleClick={swallow}
      onWheel={swallow}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        show();
      }}
    >
      {chip && (
        <Button
          variant="glass"
          size="sm"
          className="player-lock-chip"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onUnlock();
          }}
        >
          <Unlock size={18} aria-hidden /> Unlock
        </Button>
      )}
    </div>
  );
}
