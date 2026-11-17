import { describe, expect, test } from "bun:test";
import {
  arrangeLibrary,
  clearFilters,
  decadeOptions,
  defaultView,
  factsOf,
  genreOptions,
  hidingParts,
  needsFacts,
  readLibraryView,
  saveLibraryView,
  statusOf,
  type LibraryEntry,
  type LibraryFilters,
  type TitleFacts,
} from "../src/lib/library/libraryView";
import type { ContentType, Meta, Progress } from "../src/lib/types";

const progress = (metaId: string, videoId: string, updatedAt: number): Progress => ({
  metaId,
  videoId,
  type: "movie",
  name: metaId,
  position: 10,
  duration: 100,
  updatedAt,
});

const entry = (
  id: string,
  name: string,
  type: ContentType,
  extra: Partial<LibraryEntry<string>> = {},
): LibraryEntry<string> => ({ item: id, id, name, type, ...extra });

const facts = (year: number | undefined, genres: string[], rating?: number, lastEpisode?: string): TitleFacts => ({ year, genres, rating, lastEpisode });

const filters = (patch: Partial<LibraryFilters> = {}): LibraryFilters => ({ ...defaultView("saved"), query: "", ...patch });

// Made-up titles and tt0000000-style ids.
const ENTRIES: LibraryEntry<string>[] = [
  entry("tt0000001", "Harbour Lights", "movie", { addedAt: 300, facts: facts(1994, ["Drama"], 7.1) }),
  entry("tt0000002", "Amélie Street", "movie", {
    addedAt: 200,
    progress: progress("tt0000002", "tt0000002", 50),
    finished: true,
    facts: facts(2001, ["Comedy", "Romance"], 8.0),
  }),
  entry("tt0000003", "The Long Orbit", "series", {
    addedAt: 100,
    progress: progress("tt0000003", "tt0000003:1:4", 90),
    finished: false,
    facts: facts(2019, ["Sci-Fi", "Drama"], 6.5, "tt0000003:2:8"),
  }),
  entry("tt0000004", "Quiet Field", "movie", { addedAt: 400 }),
];

const ids = (f: LibraryFilters) => arrangeLibrary(ENTRIES, f).items;

describe("factsOf", () => {
  const meta = (m: Partial<Meta>): Meta => ({ id: "tt0000009", type: "movie", name: "X", videos: [], ...m });

  test("year from releaseInfo, else the release date; rating and genres", () => {
    expect(factsOf(meta({ releaseInfo: "2010–2015", imdbRating: "7.4", genres: ["Drama", " Drama ", "Crime"] }))).toEqual({
      year: 2010,
      rating: 7.4,
      genres: ["Drama", "Crime"],
    });
    expect(factsOf(meta({ details: { released: "1999-03-31" } })).year).toBe(1999);
    expect(factsOf(meta({ imdbRating: "N/A" }))).toEqual({ genres: [] });
  });

  test("a show's last aired episode, specials and future episodes aside", () => {
    const now = Date.parse("2026-01-01");
    const f = factsOf(
      meta({
        type: "series",
        videos: [
          { id: "s:2:1", title: "", season: 2, episode: 1, released: "2025-06-01" },
          { id: "s:1:9", title: "", season: 1, episode: 9, released: "2024-06-01" },
          { id: "s:0:1", title: "", season: 0, episode: 1, released: "2025-12-01" },
          { id: "s:2:2", title: "", season: 2, episode: 2, released: "2026-06-01" },
        ],
      }),
      now,
    );
    expect(f.lastEpisode).toBe("s:2:1");
  });
});

describe("statusOf", () => {
  test("not started, in progress, watched", () => {
    expect(statusOf(ENTRIES[0])).toBe("unstarted");
    expect(statusOf(ENTRIES[1])).toBe("watched");
    expect(statusOf(ENTRIES[2])).toBe("progress");
  });

  test("a show is watched only at its last aired episode, and can't tell before its episodes are in", () => {
    const p = progress("s", "s:2:8", 1);
    expect(statusOf({ type: "series", progress: p, finished: true, facts: facts(2019, [], undefined, "s:2:8") })).toBe("watched");
    expect(statusOf({ type: "series", progress: p, finished: true, facts: facts(2019, [], undefined, "s:3:1") })).toBe("progress");
    expect(statusOf({ type: "series", progress: p, finished: true })).toBeUndefined();
  });
});

