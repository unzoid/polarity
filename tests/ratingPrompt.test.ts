import { describe, expect, test } from "bun:test";
import "./storageStub";
import { dismissRating, lastReleased, ratingDismissed, shouldAskRating, type RatingAskState } from "../src/lib/playback/ratingPrompt";
import type { Meta } from "../src/lib/types";

const film: RatingAskState = {
  enabled: true,
  ended: true,
  type: "movie",
  lastReleased: true,
  nextUp: false,
  follower: false,
  local: false,
  link: false,
  shuffle: false,
  dismissed: false,
  services: [{ linked: true, known: true, rating: null }],
};

describe("shouldAskRating", () => {
  test("a film that ended, unrated on a linked service: asked", () => {
    expect(shouldAskRating(film)).toBe(true);
  });

  test("only once it has ended", () => {
    expect(shouldAskRating({ ...film, ended: false })).toBe(false);
  });

  test("a show: only after its last released episode", () => {
    expect(shouldAskRating({ ...film, type: "series", lastReleased: true })).toBe(true);
    expect(shouldAskRating({ ...film, type: "series", lastReleased: false })).toBe(false);
  });

  test("never with Up Next up, for a party follower, a local file, a link, a shuffle, dismissed or switched off", () => {
    for (const k of ["nextUp", "follower", "local", "link", "shuffle", "dismissed"] as const) {
      expect([k, shouldAskRating({ ...film, [k]: true })]).toEqual([k, false]);
    }
    expect(shouldAskRating({ ...film, enabled: false })).toBe(false);
  });

  test("nothing with no service linked", () => {
    expect(shouldAskRating({ ...film, services: [] })).toBe(false);
    expect(shouldAskRating({ ...film, services: [{ linked: false, known: true, rating: null }] })).toBe(false);
  });

  test("not when rated on any linked service, nor when no linked service has read its ratings yet", () => {
    expect(shouldAskRating({ ...film, services: [{ linked: true, known: true, rating: 7 }] })).toBe(false);
    expect(
      shouldAskRating({
        ...film,
        services: [
          { linked: true, known: true, rating: null },
          { linked: true, known: true, rating: 9 },
        ],
      }),
    ).toBe(false);
    expect(shouldAskRating({ ...film, services: [{ linked: true, known: false, rating: null }] })).toBe(false);
    // An unlinked service's rating doesn't count.
    expect(
      shouldAskRating({
        ...film,
        services: [
          { linked: true, known: true, rating: null },
          { linked: false, known: false, rating: 9 },
        ],
      }),
    ).toBe(true);
  });
});

const past = "2000-01-01T00:00:00.000Z";
const future = "2999-01-01T00:00:00.000Z";
const show: Meta = {
  id: "tt0000003",
  type: "series",
  name: "The Example Show",
  videos: [
    { id: "s0e1", title: "Special", season: 0, episode: 1, released: past },
    { id: "s1e1", title: "One", season: 1, episode: 1, released: past },
    { id: "s1e2", title: "Two", season: 1, episode: 2, released: past },
    { id: "s1e3", title: "Three", season: 1, episode: 3, released: future },
  ],
};

describe("lastReleased", () => {
  test("the last episode out, with one still to come after it", () => {
    expect(lastReleased(show, "s1e2")).toBe(true);
    expect(lastReleased(show, "s1e1")).toBe(false);
  });
  test("a special is never the end; an unknown episode or no meta isn't either", () => {
    expect(lastReleased(show, "s0e1")).toBe(false);
    expect(lastReleased(show, "nope")).toBe(false);
    expect(lastReleased(undefined, "s1e2")).toBe(false);
  });
});

describe("dismissed titles", () => {
  test("kept on the device, each once, the newest last", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(ratingDismissed("tt0000001", storage)).toBe(false);
    dismissRating("tt0000001", storage);
    dismissRating("tt0000002", storage);
    dismissRating("tt0000001", storage);
    expect(ratingDismissed("tt0000001", storage)).toBe(true);
    expect(ratingDismissed("tt0000003", storage)).toBe(false);
    expect(JSON.parse(map.get("polar.ratingDismissed")!)).toEqual(["tt0000002", "tt0000001"]);
  });
  test("a damaged entry reads as none", () => {
    const storage = { getItem: () => "{oops", setItem: () => {} };
    expect(ratingDismissed("tt0000001", storage)).toBe(false);
  });
});
