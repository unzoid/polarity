import { expect, test } from "bun:test";
import { CastMedia } from "../../src/components/player/chromecast";

const status = (cast: number, state: "loading" | "playing" | "paused", position: number, duration: number | null = 600) =>
  ({ kind: "status", cast, state, position, duration, volume: null, muted: null }) as const;

test("the TV's status becomes the events and state a <video> would have", () => {
  const m = new CastMedia(120, 0.5);
  m.id = 3;
  const seen: string[] = [];
  for (const e of ["loadedmetadata", "play", "playing", "pause", "waiting", "ended"]) m.addEventListener(e, () => seen.push(e));
  expect(m.currentTime).toBe(120);
  expect(m.paused).toBe(false); // loading: on its way to playing
  m.update(status(3, "playing", 121));
  expect(seen).toEqual(["loadedmetadata", "play", "playing"]);
  expect(m.duration).toBe(600);
  expect(m.paused).toBe(false);
  m.update(status(3, "paused", 130));
  expect(m.paused).toBe(true);
  expect(m.currentTime).toBe(130);
  // Another cast's late answer changes nothing.
  m.update(status(2, "playing", 5));
  expect(m.currentTime).toBe(130);
  m.update({ kind: "ended", cast: 3, reason: "finished" });
  expect(m.ended).toBe(true);
  expect(seen.at(-1)).toBe("ended");
  expect(m.volume).toBe(0.5);
});

test("while the TV plays, the time moves on between its reports", async () => {
  const m = new CastMedia(0);
  m.id = 1;
  m.update(status(1, "playing", 10));
  await new Promise((r) => setTimeout(r, 60));
  expect(m.currentTime).toBeGreaterThan(10.03);
  expect(m.currentTime).toBeLessThan(11);
});
