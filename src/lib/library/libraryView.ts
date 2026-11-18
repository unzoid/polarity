import { storeLocal } from "../errors";
import { isRecord, storedJson } from "../parse";
import type { ContentType, Meta, Progress } from "../types";

/**
 * Library → Saved and Watched in full: search, filters and sorts (pure; the page and TV draw them).
 *
 * Year, genres and rating aren't kept on library items (the server holds names and ids only), so they come
 * from the title's metadata, looked up on this device (`titleFacts.ts`). Until a title's facts are in, a filter
 * or sort that needs them keeps the title (at the end, for a sort) rather than hiding it: `undecided` counts
 * those, and the page says it's still looking.
 */

export type LibraryCollectionName = "saved" | "watched";
export type KindFilter = "all" | ContentType;
export type TitleStatus = "unstarted" | "progress" | "watched";
export type StatusFilter = "any" | TitleStatus;
export type LibrarySort = "added" | "title" | "year" | "watched" | "rating";

/** What the metadata says about a title, as far as the library needs it. */
export interface TitleFacts {
  year?: number;
  genres: string[];
  /** IMDb's rating, out of 10. */
  rating?: number;
  /** A show's last released episode (specials aside): watching it to the end makes the show watched. */
  lastEpisode?: string;
}

/** What a collection page remembers on this device. */
export interface LibraryView {
  kind: KindFilter;
  status: StatusFilter;
  /** "" = any genre. */
  genre: string;
  /** The decade's first year (1990 = the 1990s); 0 = any year. */
  decade: number;
  sort: LibrarySort;
}

/** The view plus the search text, which isn't remembered. */
export interface LibraryFilters extends LibraryView {
  query: string;
}

/** One title of a collection, with what's known about it. */
export interface LibraryEntry<T> {
  item: T;
  id: string;
  type: ContentType;
  name: string;
  /** When it was saved (Saved only). */
  addedAt?: number;
  /** The latest video played of it, if any. */
  progress?: Progress;
  /** Whether `progress` was watched to the end (Settings → Playback decides how far that is). */
  finished?: boolean;
  /** Undefined while its metadata hasn't been looked up yet. */
  facts?: TitleFacts;
}

export const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "Shows" },
];

export const STATUS_LABELS: Record<StatusFilter, string> = {
  any: "Any Status",
  unstarted: "Not Started",
  progress: "In Progress",
  watched: "Watched",
};

export const SORT_LABELS: Record<LibrarySort, string> = {
  added: "Recently Added",
  title: "Title",
  year: "Release Year",
  watched: "Recently Watched",
  rating: "Rating",
};

/** The statuses a collection can hold: everything in Watched has been started. */
export const statusesOf = (c: LibraryCollectionName): StatusFilter[] =>
  c === "saved" ? ["any", "unstarted", "progress", "watched"] : ["any", "progress", "watched"];

/** The sorts a collection offers, its default first. Watched has no "added" date of its own. */
export const sortsOf = (c: LibraryCollectionName): LibrarySort[] =>
  c === "saved" ? ["added", "title", "year", "watched", "rating"] : ["watched", "title", "year", "rating"];

export const defaultView = (c: LibraryCollectionName): LibraryView => ({ kind: "all", status: "any", genre: "", decade: 0, sort: sortsOf(c)[0] });

// --- Facts from metadata ------------------------------------------------------------------------

/** A title's year, genres, rating and last episode from its metadata. `now` decides what has aired. */
export function factsOf(meta: Pick<Meta, "type" | "releaseInfo" | "imdbRating" | "genres" | "details" | "videos">, now = Date.now()): TitleFacts {
  const yearText = /\b(\d{4})\b/.exec(meta.releaseInfo ?? "")?.[1] ?? /^(\d{4})/.exec(meta.details?.released ?? "")?.[1];
  const year = yearText ? Number(yearText) : undefined;
  const rating = Number.parseFloat(meta.imdbRating ?? "");
  const genres = [...new Set((meta.genres ?? []).map((g) => g.trim()).filter(Boolean))];
  const facts: TitleFacts = { genres };
  if (year && year > 1800) facts.year = year;
  if (Number.isFinite(rating) && rating > 0) facts.rating = rating;
  if (meta.type === "series") {
    const aired = (meta.videos ?? [])
      .filter((v) => v.season > 0 && (!v.released || new Date(v.released).getTime() <= now))
      .sort((a, b) => a.season - b.season || a.episode - b.episode);
    const last = aired[aired.length - 1];
    if (last) facts.lastEpisode = last.id;
  }
  return facts;
}

