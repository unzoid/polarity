import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { storeLocal } from "../errors";
import { useHiddenIds } from "../library/hiddenTitles";
import { isWatched } from "../library/watched";
import { useLibrary, useWatchHistory } from "../net/queries";
import { isRecord, storedJson } from "../parse";
import type { ContentType, LibraryItem, Meta, MetaPreview, Progress } from "../types";

export interface TasteProfile {
  /** Normalized genre affinity (-1..+1): positive for genres you watch/save, negative for hidden titles. */
  genres: ReadonlyMap<string, number>;
  /** Subtle preference between movies and series (-0.25..+0.25). */
  typeBias: Record<ContentType, number>;
  /** Number of titles with known genres that informed this profile (0 = cold start). */
  sampleSize: number;
  /** Smooth cold-start ramp `sampleSize / (sampleSize + 5)` in [0, 1). */
  confidence: number;
}

export const EMPTY_TASTE: TasteProfile = {
  genres: new Map(),
  typeBias: { movie: 0, series: 0 },
  sampleSize: 0,
  confidence: 0,
};

/**
 * Ephemeral 4-axis session intent (Netflix #588): captures what the user is leaning toward
 * right now without mutating long-term taste, blended ~35% into live rankings.
 */
export interface SessionIntent {
  /** "continue" when returning to started shows, "discover" when browsing fresh catalogs. */
  mode?: "continue" | "discover";
  /** Genre recently opened or searched in this session. */
  genre?: string;
  /** Movie vs. series leaning in this session. */
  mediaType?: ContentType;
  /** Preferred release decade/era (e.g. [1990, 1999]). */
  era?: [number, number];
}

const DAY_MS = 86_400_000;
/** Wall-clock half-life for watch history decay (45 days, Netflix #561/#582). */
const HISTORY_HALF_LIFE_DAYS = 45;
/** Grace window for <15% starts before counting them as stale abandonments (14 days). */
const ABANDON_GRACE_DAYS = 14;
const IMPRESSION_KEY = "polar.taste.impressions";
const IMPRESSION_MAX = 200;
const IMPRESSION_HALF_LIFE_DAYS = 21;

const normGenre = (g: string) => g.trim().toLowerCase();

function wallClockDecay(updatedAt: number, now: number, halfLifeDays: number, floor: number): number {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 0.7;
  const ageDays = Math.max(0, (now - updatedAt) / DAY_MS);
  return Math.max(floor, Math.pow(0.5, ageDays / halfLifeDays));
}

/**
 * Pure local taste model built from watch history, library saves, hidden titles, and any known genres
 * for those titles (from cached metas/catalogs). Zero network calls, fully deterministic.
 *
 * Uses wall-clock exponential decay (45-day half-life), a 14-day grace window for <15% starts,
 * logarithmic multi-episode binge compression (`3 + ln(eps)`), and smooth cold-start confidence.
 */
