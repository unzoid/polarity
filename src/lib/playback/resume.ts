import type { Progress } from "../types";

/** Settings → Playback, as the player reads them. */
export interface ResumeRule {
  /** Resume playback is on. */
  resume: boolean;
  /** Seconds to go back from the saved position. */
  rewind: number;
  /** The share of a video after which it counts as watched (and starts over). */
  watchedFraction: number;
}

/** Where to pick up from a saved position, or undefined to start over: not within the first 30 s, not once watched. */
export function resumeFrom(r: Pick<Progress, "position" | "duration"> | undefined, rule: ResumeRule): number | undefined {
  if (!rule.resume || !r || r.position <= 30 || r.position / r.duration >= rule.watchedFraction) return undefined;
  return Math.max(0, r.position - rule.rewind);
}

/**
 * Where a load starts. The watch party's position wins; then where a source that just failed had
 * got to (the next source carries on, it doesn't go back to where the episode was opened); then
 * the saved resume point.
 */
export function startPosition(party: number | null | undefined, reached: number | undefined, saved: number | undefined): number | undefined {
  return party ?? reached ?? saved;
}
