import { afterEach, expect, test } from "bun:test";
import { afterFailure, clearTries, FREE_TRIES, recordFailure, triesOf, waitAfter, waitLeft, waitText } from "../src/lib/account/pinTries";

const store = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;

afterEach(() => localStorage.removeItem("polar.pinTries"));

test("a few wrong PINs are free; after that the wait doubles, up to an hour", () => {
  expect([0, 1, 2].map(waitAfter)).toEqual([0, 0, 0]);
  expect(FREE_TRIES).toBe(3);
  expect([3, 4, 5, 6].map(waitAfter)).toEqual([30_000, 60_000, 120_000, 240_000]);
  expect(waitAfter(12)).toBe(60 * 60_000);
  expect(waitAfter(100)).toBe(60 * 60_000);
});

test("each wrong PIN counts from its own time", () => {
  let t = { fails: 0, until: 0 };
  for (let i = 0; i < 3; i++) t = afterFailure(t, 1000);
  expect(t).toEqual({ fails: 3, until: 31_000 });
  expect(waitLeft(t, 1000)).toBe(30_000);
  expect(waitLeft(t, 20_000)).toBe(11_000);
  expect(waitLeft(t, 31_000)).toBe(0);
});

test("a clock set back doesn't stretch the wait past what the count calls for", () => {
  expect(waitLeft({ fails: 3, until: 10_000_000 }, 0)).toBe(30_000);
  expect(waitLeft({ fails: 1, until: 10_000_000 }, 0)).toBe(0);
});

test("tries are kept per profile across restarts, and a right PIN clears them", () => {
  for (let i = 0; i < 4; i++) recordFailure("p1", 5_000);
  expect(triesOf("p1")).toEqual({ fails: 4, until: 65_000 });
  expect(triesOf("p2")).toEqual({ fails: 0, until: 0 });
  // What another start of the app reads.
  expect(JSON.parse(localStorage.getItem("polar.pinTries")!)).toEqual({ p1: { fails: 4, until: 65_000 } });
  clearTries("p1");
  expect(triesOf("p1").fails).toBe(0);
  expect(localStorage.getItem("polar.pinTries")).toBeNull();
});

test("a damaged record reads as no tries", () => {
  localStorage.setItem("polar.pinTries", JSON.stringify({ p1: { fails: "x" }, p2: { fails: 2, until: 7 } }));
  expect(triesOf("p1").fails).toBe(0);
  expect(triesOf("p2")).toEqual({ fails: 2, until: 7 });
});

test("the wait reads in seconds, then minutes", () => {
  expect(waitText(1_000)).toBe("Try again in 1 second.");
  expect(waitText(29_500)).toBe("Try again in 30 seconds.");
  expect(waitText(120_000)).toBe("Try again in 2 minutes.");
});
