import { describe, expect, test } from "bun:test";
import { filterEpisodes } from "../src/desk/EpisodeTools";
import type { Video } from "../src/lib/types";

const eps: Video[] = [
  { id: "tt1:1:1", season: 1, episode: 1, title: "Romance Dawn", overview: "Luffy sets sail." },
  { id: "tt1:1:42", season: 1, episode: 42, title: "Bursting Out", overview: "Arlong Park battle." },
  { id: "tt1:1:483", season: 1, episode: 483, title: "Looking for the Answer", overview: "Marineford climax." },
  { id: "tt1:2:1015", season: 2, episode: 1015, title: "Straw Hat Luffy", overview: "Rooftop arrival on Onigashima." },
];

describe("filterEpisodes", () => {
  test("returns all episodes when query is blank", () => {
    expect(filterEpisodes(eps, "   ")).toHaveLength(4);
  });

  test("matches episode numbers with or without prefixes", () => {
    expect(filterEpisodes(eps, "483").map((e) => e.episode)).toEqual([483]);
    expect(filterEpisodes(eps, "ep 42").map((e) => e.episode)).toEqual([42]);
    expect(filterEpisodes(eps, "#1015").map((e) => e.episode)).toEqual([1015]);
    expect(filterEpisodes(eps, "s2e1015").map((e) => e.episode)).toEqual([1015]);
    expect(filterEpisodes(eps, "s1e1015")).toEqual([]);
  });

  test("matches by title or overview case-insensitively", () => {
    expect(filterEpisodes(eps, "romance").map((e) => e.episode)).toEqual([1]);
    expect(filterEpisodes(eps, "onigashima").map((e) => e.episode)).toEqual([1015]);
  });

  test("supports custom display episode numbering", () => {
    const custom = new Map<string, number>([["tt1:1:42", 99]]);
    expect(filterEpisodes(eps, "99", (v) => custom.get(v.id) ?? v.episode).map((e) => e.id)).toEqual(["tt1:1:42"]);
  });
});
