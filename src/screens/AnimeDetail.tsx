import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useBackdropTrailer, usePageOnTop } from "../components/BackdropTrailer";
import { useTrailerOpen } from "../components/Trailer";
import { AnimeCharacters } from "../components/anime/AnimeCharacters";
import { AnimeDetails } from "../components/anime/AnimeDetails";
import { AnimeEpisodes, FilmPick, SeasonTabs, type Franchise } from "../components/anime/AnimeEpisodes";
import { AnimeHero, type HeroFranchise } from "../components/anime/AnimeHero";
import { AnimeListPanels } from "../components/anime/AnimeListPanel";
import { AnimeRelated } from "../components/anime/AnimeRelated";
import { Img } from "../components/Img";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import {
  type Anime,
  animeArt,
  animeEntries,
  animeImdbQuery,
  animeQuery,
  continuePart,
  distinctLabels,
  type AnimeCard as Card,
  franchiseArt,
  isSeason,
  noSeasonBefore,
  nothingKnownYet,
  useAnime,
  useAnimeSeasons,
  useAnimeTitle,
  useAniZip,
  type HeroImdb,
  pageArtSource,
  useLinkedImdbs,
  usePlayedZip,
} from "../lib/anime";
import { useMeta, useProgressOf } from "../lib/net";
import { usePrefs } from "../lib/settings";
import { useFoldSnap, useFormFactor } from "../lib/ui";

/**
 * An anime's page, built from AniList with ani.zip filling in episode titles,
 * stills and the link to the app's sources. Its episodes play through the
 * same IMDb-keyed streams, player and watch history as everything else, so
 * Continue Watching and Up Next just work.
 *
 * One page per franchise: AniList splits a show into an entry per season (or
 * cour), and the page opens at one of them with the rest as season tabs.
 * Switching swaps the hero, episodes and details in place, keeping the
 * scroll position and Back, like a show's seasons.
 *
 * With Settings → Anime → Seasons as separate shows (#22), the page is the
 * entry's alone: its episodes, no season tabs, and its prequel and sequel
 * among the related titles.
 */