export function buildTasteProfile(input: {
  history: readonly Progress[];
  library: readonly LibraryItem[];
  hidden?: ReadonlySet<string>;
  genresOf: (id: string) => readonly string[] | undefined;
  now?: number;
}): TasteProfile {
  const now = input.now ?? Date.now();
  const raw = new Map<string, number>();
  const seen = new Set<string>();
  let sampleSize = 0;
  let movieWeight = 0;
  let seriesWeight = 0;

  const addType = (type: ContentType, w: number) => {
    if (type === "movie") movieWeight += w;
    else seriesWeight += w;
  };

  // Group multi-episode progress per title so a 100-episode binge scales logarithmically (`3 + ln(eps)`).
  const byTitle = new Map<string, { latest: Progress; episodes: number; anyFinished: boolean }>();
  for (const p of input.history) {
    const finished = isWatched(p.position, p.duration);
    const cur = byTitle.get(p.metaId);
    if (!cur) {
      byTitle.set(p.metaId, { latest: p, episodes: 1, anyFinished: finished });
    } else {
      cur.episodes++;
      if (finished) cur.anyFinished = true;
      if (p.updatedAt > cur.latest.updatedAt) cur.latest = p;
    }
  }

  const sortedHistory = [...byTitle.values()].sort((a, b) => b.latest.updatedAt - a.latest.updatedAt);
  sortedHistory.forEach(({ latest: p, episodes, anyFinished }) => {
    if (seen.has(p.metaId)) return;
    seen.add(p.metaId);
    const decay = wallClockDecay(p.updatedAt, now, HISTORY_HALF_LIFE_DAYS, 0.25);
    const frac = p.duration > 0 ? p.position / p.duration : 0;
    const ageDays = Math.max(0, (now - p.updatedAt) / DAY_MS);

    let baseWeight: number;
    if (anyFinished || episodes > 1) {
      // Logarithmic binge compression: 1 finished watch = 3.0; 20 episodes ≈ 6.0 (never 60x a film).
      baseWeight = 3 + Math.log(Math.max(1, episodes));
    } else if (frac < 0.15) {
      // 14-day grace window for quick samples; stale <15% starts are downweighted as abandonments.
      baseWeight = ageDays <= ABANDON_GRACE_DAYS ? 0.75 : 0.2;
    } else {
      baseWeight = 2;
    }

    const w = baseWeight * decay;
    addType(p.type, w);
    const gs = input.genresOf(p.metaId);
    if (!gs?.length) return;
    sampleSize++;
    for (const g of gs) {
      const k = normGenre(g);
      raw.set(k, (raw.get(k) ?? 0) + w);
    }
  });

  // Saved titles not yet in watch history: softer positive signal with wall-clock decay.
  const sortedLibrary = [...input.library].sort((a, b) => b.addedAt - a.addedAt);
  sortedLibrary.forEach((l) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    const decay = wallClockDecay(l.addedAt, now, HISTORY_HALF_LIFE_DAYS * 1.5, 0.35);
    const w = 1.25 * decay;
    addType(l.type, w);
    const gs = input.genresOf(l.id);
    if (!gs?.length) return;
    sampleSize++;
    for (const g of gs) {
      const k = normGenre(g);
      raw.set(k, (raw.get(k) ?? 0) + w);
    }
  });

  // Hidden titles: negative signal so dismissed genres sink naturally.
  if (input.hidden?.size) {
    for (const id of input.hidden) {
      const gs = input.genresOf(id);
      if (!gs?.length) continue;
      sampleSize++;
      for (const g of gs) {
        const k = normGenre(g);
        raw.set(k, (raw.get(k) ?? 0) - 1.75);
      }
    }
  }

  let maxAbs = 0;
  for (const v of raw.values()) maxAbs = Math.max(maxAbs, Math.abs(v));
  const genres = new Map<string, number>();
  if (maxAbs > 0) {
    for (const [k, v] of raw) genres.set(k, v / maxAbs);
  }

  const totalType = movieWeight + seriesWeight;
  const movieShare = totalType > 0 ? (movieWeight / totalType - 0.5) * 0.5 : 0;
  return {
    genres,
    typeBias: { movie: movieShare, series: -movieShare },
    sampleSize,
    confidence: sampleSize / (sampleSize + 5),
  };
}

// --- Passive impression frequency capping (Netflix #580) & Serendipity (#626) ---

export interface ImpressionEntry {
  count: number;
  lastAt: number;
}

