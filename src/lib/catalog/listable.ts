import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { keys } from "../net/queryKeys";
import { imageBroken, subscribeImages } from "../ui/artGate";
import type { Meta, MetaPreview } from "../types";

/**
 * Whether Play could do anything for the title, from what a list has (#337): a film always plays; a series only
 * once its details list an episode, which a list knows only when they're already in the cache (`meta`). Its
 * details aren't fetched for this.
 */
export function playableFromList(item: MetaPreview, meta?: Pick<Meta, "videos">) {
  return item.type === "movie" || !!meta?.videos?.length;
}

/** The pictures a list's card can draw for the title: its poster, then its backdrop (PosterCard's fallback). */
export const listArt = (item: MetaPreview) => [item.poster, item.background].filter((u): u is string => !!u);

/**
 * Whether a list shows the title (#337): left out only when it can't be played and has nothing to show, no
 * description and no picture that loads (none, or every one failed). A picture still loading counts as there.
 */
export function listable(item: MetaPreview, meta?: Pick<Meta, "videos">, broken: (url: string) => boolean = imageBroken) {
  if (item.description?.trim() || playableFromList(item, meta)) return true;
  return listArt(item).some((u) => !broken(u));
}

/**
 * `items` without the titles {@link listable} leaves out. Pictures that fail later take their title out then, so
 * a blank card goes once its art is known not to load. Series details come from the cache only.
 */
export function useListable<T extends MetaPreview>(items: T[] | undefined): T[] | undefined {
  const qc = useQueryClient();
  const metaOf = useCallback((item: MetaPreview) => qc.getQueryData<Meta>(keys.meta(item.type, item.id)), [qc]);
  // Only titles with nothing else going for them can drop out; their pictures are the ones to watch.
  const doubtful = useMemo(() => (items ?? []).filter((i) => !i.description?.trim() && !playableFromList(i, metaOf(i))), [items, metaOf]);
  const urls = doubtful.flatMap(listArt).join("\n");
  const sub = useCallback((fn: () => void) => subscribeImages(urls ? urls.split("\n") : [], fn), [urls]);
  const dropped = useSyncExternalStore(
    sub,
    () =>
      doubtful
        .filter((i) => !listable(i, metaOf(i)))
        .map((i) => i.id)
        .join(" "),
    () => "",
  );
  return useMemo(() => {
    if (!items || !dropped) return items;
    const out = new Set(dropped.split(" "));
    return items.filter((i) => !out.has(i.id));
  }, [items, dropped]);
}
