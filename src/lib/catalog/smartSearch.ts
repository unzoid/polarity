import type { ContentType, MetaPreview } from "../types";

/**
 * Deterministic zero-LLM natural-language-to-filter AST parser (Netflix #618 "Showing Our Work").
 *
 * Turns casual queries like "90s romcom movies 8+" or "short scifi under 100m" into structured,
 * dismissible filter chips plus a cleaned literal query. Clicking `×` on any chip falls back
 * smoothly to literal search without hidden magic.
 */

export type SearchChipKind = "genre" | "type" | "decade" | "rating" | "runtime";

export interface SearchFilterChip {
  id: string;
  kind: SearchChipKind;
  label: string;
  /** Token slice matched in the user's raw query (for transparency / removal). */
  matched: string;
  genre?: string;
  mediaType?: ContentType | "anime";
  yearRange?: [number, number];
  minRating?: number;
  maxRuntimeMins?: number;
}

export interface ParsedSmartQuery {
  raw: string;
  /** Remaining literal text after stripping recognized filter tokens. */
  textQuery: string;
  chips: SearchFilterChip[];
  genres: string[];
  mediaType?: ContentType | "anime";
  yearRange?: [number, number];
  minRating?: number;
  maxRuntimeMins?: number;
}

/** Controlled vocabulary AKA map: colloquial shorthand -> canonical catalog genres. */
const GENRE_AKAS: readonly [RegExp, readonly string[]][] = [
  [/\brom-?coms?\b/i, ["Romance", "Comedy"]],
  [/\bsci-?fi\b|\bscience\s+fiction\b/i, ["Sci-Fi"]],
  [/\bdocs?\b|\bdocumentar(?:y|ies)\b/i, ["Documentary"]],
  [/\bthrillers?\b|\bsuspense\b/i, ["Thriller"]],
  [/\bhorrors?\b|\bscary\b|\bspooky\b/i, ["Horror"]],
  [/\bcomed(?:y|ies)\b|\bfunny\b/i, ["Comedy"]],
  [/\baction\b/i, ["Action"]],
  [/\bdramas?\b/i, ["Drama"]],
  [/\bromance\b|\bromantic\b/i, ["Romance"]],
  [/\bmyster(?:y|ies)\b|\bwhodunit\b/i, ["Mystery"]],
  [/\bfantasy\b/i, ["Fantasy"]],
  [/\bcrime\b|\bnoir\b|\bheist\b/i, ["Crime"]],
  [/\banimated\b|\banimation\b/i, ["Animation"]],
  [/\badventure\b/i, ["Adventure"]],
  [/\bwesterns?\b/i, ["Western"]],
];

const DECADE_RE = /\b(19[5-9]0|20[0-2]0)s\b|\b([5-9]0)s\b/i;
const RATING_RE = /\b([5-9](?:\.\d)?)\s*\+|\b(?:rated|rating)\s*(?:>=?|above|over)?\s*([5-9](?:\.\d)?)\b|\bhigh(?:ly)?[\s-]rated\b/i;
const RUNTIME_RE = /\b(?:under|<|<=|max|less\s+than)\s*(\d{2,3})\s*(?:m|min|mins|minutes)\b|\b(quick|short)\s+(?:watch|watches|movie|movies|film|films)\b/i;
const TYPE_MOVIE_RE = /\b(movies?|films?)\b/i;
const TYPE_SERIES_RE = /\b(series|shows?|tv\s+shows?|miniseries)\b/i;
const TYPE_ANIME_RE = /\banime\b/i;

