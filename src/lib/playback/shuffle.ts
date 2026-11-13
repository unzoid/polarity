import { isReleased } from "../format";
import type { Meta, Video } from "../types";

/**
 * Shuffle (a show's episodes in random order, for shows where the order doesn't matter): which ones have
 * played in this run, by show. Kept in memory only: a run ends with the app, and shuffled episodes never
 * change progress, Continue Watching or scrobbles (Player.tsx).
 */
const played = new Map<string, Set<string>>();

/** A new run for this show: nothing played yet but `first`. */
export function startShuffle(metaId: string, first?: string) {
  played.set(metaId, new Set(first ? [first] : []));
}

/** `videoId` has played in this show's run. */
export function noteShuffled(metaId: string, videoId: string) {
  const seen = played.get(metaId) ?? new Set<string>();
  seen.add(videoId);
  played.set(metaId, seen);
}

/** The regular, released episodes shuffle picks from (no specials, nothing not out yet). */
const pool = (meta: Meta) => meta.videos.filter((v) => v.season !== 0 && isReleased(v));

/** A random episode to start a run with. */
export function randomEpisode(meta: Meta, random = Math.random): Video | undefined {
  const all = pool(meta);
  return all[Math.floor(random() * all.length)];
}

/**
 * The episode after `current` in this run: one that hasn't played yet, at random. Once every episode has,
 * the run starts over (never with the one that just played).
 */
export function shuffledNext(meta: Meta, current: string, random = Math.random): Video | undefined {
  const others = pool(meta).filter((v) => v.id !== current);
  if (!others.length) return undefined;
  const seen = played.get(meta.id) ?? new Set<string>();
  let fresh = others.filter((v) => !seen.has(v.id));
  if (!fresh.length) {
    played.set(meta.id, new Set([current]));
    fresh = others;
  }
  return fresh[Math.floor(random() * fresh.length)];
}
