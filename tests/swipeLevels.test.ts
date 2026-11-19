import { describe, expect, test } from "bun:test";
import { SWIPE_EDGES, SWIPE_SPAN, SWIPE_START, swipeAxis, swipeLevel, swipeSide } from "../src/components/player/useSwipeLevels";
import { brightnessFor } from "../src/lib/platform/brightness";

describe("swipeSide", () => {
  const w = 800;
  const h = 400;
  test("the left half is brightness, the right half volume", () => {
    expect(swipeSide(200, 200, w, h)).toBe("left");
    expect(swipeSide(600, 200, w, h)).toBe("right");
  });
  test("the system's edges never start one", () => {
    expect(swipeSide(SWIPE_EDGES.side - 1, 200, w, h)).toBeNull();
    expect(swipeSide(w - SWIPE_EDGES.side + 1, 200, w, h)).toBeNull();
    expect(swipeSide(200, SWIPE_EDGES.top - 1, w, h)).toBeNull();
    expect(swipeSide(200, h - SWIPE_EDGES.bottom + 1, w, h)).toBeNull();
    expect(swipeSide(200, 200, 0, 0)).toBeNull();
  });
});

describe("swipeAxis", () => {
  test("too short to tell, until past the start (and past the hold's slop)", () => {
    expect(SWIPE_START).toBeGreaterThan(12);
    expect(swipeAxis(0, SWIPE_START - 1)).toBeUndefined();
    expect(swipeAxis(0, SWIPE_START)).toBe("vertical");
  });
  test("mostly up or down is vertical; sideways or diagonal is not", () => {
    expect(swipeAxis(5, -30)).toBe("vertical");
    expect(swipeAxis(30, 5)).toBe("horizontal");
    expect(swipeAxis(20, 20)).toBe("horizontal");
  });
});

describe("swipeLevel", () => {
  test("up raises, down lowers, by the share of the picture travelled", () => {
    expect(swipeLevel(0.5, -400 * SWIPE_SPAN * 0.25, 400)).toBe(0.75);
    expect(swipeLevel(0.5, 400 * SWIPE_SPAN * 0.25, 400)).toBe(0.25);
  });
  test("stays within 0 and the top, which may be past 100%", () => {
    expect(swipeLevel(0.9, -400, 400)).toBe(1);
    expect(swipeLevel(0.1, 400, 400)).toBe(0);
    expect(swipeLevel(1, -400, 400, 1.5)).toBe(1.5);
  });
  test("a picture with no height leaves it where it was", () => {
    expect(swipeLevel(0.4, -100, 0)).toBe(0.4);
  });
});

describe("brightnessFor", () => {
  test("desktop and a browser have none", async () => {
    const b = brightnessFor("windows", true, {});
    expect(b.available).toBe(false);
    expect(await b.read()).toBeNull();
  });
  test("Android without the bridge has none", () => {
    expect(brightnessFor("android", true, {}).available).toBe(false);
  });
  test("Android reads the window's level and sends changes as messages", async () => {
    const posted: string[] = [];
    const b = brightnessFor("android", true, { polarDevice: { brightness: () => 0.4 }, polarActions: { postMessage: (m) => void posted.push(m) } });
    expect(b.available).toBe(true);
    expect(await b.read()).toBe(0.4);
    b.set(0.25);
    b.set(2);
    b.restore();
    expect(posted).toEqual(["brightness:0.250", "brightness:1.000", "brightness:off"]);
  });
  test("an older Android web view calls the interface", () => {
    const calls: number[] = [];
    const b = brightnessFor("android", true, { polarDevice: { brightness: () => Number.NaN, setBrightness: (n) => void calls.push(n) } });
    b.set(0.5);
    b.restore();
    expect(calls).toEqual([0.5, -1]);
  });
  test("an unreadable level is null", async () => {
    const b = brightnessFor("android", true, { polarDevice: { brightness: () => Number.NaN } });
    expect(await b.read()).toBeNull();
  });
});
