import { expect, test } from "bun:test";
import { matchVideo, type AniZip, type AniZipEpisode } from "../src/lib/anime/anizip";
import type { AnimeCard } from "../src/lib/anime/anilist";
import { animeEpisodes } from "../src/lib/anime/episodes";
import { LONG_ANIME, longAnimeVideos, longAnimeZip } from "../src/lib/platform/fake/longAnime";
import type { Video } from "../src/lib/types";

// A show with a thousand episodes or more (#397): matching its episodes to the IMDb show's videos walked every
// video for every episode and read every date again, a second or more before the page could draw.

const DAY = 86_400_000;
const time = (iso?: string) => {
  if (!iso) return NaN;
  const day = iso.length === 10 || /T00:00(?::00(?:\.0+)?)?Z$/.test(iso);
  return new Date(day ? `${iso.slice(0, 10)}T12:00:00Z` : iso).getTime();
};

/** matchVideo as it was before #397, one walk through the videos per episode: what the indexed one must answer. */
function walked(ep: AniZipEpisode, videos: Video[]): Video | undefined {
  const regular = videos.filter((v) => v.season > 0);
  const aired = time(ep.airDateUtc ?? ep.airDate ?? ep.airdate);
  if (Number.isFinite(aired)) {
    const near = regular.filter((v) => Math.abs(time(v.released) - aired) <= 1.5 * DAY);
    if (near.length === 1) return near[0];
    if (near.length > 1) {
      const byNumber = near.find((v) => v.season === ep.seasonNumber && v.episode === ep.episodeNumber);
      if (byNumber) return byNumber;
      const sameDay = near.filter((v) => Math.abs(time(v.released) - aired) < DAY);
      return (sameDay.length ? sameDay : near).sort((a, b) => a.season - b.season || a.episode - b.episode)[0];
    }
  }
  if (ep.seasonNumber && ep.episodeNumber) {
    const exact = regular.find((v) => v.season === ep.seasonNumber && v.episode === ep.episodeNumber);
    if (exact) return exact;
  }
  if (ep.absoluteEpisodeNumber) return [...regular].sort((a, b) => a.season - b.season || a.episode - b.episode)[ep.absoluteEpisodeNumber - 1];
  return undefined;
}

test("the indexed match answers what walking every video did, double-episode days, specials and undated ones included", () => {
  let seed = 397;
  const rand = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) % n);
  const base = Date.UTC(2010, 0, 1);
  const dateOf = (d: number, form: number) =>
    form === 0 ? new Date(base + d * DAY).toISOString().slice(0, 10) : form === 1 ? new Date(base + d * DAY).toISOString() : new Date(base + d * DAY + 15 * 3_600_000).toISOString();
  for (let round = 0; round < 40; round++) {
    const videos: Video[] = Array.from({ length: 30 + rand(60) }, (_, i) => {
      const season = rand(8) === 0 ? 0 : 1 + rand(3);
      const episode = 1 + rand(20);
      // Days close together, some the same, some missing.
      const released = rand(10) === 0 ? undefined : dateOf(rand(90), rand(3));
      return { id: `tt0000001:${season}:${episode}:${i}`, title: "", season, episode, released };
    });
    for (let k = 0; k < 60; k++) {
      const ep: AniZipEpisode = {
        episode: String(1 + rand(80)),
        seasonNumber: rand(4) ? 1 + rand(3) : undefined,
        episodeNumber: rand(4) ? 1 + rand(20) : undefined,
        absoluteEpisodeNumber: rand(3) ? 1 + rand(90) : undefined,
        airDateUtc: rand(5) ? dateOf(rand(95), 1 + rand(2)) : undefined,
        airDate: rand(2) ? dateOf(rand(95), 0) : undefined,
      };
      expect(matchVideo(ep, videos)?.id).toBe(walked(ep, videos)?.id);
    }
  }
});

test("the 1,200 episodes are lined up with their videos in a few dozen milliseconds", () => {
  const anime = { id: LONG_ANIME.anilist, format: "TV", episodes: LONG_ANIME.episodes } as AnimeCard;
  const zip = longAnimeZip() as unknown as AniZip;
  const videos = longAnimeVideos();
  for (const imdb of [LONG_ANIME.imdb, "tt0000002"]) {
    const start = performance.now();
    const eps = animeEpisodes({ anime, zip, videos, imdb, titles: "english" });
    const ms = performance.now() - start;
    expect(eps.map((e) => e.video?.id)).toEqual(videos.map((v) => v.id));
    // It took 2.3 s (matched by ani.zip's numbers) and 2.7 s (lined up by date) here before #397; 15-40 ms after.
    expect(ms).toBeLessThan(400);
  }
});
