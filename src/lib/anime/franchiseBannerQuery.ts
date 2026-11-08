import { useQueries, useQueryClient } from "@tanstack/react-query";
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
  const media = useQueries({ queries: list.map((c, i) => animeQuery(c.id, pageWhenOpened(c.id, at(i)))) });
  const walks = useQueries({ queries: list.map((c, i) => seasonsQuery(client, media[i]?.data, pageWhenOpened(c.id, at(i)))) });
  const ids = [...new Set([...list.map((c) => c.id), ...walks.flatMap((w) => w.data?.seasons.map((s) => s.card.id) ?? [])])];
  const linked = useLinkedImdbs(ids);
  const title = (t: Parameters<typeof pickTitle>[0]) => pickTitle(t, animeTitles);
  const bases = list.map((c, i) => (walks[i]?.data ? bannerBase(c, walks[i].data.seasons, linked, title) : undefined));
  const zips = useQueries({ queries: bases.map((b, i) => ({ ...aniZipQuery(b?.base.id ?? 0, at(i)), enabled: !!b })) });
  // Where the base has no link, the id it plays from, asked as its page asks it (#371): through the record it plays from.
  const asks = bases.map((b) => (b?.linked === null ? b.base : undefined));
  const borrowed = asks.map((a, i) => a && borrowsFrom(a, zips[i]?.data));
  const prequels = useQueries({ queries: borrowed.map((p, i) => ({ ...aniZipQuery(p ?? 0, at(i)), enabled: p !== undefined })) });
  const played = useQueries({
    queries: asks.map((a, i) => animeImdbQuery(client, a ?? list[i]!, a && playedZip(a, zips[i]?.data, { data: prequels[i]?.data, failed: !!prequels[i]?.isError }))),
  });
  // A lookup that failed counts as none, as on the page.
  const playedId = (i: number) => (played[i]?.isError ? null : played[i]?.data === undefined ? undefined : (played[i].data?.id ?? null));
  const imdbs = bases.map((b, i) => b && artTitle(b.linked, playedId(i)));
  const metas = useQueries({
    queries: imdbs.map((imdb, i) => ({ ...metaQuery(bases[i]?.base.format === "MOVIE" ? "movie" : "series", imdb ?? ""), enabled: !!imdb?.startsWith("tt") })),
  });

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
