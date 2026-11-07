import { expect, test } from "bun:test";
import type { AnimeCard, MediaFormat, MediaStatus } from "../src/lib/anime/anilist";
import { continuePart, franchiseSummary } from "../src/lib/anime/franchiseSummary";
import { upNext } from "../src/lib/anime/episodes";
import type { Progress } from "../src/lib/types";

// An invented franchise with made-up AniList ids and tt0000000-style links.
const part = (id: number, format: MediaFormat, year: number, status: MediaStatus, episodes: number | null, label: string, next?: number) => ({
  card: {
    id,
    title: { english: `Copper Lantern ${label}` },
    coverImage: {},
    format,
    status,
    episodes,
    startDate: { year, month: 4, day: 1 },
    nextAiringEpisode: next ? { episode: next, airingAt: 1_900_000_000, timeUntilAiring: 1 } : null,
  } as AnimeCard,
  label,
});

const s1 = part(1, "TV", 2017, "FINISHED", 24, "Season 1");
const film = part(2, "MOVIE", 2019, "FINISHED", 1, "Movie");
const s2 = part(3, "TV", 2021, "FINISHED", 12, "Season 2");

test("a finished franchise: its years, parts and episodes, Finished, no countdown (#327)", () => {
  expect(franchiseSummary([s1, film, s2])).toEqual({ years: "2017 to 2021", parts: "2 seasons, 1 film, 36 episodes", status: "Finished", airing: undefined });
});

test("a franchise with a part airing: that part releasing, its next episode named, aired episodes counted", () => {
  const airing = part(4, "TV", 2024, "RELEASING", null, "Season 3", 7);
  const summary = franchiseSummary([s1, film, s2, airing]);
  expect(summary).toEqual({
    years: "2017 to now",
    parts: "3 seasons, 1 film, 42 episodes",
    status: "Season 3 releasing",
    airing: { label: "Season 3", episode: 7, airingAt: 1_900_000_000 },
  });
});

test("a franchise with a part announced: that part coming, its first episode when it's scheduled", () => {
  const announced = part(5, "TV", 2026, "NOT_YET_RELEASED", null, "Season 3");
  expect(franchiseSummary([s1, s2, announced])).toMatchObject({ years: "2017 to now", parts: "3 seasons, 36 episodes", status: "Season 3 coming", airing: undefined });
  const dated = part(5, "TV", 2026, "NOT_YET_RELEASED", null, "Season 3", 1);
  expect(franchiseSummary([s1, s2, dated]).airing).toEqual({ label: "Season 3", episode: 1, airingAt: 1_900_000_000 });
  // An airing part goes before an announced one.
  const airing = part(4, "TV", 2025, "RELEASING", 12, "Season 3", 9);
  expect(franchiseSummary([s1, s2, airing, part(6, "TV", 2027, "NOT_YET_RELEASED", null, "Season 4")]).status).toBe("Season 3 releasing");
});

const progress = (videoId: string, updatedAt: number): Progress =>
  ({ metaId: videoId.split(":")[0], videoId, type: "series", name: "Copper Lantern", position: 600, duration: 1400, updatedAt }) as Progress;

test("Play carries on with the part touched last, whichever tab is picked", () => {
  const parts = [s1, film, s2];
  const entryOf = (v: string) => (v.startsWith("tt0000001:1:") ? 1 : v.startsWith("tt0000001:2:") ? 3 : undefined);
  const linked = (id: number) => (id === 2 ? "tt0000002" : "tt0000001");
  expect(continuePart(parts, [progress("tt0000001:1:5", 10), progress("tt0000001:2:3", 20)], entryOf, linked)).toBe(s2.card);
  expect(continuePart(parts, [progress("tt0000002", 30), progress("tt0000001:2:3", 20)], entryOf, linked)).toBe(film.card);
  // Nothing played (or nothing of these parts): the page starts the first part.
  expect(continuePart(parts, [], entryOf, linked)).toBeUndefined();
  expect(continuePart(parts, [progress("tt0000009:1:1", 40)], entryOf, linked)).toBeUndefined();
});

test("a part watched to the end says so, so Play goes on to the next part", () => {
  const ep = (n: number) => ({ number: n, video: { id: `tt0000001:1:${n}` } }) as Parameters<typeof upNext>[0]["episodes"][number];
  const episodes = [ep(1), ep(2)];
  const done = new Map([[`tt0000001:1:2`, { ...progress("tt0000001:1:2", 5), position: 1400 }]]);
  expect(upNext({ episodes, byVideo: done, isMovie: false, watched: 0.9 })).toMatchObject({ kind: "start", finished: true });
  const half = new Map([[`tt0000001:1:1`, progress("tt0000001:1:1", 5)]]);
  expect(upNext({ episodes, byVideo: half, isMovie: false, watched: 0.9 }).finished).toBeUndefined();
});