describe("arrangeLibrary", () => {
  test("sorts: recently added, title, year, recently watched, rating", () => {
    expect(ids(filters())).toEqual(["tt0000004", "tt0000001", "tt0000002", "tt0000003"]);
    expect(ids(filters({ sort: "title" }))).toEqual(["tt0000002", "tt0000001", "tt0000004", "tt0000003"]);
    // Without a year (not looked up yet) goes last.
    expect(ids(filters({ sort: "year" }))).toEqual(["tt0000003", "tt0000002", "tt0000001", "tt0000004"]);
    // Never watched last, in the order they came.
    expect(ids(filters({ sort: "watched" }))).toEqual(["tt0000003", "tt0000002", "tt0000001", "tt0000004"]);
    expect(ids(filters({ sort: "rating" }))).toEqual(["tt0000002", "tt0000001", "tt0000003", "tt0000004"]);
  });

  test("filters combine", () => {
    expect(ids(filters({ kind: "movie", genre: "drama" }))).toEqual(["tt0000004", "tt0000001"]);
    expect(ids(filters({ status: "watched" }))).toEqual(["tt0000002"]);
    expect(ids(filters({ status: "unstarted" }))).toEqual(["tt0000004", "tt0000001"]);
    expect(ids(filters({ decade: 2010, kind: "series", status: "progress" }))).toEqual(["tt0000003"]);
  });

  test("a title whose facts aren't in yet stays, and is counted", () => {
    const r = arrangeLibrary(ENTRIES, filters({ genre: "Comedy" }));
    expect(r.items).toEqual(["tt0000004", "tt0000002"]);
    expect(r.undecided).toBe(1);
    // Type needs no facts: nothing undecided.
    expect(arrangeLibrary(ENTRIES, filters({ kind: "movie" })).undecided).toBe(0);
  });

  test("search: name without case or accents, genres once known, the year", () => {
    expect(ids(filters({ query: "amelie" }))).toEqual(["tt0000002"]);
    expect(ids(filters({ query: "sci-fi" }))).toEqual(["tt0000003"]);
    expect(ids(filters({ query: "drama harbour" }))).toEqual(["tt0000001"]);
    expect(ids(filters({ query: "1994" }))).toEqual(["tt0000001"]);
    expect(ids(filters({ query: "nothing like it" }))).toEqual([]);
  });
});

describe("hidingParts", () => {
  test("names the filters that alone hide everything", () => {
    expect(hidingParts(ENTRIES, filters({ kind: "series", genre: "Comedy" }))).toEqual(["kind", "genre"]);
    expect(hidingParts(ENTRIES, filters({ kind: "movie", query: "orbit" }))).toEqual(["kind", "query"]);
    expect(hidingParts(ENTRIES, filters({ decade: 1950, genre: "Romance" }))).toEqual(["decade"]);
  });

  test("clearFilters keeps the sort", () => {
    expect(clearFilters(filters({ kind: "movie", genre: "Drama", query: "x", sort: "rating" }))).toEqual(filters({ sort: "rating" }));
  });
});

describe("options", () => {
  test("genres and decades from what's known, the chosen one kept", () => {
    expect(genreOptions(ENTRIES)).toEqual(["Comedy", "Drama", "Romance", "Sci-Fi"]);
    expect(genreOptions(ENTRIES, "Western")).toContain("Western");
    expect(decadeOptions(ENTRIES)).toEqual([2010, 2000, 1990]);
    expect(decadeOptions(ENTRIES, 1960)).toEqual([2010, 2000, 1990, 1960]);
  });

  test("needsFacts", () => {
    expect(needsFacts(defaultView("saved"))).toBe(false);
    expect(needsFacts({ ...defaultView("saved"), sort: "rating" })).toBe(true);
    expect(needsFacts({ ...defaultView("saved"), genre: "Drama" })).toBe(true);
  });
});

describe("remembered view", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  test("each collection keeps its own; bad values fall back", () => {
    const s = memory();
    saveLibraryView("saved", { kind: "movie", status: "unstarted", genre: "Drama", decade: 1990, sort: "rating" }, s);
    expect(readLibraryView("saved", s)).toEqual({ kind: "movie", status: "unstarted", genre: "Drama", decade: 1990, sort: "rating" });
    expect(readLibraryView("watched", s)).toEqual(defaultView("watched"));
    s.setItem("polar.library.view.watched", JSON.stringify({ kind: "music", status: "unstarted", decade: 1995, sort: "added" }));
    expect(readLibraryView("watched", s)).toEqual(defaultView("watched"));
    s.setItem("polar.library.view.saved", "{not json");
    expect(readLibraryView("saved", s)).toEqual(defaultView("saved"));
  });
});
