import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  type Anime,
  type AnimeCard,
  type LinedEpisode,
  animeEntries,
  linkAnime,
  listedKitsuQuery,
  playContext,
  progressByVideo,
  rememberStill,
  sharedAnimeEpisodes,
  upNext,
  useAnimeImdb,
  usePlayedZip,
} from "../../lib/anime";
import type { Video } from "../../lib/types";
import { usePrefs } from "../../lib/settings";
import { useLibrary, useMeta, useProgress } from "../../lib/net";
import { watchedFraction } from "../../lib/library";

const NO_VIDEOS: Video[] = [];
/** The episodes each list was last left for (the link it was left under), so the same is left once. */
const remembered = new WeakMap<object, string>();

/**
 * Everything the anime page needs to play: the episodes, matched to the
 * app's videos, and where you're up to (lib/anime/episodes.ts). Also links
 * the entry to the id it plays from, and leaves the player what it can't
 * know itself (MAL numbering, Kitsu ids, stills) and cards which entry each
 * episode is part of.
 */
export function useAnimePlayback(anime: AnimeCard | Anime) {
  const { zip, borrow } = usePlayedZip(anime);
  const isMovie = anime.format === "MOVIE";
  // A borrowed record leaves out the prequel's Kitsu id; the id lists may have the entry's own, which stream add-ons know its episodes by.
  const { data: listedKitsu } = useQuery({ ...listedKitsuQuery(anime.id), enabled: borrow });
  const kitsu = zip?.mappings.kitsu_id ?? (borrow ? (listedKitsu ?? undefined) : undefined);
  // ani.zip's IMDb show, unless its episodes stop before this entry's (then the
  // show that has them), or the same title on Cinemeta when ani.zip has no link.
  const { data: found, isPending: linking, isSuccess: imdbKnown } = useAnimeImdb(anime, zip);
  const imdb = found?.id;
  // The app's id for this show: its IMDb page, or (for the many with none) its Kitsu id, which the stream addons know.
  const metaId = imdb ?? (kitsu ? `kitsu:${kitsu}` : undefined);
  const { data: meta, isLoading: metaLoading } = useMeta(isMovie ? "movie" : "series", metaId ?? "", !!metaId);
  const { data: progress } = useProgress(metaId ?? "");
  const malId = anime.idMal ?? zip?.mappings.mal_id;
  const { animeTitles } = usePrefs();

  // The same answers give the same array wherever on the page it's asked (#397).
  const videos = meta?.videos ?? NO_VIDEOS;
  const episodes = useMemo(() => sharedAnimeEpisodes({ anime, zip, videos, imdb, titles: animeTitles }), [zip, videos, anime, animeTitles, imdb]);

  // The id this entry plays from, for the backend: library and progress kept under its other ids move onto it.
  // Only once the IMDb lookup has answered, so a failed lookup doesn't link the entry to its Kitsu id. A link
  // the anime id lists already give is only kept once the show is in the library or has progress (#102), so
  // it's asked again when that happens.
  const qc = useQueryClient();
  const { data: library } = useLibrary();
  const used = !!progress?.length || !!library?.some((l) => l.id === metaId);
  useEffect(() => {
    if (metaId && imdbKnown) void linkAnime(qc, { canonical: metaId, anilist: anime.id, mal: malId, kitsu });
  }, [qc, metaId, imdbKnown, anime.id, malId, kitsu, used]);

  // AniSkip needs MyAnimeList's numbering, and stream addons know an IMDb-matched episode by its Kitsu id
  // too; the player can't know either. Leave them (kept across restarts) for every episode.
  useEffect(() => {
    // Asked by the page's top and its list alike: once is enough for the same episodes and link.
    const said = `${metaId}|${imdbKnown}|${malId}|${kitsu}|${isMovie}`;
    if (remembered.get(episodes) === said) return;
    remembered.set(episodes, said);
    for (const e of episodes) if (e.video && e.image) rememberStill(e.video.id, e.image);
    if (!metaId || !imdbKnown) return;
    const lined = episodes.flatMap((e): [string, number][] => (e.video ? [[e.video.id, e.number]] : []));
    // Kitsu and MAL ids are this entry's, so each episode keeps its number in it; one past the entry's end is dropped.
    const count = anime.episodes ?? undefined;
    playContext.remember(metaId, { mal: malId, kitsu, anilist: anime.id, count }, episodes.flatMap((e): LinedEpisode[] => (e.video ? [[e.video.id, e.number, e.absolute]] : [])));
    // Which entry these episodes are, for cards with seasons as separate shows (#22).
    const shown = { title: anime.title, cover: anime.coverImage.extraLarge ?? anime.coverImage.large, banner: anime.bannerImage };
    if (!isMovie) animeEntries.remember(metaId, anime.id, shown, lined);
  }, [episodes, malId, kitsu, metaId, imdbKnown, isMovie, anime.id, anime.title, anime.coverImage, anime.bannerImage, anime.episodes]);

  const byVideo = useMemo(() => progressByVideo(progress ?? [], { episodes, imdb, kitsu, isMovie }), [progress, episodes, imdb, kitsu, isMovie]);
  const next = useMemo(() => upNext({ episodes, byVideo, isMovie, metaId, watched: watchedFraction() }), [episodes, byVideo, isMovie, metaId]);

  // Until ani.zip and the link are known, there's nothing to say about sources yet.
  const loading = zip === undefined || linking;
  // A link no mapping gave (picked, or found by title) is one the user may need to change (#189).
  const pickable = !loading && (!metaId || found?.by === "stored" || found?.by === "title");
  return { zip, loading, metaId, meta, metaLoading, malId, kitsu, episodes, byVideo, next, isMovie, pickable };
}
