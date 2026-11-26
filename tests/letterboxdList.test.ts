import { describe, expect, test } from "bun:test";
import { isLetterboxdListLink, listFilms } from "../src/lib/library/letterboxdList";

// Made-up list names and public-domain films.

describe("Import Playlist: a Letterboxd list from its link", () => {
  test("a list's link is one, with or without its scheme, www. or more path; a boxd.it short link too", () => {
    for (const link of [
      "https://letterboxd.com/someone/list/a-made-up-list/",
      "letterboxd.com/someone/list/a-made-up-list",
      " http://www.letterboxd.com/some_one/list/a-made-up-list/page/2/ ",
      "https://letterboxd.com/someone/list/a-made-up-list/?sort=year",
      "https://boxd.it/aB12",
    ]) {
      expect(isLetterboxdListLink(link)).toBe(true);
    }
  });

  test("films, people, watchlists and other sites aren't lists", () => {
    for (const link of [
      "",
      "https://letterboxd.com/film/nosferatu/",
      "https://letterboxd.com/someone/",
      "https://letterboxd.com/someone/watchlist/",
      "https://example.com/someone/list/x/",
      "https://letterboxd.com.example.com/someone/list/x/",
      "https://boxd.it/",
    ]) {
      expect(isLetterboxdListLink(link)).toBe(false);
    }
  });

  test("the films keep the list's order, and one listed twice stays twice for the matcher", () => {
    const films = listFilms([{ name: "Nosferatu", year: 1922 }, { name: "The General" }, { name: "Nosferatu", year: 1922 }]);
    expect(films.map((f) => [f.name, f.year])).toEqual([
      ["Nosferatu", 1922],
      ["The General", undefined],
      ["Nosferatu", 1922],
    ]);
    expect(new Set(films.map((f) => f.key)).size).toBe(3);
  });
});
