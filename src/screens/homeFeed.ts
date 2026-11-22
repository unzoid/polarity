import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  pickForMe,
  shelfKey,
  todaysShelves,
  useBrowseFeatured,
  useBrowseShelf,
  useFeatured,
  useHomeCatalogs,
  useListable,
  useSeeds,
  useShownAbove,
  useTasteProfile,
  type Shelf as HomeShelf,
} from "../lib/catalog";
import { useCatalog, useContinueWatching, useRecommend, useSettings, useWatchHistory } from "../lib/net";
import { useNavigation } from "../lib/router";
import type { MetaPreview } from "../lib/types";

const NO_TITLES: MetaPreview[] = [];

/** With fewer fresh titles than this, a shelf shows its full list, repeats and all. */
const MIN_FRESH = 6;

/**
 * What Home shows, for any layout of it (classic, desk and phone): the featured titles, the shelves and
 * what each leaves out, the add-ons' rows, and Surprise Me.
 */
export function useHomeFeed() {
  // Without the hidden and (when asked) the watched (lib/catalog/browseFilter.ts).
  const items = useBrowseFeatured(useFeatured().data);
  const seeds = useSeeds();
  const taste = useTasteProfile();
  const shelves = useMemo(() => todaysShelves(seeds, taste), [seeds, taste]);
  const shownAbove = useShownAbove(shelves, items ?? NO_TITLES);
  const { data: watching } = useContinueWatching();
  const { data: history } = useWatchHistory();
  const watched = useMemo(
    () => new Set([...(watching ?? []).map((p) => p.metaId), ...(history ?? []).map((p) => p.metaId)]),
    [watching, history],
  );
  // Recommendations also skip what you're watching or have watched; memoized so shelves keep stable Set references.
  const excludes = useMemo(
    () => shelves.map((shelf, i) => (shelf.kind === "because" ? new Set([...shownAbove[i], ...watched]) : shownAbove[i])),
    [shelves, shownAbove, watched],
  );
  const { data: settings } = useSettings();
  const addonRows = useHomeCatalogs();
  const qc = useQueryClient();
  const { navigate } = useNavigation();

  const surpriseMe = useCallback(() => {
    const pool: MetaPreview[] = [...(items ?? [])];
    for (const s of shelves) {
      const list = qc.getQueryData<MetaPreview[]>(shelfKey(s));
      if (list?.length) pool.push(...list);
    }
    const chosen = pickForMe(pool, watched, taste);
    if (chosen) navigate({ name: "detail", type: chosen.type, id: chosen.id, preview: chosen });
  }, [items, shelves, qc, watched, taste, navigate]);

  return { items, shelves, excludes, settings, addonRows, surpriseMe };
}

/**
 * A shelf's titles once `enabled` (near the screen): what its catalog or recommendations give, without what's
 * hidden, watched or already above (`exclude`) unless that leaves too few. `skip`: the shelf stays out (its catalog
 * failed, or there's too little worth recommending).
 */
export function useShelfItems(shelf: HomeShelf, enabled: boolean, exclude: Set<string>) {
  const isCatalog = shelf.kind === "catalog";
  const catalog = useCatalog(shelf.type, isCatalog ? shelf.id : "", isCatalog ? shelf.genre : undefined, enabled && isCatalog);
  const recommended = useRecommend(shelf.type, isCatalog ? "" : shelf.seed, enabled && !isCatalog);
  const { data, isLoading, isError } = isCatalog ? catalog : recommended;
  // Nothing to play and nothing to show (#337) stays out.
  // Hidden and watched titles go too, and a shelf they leave short loads more (lib/catalog/browseFilter.ts).
  const shown = useBrowseShelf(useListable(data), isCatalog ? { type: shelf.type, id: shelf.id, genre: shelf.genre } : undefined);
  const items = useMemo(() => {
    const fresh = (shown ?? []).filter((m) => !exclude.has(m.id));
    return fresh.length >= MIN_FRESH || shelf.kind === "because" ? fresh : (shown ?? []);
  }, [shown, exclude, shelf.kind]);
  // One failing catalog shouldn't break the page; nothing good to recommend leaves the row out rather than a stub.
  const skip = isError || (shelf.kind === "because" && !!data && items.length < 4);
  return { items: isLoading || !enabled ? undefined : items, skip };
}