// --- Status -------------------------------------------------------------------------------------

/**
 * Not started (nothing played), in progress, or watched: a movie played to the end, a show whose last aired
 * episode was. Undefined for a show finished up to an episode while its episode list isn't in yet.
 */
export function statusOf(e: Pick<LibraryEntry<unknown>, "type" | "progress" | "finished" | "facts">): TitleStatus | undefined {
  if (!e.progress) return "unstarted";
  if (!e.finished) return "progress";
  if (e.type === "movie") return "watched";
  if (!e.facts) return undefined;
  return !e.facts.lastEpisode || e.facts.lastEpisode === e.progress.videoId ? "watched" : "progress";
}

// --- Filtering and sorting ----------------------------------------------------------------------

/** Ignores case and accents, so "amelie" finds "Amélie". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

const words = (query: string) => fold(query).split(/\s+/).filter(Boolean);

/** Every word is in the name, a genre (once known) or is the year. */
function matchesQuery(e: LibraryEntry<unknown>, ws: string[]) {
  if (!ws.length) return true;
  const name = fold(e.name);
  const genres = (e.facts?.genres ?? []).map(fold);
  const year = e.facts?.year ? String(e.facts.year) : "";
  return ws.every((w) => name.includes(w) || genres.some((g) => g.includes(w)) || w === year);
}

/** A filter that can hide titles, by the part of the view that sets it. */
export type FilterPart = "kind" | "status" | "genre" | "decade" | "query";

/** Yes, no, or can't tell yet (the facts it needs aren't in). */
type Verdict = boolean | undefined;

function verdict(e: LibraryEntry<unknown>, part: FilterPart, f: LibraryFilters): Verdict {
  switch (part) {
    case "kind":
      return f.kind === "all" || e.type === f.kind;
    case "status": {
      if (f.status === "any") return true;
      const s = statusOf(e);
      return s === undefined ? undefined : s === f.status;
    }
    case "genre":
      if (!f.genre) return true;
      return e.facts ? e.facts.genres.some((g) => g.toLowerCase() === f.genre.toLowerCase()) : undefined;
    case "decade":
      if (!f.decade) return true;
      return e.facts ? !!e.facts.year && e.facts.year >= f.decade && e.facts.year < f.decade + 10 : undefined;
    case "query":
      return matchesQuery(e, words(f.query));
  }
}

const PARTS: FilterPart[] = ["kind", "status", "genre", "decade", "query"];

/** The filters the view has turned on. */
export function activeParts(f: LibraryFilters): FilterPart[] {
  return PARTS.filter((p) =>
    p === "kind" ? f.kind !== "all" : p === "status" ? f.status !== "any" : p === "genre" ? !!f.genre : p === "decade" ? !!f.decade : !!f.query.trim(),
  );
}

const without = (f: LibraryFilters, part: FilterPart): LibraryFilters => {
  const d = { kind: "all", status: "any", genre: "", decade: 0, query: "" } as const;
  return { ...f, [part]: d[part] };
};

function keep<T>(entries: LibraryEntry<T>[], f: LibraryFilters) {
  const parts = activeParts(f);
  const shown: LibraryEntry<T>[] = [];
  let undecided = 0;
  for (const e of entries) {
    let unsure = false;
    let out = false;
    for (const p of parts) {
      const v = verdict(e, p, f);
      if (v === false) {
        out = true;
        break;
      }
      if (v === undefined) unsure = true;
    }
    if (out) continue;
    shown.push(e);
    if (unsure) undecided++;
  }
  return { shown, undecided };
}

const byTitle = (a: LibraryEntry<unknown>, b: LibraryEntry<unknown>) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Newest first; what has no value goes after everything that has one, in the order it came. */
function sortEntries<T>(entries: LibraryEntry<T>[], sort: LibrarySort): LibraryEntry<T>[] {
  if (sort === "title") return [...entries].sort(byTitle);
  const value = (e: LibraryEntry<T>): number | undefined => {
    switch (sort) {
      case "added":
        return e.addedAt ?? e.progress?.updatedAt;
      case "watched":
        return e.progress ? e.progress.updatedAt : undefined;
      case "year":
        return e.facts?.year;
      case "rating":
        return e.facts?.rating;
    }
  };
  const indexed = entries.map((e, i) => ({ e, i, v: value(e) }));
  indexed.sort((a, b) => {
    if (a.v === undefined || b.v === undefined) return a.v === b.v ? a.i - b.i : a.v === undefined ? 1 : -1;
    return b.v - a.v || (sort === "added" || sort === "watched" ? a.i - b.i : byTitle(a.e, b.e));
  });
  return indexed.map((x) => x.e);
}

