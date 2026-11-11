import { expect, test } from "bun:test";
import type { AnimeCard } from "../src/lib/anime/anilist";
import type { AniZip } from "../src/lib/anime/anizip";
import { animeEpisodes } from "../src/lib/anime/episodes";
import type { EpisodeFlags } from "../src/lib/anime/episodeFlags";
import { shelfEpisodes } from "../src/lib/anime/shelfEpisodes";
import type { Video } from "../src/lib/types";

/**
 * An invented long show (#427): 150 episodes a week apart, except 100 and 101, a double episode aired on one day.
 * Episodes 96 to 105 are filler.
 */
const NOW = Date.parse("2030-01-01T00:00:00Z");
const DAY = 86_400_000;
const START = Date.UTC(2005, 0, 5, 10);
const aired = (n: number) => START + (Math.min(n, 101) - 1 - (n >= 101 ? 1 : 0)) * 7 * DAY + Math.max(0, n - 101) * 7 * DAY;
const iso = (n: number) => new Date(aired(n)).toISOString();
const show = { id: 990_101, format: "TV", episodes: 150, status: "FINISHED" } as unknown as AnimeCard;
const zip = (skip: number[] = []): AniZip => ({
  mappings: { imdb_id: "tt0000101", kitsu_id: 4242 },
  episodes: Object.fromEntries(
    Array.from({ length: 150 }, (_, i) => i + 1)
      .filter((n) => !skip.includes(n))
      .map((n) => [String(n), { episode: String(n), seasonNumber: 1, episodeNumber: n, absoluteEpisodeNumber: n, airDateUtc: iso(n), title: { en: `Part ${n}` } }]),
  ),
});
/** The catalog's video for episode `n`, listed as its own episode `as` (Cinemeta's day, at midnight UTC). */
const video = (n: number, as = n): Video => ({ id: `tt0000101:1:${as}`, title: `Episode ${as}`, season: 1, episode: as, released: `${iso(n).slice(0, 10)}T00:00:00.000Z` });
const flags = new Map<number, EpisodeFlags>(Array.from({ length: 10 }, (_, i) => [96 + i, { filler: true, recap: false } as EpisodeFlags]));

const listed = (videos: Video[], z = zip()) => shelfEpisodes(animeEpisodes({ anime: show, zip: z, videos, imdb: "tt0000101", titles: "english", now: NOW }), flags, false);

function expectWhole(shelf: Video[]) {
  expect(shelf.map((v) => v.episode)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
  // Each card its own video: two cards with one id are one card to the list (and play the same file).
  expect(new Set(shelf.map((v) => v.id)).size).toBe(150);
}

test("the double episode, listed by the catalog as one video, still lists both episodes", () => {
  // The catalog has 149 videos: 100 and 101 are its episode 100, and every one after is numbered one lower.
  const videos = Array.from({ length: 149 }, (_, i) => i + 1).map((as) => video(as <= 100 ? as : as + 1, as));
  const shelf = listed(videos);
  expectWhole(shelf);
  const by = new Map(shelf.map((v) => [v.episode, v]));
  expect(by.get(100)!.id).toBe("tt0000101:1:100");
  expect(by.get(102)!.id).toBe("tt0000101:1:101");
  // 101 has no video of its own: it's asked for by the entry's Kitsu id, as anime add-ons list it.
  expect(by.get(101)!.id).toBe("kitsu:4242:101");
  expect(by.get(101)!.title).toBe("Part 101");
});

test("episodes the catalog skips are listed, named from ani.zip, and can be asked for", () => {
  const videos = Array.from({ length: 150 }, (_, i) => i + 1)
    .filter((n) => n !== 100 && n !== 101)
    .map((n) => video(n));
  const shelf = listed(videos);
  expectWhole(shelf);
  const by = new Map(shelf.map((v) => [v.episode, v]));
  expect([by.get(99)!.id, by.get(100)!.id, by.get(101)!.id, by.get(102)!.id]).toEqual(["tt0000101:1:99", "kitsu:4242:100", "kitsu:4242:101", "tt0000101:1:102"]);
  expect([by.get(99)!.tag, by.get(100)!.tag, by.get(101)!.tag, by.get(102)!.tag]).toEqual(["Filler", "Filler", "Filler", "Filler"]);
});

test("a number ani.zip skips is listed between its neighbours", () => {
  const videos = Array.from({ length: 150 }, (_, i) => video(i + 1));
  const shelf = listed(videos, zip([100, 101]));
  expectWhole(shelf);
});

test("without a Kitsu id an episode with nothing to play is still listed", () => {
  const videos = Array.from({ length: 150 }, (_, i) => i + 1)
    .filter((n) => n !== 100 && n !== 101)
    .map((n) => video(n));
  const z = zip();
  delete z.mappings.kitsu_id;
  const shelf = listed(videos, z);
  expect(shelf.map((v) => v.episode)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
  expect(new Set(shelf.map((v) => v.id)).size).toBe(150);
});
