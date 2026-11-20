import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useHiddenIds } from "../library/hiddenTitles";
import { isWatched } from "../library/watched";
import { useLibrary, useWatchHistory } from "../net/queries";
import type { ContentType, LibraryItem, Meta, MetaPreview, Progress } from "../types";

export interface TasteProfile {
  /** Normalized genre affinity (-1..+1): positive for genres you watch/save, negative for hidden titles. */
  genres: ReadonlyMap<string, number>;
  /** Subtle preference between movies and series (-0.25..+0.25). */
  typeBias: Record<ContentType, number>;
  /** Number of titles with known genres that informed this profile (0 = cold start). */
  sampleSize: number;
}

export const EMPTY_TASTE: TasteProfile = {
  genres: new Map(),
  typeBias: { movie: 0, series: 0 },
  sampleSize: 0,
};

const normGenre = (g: string) => g.trim().toLowerCase();

/**
 * Pure local taste model built from watch history, library saves, hidden titles, and any known genres
 * for those titles (from cached metas/catalogs). Zero network calls, fully deterministic.
 */
export function buildTasteProfile(input: {
  history: readonly Progress[];
  library: readonly LibraryItem[];
  hidden?: ReadonlySet<string>;
  genresOf: (id: string) => readonly string[] | undefined;
}): TasteProfile {
  const raw = new Map<string, number>();
  const seen = new Set<string>();
  let sampleSize = 0;
  let movieWeight = 0;
  let seriesWeight = 0;

  const addType = (type: ContentType, w: number) => {
    if (type === "movie") movieWeight += w;
    else seriesWeight += w;
  };

  // Watch history (newest first): finished titles count strongest, recent ones count more than old ones.
  const sortedHistory = [...input.history].sort((a, b) => b.updatedAt - a.updatedAt);
  sortedHistory.forEach((p, i) => {
    if (seen.has(p.metaId)) return;
    seen.add(p.metaId);
    const decay = Math.max(0.35, 1 - i * 0.03);
    const w = (isWatched(p.position, p.duration) ? 3 : 2) * decay;
    addType(p.type, w);
    const gs = input.genresOf(p.metaId);
    if (!gs?.length) return;
    sampleSize++;
    for (const g of gs) {
      const k = normGenre(g);
      raw.set(k, (raw.get(k) ?? 0) + w);
    }
  });

  // Saved titles not yet in watch history: softer positive signal.
  const sortedLibrary = [...input.library].sort((a, b) => b.addedAt - a.addedAt);
  sortedLibrary.forEach((l, i) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    const decay = Math.max(0.4, 1 - i * 0.025);
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
  };
}

/** Genre affinity score for a shelf (`type`, `genre`), combining personal taste with daily variety. */
export function tasteGenreRank(type: ContentType, genre: string, taste: TasteProfile | undefined, noise: number): number {
  if (!taste || taste.sampleSize === 0) return noise;
  const g = taste.genres.get(normGenre(genre)) ?? 0;
  // Never let media-type bias cancel out an explicitly hidden (negative-affinity) genre.
  const affinity = g < 0 ? g * 1.4 : g + taste.typeBias[type];
  // Higher affinity → lower sort key; keep 0.35 weight on daily noise so Home still feels fresh each day.
  return -affinity * 0.65 + noise * 0.35;
}

/** Score a candidate title for "Surprise Me / Pick for Me". */
export function scoreCandidate(item: MetaPreview, taste?: TasteProfile): number {
  const rating = Number.parseFloat(item.imdbRating ?? "");
  const ratingScore = Number.isFinite(rating) ? Math.max(0, (rating - 5.5) / 4.5) : 0.35;
  const artBonus = (item.background ? 0.15 : 0) + (item.poster ? 0.1 : 0);
  if (!taste || taste.sampleSize === 0 || !item.genres?.length) return ratingScore + artBonus;
  const genreAvg = item.genres.reduce((acc, g) => acc + (taste.genres.get(normGenre(g)) ?? 0), 0) / item.genres.length;
  return ratingScore * 0.55 + (genreAvg + taste.typeBias[item.type]) * 0.45 + artBonus;
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
): MetaPreview | undefined {
  const seen = new Set<string>();
  const fresh = candidates.filter((m) => !exclude.has(m.id) && !seen.has(m.id) && seen.add(m.id));
  const pool = fresh.length ? fresh : candidates.filter((m) => !seen.has(m.id) && seen.add(m.id));
  if (!pool.length) return undefined;
  const ranked = [...pool].sort((a, b) => scoreCandidate(b, taste) - scoreCandidate(a, taste));
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
