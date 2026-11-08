import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { metaQuery } from "../net/queries";
import { PRIORITY, type Priority } from "../net/limiter";
import { usePrefs } from "../settings/prefs";
import { animeQuery, pageWhenOpened, type Anime, type AnimeCard } from "./anilist";
import { animeArt, franchiseArt, useAniZip, usePlayedZip } from "./anizip";
import { useFranchiseBanners } from "./franchiseBannerQuery";
import { pageArtSource } from "./pageArt";
import { noSeasonBefore } from "./seasons";
import { animeImdbQuery } from "./search";

/** The backdrop and logo an anime's page shows, for a card that opens it (#336). */
export interface PageArt {
  background?: string;
  logo?: string;
  /** Every logo to choose from, `logo` first (`franchiseArt`). */
  logos: string[];
}

/**
 * The backdrop and logo `card`'s page shows, worked out as the page works them out, so a wide card and its page
 * never disagree (#336). With seasons grouped that's the franchise's (`useFranchiseBanners`, the Anime tab's
 * banner); with seasons as separate shows the entry's own page's ({@link pageArtSource}: from the title it plays
 * from when no season comes before it, else its own). Undefined until it's all known, so what's drawn doesn't
 * change; null when AniList couldn't be asked (the card keeps its own art). Nothing is asked until `enabled`
 * (the card is near the screen); `priority` places the AniList requests in its queue.
 */
export function useAnimePageArt(card: AnimeCard, enabled: boolean, priority: Priority = PRIORITY.visible): PageArt | null | undefined {
  const qc = useQueryClient();
  const { animeSeparateEntries: separate } = usePrefs();
  const grouped = enabled && !separate;
  const banners = useFranchiseBanners(
    useMemo(() => (grouped ? [card] : undefined), [grouped, card]),
    priority,
  );

  // Seasons as separate shows: the entry's own page, which asks the entry with its relations.
  const own = enabled && separate;
  const { data: anime, isError: noAnime } = useQuery({ ...animeQuery(card.id, pageWhenOpened(card.id, priority)), enabled: own });
  const first = anime ? noSeasonBefore(anime) : undefined;
  const { data: zip, isPending: zipPending } = useAniZip(card.id, own);
  const { zip: playedZip } = usePlayedZip(first ? anime : undefined, own);
  const { data: plays, isError: noPlays } = useQuery(animeImdbQuery(qc, own && first ? anime : undefined, playedZip));
  const played = anime && (noPlays || plays !== undefined) ? { of: anime.id, id: noPlays ? null : (plays?.id ?? null) } : undefined;
  const source = own && anime ? separateSource(anime, first, played) : undefined;
  const imdb = source?.imdb;
  const { data: meta, isLoading: metaLoading } = useQuery({
    ...metaQuery(card.format === "MOVIE" ? "movie" : "series", imdb ?? ""),
    enabled: own && !!imdb?.startsWith("tt"),
  });

  const result = ((): PageArt | null | undefined => {
    if (!enabled) return undefined;
    if (!separate) {
      const banner = banners?.[0];
      return banner && { background: banner.background, logo: banner.logo, logos: banner.logos ?? [] };
    }
    if (noAnime) return null;
    if (!anime || !source?.known || imdb === undefined || zipPending || (imdb?.startsWith("tt") && metaLoading)) return undefined;
    // Everything it waits for has answered here, so the art is never pending (#343).
    const { background, logo, logos } = franchiseArt({ imdb, meta, metaLoading, first: animeArt(anime, zip) });
    return { background, logo, logos };
  })();
  // The same answer keeps the same object, so what draws it doesn't redraw.
  const key = JSON.stringify(result);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => result, [key]);
}

/** {@link pageArtSource} for an entry's own page (seasons as separate shows), as AnimeDetail.tsx asks it. */
const separateSource = (anime: Anime, first: boolean | undefined, played: { of: number; id: string | null } | undefined) =>
  pageArtSource({
    separate: true,
    seasonsLoading: false,
    found: undefined,
    shown: anime,
    active: anime.id,
    separateFirst: first,
    linked: () => undefined,
    played,
  });
