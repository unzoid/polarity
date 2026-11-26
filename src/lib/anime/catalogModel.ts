import type { AnimeItem, MetaPreview } from "../types";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Picks an anime item's display title according to Settings → Anime → Title language. */
export function animeItemName(item: Pick<AnimeItem, "name" | "titles">, pref: "romaji" | "english" | "native"): string {
  const { english, romaji, native } = item.titles ?? {};
  if (pref === "native") return native || romaji || english || item.name;
  if (pref === "romaji") return romaji || english || native || item.name;
  return english || romaji || native || item.name;
}

/** Formats an out-of-10 score according to Settings → Anime → Score format. */
export function formatAnimeItemScore(score: number | undefined, format: "ten" | "percent"): string | undefined {
  if (score == null || !Number.isFinite(score) || score <= 0) return undefined;
  return format === "percent" ? `${Math.round(score * 10)}%` : score.toFixed(1);
}

/** Converts a show-first `AnimeItem` into a `MetaPreview` for instant paint in the unified detail dialog. */
export function animeItemToPreview(item: AnimeItem, titlePref: "romaji" | "english" | "native" = "english"): MetaPreview {
  return {
    id: item.id,
    type: item.type,
    name: animeItemName(item, titlePref),
    poster: item.poster,
    background: item.background,
    logo: item.logo,
    logos: item.logos,
    description: item.description,
    releaseInfo: item.year ? String(item.year) : undefined,
    imdbRating: item.score != null && item.score > 0 ? item.score.toFixed(1) : undefined,
    genres: item.genres,
    certification: item.certification,
  };
}

/** Today's weekday name in lowercase ("monday".."sunday"), matching Jikan's `/schedules?filter=`. */
export function todayWeekday(date = new Date()): string {
  return WEEKDAYS[date.getDay()];
}

/** Drops Movies/Series results whose canonical `tt…` id already appears in the Anime results. */
export function withoutAnimeItems(results: MetaPreview[] | undefined, anime: readonly AnimeItem[] | undefined): MetaPreview[] | undefined {
  if (!results || !anime?.length) return results;
  const ids = new Set(anime.map((a) => a.id));
  return results.filter((m) => !ids.has(m.id));
}
