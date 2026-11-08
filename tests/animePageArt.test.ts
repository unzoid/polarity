import { expect, test } from "bun:test";
import type { AnimeCard, MediaFormat } from "../src/lib/anime/anilist";
import { animeArt, franchiseArt, type AniZip } from "../src/lib/anime/anizip";
import { pageArtSource } from "../src/lib/anime/pageArt";

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
    const src0 = pageArtSource({ separate: false, seasonsLoading: !found, found, shown: opened, active: opened.id, separateFirst: undefined, linked, hero });
    if (done.has("hero") && src0.hero !== undefined) hero = { of: src0.hero, id: visit.plays[src0.hero] ?? null };
    const src = pageArtSource({ separate: false, seasonsLoading: !found, found, shown: opened, active: opened.id, separateFirst: undefined, linked, hero });
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
    hero: { of: s2.id, id: "tt0000100" },
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
      hero: undefined,
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
    hero: { of: film.id, id: "tt0000199" },
  });
  expect(src.hero).toBe(s1.id);
  expect(src.imdb).toBeUndefined();
});
