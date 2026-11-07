/**
 * Autocrop's lookahead (docs/autocrop.md §4) in the video playing now, as
 * `mpv_lookahead` reports it (`preroll::Lookahead`), and the status line
 * Settings → Advanced shows under "Look ahead for bar changes".
 */

export type LookaheadState = "reading" | "this-device" | "no-reader" | "not-opened" | "live" | "no-seeking" | "stopped";

const why: Record<Exclude<LookaheadState, "reading" | "this-device">, string> = {
  "no-reader": "a second player for reading ahead didn't start",
  "not-opened": "its source wouldn't open a second time",
  live: "it's a live stream, with nothing ahead to read",
  "no-seeking": "its source can't jump ahead from keyframe to keyframe",
  stopped: "its source stopped answering the reader",
};

/** What the lookahead does in the video playing now, shown under the setting's caption (`null`: nothing playing). */
export function lookaheadStatus(state: LookaheadState | null): string | null {
  if (state === null) return null;
  if (state === "reading") return "Reading ahead in the video playing now.";
  if (state === "this-device") return "Not available on this device yet.";
  return `Not reading ahead in the video playing now: ${why[state]}.`;
}
