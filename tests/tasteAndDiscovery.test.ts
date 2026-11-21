import "./storageStub";
import { describe, expect, test } from "bun:test";
import { filmography } from "../src/lib/catalog/people";
import { todaysShelves } from "../src/lib/catalog/shelves";
import { buildTasteProfile, pickForMe } from "../src/lib/catalog/taste";
import type { LibraryItem, MetaPreview, Progress } from "../src/lib/types";

const movie = (id: string, name: string, genres: string[], imdbRating = "7.8"): MetaPreview => ({
  id,
  type: "movie",
  name,
  genres,
  imdbRating,
  poster: `https://images.example.com/${id}.jpg`,
  background: `https://images.example.com/${id}-bg.jpg`,
});

const watchedProgress = (metaId: string, type: "movie" | "series", updatedAt: number): Progress => ({
  metaId,
  type,
  videoId: metaId,
  name: `Title ${metaId}`,
  position: 7000,
  duration: 7200,
  updatedAt,
});

const savedItem = (id: string, type: "movie" | "series", addedAt: number): LibraryItem => ({
  id,
  type,
  name: `Saved ${id}`,
  addedAt,
});

describe("Tier 2: Taste engine & honest personalization", () => {
  test("buildTasteProfile boosts watched genres, softly boosts saved genres, and penalizes hidden genres", () => {
    const genres = new Map<string, string[]>([
      ["tt0000001", ["Sci-Fi", "Thriller"]],
      ["tt0000002", ["Sci-Fi", "Mystery"]],
      ["tt0000003", ["Comedy"]],
      ["tt0000004", ["Horror"]],
      ["tt0000005", ["Horror"]],
    ]);
    const taste = buildTasteProfile({
      history: [watchedProgress("tt0000001", "movie", 2000), watchedProgress("tt0000002", "movie", 1900)],
      library: [savedItem("tt0000003", "series", 1800)],
      hidden: new Set(["tt0000004", "tt0000005"]),
      genresOf: (id) => genres.get(id),
    });
    expect(taste.sampleSize).toBe(5);
    expect(taste.genres.get("sci-fi")!).toBeGreaterThan(taste.genres.get("comedy")!);
    expect(taste.genres.get("horror")!).toBeLessThan(0);
    expect(taste.typeBias.movie).toBeGreaterThan(0);
  });

  test("todaysShelves honestly distinguishes 'Because you watched' from 'Because you saved' and ranks preferred genres higher", () => {
    const genres = new Map<string, string[]>([
      ["tt0000010", ["Sci-Fi"]],
      ["tt0000011", ["Sci-Fi"]],
      ["tt0000012", ["Horror"]],
    ]);
    const taste = buildTasteProfile({
      history: [watchedProgress("tt0000010", "movie", 3000), watchedProgress("tt0000011", "movie", 2900)],
      library: [],
      hidden: new Set(["tt0000012"]),
      genresOf: (id) => genres.get(id),
    });
    const shelves = todaysShelves(
      [
        { type: "series", id: "tt0000100", name: "Finished Show", source: "watched" },
        { type: "movie", id: "tt0000101", name: "Saved Film", source: "saved" },
      ],
      taste,
    );
    const becauseTitles = shelves.filter((s) => s.kind === "because").map((s) => s.title);
    expect(becauseTitles).toEqual(["Because you watched Finished Show", "Because you saved Saved Film"]);

    const genreShelves = shelves.filter((s) => s.kind === "catalog" && s.genre).map((s) => `${s.type}:${s.genre}`);
    expect(genreShelves[0]).toBe("movie:Sci-Fi");
    expect(genreShelves).not.toContain("movie:Horror");
  });

  test("pickForMe skips already-watched titles and selects high-affinity matches", () => {
    const taste = buildTasteProfile({
      history: [watchedProgress("tt0000020", "movie", 5000)],
      library: [],
      genresOf: (id) => (id === "tt0000020" ? ["Sci-Fi"] : undefined),
    });
    const pool = [
      movie("tt0000020", "Already Watched", ["Sci-Fi"], "9.0"),
      movie("tt0000021", "Great Sci-Fi", ["Sci-Fi"], "8.6"),
      movie("tt0000022", "Low Rated", ["Drama"], "5.2"),
    ];
    const picked = pickForMe(pool, new Set(["tt0000020"]), taste, () => 0);
    expect(picked?.id).toBe("tt0000021");
  });

  test("filmography includes Writing and puts it first for writers", () => {
    const rows = filmography({
      knownFor: "Writing",
      acting: [movie("tt0000031", "Cameo", ["Drama"])],
      writing: [movie("tt0000032", "Scripted Hit", ["Drama"])],
      directing: [],
    });
    expect(rows.map((r) => r.key)).toEqual(["writing", "acting"]);
    expect(rows[0]!.title).toBe("Writing");
  });
});
