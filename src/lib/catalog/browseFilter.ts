import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";
import { useHiddenIds } from "../library/hiddenTitles";
import { isWatched, showEntries } from "../library/watched";
import { keys, metaQuery, useCatalog } from "../net/queries";
import { usePrefs } from "../settings/prefs";
import { catalogBound, keepWithinLimit, useViewingLimit } from "./viewingLimit";
import type { ContentType, Meta, MetaPreview, Progress } from "../types";

/**
 * What browsing leaves out (Home's shelves and featured titles, Movies and Series, recommendations):
 * titles hidden with "Hide This Title", and with Settings → Browsing → "Hide watched titles" on,
 * titles the profile has watched. Continue Watching, the Library and Search never go through it.
 *
 * Watched, as the card menu's "Mark as Watched" reads it (lib/library/watched.ts): a film whose
 * own progress is past the watched mark; a show whose every released episode is. A show is only
 * checked once its latest played episode is finished (watch history), and only the most recent
 * SERIES_CHECKED of those, each with its episode list and progress (both cached).
 */
export interface BrowseRules {
  hidden: ReadonlySet<string>;
  watched: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();
export const NO_RULES: BrowseRules = { hidden: NONE, watched: NONE };

/** Whether the rules take anything out at all. */
export const rulesActive = (r: BrowseRules) => r.hidden.size > 0 || r.watched.size > 0;

/**
 * The one decision of what a shelf, grid or featured list shows: `items` less the hidden and the
 * watched. Other filters (an age rating, …) compose by running on its result. Keeps `items` itself
 * (same identity) when nothing goes, and undefined while loading.
 */
export function browseVisible<T extends { id: string }>(items: T[] | undefined, rules: BrowseRules): T[] | undefined {
  if (!items || !rulesActive(rules)) return items;
  const out = items.filter((m) => !rules.hidden.has(m.id) && !rules.watched.has(m.id));
  return out.length === items.length ? items : out;
}

/** Shows checked for being watched to the end, at most: each needs its episode list. */
export const SERIES_CHECKED = 40;

/**
 * From watch history (the latest video per title): the films watched, and the shows worth
 * checking (their latest played episode finished), most recent first.
 */
export function watchedCandidates(history: readonly Progress[]): { movies: Set<string>; series: { id: string; type: ContentType }[] } {
  const movies = new Set<string>();
  const series: { id: string; type: ContentType }[] = [];
  for (const p of history) {
    if (!isWatched(p.position, p.duration)) continue;
    if (p.type === "movie") movies.add(p.metaId);
    else if (series.length < SERIES_CHECKED) series.push({ id: p.metaId, type: p.type });
  }
  return { movies, series };
}

/** Every released episode of the show watched (the card menu's "Mark Show as Unwatched" state). */
export function showFinished(meta: Meta, progress: Progress[] | undefined): boolean {
  const entries = showEntries(meta, progress);
  return entries.length > 0 && entries.every((p) => isWatched(p.position, p.duration));
}

const HISTORY_STALE = 60_000;
const NO_HISTORY: Progress[] = [];

// Outside the hooks, so the combined lists keep their identity until a result changes.
const metasOf = (results: { data?: Meta }[]) => results.map((r) => r.data);
const progressOf = (results: { data?: Progress[] }[]) => results.map((r) => r.data);

/** The ids of the titles the profile has watched; empty while "Hide watched titles" is off. */
export function useWatchedIds(enabled: boolean): ReadonlySet<string> {
  const { data: history = NO_HISTORY } = useQuery({ queryKey: keys.history, queryFn: api.watchHistory, staleTime: HISTORY_STALE, enabled });
  const { movies, series } = useMemo(() => watchedCandidates(enabled ? history : NO_HISTORY), [enabled, history]);
  const metas = useQueries({ queries: series.map((s) => metaQuery(s.type, s.id)), combine: metasOf });
  const progress = useQueries({
    queries: series.map((s) => ({ queryKey: keys.progress(s.id), queryFn: () => api.progressFor(s.id), staleTime: HISTORY_STALE })),
    combine: progressOf,
  });
  return useMemo(() => {
    if (!enabled) return NONE;
    const out = new Set(movies);
    series.forEach((s, i) => {
      const meta = metas[i];
      if (meta && progress[i] && showFinished(meta, progress[i])) out.add(s.id);
    });
    return out;
  }, [enabled, movies, series, metas, progress]);
}

/** The profile's rules for what browsing shows. */
export function useBrowseRules(): BrowseRules {
  const { hideWatched } = usePrefs();
  const hidden = useHiddenIds();
  const watched = useWatchedIds(hideWatched);
  return useMemo(() => (hidden.size || watched.size ? { hidden, watched } : NO_RULES), [hidden, watched]);
}

/** `items` as browsing shows them (browseVisible with the profile's rules). */
export function useBrowseVisible<T extends MetaPreview>(items: T[] | undefined): T[] | undefined {
  const rules = useBrowseRules();
  return useMemo(() => browseVisible(items, rules), [items, rules]);
}

/** Below this many titles left, a catalog shelf fetches its next page. */
export const TOP_UP_BELOW = 12;

/**
 * A Home or TV catalog shelf's titles as browsing shows them. When hiding leaves it short, it
 * fetches the catalog's next page once, so the shelf fills instead of looking broken.
 */
export function useBrowseShelf(
  items: MetaPreview[] | undefined,
  more?: { type: ContentType; id: string; genre?: string },
): MetaPreview[] | undefined {
  const rules = useBrowseRules();
  const viewing = useViewingLimit();
  const visible = useMemo(() => browseVisible(items, rules), [items, rules]);
  const skip = items?.length ?? 0;
  const short = !!more && skip > 0 && rulesActive(rules) && (visible?.length ?? 0) < TOP_UP_BELOW;
  const { data: next } = useQuery({
    queryKey: [...keys.catalog(more?.type ?? "movie", more?.id ?? "", more?.genre), "more", skip],
    queryFn: () => api.catalog(more!.type, more!.id, skip, more!.genre, catalogBound(more!.type)),
    enabled: short,
  });
  return useMemo(() => {
    if (!short || !next?.length || !visible) return visible;
    const seen = new Set(items!.map((m) => m.id));
    const bounded = keepWithinLimit(next.filter((m) => !seen.has(m.id)), viewing);
    return [...visible, ...(browseVisible(bounded, rules) ?? [])];
  }, [short, next, visible, items, rules, viewing]);
}

/** Fewer featured titles than this left, and trending fills the carousel up. */
const FEATURED_MIN = 3;
const FEATURED_MAX = 7;

/**
 * Home's featured titles as browsing shows them: the hidden and watched taken out, then topped
 * up from trending (with the same full art) when that leaves the carousel short. Undefined while
 * loading; empty when nothing is left, and then the carousel stays out.
 */
export function useBrowseFeatured(featured: MetaPreview[] | undefined): MetaPreview[] | undefined {
  const rules = useBrowseRules();
  const active = rulesActive(rules);
  const visible = useMemo(() => browseVisible(featured, rules), [featured, rules]);
  const short = active && !!visible && visible.length < FEATURED_MIN;
  const series = useCatalog("series", "trending", undefined, short);
  const movies = useCatalog("movie", "trending", undefined, short);
  return useMemo(() => {
    if (!short || !visible) return visible;
    const have = new Set(visible.map((m) => m.id));
    const fit = (list?: MetaPreview[]) => (browseVisible(list, rules) ?? []).filter((m) => m.background && m.description && !have.has(m.id));
    const s = fit(series.data);
    const m = fit(movies.data);
    const extra = s.flatMap((item, i) => (m[i] ? [item, m[i]] : [item]));
    return [...visible, ...extra].slice(0, FEATURED_MAX);
  }, [short, visible, series.data, movies.data, rules]);
}