export function AnimeDetail({ id, preview }: { id: number; preview?: Card }) {
  const { animeSeparateEntries: separate, animeTitles } = usePrefs();
  const [activeId, setActiveId] = useState(id);
  const { data: opened } = useAnime(id);
  const { data: walk, isPending: walking } = useAnimeSeasons(separate ? undefined : opened);
  const chain = walk?.seasons;
  const found = !separate && chain && chain.length > 1 && chain.some((s) => s.card.id === id) ? chain : undefined;
  // Other seasons may be on the way (a long walk while AniList is busy): say so, with this entry as the one tab meanwhile.
  const linked = !!opened?.relations.edges.some((e) => (e.relationType === "PREQUEL" || e.relationType === "SEQUEL") && e.node.type !== "MANGA");
  const seasonsLoading = !separate && linked && (walking || walk?.complete === false);
  const title = useAnimeTitle();
  // An entry that's no season of its own (an OVA, a part nothing is known of) opens on its own page, never as a tab (#351).
  const ownTab = !!opened && isSeason(opened) && !nothingKnownYet(opened);
  const seasons = found ?? (seasonsLoading && opened && ownTab ? [{ card: opened, label: title(opened.title) }] : undefined);
  // While a season loads, the last one stays on screen (dimmed) so the page keeps its height and place.
  const { data: loaded, isError } = useAnime(activeId, { keepPrevious: true });
  const anime = loaded?.id === activeId ? loaded : undefined;
  const shown: Card | undefined = anime ?? seasons?.find((s) => s.card.id === activeId)?.card ?? (activeId === id ? preview : loaded);

  const scroller = useRef<HTMLDivElement>(null);
  useFoldSnap(scroller, !!shown);
  // A phone's page scrolls as one, the art at its top (Detail.tsx).
  const phone = useFormFactor().form === "phone";

  // The franchise's base title (#246): the series most of its TV entries play from, else its earliest TV
  // entry, not the chain's first entry (a prequel film would cover the whole series with its art). The page's
  // art comes from its linked title, else the one it plays from (the lookup its hero and the Anime tab's
  // banner share, #371), worked out once everything has answered, so it's drawn once and the same wherever
  // the page was opened from (#339).
  const linkedOf = useLinkedImdbs(found ? found.map((s) => s.card.id) : shown ? [shown.id] : []);
  const [heroImdb, setHeroImdb] = useState<HeroImdb>();
  const separateFirst = separate && opened ? noSeasonBefore(opened) : undefined;
  const sourceOf = (played: HeroImdb | undefined) =>
    pageArtSource({ separate, seasonsLoading, found: found?.map((s) => s.card), shown, active: activeId, separateFirst, linked: linkedOf, played });
  const artEntry = sourceOf(undefined).first;
  // Asked only with the entry's relations (not a preview's card), so a split part borrows its prequel's record as its hero does.
  const asked = artEntry && "relations" in artEntry ? artEntry : undefined;
  const qc = useQueryClient();
  const { zip: artZip } = usePlayedZip(asked);
  const { data: plays, isError: noPlays } = useQuery(animeImdbQuery(qc, asked, artZip));
  // A lookup that failed counts as none, so the art still comes.
  const artPlays = artEntry && (noPlays || plays !== undefined) ? { of: artEntry.id, id: noPlays ? null : (plays?.id ?? null) } : undefined;
  const source = sourceOf(artPlays);
  const { base, first, firstEntry, known: firstKnown } = source;

  // A grouped page's top is the whole franchise's (#327): the base title's name, story and facts, the parts'
  // summary, and Play carrying on wherever you left off, the same on every tab.
  const { data: baseAnime } = useQuery({ ...animeQuery(base?.card.id ?? 0), enabled: !!base });
  const linkedIds = found ? found.map((s) => linkedOf(s.card.id)).filter((x): x is string => !!x?.startsWith("tt")) : [];
  const played = useProgressOf([...new Set(linkedIds)]);
  const heroFranchise = useMemo((): HeroFranchise | undefined => {
    if (!found || !base) return undefined;
    const labels = distinctLabels(
      found.map((s) => [title(s.card.title), s.card.title.romaji, s.card.title.english]),
      found.map((s) => s.label),
    );
    const parts = found.map((s, i) => ({ card: s.card, label: labels[i] }));
    const play = continuePart(parts, played, (v) => animeEntries.entryAt(v)?.anilist, linkedOf) ?? base.card;
    const at = parts.findIndex((p) => p.card.id === play.id);
    return { parts, play, following: parts[at + 1]?.card };
    // `linkedOf` and `title` are new functions every render; what they answer is in `base` and the title setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, base?.card, played, animeTitles]);

  // The IMDb trailer behind the page, as a show's page has (test report 1, item 17): one IMDb id
  // covers the whole franchise and its trailer is the base title's, so only on that entry.
  const root = useRef<HTMLDivElement>(null);
  const onTop = usePageOnTop(root);
  const [scrolledAway, setScrolledAway] = useState(false);
  const bigTrailer = !!useTrailerOpen();
  // What the hero finds is kept with the entry it's for, so an answer for the entry it showed before doesn't count.
  const heroId = source.hero;
  const onImdb = useCallback((id: string | null | undefined) => setHeroImdb(heroId === undefined ? undefined : { of: heroId, id }), [heroId]);
  const imdb = heroId !== undefined && heroImdb?.of === heroId ? heroImdb.id : undefined;

  // One background and logo for every season tab (#27): the base title's linked series, else its ani.zip art.
  // A later entry on its own page (separate shows) has its own ani.zip art.
  const { data: firstZip, isPending: firstZipPending } = useAniZip(first?.id ?? 0, !!first);
  const resolved = source.imdb;
  // Kept once found, so switching tabs (each finds its own id again) never blanks the art.
  const kept = useRef<{ first: number; imdb: string | null }>(undefined);
  if (first && resolved !== undefined && kept.current?.first !== first.id) kept.current = { first: first.id, imdb: resolved };
  const franchiseImdb = first && kept.current?.first === first.id ? kept.current.imdb : resolved;
  // A grouped page's trailer is the base title's on every tab, as its top is (#327).
  const trailerId = found ? (firstKnown ? franchiseImdb : undefined) : firstEntry ? imdb : undefined;
  const trailer = useBackdropTrailer(trailerId?.startsWith("tt") ? trailerId : undefined, { active: onTop, paused: scrolledAway || bigTrailer });
  const { data: meta, isLoading: metaLoading } = useMeta(
    first?.format === "MOVIE" ? "movie" : "series",
    franchiseImdb ?? "",
    !!franchiseImdb?.startsWith("tt"),
  );

  if (isError && !shown) return <EmptyState>Couldn't load this anime from AniList. Try again in a minute.</EmptyState>;
  if (!shown) return <Skeleton className="detail-loading" />;

  const art = franchiseArt({ imdb: franchiseImdb, meta, metaLoading, first: animeArt(first ?? shown, firstZip), firstLoading: !!first && firstZipPending });
  const franchise = seasons && { seasons, active: activeId, select: setActiveId, loading: seasonsLoading, order: found && walk?.order };
  const backdrop = (
    <div className="detail-bg" aria-hidden>
      <Img src={art.background} alt="" loading="eager" className="detail-bg-sharp" />
      {trailer.node}
      <Img src={art.background} alt="" loading="eager" className="detail-bg-blur" />
      <div className="detail-bg-scrim" />
    </div>
  );

  return (
    <div
      className="detail anime-detail"
      ref={root}
      data-trailer={trailer.visible}
      style={{ "--cover": shown.coverImage.color ?? undefined } as React.CSSProperties}
    >
      {!phone && backdrop}
      <div
        className="scroll detail-scroll"
        ref={scroller}
        onScroll={(e) => setScrolledAway(e.currentTarget.scrollTop > e.currentTarget.clientHeight * 0.25)}
      >
        {phone && backdrop}
        {heroFranchise && base ? (
          <AnimeHero
            item={base.card}
            anime={baseAnime}
            logo={art.logo}
            logos={art.logos}
            logoPending={art.pending}
            background={art.background}
            name={title(base.card.title)}
            onImdb={onImdb}
            trailer={trailer}
            franchise={heroFranchise}
          />
        ) : (
          <AnimeHero item={shown} facts={base?.card} anime={anime} logo={art.logo} logos={art.logos} logoPending={art.pending} background={art.background} name={title(shown.title)} onImdb={onImdb} trailer={trailer} pickInTabs={!!franchise} />
        )}
        {loaded && <Body anime={loaded} franchise={franchise} switching={!anime} />}
      </div>
    </div>
  );
}

// --- Below the fold ---------------------------------------------------------

/**
 * Everything below the hero on one page, as a show's own: the episodes in a
 * shelf (or a list, your choice), then the cast, details and franchise links.
 */
function Body({ anime, franchise, switching }: { anime: Anime; franchise?: Franchise; switching: boolean }) {
  const isMovie = anime.format === "MOVIE";
  const hasRelated = anime.relations.edges.length > 0 || anime.recommendations.nodes.some((n) => !!n.mediaRecommendation);
  return (
    <div className="anime-body" data-switching={switching || undefined}>
      {!isMovie && <AnimeEpisodes key={anime.id} anime={anime} franchise={franchise} />}
      {/* A film in a franchise: the season tabs alone, to get back to the series. */}
      {isMovie && franchise && (
        <section className="seasons">
          <SeasonTabs franchise={franchise} />
          <FilmPick key={anime.id} anime={anime} />
        </section>
      )}
      <AnimeListPanels key={`list-${anime.id}`} anime={anime} />
      {anime.characters.edges.length > 0 && <AnimeCharacters anime={anime} />}
      <h2 className="t-title2 anime-section-title">Details</h2>
      <AnimeDetails anime={anime} />
      {hasRelated && <AnimeRelated anime={anime} franchise={franchise} />}
    </div>
  );
}