export function loadImpressions(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Map<string, ImpressionEntry> {
  const out = new Map<string, ImpressionEntry>();
  if (!storage) return out;
  const raw = storedJson(storage, IMPRESSION_KEY);
  if (!isRecord(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (isRecord(v) && typeof v.count === "number" && typeof v.lastAt === "number") {
      out.set(id, { count: v.count, lastAt: v.lastAt });
    }
  }
  return out;
}

/** Record passive impressions (Hero / Pick for Me) in a bounded 200-ID LRU. */
export function recordImpressions(
  ids: readonly string[],
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
) {
  if (!ids.length) return;
  const map = loadImpressions(storage);
  for (const id of ids) {
    const prev = map.get(id);
    const decayed = prev ? prev.count * wallClockDecay(prev.lastAt, now, IMPRESSION_HALF_LIFE_DAYS, 0) : 0;
    map.set(id, { count: Math.min(20, decayed + 1), lastAt: now });
  }
  const trimmed = [...map.entries()].sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, IMPRESSION_MAX);
  if (storage) storeLocal(IMPRESSION_KEY, JSON.stringify(Object.fromEntries(trimmed)), storage);
}

/** Fatigue penalty in [0, 0.45] for titles repeatedly surfaced and ignored without being clicked. */
export function impressionPenalty(
  id: string,
  impressions?: ReadonlyMap<string, ImpressionEntry>,
  now = Date.now(),
): number {
  const entry = impressions?.get(id);
  if (!entry) return 0;
  const eff = entry.count * wallClockDecay(entry.lastAt, now, IMPRESSION_HALF_LIFE_DAYS, 0);
  if (eff < 1.5) return 0;
  return Math.min(0.45, (eff - 1) * 0.08);
}

/** Serendipity in [0, 1]: `1 - maxJaccard(candidate, recentGenreSets)` so discovery rows stay varied. */
export function serendipityScore(candidate: MetaPreview, recentGenreSets: readonly (readonly string[])[]): number {
  const cand = new Set((candidate.genres ?? []).map(normGenre));
  if (!cand.size || !recentGenreSets.length) return 0.5;
  let maxSim = 0;
  for (const recent of recentGenreSets) {
    if (!recent.length) continue;
    let inter = 0;
    const union = new Set(cand);
    for (const g of recent) {
      const k = normGenre(g);
      if (cand.has(k)) inter++;
      union.add(k);
    }
    maxSim = Math.max(maxSim, union.size ? inter / union.size : 0);
  }
  return 1 - maxSim;
}

// --- Ephemeral session intent store ---

let currentSession: SessionIntent = {};
export const getSessionIntent = (): SessionIntent => currentSession;
export const updateSessionIntent = (patch: Partial<SessionIntent>) => {
  currentSession = { ...currentSession, ...patch };
};
export const resetSessionIntent = () => {
  currentSession = {};
};

function sessionBonus(item: MetaPreview, session?: SessionIntent): number {
  if (!session) return 0;
  let score = 0;
  if (session.mediaType && item.type === session.mediaType) score += 0.25;
  if (session.genre && item.genres?.some((g) => normGenre(g) === normGenre(session.genre!))) score += 0.45;
  if (session.era) {
    const y = Number(item.releaseInfo?.match(/\b(19\d{2}|20\d{2})\b/)?.[1]);
    if (Number.isFinite(y) && y >= session.era[0] && y <= session.era[1]) score += 0.3;
  }
  return Math.min(1, score);
}

/** Genre affinity score for a shelf (`type`, `genre`), combining personal taste with daily variety and session intent. */
export function tasteGenreRank(
  type: ContentType,
  genre: string,
  taste: TasteProfile | undefined,
  noise: number,
  session?: SessionIntent,
): number {
  const sessionLift = session
    ? (session.genre && normGenre(session.genre) === normGenre(genre) ? 0.35 : 0) +
      (session.mediaType === type ? 0.1 : 0)
    : 0;
  if (!taste || taste.sampleSize === 0) return noise - sessionLift;
  const g = taste.genres.get(normGenre(genre)) ?? 0;
  // Never let media-type bias cancel out an explicitly hidden (negative-affinity) genre.
  const affinity = g < 0 ? g * 1.4 : g + taste.typeBias[type];
  // Higher affinity → lower sort key; keep 0.35 weight on daily noise so Home still feels fresh each day.
  return -affinity * 0.65 + noise * 0.35 - sessionLift;
}

/** Score a candidate title for "Surprise Me / Pick for Me" and Steerable Discover. */
export function scoreCandidate(
  item: MetaPreview,
  taste?: TasteProfile,
  session?: SessionIntent,
  impressions?: ReadonlyMap<string, ImpressionEntry>,
  now = Date.now(),
): number {
  const rating = Number.parseFloat(item.imdbRating ?? "");
  const ratingScore = Number.isFinite(rating) ? Math.max(0, (rating - 5.5) / 4.5) : 0.35;
  const artBonus = (item.background ? 0.15 : 0) + (item.poster ? 0.1 : 0);
  const fatigue = impressionPenalty(item.id, impressions, now);
  const sess = sessionBonus(item, session);
  if (!taste || taste.sampleSize === 0 || !item.genres?.length) {
    return ratingScore + artBonus + sess * 0.35 - fatigue;
  }
  const genreAvg = item.genres.reduce((acc, g) => acc + (taste.genres.get(normGenre(g)) ?? 0), 0) / item.genres.length;
  const longTerm = ratingScore * 0.55 + (genreAvg + taste.typeBias[item.type]) * 0.45;
  const blended = session ? longTerm * 0.65 + sess * 0.35 : longTerm;
  return blended + artBonus - fatigue;
}

/**
 * Pick an unwatched, high-affinity title to solve decision paralysis ("Surprise Me").
 * Picks randomly from the top slice of scored candidates so repeated clicks stay surprising.
 */
export function pickForMe(
  candidates: readonly MetaPreview[],
  exclude: ReadonlySet<string>,
  taste?: TasteProfile,
  rand: () => number = Math.random,
  opts?: { session?: SessionIntent; impressions?: ReadonlyMap<string, ImpressionEntry>; now?: number },
): MetaPreview | undefined {
  const seen = new Set<string>();
  const fresh = candidates.filter((m) => !exclude.has(m.id) && !seen.has(m.id) && seen.add(m.id));
  const pool = fresh.length ? fresh : candidates.filter((m) => !seen.has(m.id) && seen.add(m.id));
  if (!pool.length) return undefined;
  const ranked = [...pool].sort(
    (a, b) => scoreCandidate(b, taste, opts?.session, opts?.impressions, opts?.now) - scoreCandidate(a, taste, opts?.session, opts?.impressions, opts?.now),
  );
  const topN = Math.min(ranked.length, Math.max(3, Math.ceil(ranked.length * 0.35)));
  const idx = Math.min(topN - 1, Math.floor(rand() * topN));
  return ranked[idx];
}

/**
 * Builds the profile's local taste model from watch history, saved titles, hidden titles, and any
 * genres already in the React Query cache (metas, catalogs, featured, recommendations).
 */
export function useTasteProfile(): TasteProfile {
  const qc = useQueryClient();
  const { data: history } = useWatchHistory();
  const { data: library } = useLibrary();
  const hidden = useHiddenIds();

  return useMemo(() => {
    if (!history?.length && !library?.length && !hidden.size) return EMPTY_TASTE;
    const byId = new Map<string, string[]>();
    const record = (m?: { id?: string; genres?: string[] }) => {
      if (m?.id && m.genres?.length && !byId.has(m.id)) byId.set(m.id, m.genres);
    };
    for (const q of qc.getQueryCache().getAll()) {
      const root = q.queryKey[0];
      const data = q.state.data;
      if (!data) continue;
      if (root === "meta") record(data as Meta);
      else if (root === "catalog" || root === "featured" || root === "recommend") {
        if (Array.isArray(data)) for (const item of data as MetaPreview[]) record(item);
      }
    }
    return buildTasteProfile({
      history: history ?? [],
      library: library ?? [],
      hidden,
      genresOf: (id) => byId.get(id),
    });
  }, [qc, history, library, hidden]);
}
