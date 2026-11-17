import { describe, expect, test } from "bun:test";
import { batchFor, cancelBatch, pauseBatch, resumeBatch, runBatch, type BatchDeps, type Hold } from "../src/lib/library/batchDownloads";
import type { DownloadState } from "../src/lib/library/downloads";
import type { MetaPreview, RankedStream, Video } from "../src/lib/types";

const show: MetaPreview = { id: "tt0000001", type: "series", name: "The Lantern Keepers" };
const ep = (e: number): Video => ({ id: `tt0000001:1:${e}`, title: `Chapter ${e}`, season: 1, episode: e });
const source = (url?: string) => ({ stream: url ? { url } : { ytId: "x" } }) as RankedStream;

/** Downloads that finish after `ticks` polls; every call recorded. */
function fakeDownloads(initial: Record<string, DownloadState> = {}, ticks = 2) {
  const state = new Map(Object.entries(initial));
  const left = new Map<string, number>();
  const log: string[] = [];
  let onSleep = () => {};
  const deps: BatchDeps = {
    sources: async (v) => (v.episode === 3 ? [source()] : [source(), source(`https://media.example.com/${v.episode}.mkv`)]),
    start: async (_, v, pick) => {
      log.push(`start ${v.episode} ${pick.stream.url}`);
      state.set(v.id, "downloading");
      left.set(v.id, ticks);
      return null;
    },
    status: async (id) => {
      const s = state.get(id);
      if (s === "downloading") {
        const n = left.get(id)! - 1;
        left.set(id, n);
        if (n <= 0) state.set(id, "done");
      }
      return state.has(id) ? { state: state.get(id)!, fraction: 0.5 } : undefined;
    },
    pause: async (id) => void (log.push(`pause ${id.split(":")[2]}`), state.set(id, "paused")),
    resume: async (id) => void (log.push(`resume ${id.split(":")[2]}`), state.set(id, "downloading")),
    remove: async (id) => void (log.push(`remove ${id.split(":")[2]}`), state.delete(id)),
    sleep: async () => onSleep(),
  };
  return { deps, state, log, setOnSleep: (f: () => void) => (onSleep = f) };
}

describe("season and show downloads (#24)", () => {
  test("one episode at a time, skipping downloaded ones and those with no downloadable source", async () => {
    const f = fakeDownloads({ "tt0000001:1:2": "done" });
    const b = await runBatch("a", show, [ep(1), ep(2), ep(3), ep(4)], f.deps);
    expect(f.log).toEqual(["start 1 https://media.example.com/1.mkv", "start 4 https://media.example.com/4.mkv"]);
    expect(b).toMatchObject({ state: "finished", total: 4, done: 3, failed: 1 });
  });

  test("pausing pauses the episode coming down; resuming goes on", async () => {
    const f = fakeDownloads({}, 3);
    let sleeps = 0;
    f.setOnSleep(() => {
      sleeps++;
      if (sleeps === 1) pauseBatch("b");
      if (sleeps === 3) {
        expect(batchFor("b")?.state).toBe("paused");
        resumeBatch("b");
      }
    });
    const b = await runBatch("b", show, [ep(1), ep(2)], f.deps);
    expect(f.log).toEqual(["start 1 https://media.example.com/1.mkv", "pause 1", "resume 1", "start 2 https://media.example.com/2.mkv"]);
    expect(b).toMatchObject({ state: "finished", done: 2 });
  });

  test("cancelling removes the episode coming down and starts no more; finished ones stay", async () => {
    const f = fakeDownloads({}, 2);
    let sleeps = 0;
    f.setOnSleep(() => {
      if (++sleeps === 2) cancelBatch("c");
    });
    const b = await runBatch("c", show, [ep(1), ep(2), ep(4)], f.deps);
    expect(f.log).toEqual(["start 1 https://media.example.com/1.mkv", "start 2 https://media.example.com/2.mkv", "remove 2"]);
    expect(f.state.get("tt0000001:1:1")).toBe("done");
    expect(b).toMatchObject({ state: "cancelled", done: 1 });
  });

  test("a batch running already isn't started twice", async () => {
    const f = fakeDownloads({}, 2);
    let second: unknown;
    f.setOnSleep(() => {
      second ??= runBatch("d", show, [ep(1)], f.deps);
    });
    await runBatch("d", show, [ep(1)], f.deps);
    expect(f.log.filter((l) => l.startsWith("start"))).toHaveLength(1);
    expect(await second).toMatchObject({ state: "running" });
  });
});

describe("holds and runs side by side", () => {
  test("a hold that waits is asked again; one that stops ends the batch before the next start", async () => {
    const f = fakeDownloads();
    const answers: (Hold | null)[] = [{ kind: "wait", reason: "Waiting for Wi-Fi" }, null, { kind: "stop", reason: "Stopped: not enough free space" }];
    const seen: (Hold | undefined)[] = [];
    f.deps.hold = async () => {
      seen.push(batchFor("h")?.held);
      return answers.shift() ?? null;
    };
    const b = await runBatch("h", show, [ep(1), ep(2), ep(4)], f.deps);
    expect(f.log).toEqual(["start 1 https://media.example.com/1.mkv"]);
    expect(seen[1]).toMatchObject({ kind: "wait" });
    expect(b).toMatchObject({ state: "finished", done: 1, held: { kind: "stop", reason: "Stopped: not enough free space" } });
  });

  test("a downloaded episode never asks the hold", async () => {
    const f = fakeDownloads({ "tt0000001:1:1": "done" });
    f.deps.hold = async () => ({ kind: "stop", reason: "x" });
    const b = await runBatch("i", show, [ep(1)], f.deps);
    expect(b).toMatchObject({ state: "finished", done: 1 });
    expect(b.held).toBeUndefined();
  });

  test("two runs over the same episode start it once", async () => {
    const f = fakeDownloads({}, 3);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sources = f.deps.sources;
    // The first run is still finding a source when the second reaches the episode; it waits, then follows.
    f.deps.sources = async (v) => (await gate, sources(v));
    f.setOnSleep(() => release());
    const [a, b] = await Promise.all([runBatch("j", show, [ep(1)], f.deps), runBatch("k", show, [ep(1)], f.deps)]);
    expect(f.log.filter((l) => l.startsWith("start"))).toEqual(["start 1 https://media.example.com/1.mkv"]);
    expect([a.done, b.done]).toEqual([1, 1]);
  });
});
