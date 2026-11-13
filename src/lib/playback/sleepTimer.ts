/**
 * The player's sleep timer (#270): stop after a set time or at the end of this episode, for falling
 * asleep to something. Pure, so the timing is tested with a made-up clock; `useSleepTimer` runs it.
 *
 * The sound fades out over the last `FADE_MS`, then playback pauses. From `WARN_MS` before the end
 * a prompt offers "+15 min" and Cancel. Nothing is remembered: each playback starts without a timer.
 */

/** Off, a number of minutes, or the end of the episode playing. */
export type SleepChoice = "off" | "15" | "30" | "45" | "60" | "90" | "episode";

export const SLEEP_CHOICES: { id: SleepChoice; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "15", label: "15 minutes" },
  { id: "30", label: "30 minutes" },
  { id: "45", label: "45 minutes" },
  { id: "60", label: "1 hour" },
  { id: "90", label: "1 hour 30 minutes" },
  { id: "episode", label: "End of this episode" },
];

/** The sound fades out over this long before playback pauses. */
export const FADE_MS = 30_000;
/** The "+15 min" prompt shows from this long before the end. */
export const WARN_MS = 60_000;
/** What "+15 min" adds. */
export const EXTEND_MS = 15 * 60_000;

/** A running timer: a moment on the clock, or the end of the episode. */
export type SleepTimer = { kind: "at"; deadline: number } | { kind: "episode" };

/** The timer `choice` starts at `now` (ms); none for Off. */
export function startSleep(choice: SleepChoice, now: number): SleepTimer | null {
  if (choice === "off") return null;
  if (choice === "episode") return { kind: "episode" };
  return { kind: "at", deadline: now + Number(choice) * 60_000 };
}

/** "+15 min": fifteen more minutes from when it would have ended (from now, once that has passed). An episode's end becomes a time. */
export function extendSleep(timer: SleepTimer, now: number, left: number | null): SleepTimer {
  const end = timer.kind === "at" ? timer.deadline : now + Math.max(0, left ?? 0);
  return { kind: "at", deadline: Math.max(end, now) + EXTEND_MS };
}

/**
 * Milliseconds until the timer ends, or null while that isn't known (the episode's length isn't yet).
 * `mediaLeft` is what's left of the video in seconds at the playback `rate`.
 */
export function sleepLeft(timer: SleepTimer, now: number, mediaLeft?: number, rate = 1): number | null {
  if (timer.kind === "at") return timer.deadline - now;
  if (mediaLeft == null || !Number.isFinite(mediaLeft)) return null;
  return (Math.max(0, mediaLeft) * 1000) / (rate > 0 ? rate : 1);
}

/** How loud to play (0–1) with `left` ms to go: full until the fade, then down to silence at the end. */
export function sleepGain(left: number | null): number {
  if (left == null || left >= FADE_MS) return 1;
  return Math.max(0, left / FADE_MS);
}

/** Whether the "+15 min" prompt shows with `left` ms to go. */
export const sleepWarns = (left: number | null) => left != null && left > 0 && left <= WARN_MS;

/** Whether the timer has run out. */
export const sleepDone = (left: number | null) => left != null && left <= 0;

/** The time left for the moon by the clock: "1:05:00", "12:30", "0:45". */
export function sleepLabel(left: number): string {
  const s = Math.max(0, Math.ceil(left / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
