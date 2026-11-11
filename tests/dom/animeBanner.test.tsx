import { afterEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { slidesReady, useFranchiseBanners, type Anime, type AnimeCard as Media, type BannerArt, type SeasonWalk } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { anilistLimiter, Limiter, PRIORITY, type Priority } from "../../src/lib/net/limiter";
import { rowPriority } from "../../src/lib/anime/anilist";
import { setPrefs } from "../../src/lib/settings/prefs";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

// An invented franchise: Season 1 (its base title) and Season 2, both linked to one made-up IMDb series.
const entry = (id: number, name: string, year: number) =>
  ({
    id,
    type: "ANIME",
    format: "TV",
    title: { english: name, romaji: null, native: null },
    coverImage: { extraLarge: `https://art.example/cover/${id}.jpg` },
    bannerImage: `https://art.example/banner/${id}.jpg`,
    startDate: { year, month: 1, day: 1 },
  }) as unknown as Media;
const s1 = entry(920001, "Lantern Coast", 2017);
const s2 = entry(920002, "Lantern Coast Season 2", 2019);
const series = "tt0000920";
const general = { background: "https://art.example/background/tt0000920.jpg", logo: "https://art.example/logo/tt0000920.png" };
const walk: SeasonWalk = {
  seasons: [
    { card: s1, label: "Season 1" },
    { card: s2, label: "Season 2" },
  ],
  order: [s1, s2],
  complete: true,
};

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.animeLinks, []);
  for (const e of [s1, s2]) {
    qc.setQueryData(keys.anime.media(e.id), { ...e, relations: { edges: [] } } as unknown as Anime);
    qc.setQueryData(keys.anime.seasons(e.id), walk);
    qc.setQueryData(keys.anime.listedImdb(e.id), series);
    qc.setQueryData(keys.aniZip(e.id), { mappings: {}, episodes: {}, images: [] });
  }
  qc.setQueryData(keys.meta("series", series), { id: series, type: "series", name: "Lantern Coast", ...general });
  return qc;
}

async function banners(cards: Media[], qc = client(), priority?: Priority, first?: Priority) {
  let out: (BannerArt | null | undefined)[] | undefined;
  function Probe() {
    out = useFranchiseBanners(cards, priority, first);
    return null;
  }
  const { unmount } = await render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  await settle();
  await unmount();
  return out;
}

afterEach(() => setPrefs({ animeSeparateEntries: false }));

test("with seasons grouped, a trending base title shows its franchise's art and logo and no label (#325)", async () => {
  setPrefs({ animeSeparateEntries: false });
  expect(await banners([s1])).toEqual([{ name: "Lantern Coast", ...general, logos: [general.logo], label: undefined }]);
});

test("a later season trending shows the base title's art and logo, the same as its page, and its season tab's label", async () => {
  setPrefs({ animeSeparateEntries: false });
  expect(await banners([s2])).toEqual([{ name: "Lantern Coast", ...general, logos: [general.logo], label: "Season 2" }]);
});

test("with seasons as separate shows, every entry keeps its own art", async () => {
  setPrefs({ animeSeparateEntries: true });
  expect(await banners([s1, s2])).toEqual([null, null]);
});

test("an airing show nothing links yet takes its art from the title it plays from, as its page does (#371)", async () => {
  setPrefs({ animeSeparateEntries: false });
  const airing = entry(920003, "Harbor Lights", 2026);
  const plays = "tt0000930";
  const qc = client();
  qc.setQueryData(keys.anime.media(airing.id), { ...airing, relations: { edges: [] } } as unknown as Anime);
  qc.setQueryData(keys.anime.seasons(airing.id), { seasons: [{ card: airing, label: "Season 1" }], order: [airing], complete: true });
  qc.setQueryData(keys.anime.listedImdb(airing.id), null);
  const zipLogo = "https://art.example/anizip/920003/logo.png";
  qc.setQueryData(keys.aniZip(airing.id), {
    mappings: { imdb_id: plays },
    episodes: {},
    images: [
      { coverType: "Fanart", url: "https://art.example/anizip/920003/fanart.jpg" },
      { coverType: "Clearlogo", url: zipLogo },
    ],
  });
  // The same answer the page's lookup has: ani.zip's IMDb link.
  qc.setQueryData(keys.anime.imdb(airing.id), { id: plays, by: "mapping" });
  const art = { background: "https://art.example/background/tt0000930.jpg", logo: "https://art.example/cover/tt0000930.jpg" };
  qc.setQueryData(keys.meta("series", plays), { id: plays, type: "series", name: "Harbor Lights", ...art });
  expect(await banners([airing], qc)).toEqual([{ name: "Harbor Lights", ...art, logos: [art.logo, zipLogo], label: undefined }]);
});

/** AniList's queue, held: every request waits for its turn, which never comes; `asked` is the priority each would go at. */
function holdAniList() {
  const asked: Priority[] = [];
  const take = spyOn(anilistLimiter, "take").mockImplementation((_signal, priority = PRIORITY.visible) => {
    asked.push(priority);
    return new Promise<void>(() => {});
  });
  return {
    asked,
    level: (i: number) => {
      const p = asked[i]!;
      return typeof p === "function" ? p() : p;
    },
    restore: () => take.mockRestore(),
  };
}

test("#380: each slide's art comes on its own; one still coming doesn't hold back the one before it", async () => {
  setPrefs({ animeSeparateEntries: false });
  const held = holdAniList();
  try {
    const later = entry(920004, "Quiet Orchard", 2024);
    expect(await banners([s1, later])).toEqual([{ name: "Lantern Coast", ...general, logos: [general.logo], label: undefined }, undefined]);
  } finally {
    held.restore();
  }
});

test("#380: the first slide's requests go ahead of the shelves on screen, the others with them", async () => {
  setPrefs({ animeSeparateEntries: false });
  const held = holdAniList();
  const first = entry(920005, "Paper Comet", 2025);
  const second = entry(920006, "Iron Meadow", 2025);
  try {
    await banners([first, second], client(), PRIORITY.visible, PRIORITY.page);
    expect(held.asked.map((_, i) => held.level(i))).toEqual([PRIORITY.page, PRIORITY.visible]);
  } finally {
    held.restore();
  }
  // In AniList's queue once its burst is spent: a shelf on screen asked first, then the banner's two slides.
  const clock = { t: 0, now: () => clock.t, sleep: async (ms: number) => void (clock.t += ms) };
  const queue = new Limiter({ burst: 1, perMinute: 60, retries: 1, defaultWait: 1000, maxWait: 1000 }, clock);
  await queue.take();
  const order: string[] = [];
  await Promise.all([
    queue.take(undefined, rowPriority("in")).then(() => order.push("shelf")),
    queue.take(undefined, held.asked[0]).then(() => order.push("slide 1")),
    queue.take(undefined, held.asked[1]).then(() => order.push("slide 2")),
  ]);
  expect(order).toEqual(["slide 1", "shelf", "slide 2"]);
});

test("#380: the carousel shows the leading slides whose art is known, in order", () => {
  const art: BannerArt = { name: "Lantern Coast", ...general };
  expect(slidesReady([])).toBe(0);
  expect(slidesReady([undefined, art, art])).toBe(0);
  expect(slidesReady([art, undefined, art])).toBe(1);
  // A slide whose franchise couldn't be asked shows with its own art: it doesn't hold back the rest.
  expect(slidesReady([art, null, art])).toBe(3);
});
