import type { QueryClient } from "@tanstack/react-query";
import { cachedLookup } from "../net/queries";
import type { AnimeCard } from "./anilist";
import type { AniZip } from "./anizip";
import { animeEntries } from "./entries";
import { animeEpisodes } from "./episodes";
import { playContext, type LinedEpisode } from "./playContext";

/**
 * Line an entry's episodes up with its title's videos, as the anime page does, for TV mode, which opens the title's own
 * page. `sure` (the title was looked up, not guessed): leave what the sources need, as the page's useAnimePlayback does
 * (lib/anime/playContext.ts: MyAnimeList's and Kitsu's numbering, absolute numbers and a later season's own titles,
 * #422, #431). `entry` (seasons as separate shows, #22): remember which episodes the entry is (lib/anime/entries.ts).
 * Never throws; an entry that can't be lined up stays unknown.
 */
export async function lineUpEntry(
  qc: QueryClient,
  anime: AnimeCard,
  zip: AniZip | null | undefined,
  metaId: string,
  titles: "romaji" | "english" | "native",
  { sure = false, entry = true }: { sure?: boolean; entry?: boolean } = {},
) {
  if (anime.format === "MOVIE") return;
  const meta = await cachedLookup(qc)
    .meta("series", metaId)
    .catch(() => null);
  if (!meta?.videos?.length) return;
  const imdb = metaId.startsWith("tt") ? metaId : undefined;
  const episodes = animeEpisodes({ anime, zip, videos: meta.videos, imdb, titles });
  if (sure) {
    // The show's own name would match the earlier seasons' files too.
    const word = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const show = meta.name ? word(meta.name) : undefined;
    const names = [...new Set([anime.title.english, anime.title.romaji].filter((t): t is string => !!t))].filter((t) => word(t) !== show);
    const ids = { mal: zip?.mappings.mal_id ?? anime.idMal ?? undefined, kitsu: zip?.mappings.kitsu_id, anilist: anime.id, count: anime.episodes ?? undefined, names };
    playContext.remember(metaId, ids, episodes.flatMap((e): LinedEpisode[] => (e.video ? [[e.video.id, e.number, e.absolute]] : [])));
  }
  if (!entry) return;
  const lined = episodes.flatMap((e): [string, number][] => (e.video ? [[e.video.id, e.number]] : []));
  const shown = { title: anime.title, cover: anime.coverImage.extraLarge ?? anime.coverImage.large, banner: anime.bannerImage };
  animeEntries.remember(metaId, anime.id, shown, lined);
}