/** Parse a user search string into structured filter chips + remaining literal text. */
export function parseSmartQuery(raw: string): ParsedSmartQuery {
  let working = raw.trim();
  const chips: SearchFilterChip[] = [];
  const genres: string[] = [];
  let mediaType: ContentType | "anime" | undefined;
  let yearRange: [number, number] | undefined;
  let minRating: number | undefined;
  let maxRuntimeMins: number | undefined;

  const strip = (m: RegExpMatchArray) => {
    const idx = m.index ?? -1;
    if (idx >= 0) working = `${working.slice(0, idx)} ${working.slice(idx + m[0].length)}`;
  };

  // 1. Decade filter ("90s", "1980s", "2010s")
  const dec = working.match(DECADE_RE);
  if (dec) {
    const start = dec[1] ? Number(dec[1]) : 1900 + Number(dec[2]);
    const end = start + 9;
    yearRange = [start, end];
    chips.push({ id: `decade:${start}`, kind: "decade", label: `${start}s`, matched: dec[0], yearRange });
    strip(dec);
  }

  // 2. Rating floor ("8+", "7.5+", "highly rated")
  const rat = working.match(RATING_RE);
  if (rat) {
    const num = Number(rat[1] ?? rat[2] ?? "7.5");
    if (Number.isFinite(num) && num >= 5 && num <= 9.9) {
      minRating = num;
      chips.push({ id: `rating:${num}`, kind: "rating", label: `${num}+ rating`, matched: rat[0], minRating: num });
      strip(rat);
    }
  }

  // 3. Runtime cap ("under 95m", "< 100 mins", "quick watch")
  const run = working.match(RUNTIME_RE);
  if (run) {
    const mins = run[1] ? Number(run[1]) : 95;
    if (Number.isFinite(mins) && mins >= 20 && mins <= 300) {
      maxRuntimeMins = mins;
      chips.push({ id: `runtime:${mins}`, kind: "runtime", label: `Under ${mins}m`, matched: run[0], maxRuntimeMins: mins });
      strip(run);
    }
  }

  // 4. Media type ("movies", "series", "anime") — only extract as a filter chip when combined with
  // another word so searching literally for "Movie" doesn't empty the query.
  const hasMultipleWords = raw.trim().split(/\s+/).length >= 2;
  if (hasMultipleWords) {
    const mAnime = working.match(TYPE_ANIME_RE);
    const mMovie = working.match(TYPE_MOVIE_RE);
    const mSeries = working.match(TYPE_SERIES_RE);
    if (mAnime) {
      mediaType = "anime";
      chips.push({ id: "type:anime", kind: "type", label: "Anime", matched: mAnime[0], mediaType });
      strip(mAnime);
    } else if (mMovie) {
      mediaType = "movie";
      chips.push({ id: "type:movie", kind: "type", label: "Movies", matched: mMovie[0], mediaType });
      strip(mMovie);
    } else if (mSeries) {
      mediaType = "series";
      chips.push({ id: "type:series", kind: "type", label: "Series", matched: mSeries[0], mediaType });
      strip(mSeries);
    }
  }

  // 5. Controlled-vocabulary genres ("romcom", "scifi", "thrillers", ...)
  // Extract when query has >= 2 words OR matches an AKA shorthand (like "romcom" or "scifi").
  for (const [re, mapped] of GENRE_AKAS) {
    const m = working.match(re);
    if (!m) continue;
    const isExactSingleCanonical =
      !hasMultipleWords && mapped.length === 1 && m[0].toLowerCase() === mapped[0].toLowerCase();
    if (isExactSingleCanonical) continue;
    for (const g of mapped) {
      if (!genres.includes(g)) {
        genres.push(g);
        chips.push({ id: `genre:${g.toLowerCase()}`, kind: "genre", label: g, matched: m[0], genre: g });
      }
    }
    strip(m);
  }

  const textQuery = working.replace(/\s+/g, " ").trim();
  return { raw: raw.trim(), textQuery, chips, genres, mediaType, yearRange, minRating, maxRuntimeMins };
}

function yearOf(item: MetaPreview): number | undefined {
  const m = item.releaseInfo?.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

function ratingOf(item: MetaPreview): number | undefined {
  const n = Number.parseFloat(item.imdbRating ?? "");
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Check whether a candidate `MetaPreview` satisfies a single active smart-search chip. */
export function chipMatchesItem(item: MetaPreview, chip: SearchFilterChip): boolean {
  switch (chip.kind) {
    case "type":
      return chip.mediaType === "anime" ? true : item.type === chip.mediaType;
    case "genre":
      if (!item.genres?.length) return true; // Keep items whose preview lacks genres rather than hiding valid hits.
      return item.genres.some((g) => g.toLowerCase() === chip.genre?.toLowerCase());
    case "decade": {
      if (!chip.yearRange) return true;
      const y = yearOf(item);
      return y != null && y >= chip.yearRange[0] && y <= chip.yearRange[1];
    }
    case "rating": {
      if (chip.minRating == null) return true;
      const r = ratingOf(item);
      return r != null && r >= chip.minRating;
    }
    case "runtime":
      return true; // MetaPreview does not carry runtime; applied when runtime metadata is present (see discover.ts).
  }
}

/** Filter a list of `MetaPreview` items against all active (non-dismissed) smart-search chips. */
export function applySmartFilters(
  items: readonly MetaPreview[] | undefined,
  parsed: ParsedSmartQuery,
  dismissed: ReadonlySet<string> = new Set(),
): MetaPreview[] | undefined {
  if (!items) return items;
  const active = parsed.chips.filter((c) => !dismissed.has(c.id));
  if (!active.length) return [...items];
  return items.filter((item) => active.every((chip) => chipMatchesItem(item, chip)));
}
