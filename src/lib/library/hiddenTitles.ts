import { useMemo } from "react";
import { getPrefs, setPrefs, usePrefs } from "../settings/prefs";
import type { ContentType, MetaPreview } from "../types";

/**
 * Titles the profile hid from browsing ("Hide This Title"): they stay out of Home's shelves, the
 * featured titles, Movies and Series, and recommendations. Search still finds them, and their page
 * says they're hidden, with Unhide. Kept in the synced pref `hiddenTitles` as JSON, so the list
 * follows the profile to every device (account/settingsSync.ts merges it as one value: two devices
 * hiding titles before they sync keep the one that synced last).
 */
export interface HiddenTitle {
  id: string;
  type: ContentType;
  /** For Settings → Browsing → Hidden titles, which lists them without fetching each. */
  name: string;
  /** When it was hidden (ms). The newest are kept when the list is full. */
  at: number;
}

/** At most this many: the settings document syncs whole, so it stays small. Hiding one more lets the oldest go. */
export const HIDDEN_LIMIT = 300;
/** A name is only a label: longer ones are cut. */
const NAME_MAX = 120;

const isType = (v: unknown): v is ContentType => v === "movie" || v === "series";

/** The stored list, newest first; anything unreadable is left out. */
export function readHiddenTitles(stored: string): HiddenTitle[] {
  if (!stored) return [];
  let v: unknown;
  try {
    v = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: HiddenTitle[] = [];
  for (const r of v as Partial<HiddenTitle>[]) {
    if (!r || typeof r.id !== "string" || !r.id || !isType(r.type) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, type: r.type, name: typeof r.name === "string" ? r.name.slice(0, NAME_MAX) : "", at: typeof r.at === "number" ? r.at : 0 });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, HIDDEN_LIMIT);
}

export const writeHiddenTitles = (list: readonly HiddenTitle[]) => (list.length ? JSON.stringify(list) : "");

/** `list` with `item` hidden, newest first and capped at HIDDEN_LIMIT (the oldest go). */
export function withHidden(list: readonly HiddenTitle[], item: Pick<MetaPreview, "id" | "type" | "name">, at: number): HiddenTitle[] {
  const entry: HiddenTitle = { id: item.id, type: item.type, name: item.name.slice(0, NAME_MAX), at };
  return [entry, ...list.filter((h) => h.id !== item.id)].slice(0, HIDDEN_LIMIT);
}

export const withoutHidden = (list: readonly HiddenTitle[], id: string) => list.filter((h) => h.id !== id);

const hiddenListeners = new Set<(item: MetaPreview) => void>();

/** Hides a title from browsing; the toast (components/HiddenTitleToast.tsx) offers Undo. */
export function hideTitle(item: MetaPreview) {
  const list = readHiddenTitles(getPrefs().hiddenTitles);
  setPrefs({ hiddenTitles: writeHiddenTitles(withHidden(list, item, Date.now())) });
  hiddenListeners.forEach((l) => l(item));
}

export function unhideTitle(id: string) {
  const list = readHiddenTitles(getPrefs().hiddenTitles);
  if (!list.some((h) => h.id === id)) return;
  setPrefs({ hiddenTitles: writeHiddenTitles(withoutHidden(list, id)) });
}

/** Hears every title hidden from here on; returns the unsubscribe. */
export function onTitleHidden(listener: (item: MetaPreview) => void) {
  hiddenListeners.add(listener);
  return () => void hiddenListeners.delete(listener);
}

/** The hidden titles, newest first. */
export function useHiddenTitles(): HiddenTitle[] {
  const { hiddenTitles } = usePrefs();
  return useMemo(() => readHiddenTitles(hiddenTitles), [hiddenTitles]);
}

/** The hidden titles' ids. */
export function useHiddenIds(): ReadonlySet<string> {
  const list = useHiddenTitles();
  return useMemo(() => new Set(list.map((h) => h.id)), [list]);
}

export const useIsHidden = (id: string) => useHiddenIds().has(id);
