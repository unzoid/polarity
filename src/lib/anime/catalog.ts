import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { keys } from "../net/queryKeys";
import { usePrefs } from "../settings/prefs";
import type { AnimeBrowseQuery, AnimeItem, AnimeShowInfo } from "../types";
import { ANIME_GENRES, ANIME_TAGS } from "./anilist";
import { animeItemName, animeItemToPreview, formatAnimeItemScore, todayWeekday, withoutAnimeItems } from "./catalogModel";

export { animeItemName, animeItemToPreview, formatAnimeItemScore, todayWeekday, withoutAnimeItems };

/** Reactive title picker for show-first `AnimeItem`s. */
export function useAnimeItemTitle() {
  const { animeTitles } = usePrefs();
  return (item: Pick<AnimeItem, "name" | "titles">) => animeItemName(item, animeTitles);
}

/** All primary shelves for the Anime tab, fetched in parallel in Rust (zero per-card requests). */
export function useAnimeHomeCatalog() {
  return useQuery({
    queryKey: keys.anime.catalogHome,
    staleTime: 30 * 60_000,
    queryFn: () => api.animeHome(),
  });
}

/** One anime genre shelf, fetched lazily when it approaches the viewport. */
export function useAnimeGenreShelf(genre: string, enabled = true) {
  return useQuery({
    queryKey: keys.anime.catalogShelf("genre", genre, 1),
    staleTime: 60 * 60_000,
    enabled: enabled && !!genre,
    queryFn: async () => (await api.animeShelf("genre", genre, 1)).items,
  });
}

/** Airing schedule for one weekday ("monday".."sunday") or all days when omitted. */
export function useAnimeSchedule(day?: string, enabled = true) {
  return useQuery({
    queryKey: keys.anime.catalogSchedule(day ?? "all"),
    staleTime: 30 * 60_000,
    enabled,
    queryFn: () => api.animeSchedule(day),
  });
}

/** Today's airing anime schedule. */
export function useAnimeToday(enabled = true) {
  const day = todayWeekday();
  return useAnimeSchedule(day, enabled);
}

/** Infinite-scroll filterable/searchable anime browse grid powered by Rust/Jikan. */
export function useAnimeBrowseCatalog(filters: Omit<AnimeBrowseQuery, "page">, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.anime.catalogBrowse(filters),
    staleTime: 15 * 60_000,
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.animeBrowse({ ...filters, page: pageParam }),
    getNextPageParam: (last, pages) => (last.hasNextPage ? pages.length + 1 : undefined),
  });
}

const NOT_ANIME: AnimeShowInfo = { isAnime: false };

/** Fast 0ms local lookup of anime identity & per-season MAL/AniList/Kitsu mappings for any title id. */
export function useAnimeShowInfo(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.anime.showInfo(id ?? ""),
    staleTime: Infinity,
    enabled: enabled && !!id && (id.startsWith("tt") || id.startsWith("kitsu:") || id.startsWith("mal:") || id.startsWith("anilist:")),
    queryFn: () => api.animeShowInfo(id!).catch(() => NOT_ANIME),
  });
}

/** Lazy-loaded characters & voice actors for an anime (fetched only when the Details/Characters tab opens). */
export function useAnimeCharacters(malId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.anime.characters(malId ?? 0),
    staleTime: 24 * 60 * 60_000,
    enabled: enabled && !!malId && malId > 0,
    queryFn: () => api.animeCharacters(malId!),
  });
}

/** Lazy-loaded rich anime details (rankings, studios, facts, tags, links & characters) in one disk-cached Rust call. */
export function useAnimeDetails(anilistId: number | undefined, malId: number | undefined, enabled = true) {
  const al = anilistId && anilistId > 0 ? anilistId : 0;
  const mal = malId && malId > 0 ? malId : 0;
  return useQuery({
    queryKey: keys.anime.details(al, mal),
    staleTime: 24 * 60 * 60_000,
    enabled: enabled && (al > 0 || mal > 0),
    queryFn: () => api.animeDetails(al || undefined, mal || undefined),
  });
}

/**
 * Show-first anime search backed by Rust/Jikan (zero AniList calls).
 * If the query names an anime genre or tag (e.g. "Isekai", "Action"), returns popular anime in that category.
 */
export function useAnimeSearchCatalog(query: string) {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const genre = ANIME_GENRES.find((g) => g.toLowerCase() === lower);
  const tag = genre ? undefined : ANIME_TAGS.find((t) => t.toLowerCase() === lower);
  const filters: Omit<AnimeBrowseQuery, "page"> = genre
    ? { genre, sort: "POPULARITY_DESC" }
    : tag
      ? { tag, sort: "POPULARITY_DESC" }
      : { search: trimmed, sort: "POPULARITY_DESC" };
  const q = useAnimeBrowseCatalog(filters, trimmed.length > 0);
  const items = q.data?.pages[0]?.items;
  return {
    title: genre || tag ? `Popular ${genre ?? tag} Anime` : "Anime",
    genre: genre ?? tag,
    browse: genre ? { genre } : tag ? { tag } : undefined,
    items,
    loading: !!trimmed && q.isLoading,
    failed: !!trimmed && q.isError,
    retry: () => void q.refetch(),
  };
}
