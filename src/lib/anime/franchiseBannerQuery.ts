import { useQueries, useQueryClient, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { metaQuery } from "../net/queries";
import { PRIORITY, type Priority } from "../net/limiter";
import { usePrefs } from "../settings/prefs";
import { animeQuery, pageWhenOpened, seasonsQuery, type AnimeCard } from "./anilist";
import { animeArt, aniZipQuery, franchiseArt } from "./anizip";
import { artTitle } from "./pageArt";
import { animeImdbQuery } from "./search";
import { borrowsFrom, playedZip } from "./splitParts";
import { bannerBase } from "./franchiseBanner";
import { pickTitle } from "./format";
import { useLinkedImdbs } from "./links";

/**
 * Runs `useQueries` once per unique `key` among the items that have one, and maps each item back to its
 * query result (`undefined` while an item isn't ready to ask yet). Keeps `QueriesObserver` free of duplicate
 * keys when two entries share a franchise/base/IMDb id or are still waiting on an earlier step.
 */
function useUniqueQueries<
  Q extends { queryKey: readonly unknown[]; queryFn: (...args: never[]) => Promise<unknown> },
  K extends string | number,
>(
  entries: readonly ({ key: K; query: () => Q } | undefined)[],
): (UseQueryResult<Awaited<ReturnType<Q["queryFn"]>>> | undefined)[] {
  type Data = Awaited<ReturnType<Q["queryFn"]>>;
  const unique: Q[] = [];
  const indexByKey = new Map<K, number>();
  for (const entry of entries) {
    if (!entry || indexByKey.has(entry.key)) continue;
    indexByKey.set(entry.key, unique.length);
    unique.push(entry.query());
  }
  const results = useQueries({ queries: unique as unknown as UseQueryOptions<Data>[] });
  return entries.map((entry) => (entry ? results[indexByKey.get(entry.key)!] : undefined));
}

/** A banner's picture, logo and small label (lib/anime/franchiseBanner.ts). */
export interface BannerArt {
  /** The base title's name, where its logo is missing. */
  name: string;
  background?: string;
  logo?: string;
  /** Every logo to choose from, `logo` first (`franchiseArt`). */
  logos?: string[];
  label?: string;
}

/**
 * {@link bannerBase} for each of `cards` with its art, the same as the page each opens (#325). Each entry is
 * undefined until its own art is known, then never changes, so nothing swaps once drawn; one entry doesn't
 * wait for another (#380). An entry whose franchise couldn't be asked (AniList failing) is null: it keeps its
 * own art. All null with seasons as separate shows, where each entry's page is its own. `priority` places the
 * AniList and ani.zip requests in their queues (a wide card's, #336); the first entry's go at `first` (the
 * featured banner's slide on screen, #380).
 */
export function useFranchiseBanners(
  cards: AnimeCard[] | undefined,
  priority: Priority = PRIORITY.visible,
  first: Priority = priority,
): (BannerArt | null | undefined)[] | undefined {
  const client = useQueryClient();
  const { animeSeparateEntries: separate, animeTitles } = usePrefs();
  const list = separate ? [] : (cards ?? []);
  const at = (i: number) => (i === 0 ? first : priority);
  const media = useUniqueQueries(list.map((c, i) => ({ key: c.id, query: () => animeQuery(c.id, pageWhenOpened(c.id, at(i))) })));
  const walks = useUniqueQueries(
    list.map((c, i) => ({ key: c.id, query: () => seasonsQuery(client, media[i]?.data, pageWhenOpened(c.id, at(i)), c.id) })),
  );
  const ids = [...new Set([...list.map((c) => c.id), ...walks.flatMap((w) => w?.data?.seasons.map((s) => s.card.id) ?? [])])];
  const linked = useLinkedImdbs(ids);
  const title = (t: Parameters<typeof pickTitle>[0]) => pickTitle(t, animeTitles);
  const bases = list.map((c, i) => {
    const seasons = walks[i]?.data?.seasons;
    return seasons ? bannerBase(c, seasons, linked, title) : undefined;
  });
  const zips = useUniqueQueries(bases.map((b, i) => (b ? { key: b.base.id, query: () => aniZipQuery(b.base.id, at(i)) } : undefined)));
  // Where the base has no link, the id it plays from, asked as its page asks it (#371): through the record it plays from.
  const asks = bases.map((b) => (b?.linked === null ? b.base : undefined));
  const borrowed = asks.map((a, i) => a && borrowsFrom(a, zips[i]?.data));
  const prequels = useUniqueQueries(
    borrowed.map((p, i) => (p !== undefined ? { key: p, query: () => aniZipQuery(p, at(i)) } : undefined)),
  );
  const played = useUniqueQueries(
    asks.map((a, i) =>
      a
        ? {
            key: a.id,
            query: () => animeImdbQuery(client, a, playedZip(a, zips[i]?.data, { data: prequels[i]?.data, failed: !!prequels[i]?.isError })),
          }
        : undefined,
    ),
  );
  // A lookup that failed counts as none, as on the page.
  const playedId = (i: number) => (played[i]?.isError ? null : played[i]?.data === undefined ? undefined : (played[i]?.data?.id ?? null));
  const imdbs = bases.map((b, i) => b && artTitle(b.linked, playedId(i)));
  const metas = useUniqueQueries(
    imdbs.map((imdb, i) => {
      if (!imdb?.startsWith("tt")) return undefined;
      const type = bases[i]?.base.format === "MOVIE" ? "movie" : "series";
      return { key: `${type}:${imdb}`, query: () => metaQuery(type, imdb) };
    }),
  );

  const result = ((): (BannerArt | null | undefined)[] | undefined => {
    if (!cards) return undefined;
    if (separate) return cards.map(() => null);
    const out: (BannerArt | null | undefined)[] = [];
    for (let i = 0; i < list.length; i++) {
      if (media[i]?.isError || walks[i]?.isError) {
        out.push(null);
        continue;
      }
      const b = bases[i];
      const imdb = imdbs[i];
      if (!b || imdb === undefined || zips[i]?.isLoading || metas[i]?.isLoading) {
        out.push(undefined);
        continue;
      }
      // Everything it waits for has answered here, so the art is never pending.
      const { background, logo, logos } = franchiseArt({ imdb, meta: metas[i]?.data, metaLoading: false, first: animeArt(b.base, zips[i]?.data) });
      out.push({ background, logo, logos, name: title(b.base.title), label: b.label });
    }
    return out;
  })();
  // The same answer keeps the same array, so what draws it doesn't redraw. An entry still coming isn't
  // one that failed: JSON would write both as null.
  const key = JSON.stringify(result?.map((b) => (b === undefined ? "coming" : b)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => result, [key]);
}

/**
 * How many of a carousel's slides can show (#380): the leading ones whose art is known. A slide still coming
 * holds back the ones after it, so the slides keep their order and the carousel only ever grows.
 */
export function slidesReady(banners: readonly (BannerArt | null | undefined)[]): number {
  const coming = banners.indexOf(undefined);
  return coming < 0 ? banners.length : coming;
}
