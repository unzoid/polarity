import { describe, expect, test } from "bun:test";
import type { AnimeEpisode } from "../src/lib/anime/episodes";
import { partDownloads, PENDING_EPISODE, shelfEpisodes } from "../src/lib/anime/shelfEpisodes";
import { batchKey, downloadableEpisodes } from "../src/lib/library/batchDownloads";
import type { Video } from "../src/lib/types";

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString();
// An entry that plays from the show's second season: its episode 1 is the show's S2 E1.
const video = (n: number, released?: string): Video => ({ id: `tt0000000:2:${n}`, title: `Episode ${n}`, season: 2, episode: n, released });
const episode = (n: number, over: Partial<AnimeEpisode> = {}): AnimeEpisode => ({
  number: n,
  video: video(n, day(-30 + n)),
  upcoming: false,
  airDate: day(-30 + n),
  ...over,
});

describe("an anime season tab's Download Season (#352)", () => {
  test("takes the listed episodes that have a video and are out, in the entry's order, numbered in the entry", () => {
    const episodes = [
      episode(2),
      episode(1),
      // Out, but no video to download yet: listed all the same (#427), not downloaded.
      episode(3, { video: undefined }),
      // Listed, coming next week.
      episode(4, { video: undefined, upcoming: true, airDate: day(7) }),
      // Listed with a video the add-ons list early, still to air.
      episode(5, { airDate: day(3), video: video(5, day(3)) }),
      // Scheduled with no date yet.
      episode(6, { video: undefined, upcoming: true, airDate: undefined }),
    ];
    const shelf = shelfEpisodes(episodes, undefined, false);
    expect(shelf.map((v) => v.id)).toEqual(["tt0000000:2:2", "tt0000000:2:1", `${PENDING_EPISODE}3`, `${PENDING_EPISODE}4`, "tt0000000:2:5", `${PENDING_EPISODE}6`]);
    const picked = partDownloads(shelf);
    expect(picked.map((v) => v.id)).toEqual(["tt0000000:2:1", "tt0000000:2:2"]);
    // The same video a single episode's Download gets: the entry's number, the episode's own name.
    expect(picked[0]).toMatchObject({ season: 1, episode: 1, title: "Episode 1" });
  });

  test("leaves out recaps the list hides, keeps filler", () => {
    const flags = new Map([
      [1, { filler: true, recap: false }],
      [2, { filler: false, recap: true }],
    ]);
    const shown = (hide: boolean) => partDownloads(shelfEpisodes([episode(1), episode(2), episode(3)], flags, hide)).map((v) => v.episode);
    expect(shown(true)).toEqual([1, 3]);
    expect(shown(false)).toEqual([1, 2, 3]);
  });

  test("is a batch of its own beside another tab's that plays from the same show and season", () => {
    expect(batchKey("tt0000000", "anilist-101")).not.toBe(batchKey("tt0000000", "anilist-102"));
    expect(batchKey("tt0000000", "anilist-101")).not.toBe(batchKey("tt0000000", 1));
  });
});

describe("a show's Download Season (#24)", () => {
  test("takes released episodes, specials aside, in order", () => {
    const vs: Video[] = [
      { id: "b", title: "", season: 1, episode: 2, released: day(-1) },
      { id: "s", title: "", season: 0, episode: 1, released: day(-9) },
      { id: "a", title: "", season: 1, episode: 1, released: day(-8) },
      { id: "c", title: "", season: 1, episode: 3, released: day(5) },
    ];
    expect(downloadableEpisodes(vs).map((v) => v.id)).toEqual(["a", "b"]);
  });
});
