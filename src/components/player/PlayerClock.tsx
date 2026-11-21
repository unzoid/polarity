import { formatTime } from "../../lib/format";
import { frameAt } from "./frameStep";
import type { MediaLike } from "./mpvMedia";
import { useMediaTime } from "./useMediaTime";

export const TIME_DISPLAYS = ["remaining", "elapsed", "endsAt"] as const;
export type TimeDisplay = (typeof TIME_DISPLAYS)[number];

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The timeline clock (Settings → Playback; clicking it cycles). Its own
 * component: it is the one part of the controls that changes every second.
 * Paused on a stepped frame (`fps` set) it shows the time and the frame number instead.
 */
export function PlayerClock({
  media,
  display,
  rate,
  onCycle,
  fps = null,
  active = true,
}: {
  media: MediaLike | null;
  display: TimeDisplay;
  rate: number;
  onCycle: () => void;
  fps?: number | null;
  active?: boolean;
}) {
  // "Ends at" only displays hour + minute: quantize to the wall-clock minute so it renders once per minute, not 60x.
  const shown = useMediaTime(active ? media : null, (t) => {
    if (fps) return `${formatTime(t.current)} · Frame ${frameAt(t.current, fps)}`;
    if (display === "elapsed") return `${formatTime(t.current)} / ${formatTime(t.duration)}`;
    if (display === "endsAt") {
      const rem = (t.duration - t.current) / (rate || 1);
      if (!Number.isFinite(rem)) return "Live";
      const endMin = Math.round((Date.now() + rem * 1000) / 60_000) * 60_000;
      return `Ends at ${clock.format(endMin)}`;
    }
    return formatTime(t.duration - t.current);
  });
  const text = shown;
  return (
    <button className="player-remaining tabular" onClick={onCycle} title="Change what the clock shows" aria-label={`${text}. Change what the clock shows`}>
      {text}
    </button>
  );
}

/**
 * The frame number on its own over the picture (#346): shown while paused on a stepped frame once the rest of
 * the controls have hidden (CSS, by the player's data-chrome), with the subtitles' shadow to read on any frame.
 */
export function FrameLabel({ media, fps }: { media: MediaLike | null; fps: number }) {
  const frame = useMediaTime(media, (t) => frameAt(t.current, fps));
  return (
    <div className="player-frame-label tabular" aria-hidden="true">
      Frame {frame}
    </div>
  );
}
