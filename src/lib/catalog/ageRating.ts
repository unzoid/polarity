/**
 * Age ratings (certifications) as ages, for a profile's viewing limit: US film and TV ratings and the common
 * European ones TMDB returns (UK, Germany, the Netherlands, France). Pure: lib/catalog/viewingLimit.ts reads
 * the limit and applies it.
 */

/** The limits Settings → Browsing offers, as the highest age a title may be rated for. */
export const LIMIT_STEPS = [6, 9, 12, 14, 16] as const;

/** Each rating's minimum age. Numbers on their own ("12", "16+", "FSK 16", "-12") are read as ages. */
const AGES: Record<string, number> = {
  // US films (MPA)
  G: 0,
  PG: 8,
  "PG-13": 13,
  R: 17,
  "NC-17": 18,
  // US TV
  "TV-Y": 0,
  "TV-Y7": 7,
  "TV-Y7-FV": 7,
  "TV-G": 0,
  "TV-PG": 10,
  "TV-14": 14,
  "TV-MA": 17,
  // UK (BBFC); PG as in the US
  U: 0,
  UC: 0,
  "12A": 12,
  R18: 18,
  // Netherlands (Kijkwijzer)
  AL: 0,
  // France ("tous publics")
  TP: 0,
};

/** Ratings that say a title has none. */
const UNRATED = new Set(["NR", "UNRATED", "NOT RATED", "N/A", "-"]);

/** A rating's minimum age; null for no rating or one this table doesn't know. */
export function minAge(certification: string | null | undefined): number | null {
  const c = (certification ?? "").trim().toUpperCase();
  if (!c || UNRATED.has(c)) return null;
  if (c in AGES) return AGES[c];
  const n = /^(?:FSK[\s-]*)?-?(\d{1,2})\+?$/.exec(c);
  return n ? Number(n[1]) : null;
}

/**
 * Whether a title may show under a limit: always without one (`limit` null); with one, when its rating's age is
 * at most the limit, and an unrated title (or one rated in a system this doesn't know) unless `hideUnrated`.
 */
export function allowed(certification: string | null | undefined, limit: number | null, hideUnrated: boolean): boolean {
  if (limit === null) return true;
  const age = minAge(certification);
  return age === null ? !hideUnrated : age <= limit;
}

/** The country whose ratings TMDB is asked for: the metadata language's region (`de-DE` → `DE`), else `US`. */
export function regionOf(language: string | null | undefined): string {
  const region = (language ?? "").split("-")[1]?.trim().toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : "US";
}

/** Each country's film ratings in TMDB's order, lowest first, for TMDB's `certification.lte`. */
const FILM_ORDER: Record<string, string[]> = {
  US: ["G", "PG", "PG-13", "R", "NC-17"],
  GB: ["U", "PG", "12A", "12", "15", "18"],
  DE: ["0", "6", "12", "16", "18"],
  NL: ["AL", "6", "9", "12", "14", "16", "18"],
  FR: ["U", "10", "12", "16", "18"],
};

/**
 * The highest film rating within `limit` in `region`'s system (the US one for a country this doesn't list), for
 * TMDB's discover to leave the rest out; null without a limit.
 */
export function discoverBound(limit: number | null, region: string): { country: string; max: string } | null {
  if (limit === null) return null;
  const country = region in FILM_ORDER ? region : "US";
  const within = FILM_ORDER[country].filter((c) => (minAge(c) ?? Infinity) <= limit);
  const max = within[within.length - 1];
  return max ? { country, max } : null;
}
