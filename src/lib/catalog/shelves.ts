import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { catalogBound, getViewingLimit, keepWithinLimit, useViewingLimit } from "./viewingLimit";
import { api } from "../api";
import { keys, useCatalog, useContinueWatching, useLibrary, useWatchHistory } from "../net/queries";
import type { ContentType, MetaPreview, Progress } from "../types";
import type { Route } from "../router";
import { watchedFraction } from "../library/watched";
import { tasteGenreRank, type TasteProfile } from "./taste";

/**
 * What the home screens show, shared by the desktop and TV layouts: the
 * featured picks, the trending picks, and the day's shelves — which
 * alternate card shape and mix sources (trending, new, genres, hidden gems,
 * classics, "Because you watched …") so no two neighbours look or read alike.
 * Which genres appear rotates daily.
 */
export type Shape = "poster" | "landscape";
export type Shelf =
  | { kind: "catalog"; type: ContentType; id: string; genre?: string; title: string; shape: Shape }
  | { kind: "because"; type: ContentType; seed: string; title: string; shape: Shape };

export const shelfKey = (s: Shelf) =>
  s.kind === "catalog" ? keys.catalog(s.type, s.id, s.genre) : keys.recommend(s.type, s.seed);

/** Where a shelf's heading leads (#48): Movies or Series at its catalog and genre; none for "Because you watched". */
export function shelfRoute(s: Shelf): Route | undefined {
  return s.kind === "catalog" ? { name: "discover", type: s.type, catalog: s.id, genre: s.genre } : undefined;
}

/** Genre shelves; a handful are picked each day. */
export const GENRES: { type: ContentType; genre: string; title: string }[] = [
  { type: "movie", genre: "Action", title: "Action & Adventure" },
  { type: "movie", genre: "Sci-Fi", title: "Sci-Fi Movies" },
  { type: "movie", genre: "Animation", title: "Animated Movies" },
  { type: "movie", genre: "Comedy", title: "Comedy Movies" },
  { type: "movie", genre: "Horror", title: "Horror Movies" },
  { type: "movie", genre: "Thriller", title: "Thrillers" },
  { type: "movie", genre: "Romance", title: "Romance Movies" },
  { type: "movie", genre: "Crime", title: "Crime Movies" },
  { type: "movie", genre: "Fantasy", title: "Fantasy Movies" },
  { type: "movie", genre: "Documentary", title: "Documentaries" },
  { type: "series", genre: "Comedy", title: "Comedy Series" },
  { type: "series", genre: "Crime", title: "Crime Series" },
  { type: "series", genre: "Drama", title: "Drama Series" },
  { type: "series", genre: "Sci-Fi", title: "Sci-Fi & Fantasy Series" },
  { type: "series", genre: "Animation", title: "Animated Series" },
  { type: "series", genre: "Mystery", title: "Mystery Series" },
  { type: "series", genre: "Documentary", title: "Docuseries" },
];

