/**
 * Where an anime page's backdrop and logo come from (#339): worked out from what has answered so far, and
 * undefined until it's all known, so the page draws its art once and draws the same art whichever entry
 * of the franchise it was opened at and whatever order the season walk, the stored links and the id
 * lists answer in. Pure; type-only imports.
 */
import type { AnimeCard } from "./anilist";
import { baseTitle, type BaseTitle } from "./baseTitle";

/** The id an entry plays from (`animeImdbQuery`, or as the page's hero found it), and which entry it's for. */
export interface HeroImdb {
  of: number;
  /** Undefined while it's being found, null for none. */
  id: string | null | undefined;
}

export interface PageArtSource {
  /** A grouped page's base title (#246), once every TV entry's link is known. */
  base?: BaseTitle;
  /** The entry whose ani.zip art stands in when the linked title has none: the base title, else the entry shown. */
  first?: AnimeCard;
  /** The entry the art comes from, whose playback id counts as `played`: the base title on a grouped page. */
  hero?: number;
  /** Whether the entry the art comes from is known yet. */
  known: boolean;
  /** Whether the entry shown is the one the art and trailer belong to. */
  firstEntry: boolean;
  /** The title the art comes from: a `tt…` id (or a Kitsu id) for its art, null for `first`'s ani.zip art, undefined while unknown. */
  imdb: string | null | undefined;
}

/**
 * The page's art source. `found` is the franchise's entries when the page groups them (undefined
 * otherwise), `shown` the entry on screen, `active` its id. With seasons as separate shows
 * (`separate`), `separateFirst` says whether no season comes before the entry (undefined until it's
 * loaded): only then does the art come from the title it plays from, else it's the entry's own.
 *
 * A grouped page takes the base title's linked id, else ({@link artTitle}) the id the base title plays
 * from (`played`: what its hero finds too and then stores as its link, so the next visit's links give the
 * same id): never the entry opened, which would make the art depend on where the page was opened from.
 */
export function pageArtSource({
  separate,
  seasonsLoading,
  found,
  shown,
  active,
  separateFirst,
  linked,
  played,
}: {
  separate: boolean;
  seasonsLoading: boolean;
  found: AnimeCard[] | undefined;
  shown: AnimeCard | undefined;
  active: number;
  separateFirst: boolean | undefined;
  /** Each entry's linked IMDb id: undefined while it's being found, null for none. */
  linked: (id: number) => string | null | undefined;
  /** What `animeImdbQuery` answers for the entry the art comes from. */
  played: HeroImdb | undefined;
}): PageArtSource {
  const base = found && baseTitle(found, linked);
  const first = found ? base?.card : shown;
  const heroId = found ? base?.card.id : shown?.id;
  const plays = heroId !== undefined && played?.of === heroId ? played.id : undefined;
  const known = separate ? separateFirst !== undefined : !seasonsLoading && (!found || !!base);
  const firstEntry = separate ? !!separateFirst : known && (!base || base.card.id === active);
  const imdb = ((): string | null | undefined => {
    if (!known || !first) return undefined;
    if (separate) return firstEntry ? plays : null;
    return base?.imdb ?? artTitle(linked(first.id), plays);
  })();
  return { base: base || undefined, first, hero: heroId, known, firstEntry, imdb };
}

/**
 * The title an anime's art comes from: the one rule its page ({@link pageArtSource}), the Anime tab's banner
 * (`useFranchiseBanners`) and its wide cards share, fed the same answers, so they can't disagree (#371). The
 * entry's linked `tt…` id (a stored link, else the id lists'), else the `tt…` id it plays from (`played`, the
 * cached `animeImdbQuery`: ani.zip's IMDb link, the stored link or a title search), else null: its ani.zip art.
 * Undefined while either is being found.
 */
export function artTitle(linked: string | null | undefined, played: string | null | undefined): string | null | undefined {
  if (linked !== null) return linked;
  if (played === undefined) return undefined;
  return played?.startsWith("tt") ? played : null;
}
