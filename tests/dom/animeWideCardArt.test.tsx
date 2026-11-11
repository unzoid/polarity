import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAnimePageArt, type Anime, type AnimeCard as Media, type PageArt, type SeasonWalk } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { setPrefs } from "../../src/lib/settings/prefs";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

// An invented franchise: Season 1 (its base title), Season 2 and a film after it, the seasons linked to one made-up
// IMDb series, the film to a made-up IMDb film; and a film of its own with no franchise.
const entry = (id: number, name: string, year: number, format = "TV") =>
  ({
    id,
    type: "ANIME",
    format,
    title: { english: name, romaji: null, native: null },
    coverImage: { extraLarge: `https://art.example/cover/${id}.jpg` },
    bannerImage: `https://art.example/banner/${id}.jpg`,
    startDate: { year, month: 1, day: 1 },
  }) as unknown as Media;
const s1 = entry(930001, "Harbour Lights", 2016);
const s2 = entry(930002, "Harbour Lights Season 2", 2018);
const film = entry(930003, "Harbour Lights: The Last Ferry", 2020, "MOVIE");
const alone = entry(930004, "Paper Orchard", 2021, "MOVIE");
const series = "tt0000930";
const filmId = "tt0000931";
const aloneId = "tt0000934";
const art = (id: string) => ({ background: `https://art.example/background/${id}.jpg`, logo: `https://art.example/logo/${id}.png` });
const edge = (relationType: string, to: Media) => ({ relationType, node: { id: to.id, type: "ANIME", format: to.format, episodes: 12 } });
const relations: Record<number, ReturnType<typeof edge>[]> = {
  [s1.id]: [edge("SEQUEL", s2)],
  [s2.id]: [edge("PREQUEL", s1), edge("SEQUEL", film)],
  [film.id]: [edge("PREQUEL", s2)],
  [alone.id]: [],
};
const walk: SeasonWalk = {
  seasons: [
    { card: s1, label: "Season 1" },
    { card: s2, label: "Season 2" },
    { card: film, label: "Movie" },
  ],
  order: [s1, s2, film],
  complete: true,
};
// ani.zip's art is the whole TVDB series': only the first season keeps it (animeArt).
const zip = (season: number) => ({
  mappings: {},
  episodes: { "1": { episode: "1", seasonNumber: season } },
  images: [
    { coverType: "Fanart", url: "https://art.example/fanart/930.jpg" },
    { coverType: "Clearlogo", url: "https://art.example/clearlogo/930.png" },
  ],
});

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.animeLinks, []);
  for (const e of [s1, s2, film]) {
    qc.setQueryData(keys.anime.media(e.id), { ...e, relations: { edges: relations[e.id] } } as unknown as Anime);
    qc.setQueryData(keys.anime.seasons(e.id), walk);
    qc.setQueryData(keys.anime.listedImdb(e.id), e === film ? filmId : series);
    qc.setQueryData(keys.anime.imdb(e.id), { id: e === film ? filmId : series });
  }
  qc.setQueryData(keys.aniZip(s1.id), zip(1));
  qc.setQueryData(keys.aniZip(s2.id), zip(2));
  qc.setQueryData(keys.aniZip(film.id), zip(0));
  qc.setQueryData(keys.anime.media(alone.id), { ...alone, relations: { edges: [] } } as unknown as Anime);
  qc.setQueryData(keys.anime.seasons(alone.id), { seasons: [{ card: alone, label: "Movie" }], order: [alone], complete: true });
  qc.setQueryData(keys.anime.listedImdb(alone.id), aloneId);
  qc.setQueryData(keys.anime.imdb(alone.id), { id: aloneId });
  qc.setQueryData(keys.aniZip(alone.id), { mappings: {}, episodes: {}, images: [] });
  qc.setQueryData(keys.meta("series", series), { id: series, type: "series", name: "Harbour Lights", ...art(series) });
  qc.setQueryData(keys.meta("movie", filmId), { id: filmId, type: "movie", name: "Harbour Lights: The Last Ferry", ...art(filmId) });
  qc.setQueryData(keys.meta("movie", aloneId), { id: aloneId, type: "movie", name: "Paper Orchard", ...art(aloneId) });
  return qc;
}

async function pageArt(card: Media, enabled = true) {
  let out: PageArt | null | undefined;
  function Probe() {
    out = useAnimePageArt(card, enabled);
    return null;
  }
  const { unmount } = await render(
    <QueryClientProvider client={client()}>
      <Probe />
    </QueryClientProvider>,
  );
  await settle();
  await unmount();
  return out;
}

const franchise = { ...art(series), logos: [art(series).logo, "https://art.example/clearlogo/930.png"] };

afterEach(() => setPrefs({ animeSeparateEntries: false }));

test("with seasons grouped, a later season's wide card shows its franchise's backdrop and logo, as its page does (#336)", async () => {
  setPrefs({ animeSeparateEntries: false });
  // The base title's general art, then ani.zip's logo of the base title to choose from.
  expect(await pageArt(s2)).toEqual(franchise);
  expect(await pageArt(s1)).toEqual(franchise);
});

test("with seasons grouped, a film in a franchise shows the franchise's art, as its page (a Movie tab) does", async () => {
  setPrefs({ animeSeparateEntries: false });
  expect(await pageArt(film)).toEqual(franchise);
});

test("a film of its own shows its own backdrop and logo", async () => {
  setPrefs({ animeSeparateEntries: false });
  expect(await pageArt(alone)).toEqual({ ...art(aloneId), logos: [art(aloneId).logo] });
  setPrefs({ animeSeparateEntries: true });
  expect(await pageArt(alone)).toEqual({ ...art(aloneId), logos: [art(aloneId).logo] });
});

test("with seasons as separate shows, a later season shows its own page's art: its banner and no logo (the name shows)", async () => {
  setPrefs({ animeSeparateEntries: true });
  expect(await pageArt(s2)).toEqual({ background: s2.bannerImage!, logo: undefined, logos: [] });
  expect(await pageArt(film)).toEqual({ background: film.bannerImage!, logo: undefined, logos: [] });
});

test("with seasons as separate shows, the first season shows the art of the title it plays from", async () => {
  setPrefs({ animeSeparateEntries: true });
  expect(await pageArt(s1)).toEqual(franchise);
});

test("nothing is worked out before the card comes near the screen", async () => {
  setPrefs({ animeSeparateEntries: false });
  expect(await pageArt(s2, false)).toBeUndefined();
});
