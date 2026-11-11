import { expect, test } from "bun:test";
import type { AnimeCard, MediaFormat } from "../src/lib/anime/anilist";
import { animeArt, franchiseArt, type AniZip } from "../src/lib/anime/anizip";
import { artTitle, pageArtSource } from "../src/lib/anime/pageArt";
import { bannerBase } from "../src/lib/anime/franchiseBanner";

// An invented franchise (made-up AniList ids, tt0000000-style links, art.example pictures): two TV
// seasons and a film, which the user opens from a search's Movies row (#339).
const entry = (id: number, format: MediaFormat, year: number): AnimeCard => ({
  id,
  title: { romaji: `Kumohane ${id}` },
  coverImage: { extraLarge: `https://art.example/${id}/cover.jpg` },
  bannerImage: `https://art.example/${id}/banner.jpg`,
  format,
  startDate: { year, month: 1, day: 1 },
});
const s1 = entry(1, "TV", 2019);
const s2 = entry(2, "TV", 2020);
const film = entry(3, "MOVIE", 2021);
const chain = [s1, s2, film];

const zipOf = (id: number) =>
  ({
    images: [
      { coverType: "Fanart", url: `https://art.example/${id}/fanart.jpg` },
      { coverType: "Clearlogo", url: `https://art.example/${id}/logo.png` },
    ],
    episodes: {},
    mappings: {},
  }) as unknown as AniZip;
const metaOf = (imdb: string) => ({ background: `https://art.example/${imdb}/background.jpg`, logo: `https://art.example/${imdb}/logo.png` });

type Event = "walk" | "listed tv" | "listed film" | "links" | "hero" | "zip" | "meta";
const EVENTS: Event[] = ["walk", "listed tv", "listed film", "links", "hero", "zip", "meta"];

