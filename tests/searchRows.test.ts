import { describe, expect, test } from "bun:test";
import { genreOf } from "../src/lib/catalog/genres";
import { searchRows } from "../src/lib/catalog/searchRows";

// Search's own rows for a search, as Search names the anime row's genre: an AniList genre or tag the words name.
const rowsFor = (query: string, animeGenre: boolean) => searchRows(genreOf(query), animeGenre);

describe("Search's row order (#338)", () => {
  test("an anime-only genre or kind of show leads with the anime", () => {
    expect(rowsFor("Slice of Life", true)).toEqual(["anime", "movies", "series"]);
    expect(rowsFor("isekai", true)).toEqual(["anime", "movies", "series"]);
    expect(rowsFor("Mecha", true)).toEqual(["anime", "movies", "series"]);
  });

  test("a genre shared with movies and series puts the anime with the genre rows, before the titles named like it", () => {
    expect(rowsFor("Action", true)).toEqual(["movieGenre", "seriesGenre", "anime", "movies", "series"]);
    // A movie genre only: no series genre row.
    expect(rowsFor("horror", true)).toEqual(["movieGenre", "anime", "movies", "series"]);
  });

  test("a movie or series genre that isn't an anime genre keeps the anime row last", () => {
    expect(rowsFor("Western", false)).toEqual(["movieGenre", "seriesGenre", "movies", "series", "anime"]);
  });

  test("a title search is unchanged: Movies, Series, Anime", () => {
    expect(rowsFor("glass orchard", false)).toEqual(["movies", "series", "anime"]);
  });
});
