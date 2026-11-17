import { beforeEach, describe, expect, test } from "bun:test";
import {
  autoDownloadsNow,
  autoHold,
  MIN_FREE_BYTES,
  episodeClosed,
  episodeWatched,
  nextEpisodes,
  resetAutoDownloads,
  type AutoDeps,
  type AutoSettings,
} from "../src/lib/library/autoDownloads";
import type { Batch } from "../src/lib/library/batchDownloads";
import type { MetaPreview, Video } from "../src/lib/types";

const show: MetaPreview = { id: "tt0000001", type: "series", name: "The Lantern Keepers" };
const ep = (s: number, e: number, released = "2000-01-01"): Video => ({ id: `tt0000001:${s}:${e}`, title: `Chapter ${e}`, season: s, episode: e, released });
const videos = [ep(1, 1), ep(1, 2), ep(0, 1), ep(1, 3), ep(2, 1), ep(2, 2, "2999-01-01")];
const code = (v: Video) => `${v.season}x${v.episode}`;

function fake(settings: AutoSettings, downloaded = ["tt0000001:1:1"]) {
  const runs: string[][] = [];
  const removed: string[] = [];
  let finish: (() => void) | undefined;
  let hold = false;
  const deps: AutoDeps = {
    settings: () => settings,
    downloaded: async (id) => downloaded.includes(id),
    run: async (key, _item, list) => {
      runs.push([key, ...list.map(code)]);
      if (hold) await new Promise<void>((r) => (finish = r));
      return { key, state: "finished", total: list.length, done: list.length, failed: 0 } satisfies Batch;
    },
    remove: async (id) => void removed.push(id),
    sleep: async () => {},
  };
  return { deps, runs, removed, holdRuns: () => (hold = true), finish: () => finish?.() };
}

beforeEach(() => resetAutoDownloads());

describe("keep the next episodes downloaded", () => {
  test("the next released episodes, specials aside, across seasons", () => {
    expect(nextEpisodes(videos, "tt0000001:1:2", 2).map(code)).toEqual(["1x3", "2x1"]);
    expect(nextEpisodes(videos, "tt0000001:1:3", 5).map(code)).toEqual(["2x1"]);
    expect(nextEpisodes(videos, "tt0000001:0:1", 2)).toEqual([]);
    expect(nextEpisodes(videos, "tt0000001:1:1", 0)).toEqual([]);
  });

  test("finishing a downloaded episode queues the next ones and shows them", async () => {
    const f = fake({ keep: 2, removeWatched: false });
    await episodeWatched(show, videos, "tt0000001:1:1", f.deps);
    expect(f.runs).toEqual([["auto:tt0000001", "1x2", "1x3"]]);
    expect([...autoDownloadsNow().ids]).toEqual(["tt0000001:1:2", "tt0000001:1:3"]);
    expect(autoDownloadsNow().runs).toEqual([]);
  });

  test("nothing happens for an episode that isn't downloaded, a movie, or with the setting off", async () => {
    const f = fake({ keep: 3, removeWatched: true }, []);
    await episodeWatched(show, videos, "tt0000001:1:1", f.deps);
    await episodeWatched({ ...show, type: "movie" }, videos, "tt0000001:1:1", f.deps);
    const off = fake({ keep: 0, removeWatched: false });
    await episodeWatched(show, videos, "tt0000001:1:1", off.deps);
    await episodeClosed("tt0000001:1:1", f.deps);
    expect([...f.runs, ...off.runs]).toEqual([]);
    expect(f.removed).toEqual([]);
  });

  test("a second finished episode while a run is going is queued after it, the newest list only", async () => {
    const f = fake({ keep: 1, removeWatched: false }, ["tt0000001:1:1", "tt0000001:1:2", "tt0000001:1:3"]);
    f.holdRuns();
    const first = episodeWatched(show, videos, "tt0000001:1:1", f.deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(autoDownloadsNow().runs.map((r) => r.videos.map(code))).toEqual([["1x2"]]);
    await episodeWatched(show, videos, "tt0000001:1:2", f.deps);
    await episodeWatched(show, videos, "tt0000001:1:3", f.deps);
    expect(f.runs).toHaveLength(1);
    f.finish();
    await new Promise((r) => setTimeout(r, 0));
    f.finish();
    await first;
    expect(f.runs).toEqual([
      ["auto:tt0000001", "1x2"],
      ["auto:tt0000001", "2x1"],
    ]);
  });

  test("with removal on, the watched episode goes once the player closes it", async () => {
    const f = fake({ keep: 0, removeWatched: true });
    await episodeWatched(show, videos, "tt0000001:1:1", f.deps);
    expect(f.removed).toEqual([]);
    await episodeClosed("tt0000001:1:1", f.deps);
    await episodeClosed("tt0000001:1:1", f.deps);
    expect(f.removed).toEqual(["tt0000001:1:1"]);
  });

  test("waits on mobile data, stops when space runs low", () => {
    expect(autoHold(true, null)).toMatchObject({ kind: "wait" });
    expect(autoHold(false, MIN_FREE_BYTES - 1)).toMatchObject({ kind: "stop" });
    expect(autoHold(false, MIN_FREE_BYTES * 10)).toBeNull();
    expect(autoHold(false, null)).toBeNull();
  });
});
