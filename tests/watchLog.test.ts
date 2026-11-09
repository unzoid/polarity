import { expect, test } from "bun:test";

import { createWatchLog } from "../src/lib/playback/watchLog";

test("each line has its time since the player opened and the position in the video (#424)", () => {
  const log = createWatchLog();
  log.reset(Date.UTC(2026, 10, 8, 20), 1000);
  log.add(1500, "buffering (cache 0.0 s ahead)", 3725.2);
  log.add(4000, "window lost focus");
  const text = log.text(["Polarity 1.0.0 · Windows · player: mpv"]);
  expect(text.split("\n").slice(0, 3)).toEqual([
    "Polarity watch log",
    "Polarity 1.0.0 · Windows · player: mpv",
    "Started 2026-11-08T20:00:00.000Z; each line has the seconds since then and the position in the video.",
  ]);
  expect(text).toContain("+    0.500   1:02:05.2  buffering (cache 0.0 s ahead)");
  expect(text).toContain("+    3.000           -  window lost focus");
});

test("no links, keys or folders get in: hosts only", () => {
  const log = createWatchLog();
  log.reset(0, 0);
  log.add(1, "source: direct file https://media.example.com/film.mkv?token=xxx from /home/someone/Videos");
  const text = log.text();
  expect(text).not.toContain("token");
  expect(text).not.toContain("film.mkv");
  expect(text).not.toContain("someone");
  expect(text).toContain("media.example.com");
});

test("a long video keeps its newest lines", () => {
  const log = createWatchLog(3);
  log.reset(0, 0);
  for (let i = 0; i < 5; i++) log.add(i, `line ${i}`);
  expect(log.lines().map((l) => l.text)).toEqual(["line 2", "line 3", "line 4"]);
  expect(log.text()).toContain("(older lines dropped)");
});

test("before anything played there's nothing to copy", () => {
  expect(createWatchLog().text()).toBe("Nothing played yet.");
});
