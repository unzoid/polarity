import type { Meta, Video } from "../../types";

/**
 * An invented anime with 1,200 episodes (and a 12-episode one beside it), for the long-show page's performance check (#397): its AniList
 * entry and ani.zip record (which the e2e test answers for) and the series IMDb would list it as (which
 * the fake shell's metadata answers for). One episode a week, numbered in seasons of 50 as TVDB would.
 */
export const LONG_ANIME = { anilist: 990_001, imdb: "tt9901200", episodes: 1200, name: "Lanternfield Chronicle" };
/** The same show cut to one cour, to compare with: what a short show's page takes. */
export const SHORT_ANIME = { anilist: 990_002, imdb: "tt9900012", episodes: 12, name: "Lanternfield Prelude" };
export type InventedAnime = typeof LONG_ANIME & { kitsu?: number; missing?: number[] };
/**
 * A show of 150 whose series IMDb lists without episodes 100 and 101 (#427): its page still lists them, asked for
 * by the entry's Kitsu id.
 */
export const GAP_ANIME: InventedAnime = { anilist: 990_005, imdb: "tt9901150", episodes: 150, name: "Lanternfield Ferry", kitsu: 4243, missing: [100, 101] };
/** A show whose one season has 1,200 episodes, as some long-running ones are listed, for TV's episode list (#436). */
export const ONE_SEASON = { imdb: "tt9901201", episodes: 1200, name: "Lanternfield Ledger" };
export const inventedAnime = (anilist: number): InventedAnime | undefined => [LONG_ANIME, SHORT_ANIME, GAP_ANIME].find((a) => a.anilist === anilist);

const WEEK = 7 * 86_400_000;
const START = Date.UTC(2001, 3, 4, 14);
const seasonOf = (n: number) => Math.ceil(n / 50);
const inSeason = (n: number) => ((n - 1) % 50) + 1;
const airs = (n: number) => START + (n - 1) * WEEK;

export function longAnimeVideos(show: InventedAnime = LONG_ANIME): Video[] {
  return Array.from({ length: show.episodes }, (_, i) => i + 1)
    .filter((n) => !show.missing?.includes(n))
    .map((n) => ({
      id: `${show.imdb}:${seasonOf(n)}:${inSeason(n)}`,
      title: `Episode #${seasonOf(n)}.${inSeason(n)}`,
      season: seasonOf(n),
      episode: inSeason(n),
      // Cinemeta's way: the day, at midnight UTC.
      released: `${new Date(airs(n)).toISOString().slice(0, 10)}T00:00:00.000Z`,
    }));
}

export function longAnimeMeta(imdb: string): Meta | null {
  if (imdb === ONE_SEASON.imdb) {
    const videos = longAnimeVideos({ ...LONG_ANIME, ...ONE_SEASON }).map((v, i) => ({ ...v, id: `${imdb}:1:${i + 1}`, title: `Ledger ${i + 1}`, season: 1, episode: i + 1 }));
    return { id: imdb, type: "series", name: ONE_SEASON.name, videos };
  }
  const show = [LONG_ANIME, SHORT_ANIME, GAP_ANIME].find((a) => a.imdb === imdb);
  return show ? { id: show.imdb, type: "series", name: show.name, videos: longAnimeVideos(show) } : null;
}

/** ani.zip's answer for the entry: every episode with its title, synopsis, still and air time. */
export function longAnimeZip(show: InventedAnime = LONG_ANIME) {
  const episodes: Record<string, unknown> = {};
  for (let n = 1; n <= show.episodes; n++)
    episodes[n] = {
      episode: String(n),
      seasonNumber: seasonOf(n),
      episodeNumber: inSeason(n),
      absoluteEpisodeNumber: n,
      title: { en: `The Lantern's Road, Part ${n}`, "x-jat": `Tourou no Michi ${n}` },
      airDate: new Date(airs(n)).toISOString().slice(0, 10),
      airDateUtc: new Date(airs(n)).toISOString(),
      runtime: 24,
      overview: `Part ${n} of the long walk: the lantern-keepers cross another valley, and someone is left behind at the ford.`,
      image: `https://media.example/still/${n}.jpg`,
    };
  return {
    titles: { en: show.name, "x-jat": "Tourou Senki" },
    episodeCount: show.episodes,
    specialCount: 0,
    images: [],
    mappings: { anilist_id: show.anilist, imdb_id: show.imdb, ...(show.kitsu && { kitsu_id: show.kitsu }), type: "TV" },
    episodes,
  };
}

