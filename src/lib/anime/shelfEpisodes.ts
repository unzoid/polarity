import type { EpisodeFlags } from "./episodeFlags";
import type { AnimeEpisode } from "./episodes";
import { stillFor } from "./stills";
import { ownEpisodeName } from "../format";
import { downloadableEpisodes } from "../library/batchDownloads";
import type { Video } from "../types";

/** Id prefix for an episode that's scheduled but has nothing to play yet. */
export const PENDING_EPISODE = "anime-pending:";

/**
 * What an anime entry's episode list shows (components/anime/AnimeEpisodes.tsx), as episode cards'
 * videos numbered in the entry: the episodes you can play and the ones still to air, recaps left out
 * when `hideRecaps`.
 */
export function shelfEpisodes(episodes: AnimeEpisode[], flags: Map<number, EpisodeFlags> | undefined, hideRecaps: boolean): Video[] {
  return episodes
    .filter((e) => (e.video || e.upcoming) && !(hideRecaps && flags?.get(e.number)?.recap))
    .map((e) => {
      const f = flags?.get(e.number);
      return {
        id: e.video?.id ?? `${PENDING_EPISODE}${e.number}`,
        // The video's name only when it's a real one: "Episode 9" or "Episode #1.9" may be another number than this entry's (#360).
        title: e.title ?? ownEpisodeName(e.video?.title) ?? `Episode ${e.number}`,
        season: 1,
        episode: e.number,
        released: e.airDate ?? e.video?.released,
        // Another source's still when this one has none: the addon's, then one another entry's ani.zip record lined up (#192).
        thumbnail: e.image ?? e.video?.thumbnail ?? (e.video && stillFor(e.video.id)),
        overview: e.overview ?? e.video?.overview,
        tag: f?.filler ? "Filler" : f?.recap ? "Recap" : undefined,
      };
    });
}

/** A season tab's Download Season (#352): the listed episodes that have a video and are out, in order. */
export const partDownloads = (shelf: Video[]) => downloadableEpisodes(shelf.filter((v) => !v.id.startsWith(PENDING_EPISODE)));
