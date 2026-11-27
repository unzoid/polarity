import "../styles/anime.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimeCharacters } from "../components/anime/AnimeCharacters";
import { AnimeDetails } from "../components/anime/AnimeDetails";
import { AnimeSeriesPick } from "../components/anime/AnimeSeriesPick";
import { useAnimePlayback } from "../components/anime/useAnimePlayback";
import { useBackdropTrailer } from "../components/BackdropTrailer";
import { useBatchDownload } from "../components/BatchDownload";
import { cardMenu } from "../components/CardMenu";
import { DownloadButton } from "../components/DownloadButton";
import { Img } from "../components/Img";
import { preloadPlayerNow } from "../components/PlayerLayer";
import { SourcePicker, useSourcePicker } from "../components/title/SourcePicker";
import { ScoreRow } from "../components/title/TitleDetails";
import { openTrailer, useTrailerOpen } from "../components/Trailer";
import { EmptyState } from "../components/ui/EmptyState";
import {
  type Anime,
  type AnimeCard,
  animeArt,
  animeEntries,
  animeImdbQuery,
  animeQuery,
  cleanDescription,
  comesOut,
  continuePart,
  countdown,
  distinctLabels,
  FORMAT_LABEL,
  franchiseArt,
  franchiseSummary,
  heroSubtitle,
  isSeason,
  LIKED_THIS_FILL,
  likedThis,
  noSeasonBefore,
  nothingKnownYet,
  pageArtSource,
  partDownloads,
  PENDING_EPISODE,
  playContext,
  relatedRows,
  shelfEpisodes,
  STATUS_LABEL,
  untilAiring,
  upNextLabel,
  useAnime,
  useAnimeScore,
  useAnimeSeasons,
  useAnimeTitle,
  useAniZip,
  useEpisodeFlags,
  useLinkedImdbs,
  useMoreRecommendations,
  usePlayedZip,
  type HeroImdb,
} from "../lib/anime";
import { LIMIT_NOTICE, useTitleVerdict } from "../lib/catalog";
import { formatRemaining, isOpenable, isReleased } from "../lib/format";
import { episodeEntry, watchedFraction } from "../lib/library";
import { useMeta, useProgressOf, useRatings } from "../lib/net";
import type { PlayRequest } from "../lib/playback";
import { useNavigation } from "../lib/router";
import { setPrefs, useEpisodeLayout, usePrefs } from "../lib/settings";
import type { Meta, Progress, Video } from "../lib/types";
import { cardArtUrl, detailBackdropUrl, sizedArt } from "../lib/ui";
import { IconMuted, IconPlay, IconPlayRing, IconSound, IconSources, IconTrailer } from "./icons";
import { ListOverlay } from "./ListOverlay";
import { Action, ListAction, MediaButtons, SeasonDownloadGlyph, Synopsis } from "./titleParts";

type Tab = "episodes" | "more" | "details" | "trailers";

/** Episodes a season shows at a time; a long one (One Piece) picks its range. */
const PAGE = 100;
const NO_VIDEOS: Video[] = [];

/**
 * An anime in the phone's title sheet, laid out as a show's (TitleBody's NetflixTitle): the art or trailer across
 * the top, the name and facts, Play and Download, the story, a row of actions, then tabs: Episodes, More Like This,
 * Details, Trailers. Its data is the anime page's (screens/AnimeDetail.tsx, desk/AnimeTitleView.tsx): AniList's
 * franchise as seasons, ani.zip's episodes, filler and recap marks, and the series it plays from.
 */
