import { useMemo } from "react";
import { getPrefs, usePrefs, type Prefs } from "../settings/prefs";
import { queryClient } from "../net/queryClient";
import { keys } from "../net/queryKeys";
import type { ContentType, Settings } from "../types";
import { allowed, discoverBound, regionOf } from "./ageRating";

/**
 * The profile's viewing limit: the highest age a title may be rated for (null: no limit) and whether titles
 * without a rating go too (never without a limit). Everything that applies it reads it here, through
 * {@link useViewingLimit} or {@link getViewingLimit}; where it's kept may change (a profile's own limit behind a
 * PIN) without its readers changing.
 */
export interface ViewingLimit {
  limit: number | null;
  hideUnrated: boolean;
}

const limitOf = (p: Pick<Prefs, "viewingLimit" | "viewingHideUnrated">): ViewingLimit => {
  const limit = p.viewingLimit > 0 ? p.viewingLimit : null;
  return { limit, hideUnrated: limit !== null && p.viewingHideUnrated };
};

/** The viewing limit, for components; the same object until it changes. */
export function useViewingLimit(): ViewingLimit {
  const { viewingLimit, viewingHideUnrated } = usePrefs();
  return useMemo(() => limitOf({ viewingLimit, viewingHideUnrated }), [viewingLimit, viewingHideUnrated]);
}

/** The viewing limit now, for code outside React. */
export const getViewingLimit = (): ViewingLimit => limitOf(getPrefs());

/** Whether a title may show under the limit (lib/catalog/ageRating.ts `allowed`). */
export const withinLimit = (item: { certification?: string } | undefined, v: ViewingLimit) =>
  allowed(item?.certification, v.limit, v.hideUnrated);

/** A list without the titles over the limit; the same list when there's none. */
export function keepWithinLimit<T extends { certification?: string }>(items: T[], v: ViewingLimit): T[] {
  return v.limit === null ? items : items.filter((m) => withinLimit(m, v));
}

/**
 * Whether a title page (or the player) may show a title: "show", "hide" when it's over the limit, or "wait" while
 * its rating isn't known yet (`settled` false: its full metadata hasn't answered). Without a limit always "show".
 */
export function useTitleVerdict(item: { certification?: string } | undefined, settled: boolean): "show" | "hide" | "wait" {
  const viewing = useViewingLimit();
  if (viewing.limit === null) return "show";
  if (!settled) return "wait";
  return withinLimit(item, viewing) ? "show" : "hide";
}

/**
 * The Anime section's mature-content choice (ecchi) as it applies: as set without a limit, left out with one (every
 * limit offered is under 18). AniList's adult titles never show either way: its queries leave them out.
 */
export function useMatureContent(): Prefs["matureContent"] {
  const { matureContent } = usePrefs();
  return useViewingLimit().limit === null ? matureContent : "hide";
}

/** What a title page says instead of a title over the profile's viewing limit. */
export const LIMIT_NOTICE = "Not shown at this profile's limit";

/**
 * What a catalog request adds for the limit: the highest film rating within it, in the metadata language's
 * region, which TMDB's discover lists apply so their pages come back full. Nothing for series or without a limit.
 */
export function catalogBound(type: ContentType): { certCountry: string; certMax: string } | undefined {
  if (type !== "movie") return undefined;
  const language = queryClient.getQueryData<Settings>(keys.settings)?.language;
  const bound = discoverBound(getViewingLimit().limit, regionOf(language));
  return bound ? { certCountry: bound.country, certMax: bound.max } : undefined;
}
