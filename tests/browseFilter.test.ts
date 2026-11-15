import { expect, test } from "bun:test";
import type { Meta, MetaPreview, Progress } from "../src/lib/types";

// Prefs (which the hidden-title store reads) load from localStorage.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { browseVisible, NO_RULES, SERIES_CHECKED, showFinished, watchedCandidates } = await import("../src/lib/catalog/browseFilter");
const { HIDDEN_LIMIT, readHiddenTitles, withHidden, withoutHidden, writeHiddenTitles } = await import("../src/lib/library/hiddenTitles");

const title = (id: string): MetaPreview => ({ id, type: "movie", name: `Film ${id}` });
const shelf = ["tt0000001", "tt0000002", "tt0000003", "tt0000004"].map(title);
const rules = (hidden: string[], watched: string[] = []) => ({ hidden: new Set(hidden), watched: new Set(watched) });

test("browseVisible: no rules keep the shelf as it is, the same array", () => {
  expect(browseVisible(shelf, NO_RULES)).toBe(shelf);
  expect(browseVisible(undefined, rules(["tt0000001"]))).toBeUndefined();
});

test("browseVisible: hidden and watched titles both leave, the order stays", () => {
  expect(browseVisible(shelf, rules(["tt0000002"], ["tt0000004"]))?.map((m) => m.id)).toEqual(["tt0000001", "tt0000003"]);
  // Rules about titles not on the shelf change nothing.
  expect(browseVisible(shelf, rules(["tt0000009"]))).toBe(shelf);
});

const played = (metaId: string, type: "movie" | "series", position: number, duration = 100): Progress => ({
  metaId,
  videoId: type === "movie" ? metaId : `${metaId}:1:1`,
  type,
  name: metaId,
  position,
  duration,
  updatedAt: 1,
});

test("watchedCandidates: finished films count; shows only when their latest episode is finished", () => {
  const { movies, series } = watchedCandidates([
    played("tt0000001", "movie", 100),
    played("tt0000002", "movie", 40),
    played("tt0000003", "series", 100),
    played("tt0000004", "series", 10),
  ]);
  expect([...movies]).toEqual(["tt0000001"]);
  expect(series.map((s) => s.id)).toEqual(["tt0000003"]);
});

test("watchedCandidates: only the most recent shows are checked", () => {
  const history = Array.from({ length: SERIES_CHECKED + 5 }, (_, i) => played(`tt${String(i).padStart(7, "0")}`, "series", 100));
  expect(watchedCandidates(history).series).toHaveLength(SERIES_CHECKED);
});

const show: Meta = {
  id: "tt0000005",
  type: "series",
  name: "A Show",
  videos: [
    { id: "tt0000005:1:1", title: "One", season: 1, episode: 1, released: "2001-01-01" },
    { id: "tt0000005:1:2", title: "Two", season: 1, episode: 2, released: "2001-01-08" },
    { id: "tt0000005:0:1", title: "Special", season: 0, episode: 1, released: "2001-01-09" },
  ],
} as Meta;
const ep = (videoId: string, position: number): Progress => ({ ...played(show.id, "series", position), videoId });

test("showFinished: every released episode watched, specials aside", () => {
  expect(showFinished(show, [ep("tt0000005:1:1", 100), ep("tt0000005:1:2", 100)])).toBe(true);
  expect(showFinished(show, [ep("tt0000005:1:1", 100)])).toBe(false);
  expect(showFinished(show, [ep("tt0000005:1:1", 100), ep("tt0000005:1:2", 50)])).toBe(false);
});

test("hidden titles: newest first, one entry per title, unreadable entries dropped", () => {
  let list = withHidden([], title("tt0000001"), 1);
  list = withHidden(list, title("tt0000002"), 2);
  list = withHidden(list, title("tt0000001"), 3);
  expect(list.map((h) => h.id)).toEqual(["tt0000001", "tt0000002"]);
  const stored = writeHiddenTitles(list);
  expect(readHiddenTitles(stored)).toEqual(list);
  expect(readHiddenTitles("not json")).toEqual([]);
  expect(readHiddenTitles(JSON.stringify([{ id: "tt0000003", type: "music", name: "x", at: 1 }, { id: 4 }]))).toEqual([]);
  expect(withoutHidden(list, "tt0000001").map((h) => h.id)).toEqual(["tt0000002"]);
  expect(writeHiddenTitles([])).toBe("");
});

test("hidden titles: capped, the oldest letting go", () => {
  let list = withHidden([], title("tt0000000"), 0);
  for (let i = 1; i <= HIDDEN_LIMIT; i++) list = withHidden(list, title(`tt${String(i).padStart(7, "0")}`), i);
  expect(list).toHaveLength(HIDDEN_LIMIT);
  expect(list.some((h) => h.id === "tt0000000")).toBe(false);
  expect(list[0].id).toBe(`tt${String(HIDDEN_LIMIT).padStart(7, "0")}`);
});
