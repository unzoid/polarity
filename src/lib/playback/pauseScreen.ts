import { episodeCode } from "../format";
import type { Meta, Person } from "../types";

/**
 * The pause screen (components/player/PauseScreen.tsx): paused and left alone, the frame dims and shows what is
 * playing, its overview and its main cast. It comes this long after the controls have hidden.
 */
export const PAUSE_SCREEN_AFTER_MS = 3000;
/** How long the pause screen takes to fade out when playback resumes or input wakes the player. */
export const PAUSE_SCREEN_EXIT_MS = 160;
/** The most cast members it lists. */
export const PAUSE_SCREEN_CAST = 6;

/** What the player is doing, as far as the pause screen cares. */
export interface PauseScreenState {
  /** Settings → Playback → "Show details while paused". */
  enabled: boolean;
  /** YouTube's player is never drawn over. */
  engine: "mpv" | "html" | "youtube" | null;
  /** The source is up and its first frame has played. */
  playing: boolean;
  paused: boolean;
  ended: boolean;
  buffering: boolean;
  /** The controls are up (or held up by an open menu). */
  controls: boolean;
  /** A panel, menu, the sleep-timer dialog, a source's info or the torrent notice is open. */
  layer: boolean;
  /** The Up Next card is up. */
  nextUp: boolean;
  /** A watch party's note or hold, or the player's own short notice, is on screen. */
  notice: boolean;
  /** Playing on a TV (AirPlay, Chromecast): its own panel is up. */
  casting: boolean;
  /** Paused on a stepped frame: the frame is what is being looked at. */
  stepping: boolean;
  /** There is something to show (the title's details have loaded). */
  details: boolean;
}

/** Whether the pause screen may show now; the wait (PAUSE_SCREEN_AFTER_MS) starts when this turns true. */
export function pauseScreenAllowed(s: PauseScreenState): boolean {
  return (
    s.enabled &&
    (s.engine === "mpv" || s.engine === "html") &&
    s.playing &&
    s.paused &&
    !s.ended &&
    !s.buffering &&
    !s.controls &&
    !s.layer &&
    !s.nextUp &&
    !s.notice &&
    !s.casting &&
    !s.stepping &&
    s.details
  );
}

/** What the pause screen says. */
export interface PauseDetails {
  name: string;
  logo?: string;
  logos?: string[];
  /** An episode's code and title ("S1, E2", "The Second One"). */
  episode?: { code: string; title: string };
  /** Year, certification and primary genres ("2024 · TV-MA · Drama"). */
  facts?: string;
  overview?: string;
  cast: Person[];
}

/** The details of `videoId` in `meta`: an episode's own overview, else the title's; the first named cast members. */
export function pauseDetails(meta: Meta | undefined, videoId: string): PauseDetails | undefined {
  if (!meta?.name) return undefined;
  const video = meta.videos?.find((v) => v.id === videoId);
  const episode = video && video.season != null && video.episode != null ? { code: episodeCode(video.season, video.episode), title: video.title } : undefined;
  const year = video?.released?.slice(0, 4) || meta.releaseInfo?.trim();
  const genres = meta.genres?.filter(Boolean).slice(0, 2).join(", ");
  const facts = [year, meta.certification?.trim(), genres].filter(Boolean).join(" · ") || undefined;
  const overview = (video?.overview || meta.description || "").trim() || undefined;
  const cast = (meta.people ?? []).filter((p) => p.name?.trim()).slice(0, PAUSE_SCREEN_CAST);
  return { name: meta.name, logo: meta.logo, logos: meta.logos, episode, facts, overview, cast };
}