export interface Arranged<T> {
  items: T[];
  /** Titles shown only because the facts a filter needs aren't in yet. */
  undecided: number;
}

/** The collection as the view shows it: filtered, then sorted. */
export function arrangeLibrary<T>(entries: LibraryEntry<T>[], f: LibraryFilters): Arranged<T> {
  const { shown, undecided } = keep(entries, f);
  return { items: sortEntries(shown, f.sort).map((e) => e.item), undecided };
}

/**
 * When nothing is left: the filters that hide everything. Those that alone let something back in when
 * turned off; if no single one does, every one that's on.
 */
export function hidingParts(entries: LibraryEntry<unknown>[], f: LibraryFilters): FilterPart[] {
  const parts = activeParts(f);
  // A title still being looked up doesn't count as letting something back in.
  const alone = parts.filter((p) => {
    const { shown, undecided } = keep(entries, without(f, p));
    return shown.length - undecided > 0;
  });
  return alone.length ? alone : parts;
}

/** The view with every filter off; the sort stays. */
export const clearFilters = (f: LibraryFilters): LibraryFilters => ({ ...f, kind: "all", status: "any", genre: "", decade: 0, query: "" });

// --- Options from what's known ------------------------------------------------------------------

/** Genres of the titles whose facts are in, A to Z; `keep` (the chosen one) stays listed even before its titles are. */
export function genreOptions(entries: LibraryEntry<unknown>[], keepGenre = ""): string[] {
  const seen = new Map<string, string>();
  for (const e of entries) for (const g of e.facts?.genres ?? []) if (!seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
  if (keepGenre && !seen.has(keepGenre.toLowerCase())) seen.set(keepGenre.toLowerCase(), keepGenre);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Decades of the titles whose facts are in, newest first; `keep` stays listed. */
export function decadeOptions(entries: LibraryEntry<unknown>[], keepDecade = 0): number[] {
  const set = new Set<number>();
  for (const e of entries) if (e.facts?.year) set.add(Math.floor(e.facts.year / 10) * 10);
  if (keepDecade) set.add(keepDecade);
  return [...set].sort((a, b) => b - a);
}

/** Whether the view needs titles' metadata: anything but type, the "added"/"title"/"watched" sorts and a status any movie can answer. */
export const needsFacts = (f: LibraryView) => f.status !== "any" || !!f.genre || !!f.decade || f.sort === "year" || f.sort === "rating";

// --- Remembered on this device ------------------------------------------------------------------

const viewKey = (c: LibraryCollectionName | "tv") => `polar.library.view.${c}`;

/** The saved view of a collection, each part checked (anything unknown falls back to the default). */
export function readLibraryView(c: LibraryCollectionName, storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage, key: LibraryCollectionName | "tv" = c): LibraryView {
  const d = defaultView(c);
  const v = storedJson(storage, viewKey(key));
  if (!isRecord(v)) return d;
  return {
    kind: KIND_OPTIONS.some((o) => o.value === v.kind) ? (v.kind as KindFilter) : d.kind,
    status: statusesOf(c).includes(v.status as StatusFilter) ? (v.status as StatusFilter) : d.status,
    genre: typeof v.genre === "string" && v.genre.length <= 60 ? v.genre : d.genre,
    decade: typeof v.decade === "number" && Number.isInteger(v.decade) && v.decade % 10 === 0 && v.decade >= 1800 && v.decade <= 2200 ? v.decade : d.decade,
    sort: sortsOf(c).includes(v.sort as LibrarySort) ? (v.sort as LibrarySort) : d.sort,
  };
}

export function saveLibraryView(c: LibraryCollectionName | "tv", view: LibraryView, storage?: Pick<Storage, "setItem">) {
  storeLocal(viewKey(c), JSON.stringify(view), storage);
}
