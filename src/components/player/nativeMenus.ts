import type { NativeDialog } from "../../lib/platform";

/**
 * The player's Speed picker as iOS's own menu (#174), laid out as AVKit lays out its own: the speeds in one list,
 * the current one ticked. Subtitles & Audio, Sources and Episodes keep the app's own panel, as on every platform
 * (#465): their rows carry details, settings and filters a menu can't.
 */

/** "1x (Normal)", "1.5x". */
export function speedLabel(rate: number) {
  return rate === 1 ? "1x (Normal)" : `${rate}x`;
}

export function speedMenu(speeds: number[], rate: number): Omit<NativeDialog, "anchor"> {
  return {
    kind: "menu",
    title: "Playback Speed",
    actions: speeds.map((r) => ({ id: String(r), label: speedLabel(r), style: "default", checked: r === rate })),
  };
}

/** The speed picked from `speedMenu`, or null. */
export function pickedSpeed(id: string | null): number | null {
  const r = id == null ? NaN : Number(id);
  return Number.isFinite(r) && r > 0 ? r : null;
}
