import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { os } from "../../lib/platform";
import { Brightness } from "../icons";
import { isMpv, type MediaLike } from "./mpvMedia";
import type { ScreenBrightnessHandle } from "./useScreenBrightness";
import { VideoBackdrop } from "./VideoBackdrop";

/** How long the HUD stays after the finger lifts. */
const LINGER_MS = 1500;
const PRESENCE = { type: "spring", duration: 0.4, bounce: 0.15 } as const;

/**
 * The screen's brightness while a finger swipes the left half of the picture (useSwipeLevels): VolumeHud's pill
 * at the left edge, filled to the level, with a sun. Drives its fill directly through DOM refs from the
 * brightness bus so 60–120 Hz drags cause zero React re-renders.
 */
export function BrightnessHud({
  brightness,
  held,
  media,
}: {
  brightness: ScreenBrightnessHandle;
  held: boolean;
  media: MediaLike | null;
}) {
  const reduce = useReducedMotion();
  const [lingering, setLingering] = useState(false);
  const wasHeld = useRef(held);
  const hudRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const iconWrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const was = wasHeld.current;
    wasHeld.current = held;
    if (!was || held) return;
    setLingering(true);
    const t = setTimeout(() => setLingering(false), LINGER_MS);
    return () => clearTimeout(t);
  }, [held]);

  const visible = held || lingering;

  useEffect(() => {
    if (!visible) return;
    const apply = (n: number) => {
      const clamped = Math.max(0, Math.min(1, n));
      if (fillRef.current) fillRef.current.style.transform = `scaleY(${clamped})`;
      if (hudRef.current) hudRef.current.setAttribute("aria-label", `Brightness ${Math.round(clamped * 100)}%`);
      const icon = iconWrapRef.current?.firstElementChild as HTMLElement | null;
      if (icon) icon.dataset.covered = String(clamped > 0.2);
    };
    const initial = brightness.getLevel();
    if (initial != null) apply(initial);
    return brightness.subscribe(apply);
  }, [visible, brightness]);

  const initialLevel = brightness.getLevel() ?? 0;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          ref={hudRef}
          className="volume-hud"
          data-side="left"
          role="status"
          aria-label={`Brightness ${Math.round(initialLevel * 100)}%`}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: -24, scale: 0.94 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24, scale: 0.94, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
          transition={PRESENCE}
        >
          <div className="volume-hud-pill">
            {!((os === "android" || os === "ios") && isMpv(media)) && <VideoBackdrop media={media} className="volume-hud-backdrop" crop />}
            <div ref={fillRef} className="volume-hud-fill" style={{ transform: `scaleY(${initialLevel})` }} />
            <span ref={iconWrapRef} style={{ display: "contents" }}>
              <Brightness className="volume-hud-icon" data-covered={initialLevel > 0.2} size="1.5rem" />
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
