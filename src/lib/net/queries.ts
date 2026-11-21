import { keepPreviousData, type QueryClient, useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { libraryToggled } from "../library/libraryEvents";
import { useCallback } from "react";
import { api } from "../api";
import { errorCode } from "../errors";
import { sync } from "../account/sync";
import { aniZipLookup } from "../anime/anizip";
import { isKitsuId } from "../anime/kitsu";
import { usePrefs } from "../settings/prefs";
import { keys } from "./queryKeys";
import { searchMinLength } from "../catalog/searchQuery";
import { queryClient } from "./queryClient";
import { catalogBound, keepWithinLimit, useViewingLimit } from "../catalog/viewingLimit";
import type { ContentType, MetaPreview, Progress, SearchResults, Settings, StreamsResult } from "../types";

export { keys };
export { queryClient };

/** `enabled` lets off-screen shelves wait until they're about to be seen. */
export const useCatalog = (type: ContentType, id: string, genre?: string, enabled = true) =>
  useQuery({
    queryKey: keys.catalog(type, id, genre),
    queryFn: () => api.catalog(type, id, 0, genre, catalogBound(type)),
    enabled,
    select: useWithinLimit((list: MetaPreview[], keep) => keep(list)),
  });

export const useRecommend = (type: ContentType, id: string, enabled = true) =>
  useQuery({
    queryKey: keys.recommend(type, id),
    queryFn: () => api.recommend(type, id),
    enabled,
    staleTime: 60 * 60_000,
    select: useWithinLimit((list: MetaPreview[], keep) => keep(list)),
  });

/** Films in a TMDB collection / franchise (`/collection/{id}`), kept within the profile's viewing limit. */
export const useCollection = (id: number | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.collection(id ?? 0),
    queryFn: () => api.collection(id!),
    enabled: enabled && id != null,
    staleTime: 6 * 60 * 60_000,
    select: useWithinLimit((list: MetaPreview[], keep) => keep(list)),
  });

/**
 * A query's `select` leaving out titles over the profile's viewing limit (lib/catalog/viewingLimit.ts); what's
 * cached stays whole, so paging and other readers are unaffected.
 */
function useWithinLimit<T>(pick: (data: T, keep: <M extends MetaPreview>(list: M[]) => M[]) => T) {
  const viewing = useViewingLimit();
  // `pick` is written inline by each caller: the limit alone decides when the selection changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((data: T) => (viewing.limit === null ? data : pick(data, (list) => keepWithinLimit(list, viewing))), [viewing]);
}

/** A person's page (TMDB): who they are and their titles (kept within the profile's viewing limit). */
export const usePerson = (id: number) =>
  useQuery({
    queryKey: keys.person(id),
    queryFn: () => api.person(id),
    staleTime: 6 * 60 * 60_000,
    retry: 1,
    select: useWithinLimit((p, keep) => ({
      ...p,
      acting: p.acting ? keep(p.acting) : p.acting,
      directing: p.directing ? keep(p.directing) : p.directing,
      writing: p.writing ? keep(p.writing) : p.writing,
    })),
  });

export const useMeta = (type: ContentType, id: string, enabled = true) => useQuery({ ...metaQuery(type, id), enabled });

/** The query behind {@link useMeta}, for asking several titles at once. */
export const metaQuery = (type: ContentType, id: string) => ({ queryKey: keys.meta(type, id), queryFn: () => api.meta(type, id), staleTime: 60 * 60_000 });

/** api's search and meta through the query cache: what a lookup fetched, useSearch and useMeta then reuse. */
export const cachedLookup = (qc: QueryClient) => ({
  search: (query: string) => qc.fetchQuery({ queryKey: keys.search(query), queryFn: () => api.search(query) }),
  meta: (type: ContentType, id: string) =>
    qc.fetchQuery({ queryKey: keys.meta(type, id), queryFn: () => api.meta(type, id), staleTime: 60 * 60_000 }),
});

export function useStreams(type: ContentType, videoId: string | undefined) {
  const select = useStreamsSelect(type, videoId);
  return useQuery({
    ...streamsQuery(type, videoId ?? ""),
    enabled: !!videoId,
    select,
  });
}

/**
 * The sources found so far while a video's add-ons are still answering (`waiting` names the rest), for a list
 * that shows them as they come; undefined before the first answers and once all have.
 */
export function usePartialStreams(type: ContentType, videoId: string | undefined) {
  const select = useStreamsSelect(type, videoId);
  return useQuery({
    queryKey: keys.streamsPartial(type, videoId ?? ""),
    // Filled by streamsQuery, never fetched.
    queryFn: () => null as StreamsResult | null,
    enabled: false,
    select: (d) => (d && select ? select(d) : d ?? undefined),
  }).data ?? undefined;
}

