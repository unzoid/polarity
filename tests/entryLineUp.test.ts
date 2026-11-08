import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { AnimeCard } from "../src/lib/anime/anilist";
import { keys } from "../src/lib/net/queryKeys";
import { longAnimeMedia, longAnimeMeta, longAnimeZip, SHORT_ANIME } from "../src/lib/platform/fake/longAnime";

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { lineUpEntry } = await import("../src/lib/anime/entryLineUp");
const { playContext } = await import("../src/lib/anime/playContext");

// TV mode opens an anime's title page without the anime page, so what that page leaves for the sources (MyAnimeList's and
// Kitsu's numbering for each episode, #422) is left as TV opens it (#431), but only for a title that was looked up.
const card = longAnimeMedia(SHORT_ANIME) as unknown as AnimeCard;
const zip = { ...longAnimeZip(SHORT_ANIME), mappings: { anilist_id: SHORT_ANIME.anilist, imdb_id: SHORT_ANIME.imdb, mal_id: 7001, kitsu_id: 8001, type: "TV" } };
const client = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.meta("series", SHORT_ANIME.imdb), longAnimeMeta(SHORT_ANIME.imdb));
  return qc;
};
const third = longAnimeMeta(SHORT_ANIME.imdb)!.videos![2].id;

test("a guessed title leaves nothing for the sources", async () => {
  await lineUpEntry(client(), card, zip as never, SHORT_ANIME.imdb, "english", { sure: false, entry: false });
  expect(playContext.episode(third)).toBeUndefined();
});

test("a looked-up title leaves each episode's number in the entry with its MyAnimeList and Kitsu ids, seasons grouped too", async () => {
  await lineUpEntry(client(), card, zip as never, SHORT_ANIME.imdb, "english", { sure: true, entry: false });
  expect(playContext.episode(third)).toEqual({ mal: 7001, kitsu: 8001, episode: 3 });
});