/** AniList's answer for the entry's page: a finished TV series with nothing before or after it. */
export function longAnimeMedia(show: InventedAnime = LONG_ANIME) {
  return {
    id: show.anilist,
    type: "ANIME",
    format: "TV",
    status: "FINISHED",
    episodes: show.episodes,
    duration: 24,
    title: { romaji: "Tourou Senki", english: show.name, native: null },
    description: "Lantern-keepers walk a road that has no end.",
    coverImage: { extraLarge: null, large: null, color: "#4a6fa5" },
    bannerImage: null,
    startDate: { year: 2001, month: 4, day: 4 },
    endDate: { year: 2024, month: 3, day: 1 },
    season: "SPRING",
    seasonYear: 2001,
    genres: ["Adventure"],
    averageScore: 80,
    relations: { edges: [] },
    characters: { edges: [] },
    staff: { edges: [] },
    studios: { edges: [] },
    tags: [],
    recommendations: { nodes: [] },
    airingSchedule: { nodes: [] },
    nextAiringEpisode: null,
  };
}

/**
 * An invented franchise for a grouped page's season tabs (#352): a 12-episode series (the short show's IMDb series), then a film
 * after it (one of the fake shell's films). AniList's entries for both, with the relation between them, and ani.zip's records.
 */
export const FRANCHISE = {
  show: { ...SHORT_ANIME, anilist: 990_003, name: "Lanternfield Crossing" },
  film: { anilist: 990_004, imdb: "tt9100003", name: "Lanternfield: The Last Ford", duration: 104 },
};

const franchiseNode = (id: number) => {
  const film = id === FRANCHISE.film.anilist;
  const entry = film ? FRANCHISE.film : FRANCHISE.show;
  return {
    id,
    type: "ANIME",
    format: film ? "MOVIE" : "TV",
    status: "FINISHED",
    episodes: film ? 1 : FRANCHISE.show.episodes,
    title: { romaji: film ? "Tourou Senki Gekijouban" : "Tourou Watari", english: entry.name, native: null },
    coverImage: { extraLarge: null, large: null, color: "#4a6fa5" },
    startDate: { year: film ? 2003 : 2002, month: 4, day: 4 },
    season: "SPRING",
    seasonYear: film ? 2003 : 2002,
  };
};

/** AniList's answer for either entry of the invented franchise, or undefined for another id. */
export function franchiseMedia(id: number) {
  if (id !== FRANCHISE.show.anilist && id !== FRANCHISE.film.anilist) return undefined;
  const film = id === FRANCHISE.film.anilist;
  return {
    ...longAnimeMedia(FRANCHISE.show),
    ...franchiseNode(id),
    duration: film ? FRANCHISE.film.duration : 24,
    description: film ? "The lantern-keepers' last crossing, at the ford where the road ends." : "Lantern-keepers learn the crossings.",
    relations: {
      edges: [{ relationType: film ? "PREQUEL" : "SEQUEL", node: franchiseNode(film ? FRANCHISE.show.anilist : FRANCHISE.film.anilist) }],
    },
  };
}

/** ani.zip's record for either entry of the invented franchise, or undefined for another id. */
export function franchiseZip(id: number) {
  if (id === FRANCHISE.show.anilist) {
    const zip = longAnimeZip(FRANCHISE.show);
    return { ...zip, mappings: { ...zip.mappings, anilist_id: id } };
  }
  if (id !== FRANCHISE.film.anilist) return undefined;
  return {
    titles: { en: FRANCHISE.film.name },
    episodeCount: 1,
    specialCount: 0,
    images: [],
    mappings: { anilist_id: id, imdb_id: FRANCHISE.film.imdb, type: "MOVIE" },
    episodes: {},
  };
}
