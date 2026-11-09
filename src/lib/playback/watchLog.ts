/**
 * The watch log (#424): what the player did while a video played, kept in memory by dev builds (and `bun tauri dev`)
 * only, for "Copy Watch Log" when something odd happens mid-video, such as a blip that brings the controls back.
 * Each line has the time since the player opened and the position in the video: buffering with the cache's fill,
 * seeks and who made them, pauses and plays, track and source changes, autocrop's changes and holds, the controls
 * showing and hiding and why, mpv's own events, dropped frames, watch party messages that moved playback, and the
 * window's focus.
 *
 * Release builds have neither the log nor the button: `WATCH_LOG` is fixed when the app is built, so their bundle
 * leaves it out. Every line goes through `redact` as the start log's do: hosts and ids, never links, keys or titles.
 */
import { redact } from "./startLog";

/** Whether this build keeps a watch log: a dev build, the dev server's, or the tests'. Any other `vite build` is "production". */
export const WATCH_LOG: boolean = import.meta.env.VITE_POLAR_CHANNEL === "dev" || import.meta.env.MODE !== "production";

export interface WatchLine {
  /** Milliseconds since the log started (the player opened). */
  at: number;
  /** Seconds into the video, when known. */
  position?: number;
  text: string;
}

/** An hour or so of a quiet video, a few minutes of a busy one; the oldest lines drop off. */
const MAX_LINES = 3000;

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
};

export function createWatchLog(max = MAX_LINES) {
  let lines: WatchLine[] = [];
  let start: { wall: number; at: number } | null = null;
  let dropped = false;
  return {
    /** The player opened: the last video's lines go. */
    reset(wall: number, at: number) {
      lines = [];
      dropped = false;
      start = { wall, at };
    },
    add(at: number, text: string, position?: number) {
      if (!start) return;
      lines.push({ at: at - start.at, text: redact(text), ...(position !== undefined && Number.isFinite(position) ? { position } : {}) });
      if (lines.length > max) {
        lines = lines.slice(-max);
        dropped = true;
      }
    },
    lines: () => lines,
    /** The log as text, in the party log's style, `head` lines (app, platform, player) first. */
    text(head: string[] = []) {
      if (!start) return "Nothing played yet.";
      return [
        "Polarity watch log",
        ...head,
        `Started ${new Date(start.wall).toISOString()}; each line has the seconds since then and the position in the video.`,
        ...(dropped ? ["(older lines dropped)"] : []),
        "",
        ...lines.map((l) => `+${(l.at / 1000).toFixed(3).padStart(9)}  ${(l.position !== undefined ? clock(l.position) : "-").padStart(10)}  ${l.text}`),
      ].join("\n");
    },
  };
}

export type WatchLog = ReturnType<typeof createWatchLog>;

/** This app's watch log, or null in a build without one. */
export const watchLog: WatchLog | null = WATCH_LOG ? createWatchLog() : null;

/** The video the log's positions are read from. */
let playing: { currentTime: number } | null = null;

export function watchMedia(media: { currentTime: number } | null) {
  playing = media;
}

/** Note `text` in the watch log, at the playing video's position. Nothing in a build without the log. */
export function watch(text: string) {
  if (!watchLog) return;
  watchLog.add(performance.now(), text, playing?.currentTime);
}
