import { describe, expect, test } from "bun:test";
import { PAUSE_SCREEN_CAST, pauseDetails, pauseScreenAllowed, type PauseScreenState } from "../src/lib/playback/pauseScreen";
import type { Meta } from "../src/lib/types";

const idle: PauseScreenState = {
  enabled: true,
  engine: "mpv",
  playing: true,
  paused: true,
  ended: false,
  buffering: false,
  controls: false,
  layer: false,
  nextUp: false,
  notice: false,
  casting: false,
  stepping: false,
  details: true,
};

describe("pauseScreenAllowed", () => {
  test("paused, the controls gone and nothing else up: allowed, over mpv and the built-in player", () => {
    expect(pauseScreenAllowed(idle)).toBe(true);
    expect(pauseScreenAllowed({ ...idle, engine: "html" })).toBe(true);
  });

  test("never over YouTube's player, nor before an engine is chosen", () => {
    expect(pauseScreenAllowed({ ...idle, engine: "youtube" })).toBe(false);
    expect(pauseScreenAllowed({ ...idle, engine: null })).toBe(false);
  });

  test("not while playing, loading, buffering or at the end", () => {
    expect(pauseScreenAllowed({ ...idle, paused: false })).toBe(false);
    expect(pauseScreenAllowed({ ...idle, playing: false })).toBe(false);
    expect(pauseScreenAllowed({ ...idle, buffering: true })).toBe(false);
    expect(pauseScreenAllowed({ ...idle, ended: true })).toBe(false);
  });

  test("not while the controls, a menu or panel, Up Next, a notice, casting or a stepped frame is up", () => {
    for (const k of ["controls", "layer", "nextUp", "notice", "casting", "stepping"] as const) {
      expect([k, pauseScreenAllowed({ ...idle, [k]: true })]).toEqual([k, false]);
    }
  });

  test("not with the setting off or nothing to show", () => {
    expect(pauseScreenAllowed({ ...idle, enabled: false })).toBe(false);
    expect(pauseScreenAllowed({ ...idle, details: false })).toBe(false);
  });
});

const meta: Meta = {
  id: "tt0000001",
  type: "series",
  name: "The Example Show",
  logo: "https://images.example.com/logo.png",
  description: "A show about examples.",
  videos: [
    { id: "tt0000001:1:1", title: "Pilot", season: 1, episode: 1, overview: "The first example." },
    { id: "tt0000001:1:2", title: "Second", season: 1, episode: 2 },
  ],
  people: Array.from({ length: 9 }, (_, i) => ({ name: `Actor ${i}`, character: `Role ${i}`, photo: i % 2 ? undefined : `https://images.example.com/${i}.jpg` })),
};

describe("pauseDetails", () => {
  test("an episode: its code, title and own overview; the first cast members", () => {
    const d = pauseDetails(meta, "tt0000001:1:1")!;
    expect(d.name).toBe("The Example Show");
    expect(d.logo).toBe("https://images.example.com/logo.png");
    expect(d.episode).toEqual({ code: "S1, E1", title: "Pilot" });
    expect(d.overview).toBe("The first example.");
    expect(d.cast).toHaveLength(PAUSE_SCREEN_CAST);
    expect(d.cast[0]).toEqual({ name: "Actor 0", character: "Role 0", photo: "https://images.example.com/0.jpg" });
  });

  test("an episode without an overview takes the show's", () => {
    expect(pauseDetails(meta, "tt0000001:1:2")!.overview).toBe("A show about examples.");
  });

  test("a film: no episode line; no cast, an empty row; unnamed people left out", () => {
    const film: Meta = { id: "tt0000002", type: "movie", name: "An Example Film", videos: [], people: [{ name: " " }, { name: "Ada Example" }] };
    const d = pauseDetails(film, "tt0000002")!;
    expect(d.episode).toBeUndefined();
    expect(d.overview).toBeUndefined();
    expect(d.cast.map((p) => p.name)).toEqual(["Ada Example"]);
    expect(pauseDetails({ ...film, people: undefined }, "tt0000002")!.cast).toEqual([]);
  });

  test("nothing before the title has loaded", () => {
    expect(pauseDetails(undefined, "tt0000002")).toBeUndefined();
  });
});
