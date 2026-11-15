import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Brightness } from "../icons";
import type { MediaLike } from "./mpvMedia";
import { VideoBackdrop } from "./VideoBackdrop";

/** How long the HUD stays after the finger lifts. */
const LINGER_MS = 1500;
const LEVEL = { type: "spring", duration: 0.35, bounce: 0 } as const;
const PRESENCE = { type: "spring", duration: 0.4, bounce: 0.15 } as const;

/**
 * The screen's brightness while a finger swipes the left half of the picture (useSwipeLevels): VolumeHud's pill
 * at the left edge, filled to the level, with a sun. It shows while `held` and lingers a moment after.
 */
export function BrightnessHud({ level, held, media }: { level: number; held: boolean; media: MediaLike | null }) {
  const reduce = useReducedMotion();
  const [lingering, setLingering] = useState(false);
  const wasHeld = useRef(held);
  useEffect(() => {
    const was = wasHeld.current;
    wasHeld.current = held;
    if (!was || held) return;
    setLingering(true);
    const t = setTimeout(() => setLingering(false), LINGER_MS);
    return () => clearTimeout(t);
  }, [held]);
  const visible = held || lingering;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="volume-hud"
          data-side="left"
          role="status"
          aria-label={`Brightness ${Math.round(level * 100)}%`}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: -24, scale: 0.94 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24, scale: 0.94, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
          transition={PRESENCE}
        >
          <div className="volume-hud-pill">
            <VideoBackdrop media={media} className="volume-hud-backdrop" crop />
            <motion.div className="volume-hud-fill" initial={false} animate={{ scaleY: level }} transition={reduce ? { duration: 0 } : LEVEL} />
            <Brightness className="volume-hud-icon" data-covered={level > 0.2} size="1.5rem" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
