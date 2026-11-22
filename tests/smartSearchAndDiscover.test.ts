import "./storageStub";
import { beforeEach, describe, expect, test } from "bun:test";
import { applySmartFilters, parseSmartQuery } from "../src/lib/catalog/smartSearch";
import { clearNotInterested, loadNotInterested, markNotInterested, steerDiscover } from "../src/lib/catalog/discover";
import {
  buildTasteProfile,
  impressionPenalty,
  loadImpressions,
  pickForMe,
  recordImpressions,
  scoreCandidate,
  serendipityScore,
} from "../src/lib/catalog/taste";
import type { MetaPreview, Progress } from "../src/lib/types";

const NOW = Date.UTC(2026, 10, 22);
const DAY = 86_400_000;

const preview = (overrides: Partial<MetaPreview> & { id: string }): MetaPreview => ({
  type: "movie",
  name: overrides.id,
  ...overrides,
});

describe("Zero-LLM Smart Search AST & Chips (#618)", () => {
  test("parses natural language queries into dismissible chips and literal text", () => {
    const parsed = parseSmartQuery("90s romcom movies 8+");
    expect(parsed.yearRange).toEqual([1990, 1999]);
    expect(parsed.genres).toEqual(["Romance", "Comedy"]);
    expect(parsed.mediaType).toBe("movie");
    expect(parsed.minRating).toBe(8);
    expect(parsed.textQuery).toBe("");
    expect(parsed.chips.map((c) => c.id)).toEqual(["decade:1990", "rating:8", "type:movie", "genre:romance", "genre:comedy"]);

    const withTitle = parseSmartQuery("short scifi under 95m space");
    expect(withTitle.maxRuntimeMins).toBe(95);
    expect(withTitle.genres).toEqual(["Sci-Fi"]);
    expect(withTitle.textQuery).toBe("short space");
  });

  test("applySmartFilters filters candidates and respects dismissed chips", () => {
    const parsed = parseSmartQuery("90s scifi 8+");
    const items: MetaPreview[] = [
      preview({ id: "tt0000001", genres: ["Sci-Fi"], releaseInfo: "1999", imdbRating: "8.7" }),
      preview({ id: "tt0000002", genres: ["Sci-Fi"], releaseInfo: "2022", imdbRating: "8.4" }),
      preview({ id: "tt0000003", genres: ["Sci-Fi"], releaseInfo: "1995", imdbRating: "6.5" }),
    ];

    expect(applySmartFilters(items, parsed)?.map((m) => m.id)).toEqual(["tt0000001"]);
    // Dismissing the 90s decade chip immediately lets 2022 back in.
    expect(applySmartFilters(items, parsed, new Set(["decade:1990"]))?.map((m) => m.id)).toEqual(["tt0000001", "tt0000002"]);
  });
});

describe("Zero-LLM Steerable TV Discover (#671)", () => {
  beforeEach(() => clearNotInterested());

  test("filters by mood + drill-down, emits deterministic rationale, and honors not-interested memory", () => {
    const taste = buildTasteProfile({
      history: [{ metaId: "tt0000010", videoId: "tt0000010", type: "movie", name: "Seed", position: 5000, duration: 5400, updatedAt: NOW - DAY }],
      library: [],
      genresOf: () => ["Sci-Fi", "Thriller"],
      now: NOW,
    });
    const candidates = [
      { item: preview({ id: "tt0000101", genres: ["Sci-Fi", "Thriller"], releaseInfo: "1998", imdbRating: "8.1" }), runtimeMins: 92 },
      { item: preview({ id: "tt0000102", genres: ["Thriller"], releaseInfo: "2021", imdbRating: "7.6" }), runtimeMins: 140 },
    ];

    const quick = steerDiscover(candidates, "quick", ["90s", "scifi"], { taste });
    expect(quick.map((p) => p.item.id)).toEqual(["tt0000101"]);
    expect(quick[0]?.rationale).toContain("92 min");
    expect(quick[0]?.rationale).toContain("8.1");

    markNotInterested("tt0000101");
    expect(loadNotInterested()).toEqual(["tt0000101"]);
    const afterBlock = steerDiscover(candidates, "quick", ["90s"], { taste, notInterestedIds: new Set(loadNotInterested()) });
    expect(afterBlock).toHaveLength(0);
  });
});

describe("Upgraded taste.ts: wall-clock decay, binge compression, SessionIntent & impressions", () => {
  beforeEach(() => localStorage.removeItem("polar.taste.impressions"));

  test("wall-clock decay, stale abandonment downweight, and logarithmic binge compression", () => {
    const history: Progress[] = [
      // 30 episodes of a comedy series watched recently (binge compressed)
      ...Array.from({ length: 30 }, (_, i) => ({
        metaId: "tt0000200",
        videoId: `tt0000200:1:${i + 1}`,
        type: "series" as const,
        name: "Long Comedy",
        position: 1300,
        duration: 1400,
        updatedAt: NOW - DAY,
      })),
      // 3 finished Sci-Fi movies (should remain competitive despite 30 episodes of one show!)
      { metaId: "tt0000201", videoId: "tt0000201", type: "movie", name: "SciFi 1", position: 5300, duration: 5400, updatedAt: NOW - DAY },
      { metaId: "tt0000202", videoId: "tt0000202", type: "movie", name: "SciFi 2", position: 5300, duration: 5400, updatedAt: NOW - 2 * DAY },
      { metaId: "tt0000203", videoId: "tt0000203", type: "movie", name: "SciFi 3", position: 5300, duration: 5400, updatedAt: NOW - 3 * DAY },
      // Stale abandoned horror movie (<15% watched 30 days ago)
      { metaId: "tt0000204", videoId: "tt0000204", type: "movie", name: "Abandoned Horror", position: 180, duration: 5400, updatedAt: NOW - 30 * DAY },
    ];
    const genreMap: Record<string, string[]> = {
      tt0000200: ["Comedy"],
      tt0000201: ["Sci-Fi"],
      tt0000202: ["Sci-Fi"],
      tt0000203: ["Sci-Fi"],
      tt0000204: ["Horror"],
    };
    const taste = buildTasteProfile({ history, library: [], genresOf: (id) => genreMap[id], now: NOW });
    expect(taste.genres.get("sci-fi")!).toBeGreaterThan(taste.genres.get("comedy")!);
    expect(taste.genres.get("horror")!).toBeLessThan(0.05);
    expect(taste.confidence).toBeCloseTo(5 / 10, 5);
  });

  test("SessionIntent boosts matching picks and passive impressions fatigue ignored titles", () => {
    const a = preview({ id: "tt0000301", type: "movie", genres: ["Drama"], releaseInfo: "2020", imdbRating: "8.0" });
    const b = preview({ id: "tt0000302", type: "movie", genres: ["Sci-Fi"], releaseInfo: "1997", imdbRating: "8.0" });
    const session = { genre: "Sci-Fi", era: [1990, 1999] as [number, number] };
    expect(scoreCandidate(b, undefined, session)).toBeGreaterThan(scoreCandidate(a, undefined, session));

    recordImpressions(["tt0000302", "tt0000302", "tt0000302", "tt0000302", "tt0000302"], NOW);
    const imps = loadImpressions();
    expect(impressionPenalty("tt0000302", imps, NOW)).toBeGreaterThan(0.2);
    const picked = pickForMe([a, b], new Set(), undefined, () => 0, { impressions: imps, now: NOW });
    expect(picked?.id).toBe("tt0000301");

    expect(serendipityScore(b, [["Drama", "Romance"]])).toBe(1);
    expect(serendipityScore(a, [["Drama"]])).toBe(0);
  });
});
