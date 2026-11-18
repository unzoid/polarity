import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { api } from "../api";
import { readCached, writeCached } from "../net/deviceCache";
import { concurrency } from "../net/limiter";
import { keys } from "../net/queryKeys";
import { isRecord } from "../parse";
import type { ContentType } from "../types";
import { factsOf, type TitleFacts } from "./libraryView";

/**
 * Year, genres, rating and last episode of the library's titles, for its filters and sorts. Looked up
 * through the same metadata query the title pages use (and share its cache), a few at a time, then kept
 * on this device (`deviceCache`, never synced) so the next visit has them at once. Nothing is added to
 * library items or sent anywhere.
 */

/** Lookups in flight at once; the rest queue (the Calendar keeps its own six). */
const lookup = concurrency(4);
/** How long kept facts count: a show's last episode moves on as new ones air. */
const FRESH = 7 * 86_400_000;
const CACHE_KEY = "library-facts";
const CACHE_AGE = 90 * 86_400_000;

type Kept = TitleFacts & { at: number };

let kept: Map<string, Kept> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function readKept(c: unknown): Kept | undefined {
  if (!isRecord(c) || typeof c.at !== "number" || !Array.isArray(c.genres)) return undefined;
  const k: Kept = { at: c.at, genres: c.genres.filter((g): g is string => typeof g === "string").slice(0, 20) };
  if (typeof c.year === "number") k.year = c.year;
  if (typeof c.rating === "number") k.rating = c.rating;
  if (typeof c.lastEpisode === "string") k.lastEpisode = c.lastEpisode;
  return k;
}

function keptFacts(): Map<string, Kept> {
  if (kept) return kept;
  kept = new Map();
  const raw = readCached(CACHE_KEY, CACHE_AGE)?.data;
  if (isRecord(raw)) {
    for (const [id, c] of Object.entries(raw)) {
      const k = readKept(c);
      if (k) kept.set(id, k);
    }
  }
  return kept;
}

function keep(id: string, facts: TitleFacts, now = Date.now()) {
  keptFacts().set(id, { ...facts, at: now });
  // Many arrive together: write once they've settled.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeCached(CACHE_KEY, Object.fromEntries(keptFacts())), 1500);
}

export interface TitleRefLike {
  id: string;
  type: ContentType;
}

/**
 * Facts for each title by id: kept ones at once, the rest as their lookups come back. A title whose
 * lookup failed gets empty facts, so it stops counting as "still looking" (and is looked up again next visit).
 */
export function useTitleFacts(titles: TitleRefLike[], enabled = true): ReadonlyMap<string, TitleFacts> {
  const now = Date.now();
  const store = keptFacts();
  const seen = new Set<string>();
  const missing = titles.filter((t) => {
    const k = store.get(t.id);
    if (k && now - k.at <= FRESH) return false;
    const key = `${t.type}:${t.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const results = useQueries({
    queries: missing.map((t) => ({
      queryKey: keys.meta(t.type, t.id),
      queryFn: () => lookup(() => api.meta(t.type, t.id)),
      staleTime: 60 * 60_000,
      enabled,
    })),
  });
  // Recompute only when a lookup settles.
  const stamp = results.map((r) => (r.isSuccess ? "s" : r.isError ? "e" : "-")).join("");
  useEffect(() => {
    results.forEach((r, i) => {
      if (r.data) keep(missing[i].id, factsOf(r.data));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  const ids = titles.map((t) => t.id).join(",");
  return useMemo(() => {
    const out = new Map<string, TitleFacts>();
    for (const t of titles) {
      const k = store.get(t.id);
      if (k) out.set(t.id, k);
    }
    results.forEach((r, i) => {
      if (r.data) out.set(missing[i].id, factsOf(r.data));
      else if (r.isError && !out.has(missing[i].id)) out.set(missing[i].id, { genres: [] });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, stamp]);
}
