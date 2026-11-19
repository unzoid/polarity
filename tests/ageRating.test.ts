import { expect, test } from "bun:test";
import "./storageStub";
import { LIMIT_STEPS, allowed, discoverBound, minAge, regionOf } from "../src/lib/catalog/ageRating";
import { keepWithinLimit } from "../src/lib/catalog/viewingLimit";
import type { MetaPreview } from "../src/lib/types";

test("ageRating: US film and TV ratings as ages", () => {
  expect([minAge("G"), minAge("PG"), minAge("PG-13"), minAge("R"), minAge("NC-17")]).toEqual([0, 8, 13, 17, 18]);
  expect([minAge("TV-Y"), minAge("TV-Y7"), minAge("TV-G"), minAge("TV-PG"), minAge("TV-14"), minAge("TV-MA")]).toEqual([0, 7, 0, 10, 14, 17]);
});

test("ageRating: UK, German, Dutch and French ratings as ages", () => {
  expect([minAge("U"), minAge("12A"), minAge("15"), minAge("18"), minAge("R18")]).toEqual([0, 12, 15, 18, 18]);
  expect([minAge("0"), minAge("6"), minAge("FSK 12"), minAge("16")]).toEqual([0, 6, 12, 16]);
  expect([minAge("AL"), minAge("9"), minAge("14")]).toEqual([0, 9, 14]);
  expect([minAge("TP"), minAge("10"), minAge("-12"), minAge("16+")]).toEqual([0, 10, 12, 16]);
  expect(minAge(" pg-13 ")).toBe(13);
});

test("ageRating: none, NR and ratings it doesn't know count as unrated", () => {
  for (const c of [undefined, null, "", "NR", "Not Rated", "Banned", "M/PG"]) expect(minAge(c)).toBeNull();
});

test("ageRating: allowed under a limit, unrated as the switch says, everything without one", () => {
  expect(allowed("R", null, true)).toBe(true);
  expect(allowed(undefined, null, true)).toBe(true);
  expect(allowed("PG-13", 12, false)).toBe(false);
  expect(allowed("PG-13", 14, false)).toBe(true);
  expect(allowed("TV-14", 14, false)).toBe(true);
  expect(allowed("TV-MA", 16, false)).toBe(false);
  expect(allowed("12", 12, false)).toBe(true);
  expect(allowed(undefined, 12, false)).toBe(true);
  expect(allowed(undefined, 12, true)).toBe(false);
  expect(allowed("NR", 12, true)).toBe(false);
});

test("ageRating: every limit offered falls between ratings cleanly", () => {
  expect(LIMIT_STEPS.every((n) => n > 0 && n < 18)).toBe(true);
  // 6 keeps G and leaves PG out; 9 keeps PG; 12 leaves PG-13 out; 14 keeps it and TV-14; 16 leaves R and TV-MA out.
  expect(allowed("PG", 6, false)).toBe(false);
  expect(allowed("PG", 9, false)).toBe(true);
  expect(allowed("TV-PG", 12, false)).toBe(true);
});

test("ageRating: the region comes from the metadata language, else the US", () => {
  expect(regionOf("de-DE")).toBe("DE");
  expect(regionOf("pt-br")).toBe("BR");
  expect(regionOf("en")).toBe("US");
  expect(regionOf(undefined)).toBe("US");
});

test("ageRating: discover's bound is the highest film rating within the limit, in the region's system", () => {
  expect(discoverBound(null, "US")).toBeNull();
  expect(discoverBound(6, "US")).toEqual({ country: "US", max: "G" });
  expect(discoverBound(12, "US")).toEqual({ country: "US", max: "PG" });
  expect(discoverBound(16, "US")).toEqual({ country: "US", max: "PG-13" });
  expect(discoverBound(12, "GB")).toEqual({ country: "GB", max: "12" });
  expect(discoverBound(14, "DE")).toEqual({ country: "DE", max: "12" });
  expect(discoverBound(9, "NL")).toEqual({ country: "NL", max: "9" });
  expect(discoverBound(9, "FR")).toEqual({ country: "FR", max: "U" });
  // A country without a table here uses the US one.
  expect(discoverBound(14, "BR")).toEqual({ country: "US", max: "PG-13" });
});

test("viewingLimit: a list keeps what's within the limit, and is the same list without one", () => {
  const t = (id: string, certification?: string): MetaPreview => ({ id, type: "movie", name: id, certification });
  const list = [t("tt0000001", "PG"), t("tt0000002", "R"), t("tt0000003")];
  expect(keepWithinLimit(list, { limit: null, hideUnrated: false })).toBe(list);
  expect(keepWithinLimit(list, { limit: 12, hideUnrated: false }).map((m) => m.id)).toEqual(["tt0000001", "tt0000003"]);
  expect(keepWithinLimit(list, { limit: 12, hideUnrated: true }).map((m) => m.id)).toEqual(["tt0000001"]);
});