/** What an anime's sources go through before they're shown (Settings → Anime); undefined for other titles. */
function useStreamsSelect(type: ContentType, videoId: string | undefined) {
  const anime = useIsAnime(videoId, type);
  const { animeNo4k } = usePrefs();
  const no4k = anime && animeNo4k;
  const select = useCallback(
    (d: StreamsResult): StreamsResult => {
      // Settings → Anime: 4K anime is nearly always an AI upscale. Counted as hidden, like Settings' other source filters.
      const kept = no4k ? d.streams.filter((r) => (r.quality.resolution ?? 0) < 2160) : d.streams;
      return {
        ...d,
        hidden: (d.hidden ?? 0) + d.streams.length - kept.length,
        // Sources that say nothing about their audio have the original's: fansub
        // releases never name their Japanese audio. (Settings → Anime's preferred
        // release groups count in Best Match: lib/playback/bestMatch.ts.)
        streams: kept.map((r) => (r.quality.languages?.length ? r : { ...r, quality: { ...r.quality, languages: ["ja"] } })),
      };
    },
    [no4k],
  );
  return anime ? select : undefined;
}

/**
 * A video's sources from the add-ons. An answer with sources stays fresh for 10 minutes; one with none at all
 * never does (#375): the next play asks again, so an add-on installed since (or an add-on that was down) counts.
 */
export const streamsQuery = (type: ContentType, videoId: string) => ({
  queryKey: keys.streams(type, videoId),
  queryFn: async () => {
    const partial = keys.streamsPartial(type, videoId);
    // A message that comes in after the whole answer is already out of date.
    let done = false;
    try {
      return await api.streams(type, videoId, (so) => void (!done && queryClient.setQueryData(partial, so)));
    } finally {
      done = true;
      queryClient.removeQueries({ queryKey: partial });
    }
  },
  staleTime: ({ state }: { state: { data?: StreamsResult } }) => (state.data && state.data.streams.length + (state.data.hidden ?? 0) > 0 ? 10 * 60_000 : 0),
});

/** Whether a title's metadata suggests it could be anime (avoids hitting api.ani.zip on live-action titles). */
function mightBeAnime(meta: { genres?: string[]; details?: { originalLanguage?: string } }): boolean {
  const genres = meta.genres ?? [];
  if (genres.some((g) => /^(animation|anime)$/i.test(g))) return true;
  if (!genres.length) {
    const lang = meta.details?.originalLanguage?.toLowerCase();
    if (!lang || lang === "ja" || lang === "zh" || lang === "ko") return true;
  }
  return false;
}

/** Whether a video is anime: a Kitsu id, a stored anime link, or an animated IMDb title ani.zip knows. */
export function useIsAnime(videoId: string | undefined, type?: ContentType) {
  const imdb = videoId?.startsWith("tt") ? videoId.split(":")[0] : undefined;
  const links = queryClient.getQueryData<{ canonical?: string }[]>(keys.animeLinks);
  const linked = !!imdb && !!links?.some((l) => l.canonical === imdb);
  // Reuse the title's meta query when `type` is known so live-action titles never hit api.ani.zip.
  const { data: typedMeta } = useQuery({
    ...metaQuery(type ?? "series", imdb ?? ""),
    enabled: !!imdb && !!type && !linked,
  });
  const meta =
    typedMeta ??
    (imdb
      ? (queryClient.getQueryData<{ genres?: string[]; details?: { originalLanguage?: string } }>(keys.meta("series", imdb)) ??
        queryClient.getQueryData<{ genres?: string[]; details?: { originalLanguage?: string } }>(keys.meta("movie", imdb)))
      : undefined);
  const shouldAskAniZip = !!imdb && !linked && (type ? !!meta && mightBeAnime(meta) : !meta || mightBeAnime(meta));
  const { data: anime } = useQuery({
    ...aniZipLookup({ imdb_id: imdb ?? "" }),
    select: (zip) => !!zip,
    enabled: shouldAskAniZip,
    staleTime: 24 * 60 * 60_000,
  });
  return !!videoId && (isKitsuId(videoId) || linked || !!anime);
}

/** Scores from the ratings services, once a key is set (re-asks when one is). */
export function useRatings(type: ContentType, id: string) {
  const { data: settings } = useSettings();
  const keyed = !!(settings?.mdblistKey?.trim() || settings?.omdbKey?.trim());
  return useQuery({
    queryKey: keys.ratings(type, id, settings?.mdblistKey ?? "", settings?.omdbKey ?? ""),
    queryFn: () => api.ratings(type, id),
    enabled: keyed && id.startsWith("tt"),
    staleTime: 6 * 60 * 60_000,
  });
}

/** A show's IMDb episode ratings (the Episode Ratings chart); none until the id is known. */
export const useImdbEpisodeRatings = (imdbId: string | undefined) =>
  useQuery({
    queryKey: keys.episodeRatings(imdbId ?? ""),
    queryFn: () => api.episodeRatings(imdbId!),
    enabled: !!imdbId,
    staleTime: 12 * 60 * 60_000,
  });

