import { describe, expect, test } from "bun:test";
import { nowPlayingText } from "../src/lib/playback/nowPlaying";

describe("Now Playing words on phones (#461)", () => {
  test("a film shows its name alone", () => {
    expect(nowPlayingText("The Lantern Keepers")).toEqual({ title: "The Lantern Keepers" });
  });

  test("an episode shows its own title, the show and its number under it", () => {
    expect(nowPlayingText("The Lantern Keepers", { season: 2, episode: 5, title: "The Long Night" })).toEqual({
      title: "The Long Night",
      subtitle: "The Lantern Keepers · S2 E5",
    });
  });

  test("an episode without a title of its own shows the show", () => {
    expect(nowPlayingText("The Lantern Keepers", { season: 1, episode: 3 })).toEqual({ title: "The Lantern Keepers", subtitle: "S1 E3" });
    expect(nowPlayingText("The Lantern Keepers", { season: 1, episode: 3, title: "  " })).toEqual({ title: "The Lantern Keepers", subtitle: "S1 E3" });
    expect(nowPlayingText("The Lantern Keepers", { season: 1, episode: 3, title: "The Lantern Keepers" })).toEqual({
      title: "The Lantern Keepers",
      subtitle: "S1 E3",
    });
  });

  test("specials are named as such", () => {
    expect(nowPlayingText("The Lantern Keepers", { season: 0, episode: 2, title: "Winter Lights" }).subtitle).toBe("The Lantern Keepers · Special 2");
  });
});
