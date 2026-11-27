import { describe, expect, test } from "bun:test";
import { animeItemName, animeItemToPreview, formatAnimeItemScore, withoutAnimeItems } from "../src/lib/anime/catalogModel";
import type { AnimeItem, MetaPreview } from "../src/lib/types";

const sample: AnimeItem = {
  id: "tt0000101",
  type: "series",
  name: "Starlight Blade",
  titles: {
    english: "Starlight Blade",
    romaji: "Hoshikage no Yaiba",
    native: "星影の刃",
  },
  poster: "https://media.example.com/poster.jpg",
  background: "https://media.example.com/bg.jpg",
  logo: "https://media.example.com/logo.png",
  logos: ["https://media.example.com/logo.png"],
  description: "A test show.",
  year: 2026,
  score: 8.65,
  genres: ["Action", "Fantasy"],
  seasonHint: 3,
  seasonLabel: "Season 3",
  malId: 12345,
};

describe("show-first anime catalog helpers", () => {
  test("picks title language according to preference", () => {
    expect(animeItemName(sample, "english")).toBe("Starlight Blade");
    expect(animeItemName(sample, "romaji")).toBe("Hoshikage no Yaiba");
    expect(animeItemName(sample, "native")).toBe("星影の刃");
  });

  test("formats scores in out-of-ten and percent modes", () => {
    expect(formatAnimeItemScore(8.65, "ten")).toBe("8.7");
    expect(formatAnimeItemScore(8.65, "percent")).toBe("87%");
    expect(formatAnimeItemScore(undefined, "ten")).toBeUndefined();
    expect(formatAnimeItemScore(0, "ten")).toBeUndefined();
  });

  test("projects AnimeItem into a MetaPreview for instant detail dialog paint", () => {
    const p = animeItemToPreview(sample, "romaji");
    expect(p).toEqual({
      id: "tt0000101",
      type: "series",
      name: "Hoshikage no Yaiba",
      poster: sample.poster,
      background: sample.background,
      logo: sample.logo,
      logos: sample.logos,
      description: sample.description,
      releaseInfo: "2026",
      imdbRating: "8.7",
      genres: ["Action", "Fantasy"],
      certification: undefined,
    });
  });

  test("withoutAnimeItems deduplicates general search results by canonical id", () => {
    const general: MetaPreview[] = [
      { id: "tt0000101", type: "series", name: "Starlight Blade" },
      { id: "tt0000202", type: "series", name: "Other Show" },
    ];
    expect(withoutAnimeItems(general, [sample])).toEqual([{ id: "tt0000202", type: "series", name: "Other Show" }]);
  });
});