export function AnimeTitle({
  id,
  preview,
  episode,
  top,
  onClose,
  onBack,
}: {
  id: number;
  preview?: AnimeCard;
  episode?: string;
  top: boolean;
  onClose: () => void;
  onBack?: () => void;
}) {
  const { animeSeparateEntries: separate, animeTitles } = usePrefs();
  const [activeId, setActiveId] = useState(id);
  useEffect(() => setActiveId(id), [id]);

  const { data: opened } = useAnime(id);
  const { data: walk, isPending: walking } = useAnimeSeasons(separate ? undefined : opened);
  const chain = walk?.seasons;
  const found = !separate && chain && chain.length > 1 && chain.some((s) => s.card.id === id) ? chain : undefined;
  const linked = !!opened?.relations.edges.some((e) => (e.relationType === "PREQUEL" || e.relationType === "SEQUEL") && e.node.type !== "MANGA");
  const seasonsLoading = !separate && linked && (walking || walk?.complete === false);
  const title = useAnimeTitle();
  const ownTab = !!opened && isSeason(opened) && !nothingKnownYet(opened);
  const seasons = found ?? (seasonsLoading && opened && ownTab ? [{ card: opened, label: title(opened.title) }] : undefined);

  const { data: loaded, isError } = useAnime(activeId, { keepPrevious: true });
  const anime = loaded?.id === activeId ? loaded : undefined;
  const shown: AnimeCard | undefined = anime ?? seasons?.find((s) => s.card.id === activeId)?.card ?? (activeId === id ? preview : loaded);

  const linkedOf = useLinkedImdbs(found ? found.map((s) => s.card.id) : shown ? [shown.id] : []);
  const separateFirst = separate && opened ? noSeasonBefore(opened) : undefined;
  const sourceOf = (played: HeroImdb | undefined) =>
    pageArtSource({ separate, seasonsLoading, found: found?.map((s) => s.card), shown, active: activeId, separateFirst, linked: linkedOf, played });
  const artEntry = sourceOf(undefined).first;
  const asked = artEntry && "relations" in artEntry ? artEntry : undefined;
  const qc = useQueryClient();
  const { zip: artZip } = usePlayedZip(asked);
  const { data: plays, isError: noPlays } = useQuery(animeImdbQuery(qc, asked, artZip));
  const artPlays = artEntry && (noPlays || plays !== undefined) ? { of: artEntry.id, id: noPlays ? null : (plays?.id ?? null) } : undefined;
  const source = sourceOf(artPlays);
  const { base, first, known: firstKnown } = source;

  const { data: baseAnime } = useQuery({ ...animeQuery(base?.card.id ?? 0), enabled: !!base });
  const linkedIds = found ? found.map((s) => linkedOf(s.card.id)).filter((x): x is string => !!x?.startsWith("tt")) : [];
  const played = useProgressOf([...new Set(linkedIds)]);
  const franchiseParts = useMemo(() => {
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

  const { data: firstZip, isPending: firstZipPending } = useAniZip(first?.id ?? 0, !!first);
  const resolved = source.imdb;
  // Kept once found, so switching seasons (each finds its own id again) never blanks the art.
  const kept = useRef<{ first: number; imdb: string | null }>(undefined);
  if (first && resolved !== undefined && kept.current?.first !== first.id) kept.current = { first: first.id, imdb: resolved };
  const franchiseImdb = first && kept.current?.first === first.id ? kept.current.imdb : resolved;
  const { data: meta, isLoading: metaLoading } = useMeta(first?.format === "MOVIE" ? "movie" : "series", franchiseImdb ?? "", !!franchiseImdb?.startsWith("tt"));

  // The viewing limit, as a show's page has it: TMDB's certification, or AniList's adult genre.
  const limitSubject = useMemo(
    () =>
      meta ??
      (shown
        ? {
            id: franchiseImdb ?? `anilist:${shown.id}`,
            type: shown.format === "MOVIE" ? ("movie" as const) : ("series" as const),
            name: title(shown.title),
            certification: shown.genres?.some((g) => /^hentai$/i.test(g)) ? "NC-17" : undefined,
          }
        : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta, shown, franchiseImdb],
  );
  const verdict = useTitleVerdict(limitSubject, !!meta || (!metaLoading && franchiseImdb !== undefined) || isError);

  const [sheets, setSheets] = useState(0);
  const onSheet = useCallback((open: boolean) => setSheets((n) => Math.max(0, n + (open ? 1 : -1))), []);
  const bigTrailer = !!useTrailerOpen();
  const trailerId = firstKnown && franchiseImdb?.startsWith("tt") ? franchiseImdb : undefined;
  const trailer = useBackdropTrailer(trailerId, { active: top && verdict === "show", paused: sheets > 0 || bigTrailer });
  const picker = useSourcePicker(onSheet);

  // Play carries on across the whole franchise when it's grouped; the Episodes tab is the open season's.
  const headItem = franchiseParts && base ? base.card : shown;
  const headAnime = franchiseParts && base ? baseAnime : anime;
  const playingEntry = franchiseParts?.play ?? headAnime ?? headItem;
  const placeholder = shown ?? ({ id, title: { romaji: "" }, coverImage: {} } as AnimeCard);
  const firstPb = useAnimePlayback(playingEntry ?? placeholder);
  const afterPb = useAnimePlayback(franchiseParts?.following ?? playingEntry ?? placeholder);
  const pb = franchiseParts?.following && firstPb.next.finished ? afterPb : firstPb;
  const activePb = useAnimePlayback(loaded ?? shown ?? placeholder);
  const { data: ratings } = useRatings(pb.isMovie ? "movie" : "series", pb.metaId ?? "");

  const summary = useMemo(() => (franchiseParts ? franchiseSummary(franchiseParts.parts) : undefined), [franchiseParts]);
  const formatScore = useAnimeScore();

  const isMovieOnly = !seasons && shown?.format === "MOVIE";
  const ytTrailerId = (headAnime ?? anime)?.trailer?.site === "youtube" ? (headAnime ?? anime)!.trailer!.id : meta?.trailerYtId;
  const tabs = useMemo((): { id: Tab; label: string }[] => {
    const list: { id: Tab; label: string }[] = [];
    if (!isMovieOnly) list.push({ id: "episodes", label: "Episodes" });
    list.push({ id: "more", label: "More Like This" });
    list.push({ id: "details", label: "Details" });
    if (ytTrailerId) list.push({ id: "trailers", label: "Trailers" });
    return list;
  }, [isMovieOnly, ytTrailerId]);
  const [tab, setTab] = useState<Tab>(isMovieOnly ? "more" : "episodes");
  const shownTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  if (verdict === "hide")
    return (
      <div className="ps-body">
        <MediaButtons onClose={onClose} onBack={onBack} />
        <EmptyState>{LIMIT_NOTICE}</EmptyState>
      </div>
    );
  if (isError && !shown)
    return (
      <div className="ps-body">
        <MediaButtons onClose={onClose} onBack={onBack} />
        <EmptyState>Couldn't load this anime from AniList. Try again in a minute.</EmptyState>
      </div>
    );
  if (!shown || verdict === "wait" || (seasonsLoading && !found)) {
    const art = preview?.bannerImage ?? preview?.coverImage.extraLarge ?? preview?.coverImage.large;
    return (
      <div className="ps-body" aria-busy>
        <div className="ps-media scheme-dark">
          {art && <Img className="ps-media-art" src={art} alt="" loading="eager" />}
          <MediaButtons onClose={onClose} onBack={onBack} />
        </div>
        <div className="ps-scroll">
          <div className="ps-info">
            <span className="ps-sk ps-sk-title" />
            <span className="ps-sk ps-sk-line" />
            <span className="ps-sk ps-sk-btn" />
            <span className="ps-sk ps-sk-btn" />
            <span className="ps-sk ps-sk-text" />
            <span className="ps-sk ps-sk-text ps-sk-short" />
          </div>
        </div>
      </div>
    );
  }

  const rawArt = franchiseArt({ imdb: franchiseImdb, meta, metaLoading, first: animeArt(first ?? shown, firstZip), firstLoading: !!first && firstZipPending });
  const art = detailBackdropUrl(rawArt.background, true) ?? rawArt.background;
  const coverFallbacks = [meta?.poster, first?.coverImage.extraLarge, first?.coverImage.large, shown.coverImage.extraLarge, shown.coverImage.large].filter(
    (u): u is string => !!u,
  );
  const fallbackBg = art ?? coverFallbacks[0];

  const head = headItem ?? shown;
  const displayName = title(head.title);
  const subTitle = heroSubtitle(head.title, animeTitles, false);
  const score = formatScore(head.averageScore);
  const studios = (headAnime ?? anime)?.studios.edges.filter((e) => e.node.isAnimationStudio).map((e) => e.node.name) ?? [];
  const factsSource = base?.card ?? shown;
  const nextAiring = summary ? summary.airing : head.nextAiringEpisode;
  const facts: string[] = summary
    ? [summary.years, summary.parts, summary.status].filter((x): x is string => !!x)
    : [
        factsSource.seasonYear ? String(factsSource.seasonYear) : undefined,
        factsSource.format && FORMAT_LABEL[factsSource.format],
        factsSource.format === "MOVIE"
          ? factsSource.duration
            ? `${factsSource.duration} min`
            : undefined
          : factsSource.episodes
            ? `${factsSource.episodes} Episode${factsSource.episodes === 1 ? "" : "s"}`
            : undefined,
        factsSource.status && STATUS_LABEL[factsSource.status],
      ].filter((x): x is string => !!x);

  const target = pb.isMovie ? pb.metaId : pb.next.ep?.video?.id;
  const request: PlayRequest | null =
    target && pb.metaId
      ? {
          type: pb.isMovie ? "movie" : "series",
          metaId: pb.metaId,
          videoId: target,
          resumable: !!pb.next.resumeAt,
          subtitle: pb.next.ep ? `Episode ${pb.next.ep.number}${pb.next.ep.title ? ` · ${pb.next.ep.title}` : ""}` : displayName,
        }
      : null;
  const playLabel = upNextLabel(pb.next, pb.isMovie);
  const playVideo = pb.next.ep?.video;
  const watched = target ? pb.byVideo.get(target) : undefined;
  const resuming = !!pb.next.resumeAt && !!watched?.duration;
  const nextEp = !pb.isMovie && (resuming || pb.next.kind === "next") ? pb.next.ep : undefined;
  const synopsis = cleanDescription((headAnime ?? anime)?.description).join(" ");
  const unavailable =
    !pb.loading && !pb.metaId ? "Not linked to any sources yet" : !pb.metaLoading && pb.metaId && !target && !pb.isMovie ? "No episodes to play yet" : undefined;

  const seasonChoices = seasons
    ? distinctLabels(
        seasons.map((s) => [title(s.card.title), s.card.title.romaji, s.card.title.english]),
        seasons.map((s) => s.label),
      ).map((label, i) => ({ id: seasons[i].card.id, label }))
    : [];

  return (
    <div className="ps-body">
      <div className="ps-media scheme-dark">
        {fallbackBg && <Img className="ps-media-art" src={fallbackBg} fallbacks={coverFallbacks} alt="" loading="eager" fetchPriority="high" />}
        {trailer.node}
        <MediaButtons onClose={onClose} onBack={onBack} />
        {trailer.state !== "idle" && (
          <button
            type="button"
            className="ps-mute"
            aria-label={trailer.state === "ended" ? "Replay trailer" : trailer.muted ? "Turn trailer sound on" : "Mute trailer"}
            onClick={trailer.state === "ended" ? trailer.replay : trailer.toggleMute}
          >
            {trailer.muted || trailer.state === "ended" ? <IconMuted size={16} /> : <IconSound size={16} />}
          </button>
        )}
      </div>
      <div className="ps-scroll">
        <div className="ps-info">
          <h1 className="ps-title">{displayName}</h1>
          {subTitle && <p className="ps-subtitle">{subTitle}</p>}
          <p className="ps-facts">
            {score && <span className="ps-fact-badge">★ {score}</span>}
            {facts.map((f, i) => (
              <span key={`${f}-${i}`}>{f}</span>
            ))}
          </p>
          {ratings && (
            <div className="ps-scores">
              <ScoreRow ratings={ratings} />
            </div>
          )}
          {nextAiring && (
            <p className="ps-airing tabular">
              {summary?.airing ? `${summary.airing.label} · ` : ""}Episode {nextAiring.episode} in {countdown(untilAiring(nextAiring.airingAt))}
            </p>
          )}
          <button type="button" className="ps-btn ps-btn-white" disabled={!request} onPointerDown={preloadPlayerNow} onClick={() => request && picker.play(request)}>
            <IconPlay size={27} />
            {playLabel}
          </button>
          {pb.meta && (pb.isMovie || playVideo) && (
            <DownloadButton
              item={pb.meta}
              video={pb.isMovie ? undefined : playVideo}
              className="ps-btn ps-btn-grey"
              size={22}
              text={pb.isMovie ? "Download" : `Download Ep ${pb.next.ep?.number ?? playVideo?.episode ?? 1}`}
            />
          )}
          {resuming && watched && (
            <div className="ps-resume">
              {nextEp && (
                <p className="ps-resume-title">
                  Episode {nextEp.number}
                  {nextEp.title ? ` · ${nextEp.title}` : ""}
                </p>
              )}
              <div className="ps-resume-bar">
                <span className="ph-progress ps-progress">
                  <i style={{ width: `${Math.round(Math.min(1, watched.position / watched.duration) * 100)}%` }} />
                </span>
                <span>{formatRemaining(watched.position, watched.duration)}</span>
              </div>
            </div>
          )}
          {!resuming && nextEp && (
            <p className="ps-resume-title ps-up-next">
              Episode {nextEp.number}
              {nextEp.title ? ` · ${nextEp.title}` : ""}
            </p>
          )}
          <Synopsis text={nextEp?.overview || synopsis} />
          <div className="ps-credits">
            {studios.length > 0 && <p>Studio: {studios.slice(0, 3).join(", ")}</p>}
            {!!head.genres?.length && <p>Genres: {head.genres.slice(0, 5).join(", ")}</p>}
            {(unavailable || pb.pickable) && (
              <p className="ps-anime-link">
                {unavailable && <span>{unavailable}</span>}
                {pb.pickable && <AnimeSeriesPick anime={playingEntry ?? shown} isMovie={pb.isMovie} current={pb.metaId} mal={pb.malId} kitsu={pb.kitsu} />}
              </p>
            )}
          </div>
        </div>
        <AnimeActions
          meta={pb.meta}
          name={displayName}
          imdbId={pb.metaId?.startsWith("tt") ? pb.metaId : undefined}
          ytTrailerId={ytTrailerId}
          request={request}
          onSources={() => request && picker.choose(request)}
          activeAnime={loaded}
          activePb={activePb}
        />
        <nav className="ps-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === shownTab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ps-tab-body">
          {shownTab === "episodes" && loaded && (
            <AnimeEpisodes
              anime={loaded}
              pb={activePb}
              seasonChoices={seasonChoices}
              activeSeasonId={activeId}
              onSelectSeason={setActiveId}
              seasonsLoading={seasonsLoading}
              episode={episode}
              onSheet={onSheet}
              fallbackBg={fallbackBg}
            />
          )}
          {shownTab === "more" && loaded && <AnimeMore anime={loaded} franchiseCards={seasons?.map((s) => s.card)} />}
          {shownTab === "details" && loaded && (
            <div className="ps-anime-details">
              {(loaded.characters.edges.length > 0 || loaded.staff.edges.length > 0) && <AnimeCharacters anime={loaded} />}
              <AnimeDetails anime={loaded} />
            </div>
          )}
          {shownTab === "trailers" && ytTrailerId && (
            <div className="ps-trailers">
              <button
                type="button"
                className="ps-trailer"
                onClick={() => openTrailer({ name: displayName, imdbId: pb.metaId?.startsWith("tt") ? pb.metaId : undefined, ytId: ytTrailerId, ytFrom: "AniList" })}
              >
                <span className="ps-trailer-still scheme-dark">
                  {fallbackBg && <Img src={fallbackBg} alt="" loading="lazy" />}
                  <span className="ps-trailer-play" aria-hidden>
                    <IconPlayRing size={44} />
                  </span>
                </span>
                <span className="ps-trailer-name">Trailer: {displayName}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <SourcePicker picker={picker} />
    </div>
  );
}

/** Add to List, Trailer, Sources, and the open season's download, as a show's row has them. */
function AnimeActions({
  meta,
  name,
  imdbId,
  ytTrailerId,
  request,
  onSources,
  activeAnime,
  activePb,
}: {
  meta?: Meta;
  name: string;
  imdbId?: string;
  ytTrailerId?: string;
  request: PlayRequest | null;
  onSources: () => void;
  activeAnime?: Anime;
  activePb: ReturnType<typeof useAnimePlayback>;
}) {
  const { animeHideRecaps } = usePrefs();
  const { data: flags } = useEpisodeFlags(activePb.malId, activeAnime ? [activeAnime.title.english, activeAnime.title.romaji] : []);
  const list = useMemo(() => shelfEpisodes(activePb.episodes, flags, animeHideRecaps), [activePb.episodes, flags, animeHideRecaps]);
  const downloads = useMemo(() => partDownloads(list), [list]);
  return (
    <div className="ps-actions">
      {meta && <ListAction item={meta} />}
      {ytTrailerId && (
        <Action label="Trailer" onClick={() => openTrailer({ name, imdbId, ytId: ytTrailerId, ytFrom: "AniList" })}>
          <IconTrailer size={27} />
        </Action>
      )}
      <Action label="Sources" disabled={!request} onClick={onSources}>
        <IconSources size={27} />
      </Action>
      {meta && activeAnime && !activePb.isMovie && downloads.length > 0 && <SeasonDownload item={meta} videos={downloads} part={activeAnime.id} />}
    </div>
  );
}

function SeasonDownload({ item, videos, part }: { item: Meta; videos: Video[]; part: number }) {
  const d = useBatchDownload({ item, videos, part });
  return (
    <Action
      label={
        d.running ? (
          "Downloading"
        ) : (
          <>
            Download
            <br />
            Season
          </>
        )
      }
      disabled={d.disabled && !d.running}
      onClick={d.start}
    >
      <SeasonDownloadGlyph />
    </Action>
  );
}

const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * The open season's episodes: the season (a chooser when the franchise has several), the range of a long one,
 * hiding recaps when there are fillers, and the show's two layouts. A film in the franchise is one card to play.
 */
function AnimeEpisodes({
  anime,
  pb,
  seasonChoices,
  activeSeasonId,
  onSelectSeason,
  seasonsLoading,
  episode,
  onSheet,
  fallbackBg,
}: {
  anime: Anime;
  pb: ReturnType<typeof useAnimePlayback>;
  seasonChoices: { id: number; label: string }[];
  activeSeasonId: number;
  onSelectSeason: (id: number) => void;
  seasonsLoading: boolean;
  episode?: string;
  onSheet: (open: boolean) => void;
  fallbackBg?: string;
}) {
  const prefs = usePrefs();
  const [layout, setLayout] = useEpisodeLayout();
  const [choosing, setChoosing] = useState<"season" | "range" | null>(null);
  const picker = useSourcePicker(onSheet);
  const { data: flags } = useEpisodeFlags(pb.malId, [anime.title.english, anime.title.romaji]);
  const hasFiller = !!flags && [...flags.values()].some((f) => f.filler);
  const list = useMemo(() => shelfEpisodes(pb.episodes ?? NO_VIDEOS, flags, prefs.animeHideRecaps), [pb.episodes, flags, prefs.animeHideRecaps]);

  // The player skips fillers when asked to (Settings → Anime): it's told which they are.
  useEffect(() => {
    if (flags && pb.metaId)
      playContext.filler(
        pb.metaId,
        pb.episodes.flatMap((e) => (e.video ? [e.video.id] : [])),
        pb.episodes.flatMap((e) => (e.video && flags.get(e.number)?.filler ? [e.video.id] : [])),
      );
  }, [flags, pb.episodes, pb.metaId]);

  const pages = Math.ceil(list.length / PAGE);
  const [page, setPage] = useState<number | null>(null);
  useEffect(() => setPage(null), [anime.id]);
  const upNextId = pb.next.kind !== "start" ? pb.next.ep?.video?.id : undefined;
  const upTo = Math.max(0, list.findIndex((v) => v.id === (pb.next.ep?.video?.id ?? "")));
  const currentPage = Math.min(Math.max(0, pages - 1), page ?? Math.floor(upTo / PAGE));
  const visible = pages > 1 ? list.slice(currentPage * PAGE, currentPage * PAGE + PAGE) : list;

  const request = (v: Video): PlayRequest | undefined =>
    v.id.startsWith(PENDING_EPISODE) || !pb.metaId
      ? undefined
      : { type: "series", metaId: pb.metaId, videoId: v.id, resumable: pb.byVideo.has(v.id), subtitle: `Episode ${v.episode}${v.title ? ` · ${v.title}` : ""}` };

  // Opened at an episode (a notification, Continue Watching): its sources come up once.
  const offered = useRef(false);
  useEffect(() => {
    if (!episode || offered.current || !pb.metaId) return;
    const linked = list.find((v) => v.id === episode);
    const req = linked ? request(linked) : undefined;
    if (!req) return;
    offered.current = true;
    picker.choose(req);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, list, pb.metaId]);

  const seasonLabel = seasonChoices.find((s) => s.id === activeSeasonId)?.label ?? anime.title.english ?? anime.title.romaji ?? "Episodes";
  const rangeOptions = Array.from({ length: pages }, (_, i) => ({
    id: i,
    label: `Episodes ${list[i * PAGE]?.episode}–${list[Math.min(list.length, (i + 1) * PAGE) - 1]?.episode}`,
  }));
  const isMoviePart = anime.format === "MOVIE";
  const movieReq: PlayRequest | undefined =
    isMoviePart && pb.metaId ? { type: "movie", metaId: pb.metaId, videoId: pb.metaId, resumable: !!pb.next.resumeAt, subtitle: seasonLabel } : undefined;
  const runtime = anime.duration ? `${anime.duration}m` : undefined;
  const play = (v: Video) => {
    const req = request(v);
    if (req) picker.play(req);
  };

  return (
    <section className="ps-episodes" data-layout={isMoviePart ? "list" : layout}>
      <div className="ps-season-bar">
        {seasonChoices.length > 1 ? (
          <button type="button" className="ps-season-btn" onClick={() => setChoosing("season")}>
            <span>{seasonLabel}</span>
            <Chevron />
          </button>
        ) : (
          <span className="ps-season-name">{seasonsLoading ? `${seasonLabel}…` : seasonLabel}</span>
        )}
        <span className="ps-flex" />
        {!isMoviePart && (
          <div className="ps-layout" role="radiogroup" aria-label="Episode layout">
            <button type="button" role="radio" aria-checked={layout === "row"} aria-label="Side by side" onClick={() => setLayout("row")}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <rect x="2" y="5" width="7" height="10" rx="2" fill="currentColor" />
                <rect x="11" y="5" width="7" height="10" rx="2" fill="currentColor" opacity="0.55" />
              </svg>
            </button>
            <button type="button" role="radio" aria-checked={layout === "list"} aria-label="Listed" onClick={() => setLayout("list")}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <rect x="2" y="3.5" width="16" height="5.5" rx="1.8" fill="currentColor" />
                <rect x="2" y="11" width="16" height="5.5" rx="1.8" fill="currentColor" opacity="0.55" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {!isMoviePart && (pages > 1 || hasFiller) && (
        <div className="ps-ep-tools">
          {pages > 1 && (
            <button type="button" className="ps-chip" onClick={() => setChoosing("range")}>
              {rangeOptions[currentPage]?.label}
              <Chevron />
            </button>
          )}
          {hasFiller && (
            <button type="button" className="ps-chip" aria-pressed={prefs.animeHideRecaps} onClick={() => setPrefs({ animeHideRecaps: !prefs.animeHideRecaps })}>
              {prefs.animeHideRecaps ? "Recaps hidden" : "Hide recaps"}
            </button>
          )}
        </div>
      )}

      {isMoviePart ? (
        <ol className="ps-episode-list">
          <li className="ps-episode">
            <div className="ps-episode-head">
              <button type="button" className="ps-episode-still scheme-dark" aria-label={`Play ${seasonLabel}`} disabled={!movieReq} onClick={() => movieReq && picker.play(movieReq)}>
                <Img src={anime.bannerImage ?? fallbackBg} fallbacks={[anime.coverImage.extraLarge ?? ""].filter(Boolean)} alt="" loading="lazy" />
                {movieReq && (
                  <span className="ps-episode-play" aria-hidden>
                    <IconPlayRing size={34} />
                  </span>
                )}
              </button>
              <div className="ps-episode-name">
                <strong>{seasonLabel}</strong>
                <span>{[runtime, anime.seasonYear].filter(Boolean).join(" · ")}</span>
              </div>
              {movieReq && pb.meta && <DownloadButton item={pb.meta} className="ps-episode-dl" size={22} />}
            </div>
            {anime.description && <p className="ps-episode-text">{cleanDescription(anime.description)[0]}</p>}
          </li>
        </ol>
      ) : pb.loading ? (
        <p className="ps-empty">Loading episodes…</p>
      ) : !visible.length ? (
        <p className="ps-empty">{comesOut(anime) ? `${comesOut(anime)}.` : pb.metaLoading ? "Loading episodes…" : "No episodes to play yet."}</p>
      ) : layout === "row" ? (
        <EpisodeStrip key={`${anime.id}:${currentPage}`} meta={pb.meta} episodes={visible} progress={pb.byVideo} flags={flags} upNextId={upNextId} runtime={runtime} fallbackBg={fallbackBg} onPlay={play} />
      ) : (
        <ol className="ps-episode-list">
          {visible.map((v) => (
            <EpisodeRow key={v.id} meta={pb.meta} video={v} progress={pb.byVideo.get(v.id)} flag={flags?.get(v.episode)} runtime={runtime} fallbackBg={fallbackBg} onPlay={play} />
          ))}
        </ol>
      )}

      <ListOverlay
        open={choosing === "season"}
        label="Seasons"
        options={seasonChoices}
        value={activeSeasonId}
        onPick={(id) => {
          onSelectSeason(id);
          setChoosing(null);
        }}
        onClose={() => setChoosing(null)}
      />
      <ListOverlay
        open={choosing === "range"}
        label="Episodes"
        options={rangeOptions}
        value={currentPage}
        onPick={(i) => {
          setPage(i);
          setChoosing(null);
        }}
        onClose={() => setChoosing(null)}
      />
      <SourcePicker picker={picker} />
    </section>
  );
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M2.5 5l4.5 4.5L11.5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Flag = { filler?: boolean; recap?: boolean };

/**
 * Where an episode stands: out yet, how far along, watched. One listed for the coming week can already be played
 * (`soon`): services often put it out before the listed date (#143).
 */
function episodeState(v: Video, p: Progress | undefined, meta?: Meta) {
  const unreleased = v.id.startsWith(PENDING_EPISODE) || !isOpenable(v);
  const soon = !unreleased && !isReleased(v);
  const fraction = p && p.duration > 0 ? p.position / p.duration : 0;
  const watched = fraction >= watchedFraction();
  return { playable: !unreleased && !!meta, unreleased, soon, fraction, watched, inProgress: fraction > 0 && !watched };
}

function Badges({ flag }: { flag?: Flag }) {
  if (!flag?.filler && !flag?.recap) return null;
  return (
    <>
      {flag.filler && <span className="ps-ep-badge">Filler</span>}
      {flag.recap && <span className="ps-ep-badge">Recap</span>}
    </>
  );
}

/** A season's episodes side by side, opening on the one you're up to (TitleBody's strip, with filler marks). */
function EpisodeStrip({
  meta,
  episodes,
  progress,
  flags,
  upNextId,
  runtime,
  fallbackBg,
  onPlay,
}: {
  meta?: Meta;
  episodes: Video[];
  progress: Map<string, Progress>;
  flags?: Map<number, Flag>;
  upNextId?: string;
  runtime?: string;
  fallbackBg?: string;
  onPlay: (v: Video) => void;
}) {
  const strip = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>("[data-up-next]");
    if (el && strip.current) strip.current.scrollLeft = el.offsetLeft - 12;
    // Only when the season opens: later progress mustn't move the row under a finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ol className="ps-ep-strip" ref={strip}>
      {episodes.map((v) => (
        <EpisodeCard key={v.id} meta={meta} video={v} progress={progress.get(v.id)} flag={flags?.get(v.episode)} isUpNext={v.id === upNextId} runtime={runtime} fallbackBg={fallbackBg} onPlay={onPlay} />
      ))}
    </ol>
  );
}

const EpisodeCard = memo(function EpisodeCard({
  meta,
  video: v,
  progress: p,
  flag,
  isUpNext,
  runtime,
  fallbackBg,
  onPlay,
}: {
  meta?: Meta;
  video: Video;
  progress?: Progress;
  flag?: Flag;
  isUpNext: boolean;
  runtime?: string;
  fallbackBg?: string;
  onPlay: (v: Video) => void;
}) {
  const s = episodeState(v, p, meta);
  return (
    <li className="ps-ep-card" data-up-next={isUpNext || undefined} {...(meta && s.playable ? cardMenu(meta, episodeEntry(meta, v, p), { episode: true }) : {})}>
      <button type="button" className="ps-ep-still scheme-dark" aria-label={`Play episode ${v.episode}`} disabled={!s.playable} onClick={() => onPlay(v)}>
        <Img src={v.thumbnail ? sizedArt(v.thumbnail, "w500") : fallbackBg} fallbacks={fallbackBg ? [fallbackBg] : undefined} alt="" loading="lazy" />
        {s.playable ? (
          <span className="ps-ep-play" aria-hidden>
            <IconPlay size={18} />
          </span>
        ) : (
          <span className="ps-ep-soon">{v.released ? shortDateFmt.format(new Date(v.released)) : "Soon"}</span>
        )}
        {s.fraction > 0 && (
          <span className="ph-progress" aria-hidden>
            <i style={{ width: `${Math.round(Math.min(1, s.fraction) * 100)}%` }} />
          </span>
        )}
      </button>
      <div className="ps-ep-head">
        <strong>
          <span className="ps-ep-num">{v.episode}</span>
          {v.title?.trim() || `Episode ${v.episode}`}
          <Badges flag={flag} />
        </strong>
        {s.playable && meta && <DownloadButton item={meta} video={v} className="ps-episode-dl" size={20} />}
      </div>
      <span className="ps-ep-meta">
        {[s.inProgress && p ? formatRemaining(p.position, p.duration) : runtime, v.released && !s.unreleased ? `${s.soon ? "Airs " : ""}${fullDateFmt.format(new Date(v.released))}` : undefined]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {v.overview && <p className="ps-ep-text">{v.overview}</p>}
    </li>
  );
});

const EpisodeRow = memo(function EpisodeRow({
  meta,
  video: v,
  progress: p,
  flag,
  runtime,
  fallbackBg,
  onPlay,
}: {
  meta?: Meta;
  video: Video;
  progress?: Progress;
  flag?: Flag;
  runtime?: string;
  fallbackBg?: string;
  onPlay: (v: Video) => void;
}) {
  const s = episodeState(v, p, meta);
  return (
    <li className="ps-episode" {...(meta && s.playable ? cardMenu(meta, episodeEntry(meta, v, p), { episode: true }) : {})}>
      <div className="ps-episode-head">
        <button type="button" className="ps-episode-still scheme-dark" aria-label={`Play episode ${v.episode}`} disabled={!s.playable} onClick={() => onPlay(v)}>
          <Img src={v.thumbnail ? sizedArt(v.thumbnail, "w300") : fallbackBg} fallbacks={fallbackBg ? [fallbackBg] : undefined} alt="" loading="lazy" />
          {s.playable && (
            <span className="ps-episode-play" aria-hidden>
              <IconPlayRing size={34} />
            </span>
          )}
          {s.fraction > 0 && (
            <span className="ph-progress" aria-hidden>
              <i style={{ width: `${Math.round(Math.min(1, s.fraction) * 100)}%` }} />
            </span>
          )}
        </button>
        <div className="ps-episode-name">
          <strong>
            {v.episode}. {v.title?.trim() || `Episode ${v.episode}`}
          </strong>
          <span>
            {s.unreleased
              ? v.released
                ? `Coming ${shortDateFmt.format(new Date(v.released))}`
                : "Not yet released"
              : s.soon && v.released
                ? `Airs ${shortDateFmt.format(new Date(v.released))}`
                : s.inProgress && p
                  ? formatRemaining(p.position, p.duration)
                  : runtime}
            <Badges flag={flag} />
          </span>
        </div>
        {s.playable && meta && <DownloadButton item={meta} video={v} className="ps-episode-dl" size={22} />}
      </div>
      {v.overview && <p className="ps-episode-text">{v.overview}</p>}
    </li>
  );
});

/** The franchise's other entries and AniList's recommendations, three posters across. */
function AnimeMore({ anime, franchiseCards }: { anime: Anime; franchiseCards?: AnimeCard[] }) {
  const { animeSeparateEntries: separate } = usePrefs();
  const title = useAnimeTitle();
  const { navigate } = useNavigation();
  const own = franchiseCards ?? [];
  const first = likedThis(anime, anime.recommendations.nodes, own, separate);
  const { data: more } = useMoreRecommendations(anime.id, first.length < LIKED_THIS_FILL && !!anime.recommendations.hasNextPage);
  const recs = more ? likedThis(anime, [...anime.recommendations.nodes, ...more.nodes], own, separate) : first;
  const { watchOrder, also } = relatedRows(
    anime,
    franchiseCards ? { seasons: franchiseCards.map((c) => ({ card: c, label: title(c.title) })), active: anime.id, loading: false } : undefined,
  );
  const related = [...watchOrder, ...also].filter((c) => c.card.type !== "MANGA").map((c) => c.card);
  const combined = [...related, ...recs].filter((c, i, all) => c.id !== anime.id && all.findIndex((x) => x.id === c.id) === i);
  if (!combined.length) return <p className="ps-empty">Nothing similar found yet.</p>;
  return (
    <div className="ps-grid">
      {combined.map((m) => {
        const name = title(m.title);
        const art = cardArtUrl(m.coverImage.extraLarge ?? m.coverImage.large, "poster");
        return (
          <button key={m.id} type="button" className="ph-poster scheme-dark" data-origin="4" aria-label={name} onClick={() => navigate({ name: "anime-detail", id: m.id, preview: m })}>
            {art ? <Img src={art} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="ph-poster-name">{name}</span>}
          </button>
        );
      })}
    </div>
  );
}
