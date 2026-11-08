import { useMemo } from "react";
import { animeEntries, useAnimePageArt, type AnimeCard } from "../../lib/anime";
import { PRIORITY } from "../../lib/net";
import { loadingArt, type LoadingArt } from "../../lib/playback";
import { usePrefs } from "../../lib/settings/prefs";
import type { MetaPreview } from "../../lib/types";

/** {@link loadingArt} for the episode `videoId` of the title `meta` is for. */
export function useLoadingArt(meta: MetaPreview | undefined, metaPending: boolean, videoId: string): LoadingArt {
  const { animeEnabled } = usePrefs();
  const entry = useMemo(() => (animeEnabled ? animeEntries.entryAt(videoId) : undefined), [animeEnabled, videoId]);
  // Only its id counts for the page's art; the rest is what a card needs to be one.
  const card = useMemo((): AnimeCard | undefined => entry && { id: entry.anilist, title: entry.title, coverImage: {} }, [entry]);
  const page = useAnimePageArt(card ?? NO_CARD, !!card, PRIORITY.page);
  return loadingArt(meta, metaPending, page, !!card);
}

const NO_CARD: AnimeCard = { id: 0, title: {}, coverImage: {} };
