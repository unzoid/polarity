import { useMemo } from "react";
import { useLibrary, useWatchHistory } from "../net/queries";
import type { LibraryItem, Progress } from "../types";
import type { LibraryEntry } from "./libraryView";
import { useTitleFacts } from "./titleFacts";
import { isWatched } from "./watched";

/**
 * Saved or Watched as entries for `arrangeLibrary`: each title with its latest progress and, once looked
 * up, its facts. `undefined` until the collection itself has loaded. `facts`: whether to look titles up
 * (TV only does when its view needs them).
 */
export function useSavedEntries(facts = true): LibraryEntry<LibraryItem>[] | undefined {
  const { data } = useLibrary();
  const { data: history } = useWatchHistory();
  const known = useTitleFacts(data ?? [], facts);
  return useMemo(() => {
    if (!data) return undefined;
    const latest = new Map((history ?? []).map((p) => [p.metaId, p]));
    return data.map((item) => {
      const progress = latest.get(item.id);
      return {
        item,
        id: item.id,
        type: item.type,
        name: item.name,
        addedAt: item.addedAt,
        progress,
        finished: progress ? isWatched(progress.position, progress.duration) : undefined,
        facts: known.get(item.id),
      };
    });
  }, [data, history, known]);
}

export function useWatchedEntries(facts = true): LibraryEntry<Progress>[] | undefined {
  const { data } = useWatchHistory();
  const refs = useMemo(() => (data ?? []).map((p) => ({ id: p.metaId, type: p.type })), [data]);
  const known = useTitleFacts(refs, facts);
  return useMemo(
    () =>
      data?.map((p) => ({
        item: p,
        id: p.metaId,
        type: p.type,
        name: p.name,
        progress: p,
        finished: isWatched(p.position, p.duration),
        facts: known.get(p.metaId),
      })),
    [data, known],
  );
}
