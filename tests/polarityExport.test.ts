import { beforeAll, describe, expect, test } from "bun:test";
import type { AnimeLink } from "../src/lib/library/identity";
import type { LibraryItem, Progress } from "../src/lib/types";

/** playlists.ts (which the export reads its limits from) keeps its state in localStorage from the moment it loads. */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let ex: typeof import("../src/lib/library/polarityExport");
let pl: typeof import("../src/lib/library/playlists");
beforeAll(async () => {
  ex = await import("../src/lib/library/polarityExport");
  pl = await import("../src/lib/library/playlists");
});

/** What crates/library/src/export.rs writes. */
const doc = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    app: "polarity",
    version: 1,
    exportedAt: 1000,
    library: [{ id: "tt0000001", type: "series", name: "Made-up Show", addedAt: 100 }],
    progress: [
      {
        metaId: "tt0000001",
        videoId: "tt0000001:1:2",
        type: "series",
        name: "Made-up Show",
        season: 1,
        episode: 2,
        episodeTitle: "Two",
        position: 600,
        duration: 1200,
        updatedAt: 300,
        // Never written by Polarity; a hand-edited file's is dropped all the same.
        stream: { url: "https://media.example.com/film.mkv" },
      },
    ],
    animeLinks: [{ canonical: "tt0000001", anilist: 7, kitsu: 70, updatedAt: 50 }],
    playlists: [{ id: "p1", name: "Weekend", updatedAt: 5, items: [{ id: "tt0000002", type: "movie", name: "Film" }] }],
    ...over,
  });

describe("reading a Polarity export", () => {
  test("a file Polarity wrote reads back whole, without a source", () => {
    const read = ex.readPolarityExport(doc());
    expect(read.version).toBe(1);
    expect(read.library).toHaveLength(1);
    expect(read.progress[0]).toMatchObject({ videoId: "tt0000001:1:2", season: 1, episode: 2, updatedAt: 300 });
    expect(read.progress[0]).not.toHaveProperty("stream");
    expect(read.animeLinks).toEqual([{ canonical: "tt0000001", anilist: 7, kitsu: 70, updatedAt: 50 }]);
    expect(read.playlists[0].items).toEqual([{ id: "tt0000002", type: "movie", name: "Film" }]);
    expect(read.unreadable).toBe(0);
  });

  test("another kind of file, or a newer version, is refused with a reason", () => {
    expect(() => ex.readPolarityExport("not json")).toThrow("isn't JSON");
    expect(() => ex.readPolarityExport("[]")).toThrow("isn't a Polarity export");
    expect(() => ex.readPolarityExport(doc({ app: "other" }))).toThrow("isn't a Polarity export");
    expect(() => ex.readPolarityExport(doc({ version: 2 }))).toThrow("newer version");
    expect(() => ex.readPolarityExport(doc({ version: undefined }))).toThrow("no version");
    expect(() => ex.readPolarityExport(doc({ version: -1 }))).toThrow("no version");
    expect(() => ex.readPolarityExport(doc({ library: undefined }))).toThrow("incomplete");
    expect(() => ex.readPolarityExport(doc({ progress: {} }))).toThrow("incomplete");
  });

  test("entries that don't fit are counted and left out; missing links and playlists are fine", () => {
    const read = ex.readPolarityExport(
      doc({
        library: [{ id: "tt0000001", type: "series", name: "A", addedAt: 1 }, { id: "tt0000002", type: "game", name: "B", addedAt: 1 }, "x"],
        progress: [{ metaId: "tt0000001", videoId: "tt0000001", type: "movie", name: "A", position: "1", duration: 2, updatedAt: 3 }],
        animeLinks: undefined,
        playlists: undefined,
      }),
    );
    expect(read.library.map((i) => i.id)).toEqual(["tt0000001"]);
    expect(read.progress).toEqual([]);
    expect(read.animeLinks).toEqual([]);
    expect(read.playlists).toEqual([]);
    expect(read.unreadable).toBe(3);
  });
});

describe("importing it", () => {
  test("links go first, then library and history, then playlists; a second import adds nothing", async () => {
    const calls: string[] = [];
    const links = new Map<number, AnimeLink>();
    const progress = new Map<string, Progress>();
    const library = new Map<string, LibraryItem>();
    const deps = {
      importAnimeLinks: async (ls: AnimeLink[]) => {
        calls.push("links");
        const fresh = ls.filter((l) => (links.get(l.anilist)?.updatedAt ?? -1) < l.updatedAt);
        fresh.forEach((l) => links.set(l.anilist, l));
        return fresh.length;
      },
      importLibrary: async (items: LibraryItem[], rows: Progress[]) => {
        calls.push("library");
        const newItems = items.filter((i) => !library.has(i.id));
        newItems.forEach((i) => library.set(i.id, i));
        const newRows = rows.filter((p) => (progress.get(p.videoId)?.updatedAt ?? -1) < p.updatedAt);
        newRows.forEach((p) => progress.set(p.videoId, p));
        return { library: newItems.length, progress: newRows.length };
      },
      importPlaylists: (p: Parameters<typeof pl.importPlaylists>[0]) => (calls.push("playlists"), pl.importPlaylists(p)),
    };
    const read = ex.readPolarityExport(doc());
    const added = await ex.importPolarityExport(read, deps);
    expect(calls).toEqual(["links", "library", "playlists"]);
    expect(added).toEqual({ library: 1, progress: 1, links: 1, playlists: 1 });
    expect(ex.describeImport(added)).toBe("Added 1 library title, 1 history entry, 1 playlist and 1 anime link.");

    const again = await ex.importPolarityExport(read, deps);
    expect(again).toEqual({ library: 0, progress: 0, links: 0, playlists: 0 });
    expect(ex.describeImport(again, 2)).toBe("Nothing new: everything in the file is already here, or newer here. 2 entries couldn't be read.");
  });

  test("a playlist edited here after the export keeps the edit", () => {
    pl.setPlaylistSpace("p-newer");
    const mine = pl.createPlaylist("Mine")!;
    expect(pl.importPlaylists([{ id: mine.id, name: "Older", updatedAt: mine.updatedAt - 1, items: [] }])).toBe(0);
    expect(pl.importPlaylists([{ id: mine.id, name: "Newer", updatedAt: mine.updatedAt + 1, items: [] }])).toBe(1);
    const saved = JSON.parse(store.get("polar.playlists.p-newer") ?? "null");
    expect(saved.playlists[0].name).toBe("Newer");
    expect(saved.dirty).toEqual([mine.id]);
  });

  test("only readable, live playlists are exported, without their extra fields", () => {
    const list = ex.exportablePlaylists([
      { id: "a", name: "A", updatedAt: 1, items: [{ id: "tt0000001", type: "movie", name: "X" }] },
      { id: "b", name: "B", updatedAt: 1, items: [], deleted: true },
      { id: "c", name: "C", updatedAt: 1, items: [], packed: "\\x01" },
    ]);
    expect(list.map((p) => p.id)).toEqual(["a"]);
  });
});