function* orders<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) return yield items;
  for (let i = 0; i < items.length; i++) for (const rest of orders([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
}

interface Visit {
  /** The id lists' IMDb ids, and the links stored before this visit. */
  listed: Record<number, string | null>;
  stored: Record<number, string>;
  /** The id each entry plays from, as its hero finds it (a title search when nothing's linked). */
  plays: Record<number, string | null>;
}

/**
 * The art the page draws after each answer arrives, in `order`, opened at `opened`: AnimeDetail.tsx's
 * glue between pageArtSource, its queries and franchiseArt.
 */
function drawn(opened: AnimeCard, order: Event[], visit: Visit) {
  const done = new Set<Event>();
  const frames: string[] = [];
  for (const e of order) {
    done.add(e);
    const linked = (id: number) => {
      const answered = done.has("links") && done.has(id === film.id ? "listed film" : "listed tv");
      return answered ? (visit.stored[id] ?? visit.listed[id] ?? null) : undefined;
    };
    const found = done.has("walk") ? chain : undefined;
    let hero: { of: number; id: string | null } | undefined;
    // The hero reports the id of whichever entry it shows: the opened entry until the base is known.
    const src0 = pageArtSource({ separate: false, seasonsLoading: !found, found, shown: opened, active: opened.id, separateFirst: undefined, linked, played: hero });
    if (done.has("hero") && src0.hero !== undefined) hero = { of: src0.hero, id: visit.plays[src0.hero] ?? null };
    const src = pageArtSource({ separate: false, seasonsLoading: !found, found, shown: opened, active: opened.id, separateFirst: undefined, linked, played: hero });
    const first = src.first ?? opened;
    const tt = !!src.imdb?.startsWith("tt");
    const art = franchiseArt({
      imdb: src.imdb,
      meta: tt && done.has("meta") ? metaOf(src.imdb!) : undefined,
      metaLoading: tt && !done.has("meta"),
      first: animeArt(first, done.has("zip") ? zipOf(first.id) : undefined),
      firstLoading: !!src.first && !done.has("zip"),
    });
    if (art.background || art.logo) frames.push(`${art.background} ${art.logo}`);
  }
  return frames;
}

function artOfEveryOrder(visit: Visit) {
  const seen = new Set<string>();
  for (const opened of chain) {
    for (const order of orders(EVENTS)) {
      const frames = drawn(opened, order, visit);
      // One draw: once art shows it never changes during the visit.
      expect(new Set(frames).size).toBe(1);
      seen.add(frames[0]);
    }
  }
  return seen;
}

test("nothing linked: one draw from the base title's own id, the same whichever entry opens it and in whatever order answers come (#339)", () => {
  const plays = { [s1.id]: "tt0000100", [s2.id]: "tt0000100", [film.id]: "tt0000199" };
  const first = artOfEveryOrder({ listed: { 1: null, 2: null, 3: null }, stored: {}, plays });
  expect([...first]).toEqual([`${metaOf("tt0000100").background} ${metaOf("tt0000100").logo}`]);
  // The next visit: the base title's hero stored the id it plays from, the film's its own.
  const again = artOfEveryOrder({ listed: { 1: null, 2: null, 3: null }, stored: { 1: "tt0000100", 3: "tt0000199" }, plays });
  expect(again).toEqual(first);
});

test("listed TV seasons: the base title's series, never the film's own title", () => {
  const seen = artOfEveryOrder({
    listed: { 1: "tt0000300", 2: "tt0000300", 3: "tt0000399" },
    stored: {},
    plays: { 1: "tt0000300", 2: "tt0000300", 3: "tt0000399" },
  });
  expect([...seen]).toEqual([`${metaOf("tt0000300").background} ${metaOf("tt0000300").logo}`]);
});

test("no title anywhere: the base title's ani.zip art, drawn only once ani.zip has answered (not its banner first)", () => {
  const seen = artOfEveryOrder({ listed: { 1: null, 2: null, 3: null }, stored: {}, plays: {} });
  expect([...seen]).toEqual([`https://art.example/1/fanart.jpg https://art.example/1/logo.png`]);
});

test("with seasons as separate shows a later entry keeps its own art", () => {
  const src = pageArtSource({
    separate: true,
    seasonsLoading: false,
    found: undefined,
    shown: s2,
    active: s2.id,
    separateFirst: false,
    linked: () => "tt0000100",
    played: { of: s2.id, id: "tt0000100" },
  });
  expect(src).toMatchObject({ first: s2, imdb: null, firstEntry: false });
  // Until the entry is loaded nothing is known.
  expect(
    pageArtSource({
      separate: true,
      seasonsLoading: false,
      found: undefined,
      shown: s2,
      active: s2.id,
      separateFirst: undefined,
      linked: () => null,
      played: undefined,
    }).imdb,
  ).toBeUndefined();
});

test("a hero's id for another entry doesn't count", () => {
  const src = pageArtSource({
    separate: false,
    seasonsLoading: false,
    found: chain,
    shown: film,
    active: film.id,
    separateFirst: undefined,
    linked: () => null,
    played: { of: film.id, id: "tt0000199" },
  });
  expect(src.hero).toBe(s1.id);
  expect(src.imdb).toBeUndefined();
});

// The Anime tab's banner and the page it opens, fed the same answers (#371): an airing single-season show
// the id lists don't have yet and nobody has stored, whose ani.zip record links its IMDb show, and a later
// season trending while its unlinked base title plays from a title of its own.
const banner = (card: AnimeCard, seasons: AnimeCard[], linked: (id: number) => string | null | undefined, plays: Record<number, string | null>) => {
  const b = bannerBase(card, seasons.map((c, i) => ({ card: c, label: `Season ${i + 1}` })), linked, (t) => t.romaji ?? "");
  return b && artTitle(b.linked, plays[b.base.id]);
};
const page = (opened: AnimeCard, seasons: AnimeCard[], linked: (id: number) => string | null | undefined, plays: Record<number, string | null>) => {
  const found = seasons.length > 1 ? seasons : undefined;
  const at = (played?: { of: number; id: string | null }) =>
    pageArtSource({ separate: false, seasonsLoading: false, found, shown: opened, active: opened.id, separateFirst: undefined, linked, played });
  const entry = at().first!;
  return at({ of: entry.id, id: plays[entry.id] ?? null }).imdb;
};

test("the banner and the page take their art from the same title, given the same answers (#371)", () => {
  const airing = entry(7, "TV", 2026);
  const none = () => null;
  for (const plays of [{ 7: "tt0000700" }, { 7: "kitsu:7" }, { 7: null }]) {
    expect(banner(airing, [airing], none, plays)).toBe(page(airing, [airing], none, plays));
  }
  expect(page(airing, [airing], none, { 7: "tt0000700" })).toBe("tt0000700");
  // A Kitsu id has no general title: ani.zip's art, on both.
  expect(page(airing, [airing], none, { 7: "kitsu:7" })).toBeNull();
  // A grouped franchise, the later season trending: the base title's own id on both, whichever entry opens the page.
  const plays = { [s1.id]: "tt0000100", [s2.id]: "tt0000200" };
  for (const opened of [s1, s2]) expect(page(opened, [s1, s2], none, plays)).toBe(banner(s2, [s1, s2], none, plays));
  expect(banner(s2, [s1, s2], none, plays)).toBe("tt0000100");
  // A stored or listed link wins over what it plays from, on both.
  const linked = (id: number) => (id === s1.id ? "tt0000111" : null);
  expect(banner(s2, [s1, s2], linked, plays)).toBe("tt0000111");
  expect(page(s2, [s1, s2], linked, plays)).toBe("tt0000111");
});

test("the banner and the page draw the same backdrop and logos from the same title and answers", () => {
  const airing = entry(7, "TV", 2026);
  const meta = { background: "https://art.example/tt0000700/background.jpg", logo: "https://art.example/tt0000700/cover.jpg" };
  const art = (imdb: string | null | undefined) => franchiseArt({ imdb, meta, metaLoading: false, first: animeArt(airing, zipOf(airing.id)) });
  const plays = { 7: "tt0000700" };
  const onBanner = art(banner(airing, [airing], () => null, plays));
  expect(onBanner).toEqual(art(page(airing, [airing], () => null, plays)));
  // A cover handed over as the logo isn't the only choice: ani.zip's logo follows, for the heading to fall back on.
  expect(onBanner.logos).toEqual([meta.logo, "https://art.example/7/logo.png"]);
});
