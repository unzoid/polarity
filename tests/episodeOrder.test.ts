import { describe, expect, test } from "bun:test";
import type { EpisodeOrder } from "../src/lib/library/episodeOrder";
import type { Meta, Progress, Video } from "../src/lib/types";

// The watched threshold and the remembered choice read localStorage as they load.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { firstInOrder, LEFTOVER_LABEL, nextInOrder, orderLabel, orderView, previousInOrder, shelfGroupOf, shelfGroups } = await import(
  "../src/lib/library/episodeOrder"
);
const { readChosen, withChoice } = await import("../src/lib/library/episodeOrderChoice");
const { seasonsOf, upNext } = await import("../src/lib/library/episodes");

const ep = (season: number, episode: number, released = "2020-01-01"): Video => ({
  id: `tt0000001:${season}:${episode}`,
  title: `Made Up ${season}x${episode}`,
  season,
  episode,
  released,
});

// Aired: a special, then two seasons of two; the last not out yet.
const videos = [ep(0, 1), ep(1, 1), ep(1, 2), ep(2, 1), ep(2, 2, "2999-01-01")];
const meta = { id: "tt0000001", type: "series", name: "Made Up Show", videos } as Meta;
const id = (s: number, e: number) => `tt0000001:${s}:${e}`;

const order: EpisodeOrder = {
  id: "aa01",
  name: "Story Order",
  kind: "storyArc",
  groups: [
    // The special first, then season 2's first episode before season 1's.
    { name: "Prologue", episodes: [id(0, 1)] },
    { name: "Arc One", episodes: [id(2, 1), id(1, 1), id(9, 9)] },
    // A repeat, and a group with nothing the aired list has.
    { name: "Arc Two", episodes: [id(1, 1), id(2, 2)] },
    { name: "Gone", episodes: [id(8, 1)] },
  ],
};
// Season 1's second episode isn't in the order.
const view = orderView(order, videos);

const ids = (list: (Video | undefined)[]) => list.map((v) => v?.id);
const progress = (videoId: string, position: number, updatedAt = 1): Progress => ({ metaId: "tt0000001", videoId, position, duration: 100, updatedAt }) as Progress;

describe("orderView", () => {
  test("groups follow the order, each episode once where it first appears, unknown ids dropped", () => {
    expect(view.groups.map((g) => [g.id, g.label, ids(g.videos)])).toEqual([
      [1, "Prologue", [id(0, 1)]],
      [2, "Arc One", [id(2, 1), id(1, 1)]],
      [3, "Arc Two", [id(2, 2)]],
      [4, LEFTOVER_LABEL, [id(1, 2)]],
    ]);
    expect(view.groups.at(-1)?.leftover).toBe(true);
    expect(ids(view.sequence)).toEqual([id(0, 1), id(2, 1), id(1, 1), id(2, 2), id(1, 2)]);
  });

  test("episodes are numbered by their place in their group, and keep their aired ids", () => {
    expect(view.number.get(id(1, 1))).toBe(2);
    expect(view.number.get(id(2, 1))).toBe(1);
    expect(view.groupOf.get(id(1, 2))).toBe(4);
    // The videos are the aired ones, untouched: sources, progress and downloads go by these.
    expect(view.sequence.find((v) => v.id === id(1, 1))).toBe(videos[1]);
  });

  test("an order naming every episode has no leftover group; an unnamed group gets a name", () => {
    const all = orderView({ ...order, groups: [{ name: " ", episodes: videos.map((v) => v.id) }] }, videos);
    expect(all.groups.map((g) => g.label)).toEqual(["Part 1"]);
  });

  test("an order with nothing the list has leaves every episode reachable", () => {
    const none = orderView({ ...order, groups: [{ name: "X", episodes: [id(7, 7)] }] }, videos);
    expect(none.groups.map((g) => g.label)).toEqual([LEFTOVER_LABEL]);
    expect(none.sequence).toHaveLength(videos.length);
  });
});

describe("next and previous in an order", () => {
  test("next crosses groups, passes over the unreleased and the left-out ones", () => {
    expect(nextInOrder(view, id(0, 1))?.id).toBe(id(2, 1));
    expect(nextInOrder(view, id(2, 1))?.id).toBe(id(1, 1));
    // 2x2 isn't out yet and 1x2 is outside the order.
    expect(nextInOrder(view, id(1, 1))).toBeUndefined();
    expect(nextInOrder(view, "tt0000001:5:5")).toBeUndefined();
  });

  test("previous goes back through the order; in the leftovers, only among them", () => {
    expect(previousInOrder(view, id(1, 1))?.id).toBe(id(2, 1));
    expect(previousInOrder(view, id(0, 1))).toBeUndefined();
    expect(previousInOrder(view, id(1, 2))).toBeUndefined();
  });

  test("the order starts at its first released episode, a special if it puts one first", () => {
    expect(firstInOrder(view)?.id).toBe(id(0, 1));
  });
});

describe("upNext with an order", () => {
  test("nothing watched: the order's start; as aired: season 1", () => {
    expect(upNext(meta, [], view).video?.id).toBe(id(0, 1));
    expect(upNext(meta, []).video?.id).toBe(id(1, 1));
  });

  test("after a finished episode, the next one in the order", () => {
    const done = [progress(id(2, 1), 100)];
    expect(upNext(meta, done, view)).toMatchObject({ kind: "next", video: { id: id(1, 1) } });
    // As aired, season 2's first is followed by its second, which isn't out: back to the start.
    expect(upNext(meta, done).kind).toBe("start");
  });

  test("an unfinished episode resumes whatever the order", () => {
    expect(upNext(meta, [progress(id(1, 1), 50)], view)).toMatchObject({ kind: "resume", resumeAt: 50, video: { id: id(1, 1) } });
  });
});

describe("what the season picker lists", () => {
  test("seasons as aired, specials last; an order's groups when chosen", () => {
    const aired = shelfGroups(videos, seasonsOf(meta));
    expect(aired.map((g) => [g.id, g.videos.length])).toEqual([
      [1, 2],
      [2, 2],
      [0, 1],
    ]);
    expect(shelfGroups(videos, seasonsOf(meta), view)).toBe(view.groups);
    expect(shelfGroupOf(videos[1], view)).toBe(2);
    expect(shelfGroupOf(videos[1])).toBe(1);
  });
});

test("an order's label names its type unless its name already does", () => {
  expect(orderLabel({ name: "DVD Order", kind: "dvd" })).toBe("DVD Order");
  expect(orderLabel({ name: "Collector's Set", kind: "dvd" })).toBe("Collector's Set · DVD");
  expect(orderLabel({ name: "", kind: "absolute" })).toBe("Absolute");
});

describe("the remembered choice", () => {
  test("keeps well-formed entries only", () => {
    expect(readChosen({ tt1: { order: "aa", at: 1 }, tt2: { order: 3 }, tt3: "x" })).toEqual({ tt1: { order: "aa", at: 1 } });
    expect(readChosen(null)).toEqual({});
  });

  test("as aired removes a show; past the limit the least recently chosen go", () => {
    let chosen = withChoice({}, "tt1", "aa", 1, 2);
    chosen = withChoice(chosen, "tt2", "bb", 2, 2);
    chosen = withChoice(chosen, "tt3", "cc", 3, 2);
    expect(Object.keys(chosen).sort()).toEqual(["tt2", "tt3"]);
    expect(withChoice(chosen, "tt2", null, 4, 2)).toEqual({ tt3: { order: "cc", at: 3 } });
  });
});
