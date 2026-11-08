import { BROWSE_GENRES } from "./genres";

/** Search's own rows, before the add-ons' (#338). */
export type SearchRow = "movieGenre" | "seriesGenre" | "anime" | "movies" | "series";

/**
 * The order of Search's own rows. `genre`: the movie or series genre the search names (`genreOf`). `animeGenre`: the
 * search names an anime genre or kind of show, so the anime row is that genre's anime by popularity.
 *
 * A title search: Movies, Series, Anime. A movie or series genre leads with its popular movies and series, then the
 * titles named like it. An anime genre that's also a movie or series genre ("Action") puts its anime with the other
 * genre rows, before the titles named like it; one that's anime alone ("Isekai", "Slice of Life", the Anime chips)
 * leads with the anime, as the movies and series are only titles containing the words.
 */
export function searchRows(genre: string | undefined, animeGenre: boolean): SearchRow[] {
  const genreRows: SearchRow[] = [];
  if (genre && BROWSE_GENRES.movie.includes(genre)) genreRows.push("movieGenre");
  if (genre && BROWSE_GENRES.series.includes(genre)) genreRows.push("seriesGenre");
  if (!animeGenre) return [...genreRows, "movies", "series", "anime"];
  return [...genreRows, "anime", "movies", "series"];
}
