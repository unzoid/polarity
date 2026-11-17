import { expect, test } from "bun:test";
import { nextVideo, previousVideo } from "../../src/lib/library/episodes";
import type { Meta, Video } from "../../src/lib/types";

const ep = (season: number, episode: number, released?: string): Video => ({ id: `tt0000000:${season}:${episode}`, title: `E${episode}`, season, episode, released });
const meta = {
  id: "tt0000000",
  type: "series",
  name: "A Public Domain Show",
  videos: [ep(0, 1), ep(1, 1), ep(1, 2), ep(2, 1), ep(2, 2, "2999-01-01")],
} as Meta;

test("the episode before crosses back into the last season, never into specials", () => {
  expect(previousVideo(meta, "tt0000000:2:1")?.id).toBe("tt0000000:1:2");
  expect(previousVideo(meta, "tt0000000:1:2")?.id).toBe("tt0000000:1:1");
  expect(previousVideo(meta, "tt0000000:1:1")).toBeUndefined();
  expect(previousVideo(meta, "nope")).toBeUndefined();
});

test("next and previous mirror each other over released episodes", () => {
  expect(nextVideo(meta, "tt0000000:1:2")?.id).toBe("tt0000000:2:1");
  // Not out yet: no next.
  expect(nextVideo(meta, "tt0000000:2:1")).toBeUndefined();
});