/** Stable pseudo-random 0..1 for (day, key): same order all day, new one tomorrow. */
function dailyNoise(day: number, key: string) {
  let h = 2166136261 ^ day;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export interface Seed {
  type: ContentType;
  id: string;
  name: string;
  /** Whether the user watched it or only saved it to their library (keeps "Because you …" honest). */
  source?: "watched" | "saved";
}

export function todaysShelves(seeds: Seed[], taste?: TasteProfile): Shelf[] {
  const day = Math.floor(Date.now() / 86_400_000);
  const genres = [...GENRES].sort(
    (a, b) =>
      tasteGenreRank(a.type, a.genre, taste, dailyNoise(day, a.type + a.genre)) -
      tasteGenreRank(b.type, b.genre, taste, dailyNoise(day, b.type + b.genre)),
  );
  const genre = (i: number, shape: Shape): Shelf => ({ kind: "catalog", id: "popular", shape, ...genres[i] });
  const catalog = (type: ContentType, id: string, title: string, shape: Shape): Shelf => ({ kind: "catalog", type, id, title, shape });
  const because = (i: number, shape: Shape): Shelf[] =>
    seeds[i]
      ? [
          {
            kind: "because",
            type: seeds[i].type,
            seed: seeds[i].id,
            title: `${seeds[i].source === "saved" ? "Because you saved" : "Because you watched"} ${seeds[i].name}`,
            shape,
          },
        ]
      : [];

  return [
    ...because(0, "landscape"),
    catalog("series", "trending", "Trending Series", "landscape"),
    catalog("movie", "new", "New Movies", "poster"),
    genre(0, "landscape"),
    catalog("series", "popular", "Popular Series", "poster"),
    ...because(1, "landscape"),
    catalog("movie", "popular", "Popular Movies", "poster"),
    genre(1, "landscape"),
    catalog("movie", "gems", "Hidden Gems", "poster"),
    genre(2, "landscape"),
    catalog("series", "new", "New Series", "poster"),
    genre(3, "landscape"),
    catalog("movie", "classics", "Classic Movies", "poster"),
    catalog("series", "top_rated", "Top Rated Series", "landscape"),
    genre(4, "poster"),
    catalog("series", "gems", "Hidden Gem Series", "landscape"),
    catalog("movie", "top_rated", "Top Rated Movies", "poster"),
    genre(5, "landscape"),
    catalog("series", "classics", "Classic Series", "poster"),
  ];
}

/** The two titles you were most recently into: watched/watching first, else saved in Library. */
export function useSeeds(): Seed[] {
  const { data: watching } = useContinueWatching();
  const { data: history } = useWatchHistory();
  const { data: library } = useLibrary();
  return useMemo(() => {
    const activity = [...(watching ?? []), ...(history ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
    const candidates: Seed[] = [
      ...activity.map((p) => ({ type: p.type, id: p.metaId, name: p.name, source: "watched" as const })),
      ...[...(library ?? [])].sort((a, b) => b.addedAt - a.addedAt).map((l) => ({ type: l.type, id: l.id, name: l.name, source: "saved" as const })),
    ];
    const seen = new Set<string>();
    return candidates.filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 2);
  }, [watching, history, library]);
}

/**
 * For each shelf, the ids already shown above it (`top`, then earlier
 * shelves), recomputed as shelves finish loading. Scoped to keys belonging to
 * `shelves` and coalesced per animation frame so concurrent query arrivals
 * don't cascade into 19+ full Home re-renders.
 */
export function useShownAbove(shelves: Shelf[], top: MetaPreview[]) {
  const qc = useQueryClient();
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const shelfKeySet = useMemo(() => new Set(shelves.map((s) => JSON.stringify(shelfKey(s)))), [shelves]);
  useEffect(() => {
    let raf = 0;
    const unsub = qc.getQueryCache().subscribe((e) => {
      if (e.type !== "updated" || e.action.type !== "success") return;
      const root = e.query.queryKey[0];
      if (root !== "catalog" && root !== "recommend") return;
      if (!shelfKeySet.has(JSON.stringify(e.query.queryKey))) return;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          bump();
        });
      }
    });
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [qc, shelfKeySet]);
  return useMemo(() => {
    void version;
    const shown = new Set(top.map((m) => m.id));
    return shelves.map((s) => {
      const above = new Set(shown);
      for (const m of qc.getQueryData<MetaPreview[]>(shelfKey(s)) ?? []) shown.add(m.id);
      return above;
    });
  }, [shelves, top, version, qc]);
}

/** Featured titles: a mix of trending series and movies that have full art. */
export function useFeatured() {
  const qc = useQueryClient();
  const viewing = useViewingLimit();
  return useQuery({
    queryKey: keys.featured,
    queryFn: async () => {
      const fetchTrending = (type: ContentType) =>
        qc.fetchQuery({
          queryKey: keys.catalog(type, "trending", undefined),
          queryFn: () => api.catalog(type, "trending", 0, undefined, catalogBound(type)),
        });
      const [series, movies] = await Promise.all([fetchTrending("series"), fetchTrending("movie")]);
      // Within the profile's viewing limit as it is now; `select` below keeps up when it changes.
      const limit = getViewingLimit();
      const pick = (list: MetaPreview[]) => keepWithinLimit(list, limit).filter((m) => m.background && m.description).slice(0, 4);
      const s = pick(series);
      const m = pick(movies);
      // Interleave so the carousel alternates TV and film.
      return s.flatMap((item, i) => (m[i] ? [item, m[i]] : [item])).slice(0, 7);
    },
    select: useCallback((list: MetaPreview[]) => keepWithinLimit(list, viewing), [viewing]),
  });
}

/**
 * Trending titles, series and movies alternating. Needs both a poster and a
 * backdrop; skips `skip` (what a hero above is already featuring).
 */
export function trendingPicks(series?: MetaPreview[], movies?: MetaPreview[], skip: MetaPreview[] = [], size = 12) {
  const skipIds = new Set(skip.map((f) => f.id));
  const usable = (list?: MetaPreview[]) => (list ?? []).filter((m) => m.poster && m.background && !skipIds.has(m.id));
  const s = usable(series);
  const m = usable(movies);
  const out: MetaPreview[] = [];
  for (let i = 0; out.length < size && (i < s.length || i < m.length); i++) {
    if (s[i]) out.push(s[i]);
    if (m[i] && out.length < size) out.push(m[i]);
  }
  return out;
}

/** Trending series and movies, loaded. */
export function useTrending() {
  const series = useCatalog("series", "trending");
  const movies = useCatalog("movie", "trending");
  return { series: series.data, movies: movies.data };
}

/** A watch-history entry as a title card. */
export const progressItem = (p: Progress): MetaPreview => ({
  id: p.metaId,
  type: p.type,
  name: p.name,
  background: p.background,
  poster: p.poster,
});

/** How far through a history entry is, 0..1 (a finished one reads as complete). */
export const progressFraction = (p: Progress) => (!p.duration ? 0 : p.position / p.duration >= watchedFraction() ? 1 : p.position / p.duration);
