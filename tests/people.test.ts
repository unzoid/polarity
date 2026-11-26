import { describe, expect, test } from "bun:test";
import { bioPreview, creditLines, extraKind, extraStill, filmography, knownForLines, lifeFacts, personFacts, personIds, professions, yearsBetween } from "../src/lib/catalog/people";
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

describe("a person's page", () => {
  const now = new Date(2026, 10, 25);
  const show = (n: number, year: string): MetaPreview => ({ id: `tt100000${n}`, type: "series", name: `Show ${n}`, releaseInfo: year });

  test("an age counts whole years, to the death when there is one", () => {
    expect(yearsBetween("1969-08-11", undefined, now)).toBe(57);
    expect(yearsBetween("1969-11-26", undefined, now)).toBe(56);
    expect(yearsBetween("1920-01-14", "1990-01-13")).toBe(69);
    expect(yearsBetween(undefined)).toBeUndefined();
    expect(yearsBetween("unknown")).toBeUndefined();
  });

  test("the facts card: born with the age, or died with the age they reached", () => {
    const living = personFacts({ born: "1969-08-11", birthplace: "Example Town", knownFor: "Acting" }, now);
    expect(living.map(([k]) => k)).toEqual(["Born", "Birthplace", "Known for"]);
    expect(living[0][1]).toMatch(/1969 \(age 57\)$/);
    const gone = personFacts({ born: "1920-01-14", died: "1990-06-02" }, now);
    expect(gone[0][1]).not.toMatch(/age/);
    expect(gone[1]).toEqual(["Died", expect.stringMatching(/1990 \(aged 70\)$/)]);
    expect(personFacts({}, now)).toEqual([]);
  });

  test("what they do, the lead first", () => {
    expect(professions({ acting: [film(1)], directing: [film(2)] })).toEqual(["Actor", "Director"]);
    expect(professions({ acting: [film(1)], directing: [film(2)], knownFor: "Creator" })).toEqual(["Creator", "Actor"]);
  });

  test("credits are newest first with their parts, undated ones last", () => {
    const p = {
      acting: [film(1), show(2, "2013–2023"), { ...film(3), releaseInfo: "2011" }],
      roles: [
        { id: "tt1000002", list: "acting" as const, name: "Nora", episodes: 24 },
        { id: "tt0000003", list: "acting" as const, name: "Bryony (voice)" },
        { id: "tt0000003", list: "directing" as const, name: "Director" },
      ],
    };
    const lines = creditLines(p, filmography(p)[0]);
    expect(lines.map((l) => [l.item.name, l.year, l.role, l.episodes])).toEqual([
      ["Show 2", 2013, "Nora", 24],
      ["Film 3", 2011, "Bryony (voice)", undefined],
      ["Film 1", undefined, undefined, undefined],
    ]);
  });

  test("known for: the most notable, guest parts in shows last", () => {
    const p = {
      acting: [show(1, "2005"), film(2), show(3, "2014"), film(4)],
      roles: [
        { id: "tt1000001", list: "acting" as const, episodes: 1 },
        { id: "tt1000003", list: "acting" as const, episodes: 40 },
      ],
    };
    expect(knownForLines(p, 3).map((l) => l.item.name)).toEqual(["Film 2", "Show 3", "Film 4"]);
    expect(knownForLines(p).map((l) => l.item.name)).toEqual(["Film 2", "Show 3", "Film 4", "Show 1"]);
    expect(knownForLines({})).toEqual([]);
  });
});

describe("extras", () => {
  test("a tile's kind and still", () => {
    expect(extraKind("Behind the Scenes")).toBe("Behind the Scenes");
    expect(extraKind(" ")).toBe("Video");
    expect(extraStill({ key: "xxx" })).toBe("https://i.ytimg.com/vi/xxx/mqdefault.jpg");
  });
});
