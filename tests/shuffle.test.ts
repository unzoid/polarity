import { expect, test } from "bun:test";
import { noteShuffled, randomEpisode, shuffledNext, startShuffle } from "../src/lib/playback/shuffle";
import type { Meta, Video } from "../src/lib/types";

const ep = (season: number, episode: number, released?: string): Video => ({ id: `tt0000000:${season}:${episode}`, title: `E${episode}`, season, episode, released });
const meta = {
  id: "tt0000000",
  type: "series",
  name: "A Public Domain Show",
  videos: [ep(0, 1), ep(1, 1), ep(1, 2), ep(1, 3), ep(2, 1), ep(2, 2, "2999-01-01")],
} as Meta;
const out = new Set(["tt0000000:0:1", "tt0000000:2:2"]);

test("a run plays every released regular episode once before any again", () => {
  const first = randomEpisode(meta, () => 0)!;
  startShuffle(meta.id, first.id);
  const order = [first.id];
  let current = first.id;
  for (let i = 0; i < 3; i++) {
    const next = shuffledNext(meta, current)!;
    expect(order).not.toContain(next.id);
    expect(out.has(next.id)).toBe(false);
    noteShuffled(meta.id, next.id);
    order.push(next.id);
    current = next.id;
  }
  expect(new Set(order).size).toBe(4);
  // All four played: the run starts over, never with the one that just played.
  const again = shuffledNext(meta, current)!;
  expect(again.id).not.toBe(current);
  expect(out.has(again.id)).toBe(false);
});

test("a show with one episode has nothing to shuffle to", () => {
  const one = { ...meta, id: "tt0000001", videos: [ep(1, 1)] } as Meta;
  startShuffle(one.id, "tt0000000:1:1");
  expect(shuffledNext(one, "tt0000000:1:1")).toBeUndefined();
});
