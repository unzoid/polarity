import type { PageArt } from "../anime/cardPageArt";
import type { MetaPreview } from "../types";

/** What the player's loading screen draws (#391): the title page's logo and backdrop. */
export interface LoadingArt {
  logo?: string;
  logos?: string[];
  background?: string;
  /** Not known yet: nothing shows in the logo's place. */
  pending: boolean;
}

/**
 * The loading screen's art, the title page's (#391). An anime episode whose entry is known here (the anime page
 * lined it up, lib/anime/entries.ts) takes its page's art (`useAnimePageArt`, the rule the page, the Anime tab's
 * banner and its wide cards share: the franchise's with seasons grouped, the entry's own page's with seasons as
 * separate shows). Anything else, or an anime whose page couldn't be asked, takes its title's (`meta`), as the
 * title page shows it. Pure.
 */
export function loadingArt(
  meta: Pick<MetaPreview, "logo" | "logos" | "background"> | undefined,
  metaPending: boolean,
  page: PageArt | null | undefined,
  anime: boolean,
): LoadingArt {
  if (anime && page === undefined) return { pending: true };
  if (anime && page) return { logo: page.logo, logos: page.logos, background: page.background, pending: false };
  return { logo: meta?.logo, logos: meta?.logos, background: meta?.background, pending: metaPending };
}