export const useProgress = (metaId: string) =>
  useQuery({ queryKey: keys.progress(metaId), queryFn: () => api.progressFor(metaId), staleTime: 0 });

/** Several titles' progress at once, flattened (the Downloads page's watched marks, #15); the same cache as useProgress. */
export const useProgressOf = (metaIds: string[]) => {
  const unique = [...new Set(metaIds)];
  return useQueries({
    queries: unique.map((metaId) => ({ queryKey: keys.progress(metaId), queryFn: () => api.progressFor(metaId), staleTime: 0 })),
    combine: flatProgress,
  });
};

// Outside the hook, so the combined list keeps its identity until a result changes.
const flatProgress = (results: { data?: Progress[] }[]) => results.flatMap((r) => r.data ?? []);

export const useContinueWatching = () =>
  useQuery({ queryKey: keys.continue, queryFn: api.continueWatching, staleTime: 0 });

export const useWatchHistory = () =>
  useQuery({ queryKey: keys.history, queryFn: api.watchHistory, staleTime: 0 });

export const useLibrary = () => useQuery({ queryKey: keys.library, queryFn: api.library, staleTime: 0 });

export const useAddons = () => useQuery({ queryKey: keys.addons, queryFn: api.addons, staleTime: Infinity });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings, staleTime: Infinity });

export const useSearch = (query: string) => {
  const select = useWithinLimit((r: SearchResults, keep) => ({ ...r, movies: keep(r.movies), series: keep(r.series) }));
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => api.search(query),
    enabled: query.trim().length >= searchMinLength(query.trim()),
    placeholderData: keepPreviousData,
    select,
  });
};

export function useToggleLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: MetaPreview) => api.toggleLibrary(item),
    onSuccess: (inLibrary, item) => {
      qc.invalidateQueries({ queryKey: keys.library });
      libraryToggled(item, inLibrary);
      sync.schedule();
    },
  });
}

export function useSaveProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Progress) => api.saveProgress(p),
    onSuccess: (_, p) => {
      qc.invalidateQueries({ queryKey: keys.progress(p.metaId) });
      qc.invalidateQueries({ queryKey: keys.continue });
      qc.invalidateQueries({ queryKey: keys.history });
      sync.schedule();
    },
  });
}

// --- Prefetch on intent ---------------------------------------------------
// Hovering a poster for ~120ms (or focusing it) is a strong signal the user is
// about to open it. Fetch detail then, so the page is ready on click.

export const prefetchMeta = (type: ContentType, id: string) =>
  queryClient.prefetchQuery({
    queryKey: keys.meta(type, id),
    queryFn: () => api.meta(type, id),
    staleTime: 60 * 60_000,
  });

export const prefetchStreams = (type: ContentType, videoId: string) => queryClient.prefetchQuery(streamsQuery(type, videoId));
/** A video's sources, if they've been fetched already (prefetchStreams); never asks the add-ons. */
export const cachedStreams = (type: ContentType, videoId: string) =>
  queryClient.getQueryData<StreamsResult>(streamsQuery(type, videoId).queryKey)?.streams;

const preloaded = new Set<string>();
export function preloadImage(src?: string) {
  if (!src || preloaded.has(src)) return;
  preloaded.add(src);
  const img = new Image();
  img.decoding = "async";
  img.src = src;
}

/**
 * What `useUpdateSettings` runs, for a given cache. Optimistic: the UI reflects the change at once
 * and rolls back if it was refused. A change that only couldn't be written (`save_failed`) stays:
 * the native side keeps it until Polarity quits, and rolling back would flip new, old, new when the
 * settings are read again (re-test 3c).
 */
export function settingsMutation(qc: QueryClient) {
  return {
    mutationFn: async (patch: Partial<Settings>) => {
      const current = qc.getQueryData<Settings>(keys.settings) ?? (await api.settings());
      return api.saveSettings({ ...current, ...patch });
    },
    onMutate: async (patch: Partial<Settings>) => {
      await qc.cancelQueries({ queryKey: keys.settings });
      const previous = qc.getQueryData<Settings>(keys.settings);
      if (previous) qc.setQueryData(keys.settings, { ...previous, ...patch });
      return { previous };
    },
    onError: (e: unknown, _p: Partial<Settings>, ctx: { previous?: Settings } | undefined) => {
      if (errorCode(e) !== "save_failed" && ctx?.previous) qc.setQueryData(keys.settings, ctx.previous);
    },
    onSuccess: (saved: Settings) => qc.setQueryData(keys.settings, saved),
  };
}

/**
 * Change settings and save them right away (see `settingsMutation`). For toggles and pickers;
 * text fields that need an explicit Save use the form in Settings instead.
 */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation(settingsMutation(qc));
}
