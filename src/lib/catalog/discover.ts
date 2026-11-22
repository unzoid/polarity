import { storeLocal } from "../errors";
import { storedJson } from "../parse";
import type { ContentType, MetaPreview } from "../types";
import { scoreCandidate, type SessionIntent, type TasteProfile } from "./taste";

/**
 * Zero-LLM Steerable TV Discover (Netflix #671): remote-friendly mood/constraint chips
 * with deterministic 1-line rationales, narrower drill-down chips, and one-press
 * "Not interested" local memory.
 */

export type DiscoverMoodId = "quick" | "thrillers" | "miniseries" | "watchlist" | "gems";
export type DrillDownId = "90s" | "2010s" | "animated" | "scifi" | "highRated";

export interface DiscoverChip {
  id: DiscoverMoodId;
  label: string;
  description: string;
}

export interface DrillDownChip {
  id: DrillDownId;
  label: string;
}

export const DISCOVER_CHIPS: readonly DiscoverChip[] = [
  { id: "quick", label: "Quick Watches", description: "Tight films under 100 minutes" },
  { id: "thrillers", label: "High-Rated Thrillers", description: "Tense thrillers & mysteries rated 7.2+" },
  { id: "miniseries", label: "Finishable Series", description: "Self-contained shows you can finish fast" },
  { id: "watchlist", label: "Unwatched Watchlist", description: "Saved to your library, not started yet" },
  { id: "gems", label: "Hidden Gems", description: "Critically loved picks outside your recent history" },
];

export const DRILL_DOWN_CHIPS: readonly DrillDownChip[] = [
  { id: "90s", label: "90s" },
  { id: "2010s", label: "2010s+" },
  { id: "animated", label: "Animated" },
  { id: "scifi", label: "Sci-Fi" },
  { id: "highRated", label: "8.0+" },
];

export interface DiscoverCandidate {
  item: MetaPreview;
  /** Optional known runtime in minutes (e.g. from cached full Meta). */
  runtimeMins?: number;
  /** Optional known episode count for series. */
  episodeCount?: number;
}

export interface SteeredPick {
  item: MetaPreview;
  score: number;
  /** Deterministic 1-line rationale shown under the focused card. */
  rationale: string;
}

const NOT_INTERESTED_KEY = "polar.discover.notInterested";
const MAX_NOT_INTERESTED = 200;

export function loadNotInterested(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): string[] {
  if (!storage) return [];
  const raw = storedJson(storage, NOT_INTERESTED_KEY);
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, MAX_NOT_INTERESTED) : [];
}

export function markNotInterested(id: string, storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage): string[] {
  const prev = loadNotInterested(storage).filter((x) => x !== id);
  const next = [id, ...prev].slice(0, MAX_NOT_INTERESTED);
  if (storage) storeLocal(NOT_INTERESTED_KEY, JSON.stringify(next), storage);
  return next;
}

export function clearNotInterested(storage: Pick<Storage, "removeItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.removeItem(NOT_INTERESTED_KEY);
  } catch {
    /* ignore */
  }
}

function yearOf(item: MetaPreview): number | undefined {
  const m = item.releaseInfo?.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

function ratingOf(item: MetaPreview): number | undefined {
  const n = Number.parseFloat(item.imdbRating ?? "");
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function hasGenre(item: MetaPreview, ...targets: string[]): boolean {
  const lower = targets.map((t) => t.toLowerCase());
  return (item.genres ?? []).some((g) => lower.includes(g.toLowerCase()));
}

function matchesMood(c: DiscoverCandidate, mood: DiscoverMoodId, libraryIds: ReadonlySet<string>, watchedIds: ReadonlySet<string>): boolean {
  const { item } = c;
  const r = ratingOf(item);
  switch (mood) {
    case "quick":
      return item.type === "movie" && (c.runtimeMins != null ? c.runtimeMins <= 100 : true);
    case "thrillers":
      return hasGenre(item, "Thriller", "Mystery", "Crime") && (r == null || r >= 7.2);
    case "miniseries":
      return item.type === "series" && (c.episodeCount == null || c.episodeCount <= 12);
    case "watchlist":
      return libraryIds.has(item.id) && !watchedIds.has(item.id);
    case "gems":
      return !watchedIds.has(item.id) && r != null && r >= 7.3 && r <= 8.5;
  }
}

function matchesDrillDown(item: MetaPreview, d: DrillDownId): boolean {
  const y = yearOf(item);
  const r = ratingOf(item);
  switch (d) {
    case "90s":
      return y != null && y >= 1990 && y <= 1999;
    case "2010s":
      return y != null && y >= 2010;
    case "animated":
      return hasGenre(item, "Animation");
    case "scifi":
      return hasGenre(item, "Sci-Fi", "Science Fiction");
    case "highRated":
      return r != null && r >= 8.0;
  }
}

function buildRationale(
  c: DiscoverCandidate,
  mood: DiscoverMoodId,
  taste: TasteProfile | undefined,
  libraryIds: ReadonlySet<string>,
): string {
  const parts: string[] = [];
  if (mood === "watchlist" || libraryIds.has(c.item.id)) {
    parts.push("In your watchlist");
  } else if (taste && taste.sampleSize > 0 && c.item.genres?.length) {
    const topGenre = [...c.item.genres].sort(
      (a, b) => (taste.genres.get(b.toLowerCase()) ?? 0) - (taste.genres.get(a.toLowerCase()) ?? 0),
    )[0];
    if (topGenre && (taste.genres.get(topGenre.toLowerCase()) ?? 0) > 0.15) {
      parts.push(`Matches your ${topGenre} taste`);
    }
  }
  if (!parts.length) {
    parts.push(DISCOVER_CHIPS.find((x) => x.id === mood)?.label ?? "Picked for you");
  }
  if (c.runtimeMins != null && c.item.type === "movie") parts.push(`${c.runtimeMins} min`);
  if (c.episodeCount != null && c.item.type === "series") parts.push(`${c.episodeCount} eps`);
  const r = ratingOf(c.item);
  if (r != null) parts.push(`★ ${r.toFixed(1)}`);
  return parts.join(" · ");
}

/** Filter and rank candidates for a selected Steerable Discover chip + optional drill-downs. */
export function steerDiscover(
  candidates: readonly DiscoverCandidate[],
  mood: DiscoverMoodId,
  drillDowns: readonly DrillDownId[],
  ctx: {
    taste?: TasteProfile;
    session?: SessionIntent;
    libraryIds?: ReadonlySet<string>;
    watchedIds?: ReadonlySet<string>;
    notInterestedIds?: ReadonlySet<string>;
    preferredType?: ContentType;
  } = {},
): SteeredPick[] {
  const libraryIds = ctx.libraryIds ?? new Set<string>();
  const watchedIds = ctx.watchedIds ?? new Set<string>();
  const blocked = ctx.notInterestedIds ?? new Set<string>();
  const seen = new Set<string>();

  const picks: SteeredPick[] = [];
  for (const c of candidates) {
    if (blocked.has(c.item.id) || seen.has(c.item.id)) continue;
    if (ctx.preferredType && mood !== "quick" && mood !== "miniseries" && c.item.type !== ctx.preferredType) continue;
    if (!matchesMood(c, mood, libraryIds, watchedIds)) continue;
    if (!drillDowns.every((d) => matchesDrillDown(c.item, d))) continue;
    seen.add(c.item.id);
    const score = scoreCandidate(c.item, ctx.taste, ctx.session);
    picks.push({ item: c.item, score, rationale: buildRationale(c, mood, ctx.taste, libraryIds) });
  }
  picks.sort((a, b) => b.score - a.score);
  return picks;
}
