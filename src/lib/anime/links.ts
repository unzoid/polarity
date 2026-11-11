import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { sync } from "../account/sync";
import { api } from "../api";
import { inShell } from "../platform/bridge";
import { aliasTable, type AnimeLink } from "../library/identity";
import { keys } from "../net/queryKeys";
import { linkedImdb, listedImdbQuery, useListedImdb } from "./landscapeArt";

/**
 * The anime links of the active space (docs/anime-identity.md): which id
 * each AniList entry the user has opened is played from. The anime pages
 * record one once they know that id; the backend then moves library items
 * and progress kept under the entry's other ids onto it. A link the backend
 * already has costs nothing (it answers "unchanged" without saving).
 */

/** Record a link; when it changed anything, what shows library and progress reloads and sync sends it. */
export async function linkAnime(qc: QueryClient, link: Omit<AnimeLink, "updatedAt">) {
  if (!inShell) return;
  refresh(qc, await api.linkAnime(link).catch(() => false));
}

function refresh(qc: QueryClient, changed: boolean) {
  // A stored link can change without moving anything; it's a local read, so just ask again.
  void qc.invalidateQueries({ queryKey: keys.animeLinks });
  if (!changed) return;
  for (const k of [keys.library, keys.progressAll, keys.continue, keys.history]) void qc.invalidateQueries({ queryKey: k });
  sync.schedule();
}

/** A pick, or "Use Polarity's match", just made on an anime page (#335): what the notice offering Undo says. */
export type SeriesChange = { anilist: number; /** The picked show's name; none when the stored link was taken back. */ name?: string; undo: () => void };
type ChangeListener = (change: SeriesChange) => void;
const changeListeners = new Set<ChangeListener>();

/** Hear each pick and its removal; returns the function that stops listening. */
export function onSeriesChange(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** Puts the entry's link back as `before` was (none: the stored link taken back), without a notice. */
async function restoreLink(qc: QueryClient, anilist: number, before: AnimeLink | undefined) {
  if (before) await linkAnime(qc, { canonical: before.canonical, anilist, mal: before.mal, kitsu: before.kitsu });
  else if (inShell) refresh(qc, await api.unlinkAnime(anilist).catch(() => false));
  await qc.invalidateQueries({ queryKey: keys.anime.imdb(anilist) });
}

/**
 * The show the user picked for an entry by hand (#189), stored as its link: the entry plays from it from
 * then on, on every device the space syncs to, and what was kept under its other ids moves onto it. A
 * notice offers to undo it (#335).
 */
export async function pickAnimeImdb(qc: QueryClient, link: Omit<AnimeLink, "updatedAt">, name?: string) {
  const before = (await animeLinks()).find((l) => l.anilist === link.anilist);
  await linkAnime(qc, link);
  await qc.invalidateQueries({ queryKey: keys.anime.imdb(link.anilist) });
  changeListeners.forEach((l) => l({ anilist: link.anilist, name, undo: () => void restoreLink(qc, link.anilist, before) }));
}

/**
 * "Use Polarity's match" (#335): takes the entry's stored link back, on every device, so it plays from what
 * the id lists or the title search find again; what the link moved goes back too. A notice offers to undo it.
 */
export async function unpickAnime(qc: QueryClient, anilist: number) {
  const before = (await animeLinks()).find((l) => l.anilist === anilist);
  await restoreLink(qc, anilist, undefined);
  changeListeners.forEach((l) => l({ anilist, undo: () => void restoreLink(qc, anilist, before) }));
}

/** The stored links. */
export const animeLinks = (): Promise<AnimeLink[]> => (inShell ? api.animeLinks().catch(() => []) : Promise.resolve([]));

/** The stored links as an alias table ({@link aliasTable}), for merging the same show under its ids. */
export function useAnimeAliases(): ReadonlyMap<string, string> {
  const { data } = useQuery({ queryKey: keys.animeLinks, queryFn: animeLinks, staleTime: Infinity });
  return useMemo(() => aliasTable(data ?? []), [data]);
}

/** {@link linkedImdb} for a card: the stored links and the id lists asked together. */
export function useLinkedImdb(anilistId: number) {
  const listed = useListedImdb(anilistId);
  const { data: links } = useQuery({ queryKey: keys.animeLinks, queryFn: animeLinks, staleTime: Infinity });
  return linkedImdb(anilistId, listed, links);
}

/** {@link useLinkedImdb} for several entries at once (a franchise's season tabs), as a lookup by AniList id. */
export function useLinkedImdbs(anilistIds: number[]): (anilistId: number) => string | null | undefined {
  const listed = useQueries({ queries: anilistIds.map(listedImdbQuery) });
  const { data: links } = useQuery({ queryKey: keys.animeLinks, queryFn: animeLinks, staleTime: Infinity });
  const byId = new Map(anilistIds.map((id, i) => [id, linkedImdb(id, listed[i]?.data, links)]));
  return (id) => byId.get(id);
}
