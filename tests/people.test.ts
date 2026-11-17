import { describe, expect, test } from "bun:test";
import { bioPreview, extraKind, extraStill, filmography, lifeFacts, personIds } from "../src/lib/catalog/people";
import type { MetaPreview } from "../src/lib/types";

const film = (n: number): MetaPreview => ({ id: `tt000000${n}`, type: "movie", name: `Film ${n}` });

describe("personIds", () => {
  test("names with TMDB ids from cast and crew; Cinemeta's names have none", () => {
    const ids = personIds({
      people: [{ name: "Ada Brennan", tmdbId: 1 }, { name: "Tomas Okafor" }],
      crew: [{ name: "Ines Marchetti", character: "Director", tmdbId: 2 }],
    });
    expect([...ids]).toEqual([
      ["Ada Brennan", 1],
      ["Ines Marchetti", 2],
    ]);
    expect(personIds({ people: [{ name: "Ada Brennan" }] }).size).toBe(0);
    expect(personIds(undefined).size).toBe(0);
  });

  test("a name given two ids is left plain rather than guessed", () => {
    const ids = personIds({ people: [{ name: "Sam Lee", tmdbId: 1 }], crew: [{ name: "Sam Lee", tmdbId: 2 }, { name: "Jo", tmdbId: 3 }] });
    expect(ids.has("Sam Lee")).toBe(false);
    expect(ids.get("Jo")).toBe(3);
    // The same person in both lists is one id.
    expect(personIds({ people: [{ name: "Jo", tmdbId: 3 }], crew: [{ name: "Jo", tmdbId: 3 }] }).get("Jo")).toBe(3);
  });
});

describe("bioPreview", () => {
  test("a short biography is shown whole", () => {
    expect(bioPreview("Born somewhere. Acts.")).toEqual({ text: "Born somewhere. Acts.", more: false });
    expect(bioPreview(undefined)).toEqual({ text: "", more: false });
  });

  test("a long one stops at a sentence, with more to read", () => {
    const bio = "First sentence here. Second one is a bit longer. Third goes on and on and on.";
    expect(bioPreview(bio, 50)).toEqual({ text: "First sentence here. Second one is a bit longer.", more: true });
  });

  test("one sentence longer than the preview is cut at a word", () => {
    const { text, more } = bioPreview("word ".repeat(40).trim(), 30);
    expect(more).toBe(true);
    expect(text.endsWith("word…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(31);
  });
});

describe("lifeFacts", () => {
  test("known for, the dates and the birthplace, the ones there", () => {
    expect(lifeFacts({ knownFor: "Acting", born: "1970-01-14", birthplace: "Example Town" })).toEqual([
      "Acting",
      expect.stringMatching(/^Born .*1970/),
      "Example Town",
    ]);
    expect(lifeFacts({ born: "1920-01-14", died: "1990-06-02" })[0]).toMatch(/1920.* – .*1990/);
    expect(lifeFacts({})).toEqual([]);
  });
});

describe("filmography", () => {
  test("acting first, directing first for a director, empty rows left out", () => {
    const p = { acting: [film(1)], directing: [film(2)] };
    expect(filmography(p).map((r) => r.key)).toEqual(["acting", "directing"]);
    expect(filmography({ ...p, knownFor: "Directing" }).map((r) => r.key)).toEqual(["directing", "acting"]);
    expect(filmography({ acting: [], directing: [film(2)] }).map((r) => r.title)).toEqual(["Directing"]);
    expect(filmography({})).toEqual([]);
  });
});

describe("extras", () => {
  test("a tile's kind and still", () => {
    expect(extraKind("Behind the Scenes")).toBe("Behind the Scenes");
    expect(extraKind(" ")).toBe("Video");
    expect(extraStill({ key: "xxx" })).toBe("https://i.ytimg.com/vi/xxx/mqdefault.jpg");
  });
});
