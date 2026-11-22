import { useMemo, useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api";
import { runtimeSeconds } from "../format";
import { keys, useContinueWatching, useWatchHistory } from "../net/queries";
import type { Meta, Progress } from "../types";
import { nextVideo } from "./episodes";
import { removeFromContinueWatching } from "./titleActions";
import { isWatched } from "./watched";

/** How many recently finished series we inspect for an Up Next episode. */
export const UP_NEXT_SERIES_LIMIT = 12;
/** Maximum cards shown in the Continue Watching row (matches Rust's CONTINUE_LIMIT). */
export const CONTINUE_ROW_LIMIT = 20;

const DISMISSED_KEY = "polar.upNextDismissed";

export interface ContinueEntry {
  progress: Progress;
  /** True when the card queues the next unwatched episode after a finished one (no partial progress yet). */
  upNext?: boolean;
  /** The finished episode id that produced this Up Next card, used to dismiss it until a newer episode is watched. */
  afterVideoId?: string;
}

type DismissedMap = Record<string, string>;

let cachedDismissed: DismissedMap | null = null;
const listeners = new Set<() => void>();

function readDismissed(): DismissedMap {
  if (cachedDismissed) return cachedDismissed;
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: DismissedMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      cachedDismissed = out;
      return out;
    }
  } catch {
    // Ignore storage errors (private mode / tests without localStorage).
  }
  cachedDismissed = {};
  return cachedDismissed;
}

function writeDismissed(next: DismissedMap) {
  cachedDismissed = next;
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Best-effort persistence on this device.
  }
  listeners.forEach((fn) => fn());
}

function subscribeDismissed(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Hide Up Next cards for these finished episodes until the user watches another episode of the show. */
export function dismissUpNext(entries: readonly ContinueEntry[]) {
  const upNextEntries = entries.filter((e) => e.upNext && e.afterVideoId);
  if (!upNextEntries.length) return;
  const next = { ...readDismissed() };
  for (const e of upNextEntries) next[e.progress.metaId] = e.afterVideoId!;
  writeDismissed(next);
}

/** Reset the in-memory dismissal cache (for tests). */
export function resetDismissedUpNext() {
  cachedDismissed = null;
  try {
    localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn());
}

/**
 * Remove a mix of in-progress and Up Next entries from Continue Watching:
 * in-progress episodes reset to 0 (keeping the rest of the show's history),
 * while Up Next cards are dismissed until a newer episode is watched.
 */
export async function removeContinueEntries(entries: readonly ContinueEntry[]) {
  const inProgress = entries.filter((e) => !e.upNext).map((e) => e.progress);
  const upNext = entries.filter((e) => e.upNext);
  if (upNext.length) dismissUpNext(upNext);
  if (inProgress.length) await removeFromContinueWatching(inProgress);
}

/**
 * Recently finished series from watch history that aren't already in Continue Watching
 * and haven't been dismissed for their last finished episode.
 */
export function upNextSeriesCandidates(
  inProgress: readonly Progress[],
  history: readonly Progress[],
  dismissed: Readonly<DismissedMap> = {},
): Progress[] {
  const active = new Set(inProgress.map((p) => p.metaId));
  const out: Progress[] = [];
  for (const p of history) {
    if (p.type !== "series") continue;
    if (active.has(p.metaId)) continue;
    if (!isWatched(p.position, p.duration)) continue;
    if (dismissed[p.metaId] === p.videoId) continue;
    out.push(p);
    if (out.length >= UP_NEXT_SERIES_LIMIT) break;
  }
  return out;
}

/**
 * Combines in-progress items with Up Next episodes for recently finished series,
 * newest activity first. A series with a next released episode stays in Continue
 * Watching instead of vanishing the moment an episode finishes.
 */
export function buildContinueEntries(
  inProgress: readonly Progress[],
  history: readonly Progress[],
  metas: ReadonlyMap<string, Meta>,
  dismissed: Readonly<DismissedMap> = {},
): ContinueEntry[] {
  const entries: ContinueEntry[] = inProgress.map((progress) => ({ progress }));
  for (const p of upNextSeriesCandidates(inProgress, history, dismissed)) {
    const meta = metas.get(p.metaId);
    if (!meta) continue;
    const next = nextVideo(meta, p.videoId);
    if (!next) continue;
    entries.push({
      upNext: true,
      afterVideoId: p.videoId,
      progress: {
        metaId: p.metaId,
        type: "series",
        videoId: next.id,
        name: meta.name || p.name,
        poster: meta.poster ?? p.poster,
        background: next.thumbnail ?? meta.background ?? p.background,
        position: 0,
        duration: runtimeSeconds(meta.runtime) ?? 0,
        season: next.season,
        episode: next.episode,
        episodeTitle: next.title,
        updatedAt: p.updatedAt,
      },
    });
  }
  entries.sort((a, b) => b.progress.updatedAt - a.progress.updatedAt || a.progress.videoId.localeCompare(b.progress.videoId));
  return entries.slice(0, CONTINUE_ROW_LIMIT);
}

/** Continue Watching with automatic Up Next for recently finished series episodes. */
export function useUpNextContinueWatching(): ContinueEntry[] {
  const { data: inProgress } = useContinueWatching();
  const { data: history } = useWatchHistory();
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, readDismissed);

  const candidates = useMemo(
    () => upNextSeriesCandidates(inProgress ?? [], history ?? [], dismissed),
    [inProgress, history, dismissed],
  );

  const metaResults = useQueries({
    queries: candidates.map((p) => ({
      queryKey: keys.meta("series", p.metaId),
      queryFn: () => api.meta("series", p.metaId),
      staleTime: 60 * 60_000,
    })),
  });

  const metas = useMemo(() => {
    const map = new Map<string, Meta>();
    candidates.forEach((p, i) => {
      const m = metaResults[i]?.data;
      if (m) map.set(p.metaId, m);
    });
    return map;
  }, [candidates, metaResults]);

  return useMemo(
    () => buildContinueEntries(inProgress ?? [], history ?? [], metas, dismissed),
    [inProgress, history, metas, dismissed],
  );
}
