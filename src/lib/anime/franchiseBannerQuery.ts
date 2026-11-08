import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { metaQuery } from "../net/queries";
import { PRIORITY } from "../net/limiter";
import { usePrefs } from "../settings/prefs";
import { animeQuery, seasonsQuery, type AnimeCard } from "./anilist";
import { animeArt, aniZipQuery, franchiseArt } from "./anizip";
import { artTitle } from "./pageArt";
import { animeImdbQuery } from "./search";
import { borrowsFrom, playedZip } from "./splitParts";
import { bannerBase } from "./franchiseBanner";
import { pickTitle } from "./format";
import { useLinkedImdbs } from "./links";

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
 * {@link bannerBase} for each of `cards` with its art, the same as the page each opens (#325): undefined
 * until every one is known, so nothing swaps once drawn. An entry whose franchise couldn't be asked
 * (AniList failing) is null: it keeps its own art. All null with seasons as separate shows, where each
 * entry's page is its own.
 */
export function useFranchiseBanners(cards: AnimeCard[] | undefined): (BannerArt | null)[] | undefined {
  const client = useQueryClient();
  const { animeSeparateEntries: separate, animeTitles } = usePrefs();
  const list = separate ? [] : (cards ?? []);
  const media = useQueries({ queries: list.map((c) => animeQuery(c.id, PRIORITY.visible)) });
  const walks = useQueries({ queries: list.map((_, i) => seasonsQuery(client, media[i]?.data)) });
  const ids = [...new Set([...list.map((c) => c.id), ...walks.flatMap((w) => w.data?.seasons.map((s) => s.card.id) ?? [])])];
  const linked = useLinkedImdbs(ids);
  const title = (t: Parameters<typeof pickTitle>[0]) => pickTitle(t, animeTitles);
  const bases = list.map((c, i) => (walks[i]?.data ? bannerBase(c, walks[i].data.seasons, linked, title) : undefined));
  const zips = useQueries({ queries: bases.map((b) => ({ ...aniZipQuery(b?.base.id ?? 0), enabled: !!b })) });
  // Where the base has no link, the id it plays from, asked as its page asks it (#371): through the record it plays from.
  const asks = bases.map((b) => (b?.linked === null ? b.base : undefined));
  const borrowed = asks.map((a, i) => a && borrowsFrom(a, zips[i]?.data));
  const prequels = useQueries({ queries: borrowed.map((p) => ({ ...aniZipQuery(p ?? 0), enabled: p !== undefined })) });
  const played = useQueries({
    queries: asks.map((a, i) => animeImdbQuery(client, a ?? list[i]!, a && playedZip(a, zips[i]?.data, { data: prequels[i]?.data, failed: !!prequels[i]?.isError }))),
  });
  // A lookup that failed counts as none, as on the page.
  const playedId = (i: number) => (played[i]?.isError ? null : played[i]?.data === undefined ? undefined : (played[i].data?.id ?? null));
  const imdbs = bases.map((b, i) => b && artTitle(b.linked, playedId(i)));
  const metas = useQueries({
    queries: imdbs.map((imdb, i) => ({ ...metaQuery(bases[i]?.base.format === "MOVIE" ? "movie" : "series", imdb ?? ""), enabled: !!imdb?.startsWith("tt") })),
  });

  const result = ((): (BannerArt | null)[] | undefined => {
    if (!cards) return undefined;
    if (separate) return cards.map(() => null);
    const out: (BannerArt | null)[] = [];
    for (let i = 0; i < list.length; i++) {
      if (media[i]?.isError || walks[i]?.isError) {
        out.push(null);
        continue;
      }
      const b = bases[i];
      const imdb = imdbs[i];
      if (!b || imdb === undefined || zips[i]?.isLoading || metas[i]?.isLoading) return undefined;
      const art = franchiseArt({ imdb, meta: metas[i]?.data, metaLoading: false, first: animeArt(b.base, zips[i]?.data) });
      out.push({ ...art, name: title(b.base.title), label: b.label });
    }
    return out;
  })();
  // The same answer keeps the same array, so what draws it doesn't redraw.
  const key = JSON.stringify(result);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => result, [key]);
}
