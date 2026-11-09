import { afterAll, afterEach, beforeAll, expect, spyOn, test, type Mock } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { animeQuery, fetchAnime, seasonsQuery, useAiringSchedule, type Anime } from "../../src/lib/anime/anilist";
import { readLinked } from "../../src/lib/anime/responses";
import { anilistLimiter } from "../../src/lib/net/limiter";
import { render } from "./render";

// #430: AniList's answers are kept on the device, each kind for its own age. An invented franchise of four
// seasons in a row (940001 to 940004), and an invented airing schedule.
const HOUR = 60 * 60_000;
const ids = [940001, 940002, 940003, 940004];
const card = (id: number) => ({
  id,
  type: "ANIME",
  format: "TV",
  status: "FINISHED",
  title: { english: `Glass Harbor ${ids.indexOf(id) + 1}`, romaji: null, native: null },
  coverImage: { large: `https://art.example/cover/${id}.jpg` },
  startDate: { year: 2010 + ids.indexOf(id), month: 1, day: 1 },
});
const near = (id: number) => {
  const i = ids.indexOf(id);
  return [
    ...(i > 0 ? [{ relationType: "PREQUEL", id: ids[i - 1]! }] : []),
    ...(i < ids.length - 1 ? [{ relationType: "SEQUEL", id: ids[i + 1]! }] : []),
  ];
};
const media = (id: number): Record<string, unknown> => ({
  ...card(id),
  relations: {
    edges: near(id).map((e) => ({
      relationType: e.relationType,
      node: { ...card(e.id), relations: { edges: near(e.id).map((n) => ({ relationType: n.relationType, node: { id: n.id, type: "ANIME", format: "TV" } })) } },
    })),
  },
});

// Days back, so every moment this file moves to is still past: AniList's limiter remembers when it asked.
const START = Date.now() - 3 * 24 * HOUR;
let now = START;
const asked: string[] = [];
async function answer(_url: string, init?: RequestInit) {
  const { query } = JSON.parse(String(init?.body)) as { query: string };
  asked.push(query);
  const data: Record<string, unknown> = {};
  if (query.includes("airingSchedules")) {
    data.Page = {
      pageInfo: { hasNextPage: false },
      airingSchedules: [{ id: 1, episode: 3, airingAt: 1_800_000_000, media: { ...card(940004), popularity: 9000, isAdult: false } }],
    };
  }
  const asks = [...query.matchAll(/m(\d+): Media/g)].map((m) => Number(m[1]));
  // As AniList answers: an id it doesn't have makes it a 404 with every alias null.
  if (asks.some((id) => !ids.includes(id))) {
    const nulls = Object.fromEntries(asks.map((id) => [`m${id}`, null]));
    return new Response(JSON.stringify({ errors: [{ message: "Not Found.", status: 404 }], data: nulls }), { status: 404 });
  }
  for (const id of asks) data[`m${id}`] = media(id);
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// Only while this file's tests run: the suite shares one process.
let clock: Mock<typeof Date.now>;
let fetches: Mock<typeof fetch>;
let turns: Mock<typeof anilistLimiter.take>;
beforeAll(() => {
  clock = spyOn(Date, "now").mockImplementation(() => now);
  fetches = spyOn(globalThis, "fetch").mockImplementation(answer as unknown as typeof fetch);
  // Every request goes at once. AniList's budget is shared with the suite's other files, and with this
  // file's clock days back it would never refill: what they spent would hold these requests for good.
  turns = spyOn(anilistLimiter, "take").mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  asked.length = 0;
});

/** A fresh start: nothing in memory, the device's store as it was. */
const walk = () => seasonsQuery(new QueryClient(), readLinked(media(940002)) as unknown as Anime).queryFn();

test("a franchise's links are kept a day: a walk after a restart asks nothing, a day later it asks again", async () => {
  try {
    const first = await walk();
    expect(first.order.map((c) => c.id)).toEqual(ids);
    expect(asked.length).toBeGreaterThan(0);
    asked.length = 0;
    now += 23 * HOUR;
    expect((await walk()).order.map((c) => c.id)).toEqual(ids);
    expect(asked).toEqual([]);
    now += 2 * HOUR;
    await walk();
    expect(asked.length).toBeGreaterThan(0);
  } finally {
    now = START;
  }
});

test("an entry's page is kept a day, and used as it came for a day, or an hour while it airs", async () => {
  await fetchAnime(940003);
  expect(asked.length).toBe(1);
  const later = (hours: number) => {
    now += hours * HOUR;
    return animeQuery(940003).initialData();
  };
  try {
    expect(later(23)?.id).toBe(940003);
    expect(later(2)).toBeUndefined();
  } finally {
    now = START;
  }
  const { staleTime } = animeQuery(940003);
  expect(staleTime({ state: { data: { status: "FINISHED" } as Anime } })).toBe(24 * HOUR);
  expect(staleTime({ state: { data: { status: "RELEASING" } as Anime } })).toBe(HOUR);
});

test("an entry AniList doesn't have fails alone, though AniList leaves out its whole batch", async () => {
  const [found, missing] = await Promise.allSettled([fetchAnime(940001), fetchAnime(949999)]);
  expect(found.status === "fulfilled" && found.value.id).toBe(940001);
  expect(missing.status).toBe("rejected");
  expect(asked.length).toBe(3);
});

test("the airing schedule is kept an hour", async () => {
  const shown: number[][] = [];
  function Schedule() {
    const { data } = useAiringSchedule(1_799_990_000, 1_800_076_400);
    if (data) shown.push(data.map((s) => s.media.id));
    return null;
  }
  const open = async () => {
    const view = await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Schedule />
      </QueryClientProvider>,
    );
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    await view.unmount();
  };
  try {
    await open();
    expect(asked.length).toBe(1);
    asked.length = 0;
    now += 59 * 60_000;
    shown.length = 0;
    await open();
    expect(asked).toEqual([]);
    expect(shown[0]).toEqual([940004]);
    now += 2 * 60_000;
    await open();
    expect(asked.length).toBe(1);
  } finally {
    now = START;
  }
});

afterAll(() => {
  clock.mockRestore();
  fetches.mockRestore();
  turns.mockRestore();
});
