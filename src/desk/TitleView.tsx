import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "../styles/title/episode-ratings.css";
import { useBatchDownload } from "../components/BatchDownload";
import { useBackdropTrailer } from "../components/BackdropTrailer";
import { BrandIcon } from "../components/BrandIcon";
import { cardMenu } from "../components/CardMenu";
import { DownloadButton } from "../components/DownloadButton";
import { Download } from "../components/icons";
import { Img } from "../components/Img";
import { preloadPlayerNow } from "../components/PlayerLayer";
import { TitleLogo } from "../components/TitleLogo";
import { imdbUrl } from "../components/RatingRing";
import { useEpisodeRatings } from "../components/title/EpisodeRatings";
import { playExtra } from "../components/title/ExtrasShelf";
import { SourcePicker, useSourcePicker } from "../components/title/SourcePicker";
import { ScoreRow } from "../components/title/TitleDetails";
import { openTrailer, useTrailerOpen } from "../components/Trailer";
import {
  FORMAT_LABEL,
  SEASON_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  playContext,
  useAnimeDetails,
  useAnimeShowInfo,
  useEpisodeFlags,
  type AnimeCard,
  type EpisodeFlags,
  type MediaFormat,
  type MediaSeason,
  type MediaStatus,
} from "../lib/anime";
import { call } from "../lib/platform/bridge";
import { setPrefs, useEpisodeLayout, usePrefs } from "../lib/settings";
import type { AnimeSeasonMapping, ContentType, ExternalRatings, Extra, Meta, MetaPreview, Progress, Video } from "../lib/types";
import { api } from "../lib/api";
import { extraKind, extraStills, LIMIT_NOTICE, useBrowseVisible, useListable, useTitleVerdict } from "../lib/catalog";
import { errorMessage } from "../lib/errors";
import { episodeCode, formatRemaining, formatRuntime, isOpenable, isReleased } from "../lib/format";
import { downloadableEpisodes, episodeEntry, progressMap, seasonsOf, shelfGroupOf, shelfGroups, upNext, useEpisodeOrders, watchedFraction } from "../lib/library";
import { useCollection, useMeta, useProgress, useRatings, useRecommend, useStreams } from "../lib/net";
import { trailerFor, useFileTrailer, usePlayTarget, type PlayRequest } from "../lib/playback";
import { useNavigation } from "../lib/router";
import { cardArtUrl, detailBackdropUrl, lazyNamed, sizedArt } from "../lib/ui";
import { useHorizontalWindow, useVerticalWindow } from "../lib/ui/windowing";
import { IconCheck, IconChevronRight, IconMuted, IconPlay, IconPlayRing, IconPlus, IconSound, IconSources, IconTrailer } from "../phone/icons";
import { AnimatedSwap, EpisodeSearch, filterEpisodes } from "./EpisodeTools";
import { DeskRatingsOverlay } from "./RatingsOverlay";
import { Poster, ProgressLine as ProgressBar } from "./Rows";
import { SeasonChooser } from "./SeasonChooser";
import { CompactPlay, IconRatingsGrid, ListAction, NextUp, PinnedBar, useCardStrip } from "./TitleParts";

const AnimeTitleView = lazyNamed(() => import("./AnimeTitleView"), "AnimeTitleView");
export const preloadAnimeTitleView = () => void AnimeTitleView.preload().catch(() => {});

type Props = {
  type: ContentType;
  id: string;
  preview?: MetaPreview;
  episode?: string;
  /** Auto-select this season number when opened from a seasonal anime shelf. */
  season?: number;
  /** The title showing in its dialog (not one under a title opened from it). */
  top: boolean;
};

/**
 * Unified show-first title in the dialog: movies, shows, and anime all open directly in NetflixTitle
 * with zero AniList redirect waterfall.
 */
export function TitleView(props: Props) {
  return <NetflixTitle {...props} />;
}

/** Compatibility bridge for legacy `anime-detail` routes (by AniList id): resolves locally via Fribb in 0ms. */
export function AnimeView({
  id,
  preview,
  episode,
  top = true,
  fallbackArt,
}: {
  id: number;
  preview?: AnimeCard;
  episode?: string;
  top?: boolean;
  fallbackArt?: string;
}) {
  const { data: mapping, isPending } = useQuery({
    queryKey: ["anime", "resolve-anilist", id],
    staleTime: Infinity,
    queryFn: () => call<AnimeSeasonMapping | null>("anime_ids", { key: "anilist_id", value: String(id) }).catch(() => null),
  });
  const canonical = mapping?.imdb_id ?? (mapping?.kitsu_id ? `kitsu:${mapping.kitsu_id}` : mapping?.mal_id ? `mal:${mapping.mal_id}` : undefined);
  const season = mapping?.season?.tmdb ?? mapping?.season?.tvdb;
  const skArt = preview?.bannerImage ?? preview?.coverImage.extraLarge ?? preview?.coverImage.large ?? fallbackArt;
  if (isPending) return <Outline art={skArt} />;
  if (canonical) {
    const type: ContentType = preview?.format === "MOVIE" || mapping?.type === "MOVIE" ? "movie" : "series";
    return <NetflixTitle type={type} id={canonical} episode={episode} season={season} top={top} />;
  }
  return (
    <Suspense fallback={<Outline art={skArt} />}>
      <AnimeTitleView id={id} preview={preview} episode={episode} top={top} fallbackArt={fallbackArt} />
    </Suspense>
  );
}

function Outline({ preview, art: directArt }: { preview?: MetaPreview; art?: string }) {
  const art = directArt ?? detailBackdropUrl(preview?.background ?? preview?.poster);
  if (preview) return <PreviewOutline preview={preview} art={art} />;
  return (
    <div className="dk-t" aria-busy>
      <div className="dk-t-media scheme-dark">{art && <Img className="dk-t-art" src={art} alt="" loading="eager" />}</div>
      <div className="dk-t-info">
        <span className="dk-sk dk-sk-title" />
        <span className="dk-sk dk-sk-line" />
        <span className="dk-sk dk-sk-btn" />
        <span className="dk-sk dk-sk-text" />
        <span className="dk-sk dk-sk-text dk-sk-short" />
      </div>
    </div>
  );
}

/**
 * The title before its details arrive, drawn from what the poster already knows, in the page's real layout: the art and
 * its logo, the name and year, Play and Download, the tiles, the synopsis. Nothing in it moves when the details land;
 * the controls are just not live yet (data-wait: full strength, not greyed, since nobody reaches them that fast).
 */
function PreviewOutline({ preview, art }: { preview: MetaPreview; art?: string }) {
  const logo = preview.logo ? sizedArt(preview.logo, "w500") : undefined;
  const series = preview.type === "series";
  return (
    <div className="dk-t" aria-busy>
      <div className="dk-t-media scheme-dark">
        {art && <Img className="dk-t-art" src={art} fallbacks={[sizedArt(preview.poster, "w780")]} alt="" loading="eager" fetchPriority="high" />}
        {logo && (
          <TitleLogo
            key={logo}
            className="dk-t-logo"
            src={logo}
            logos={preview.logos?.map((u) => sizedArt(u, "w500") ?? u)}
            backdrop={art}
            alt=""
            loading="eager"
            draggable={false}
          />
        )}
      </div>
      <div className="dk-t-info">
        <h1 className={logo ? "dk-sr" : "dk-t-name"}>{preview.name}</h1>
        <Facts item={preview} />
        <div className="dk-t-action-row">
          <div className="dk-t-buttons">
            <button type="button" className="dk-t-btn dk-t-btn-white" disabled data-wait>
              <IconPlay size={24} />
              Play
            </button>
            <WaitDownload />
          </div>
          <div className="dk-t-actions">
            <Action label="Add to List" disabled wait onClick={() => {}}>
              <IconPlus size={28} stroke={1.5} />
            </Action>
            <Action label="Trailer" disabled wait onClick={() => {}}>
              <IconTrailer size={27} />
            </Action>
            <Action label="Sources" disabled wait onClick={() => {}}>
              <IconSources size={27} />
            </Action>
            {series && <WaitSeasonDownload />}
          </div>
        </div>
        {preview.description && (
          <div className="dk-t-meta-grid">
            <div className="dk-t-meta-main">
              <Synopsis text={preview.description} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Download, in its place before the episode it downloads is known. */
function WaitDownload() {
  return (
    // DownloadButton's own idle markup, so going live swaps nothing you can see.
    <button type="button" className="dk-t-btn dk-t-btn-grey" disabled data-wait>
      <span className="btn-glyph-static">
        <Download size={22} />
      </span>
      Download
    </button>
  );
}

/** Download Season, in its place before the season is known. */
function WaitSeasonDownload() {
  return (
    <Action
      label={
        <>
          Download
          <br />
          Season
        </>
      }
      disabled
      wait
      onClick={() => {}}
    >
      <SeasonGlyph />
    </Action>
  );
}

function SeasonGlyph() {
  return (
    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5v10.5M7.5 9.5l4.5 4.5 4.5-4.5M4 17.5h16M6.5 20.5h11" />
    </svg>
  );
}

type Tab = "episodes" | "collection" | "more" | "details" | "trailers";

/**
 * The title as Netflix's iPad app shows it in its dialog: the trailer (or the art) across the top at 16:9, then the
 * name, its facts, Play (or Resume) and Download across the width, where you are, what it's about, who's in it, a row
 * of labelled actions, then tabs: Episodes, Collection, More Like This, (Characters for anime), Trailers & More.
 */
function NetflixTitle({ type, id, preview, episode, season, top }: Props) {
  const { data: meta, isError, error } = useMeta(type, id);
  const { data: animeInfo } = useAnimeShowInfo(id);
  const verdict = useTitleVerdict(meta ?? preview, !!meta || isError);
  const item: MetaPreview | undefined = verdict === "show" ? (meta ?? preview) : undefined;
  const series = type === "series";

  const [sheets, setSheets] = useState(0);
  const onSheet = useCallback((open: boolean) => setSheets((n) => Math.max(0, n + (open ? 1 : -1))), []);
  const bigTrailer = !!useTrailerOpen();
  const trailer = useBackdropTrailer(id, { active: top && verdict === "show", paused: sheets > 0 || bigTrailer });
  const picker = useSourcePicker(onSheet);
  const { next, videoId, resumeAt } = usePlayTarget(item ?? { id, type, name: "" }, meta);
  useStreams(type, videoId);
  const { data: progress } = useProgress(id);
  const { data: fileTrailer, isFetching: trailerFetching } = useFileTrailer(id);
  const { data: ratings, isLoading: ratingsLoading } = useRatings(type, id);

  const tabs = useMemo((): { id: Tab; label: string }[] => {
    const list: { id: Tab; label: string }[] = [];
    if (series) list.push({ id: "episodes", label: "Episodes" });
    if (meta?.details?.collection) list.push({ id: "collection", label: "Collection" });
    list.push({ id: "more", label: "More Like This" });
    if (animeInfo?.isAnime && (animeInfo.anilistId || animeInfo.malId)) list.push({ id: "details", label: "Details" });
    if (meta?.trailerYtId || fileTrailer || meta?.extras?.length) list.push({ id: "trailers", label: "Trailers & More" });
    return list;
  }, [series, meta, fileTrailer, animeInfo]);
  const [tab, setTab] = useState<Tab>(series ? "episodes" : "more");
  const [tabDir, setTabDir] = useState(1);
  const shownTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  const pickTab = (nextTab: Tab) => {
    const prevIdx = tabs.findIndex((t) => t.id === shownTab);
    const nextIdx = tabs.findIndex((t) => t.id === nextTab);
    setTabDir(nextIdx >= prevIdx ? 1 : -1);
    setTab(nextTab);
  };
  const [logoFailed, setLogoFailed] = useState(false);
  const logoSrc = item?.logo ? sizedArt(item.logo, "w500") : undefined;
  useEffect(() => setLogoFailed(false), [logoSrc]);
  const actionRow = useRef<HTMLDivElement>(null);
  // The season the Episodes tab shows, so Download Season downloads that one.
  const [shelf, setShelf] = useState<Shelf>();

  if (verdict === "hide") return <p className="dk-t-note">{LIMIT_NOTICE}</p>;
  if (!item) {
    if (isError) return <p className="dk-t-note">Couldn't load this title: {errorMessage(error)}</p>;
    return <Outline preview={preview} />;
  }

  const video = series ? next?.video : undefined;
  const request: PlayRequest | null = videoId
    ? {
        type,
        metaId: id,
        videoId,
        resumable: !!resumeAt,
        subtitle: video ? (video.title?.trim() ? `${episodeCode(video.season, video.episode)} · ${video.title.trim()}` : episodeCode(video.season, video.episode)) : item.name,
      }
    : null;
  const watched = series ? (video ? progress?.find((p) => p.videoId === video.id) : undefined) : progress?.find((p) => p.videoId === id);
  const resuming = !!resumeAt && !!watched?.duration;
  const playLabel = resumeAt ? "Resume" : series && next?.kind === "next" && video ? `Play ${shortCode(video)}` : "Play";
  const play = () => request && picker.play(request);
  const showNext = resuming || (series && next?.kind === "next" && !!video);
  const art = detailBackdropUrl(item.background ?? item.poster);
  const logoShown = !!logoSrc && !logoFailed;
  const seasonShelf = shelf ?? (meta && series ? defaultShelf(meta, video) : undefined);
  // Still loading what Play, Download and Sources act on (the details, or where you are in the show).
  const waiting = !meta || progress === undefined;
  const trailerWaiting = !meta || trailerFetching;

  return (
    <div className="dk-t">
      <PinnedBar anchor={actionRow} name={item.name}>
        <CompactPlay label={playLabel} disabled={!request} onPlay={play} onPreload={preloadPlayerNow} />
      </PinnedBar>
      <div className="dk-t-media scheme-dark">
        {art && <Img className="dk-t-art" src={art} fallbacks={[sizedArt(item.poster, "w780")]} alt="" loading="eager" fetchPriority="high" />}
        {trailer.node}
        {logoShown && (
          <TitleLogo
            key={logoSrc}
            className="dk-t-logo"
            src={logoSrc}
            logos={item.logos?.map((u) => sizedArt(u, "w500") ?? u)}
            backdrop={art}
            alt=""
            loading="eager"
            draggable={false}
            onFail={() => setLogoFailed(true)}
          />
        )}
        {trailer.state !== "idle" && (
          <button
            type="button"
            className="dk-round dk-t-mute"
            aria-label={trailer.state === "ended" ? "Replay trailer" : trailer.muted ? "Turn trailer sound on" : "Mute trailer"}
            onClick={trailer.state === "ended" ? trailer.replay : trailer.toggleMute}
          >
            {trailer.muted || trailer.state === "ended" ? <IconMuted size={18} /> : <IconSound size={18} />}
          </button>
        )}
      </div>
      <div className="dk-t-info">
        {/* The logo names the title on the art; the heading stays for screen readers. */}
        <h1 className={logoShown ? "dk-sr" : "dk-t-name"}>{item.name}</h1>
        <Facts item={item} meta={meta} />
        <TitleScores item={item} ratings={ratings} loading={ratingsLoading} />
        <div className="dk-t-action-row" ref={actionRow}>
          <div className="dk-t-buttons">
            <button
              type="button"
              className="dk-t-btn dk-t-btn-white"
              disabled={!request}
              data-wait={(!request && waiting) || undefined}
              onPointerEnter={preloadPlayerNow}
              onPointerDown={preloadPlayerNow}
              onClick={play}
            >
              <IconPlay size={24} />
              {playLabel}
            </button>
            {!series || video ? (
              <DownloadButton item={item} video={video} className="dk-t-btn dk-t-btn-grey" size={22} text={video ? `Download ${shortCode(video)}` : "Download"} />
            ) : (
              waiting && <WaitDownload />
            )}
          </div>
          <Actions
            item={item}
            meta={meta}
            shelf={seasonShelf}
            request={request}
            onSources={() => request && picker.choose(request)}
            fileTrailer={!!fileTrailer}
            waiting={waiting}
            trailerWaiting={trailerWaiting}
          />
        </div>
        <div className="dk-t-meta-grid">
          <div className="dk-t-meta-main">
            <Synopsis text={item.description} />
            {showNext && (
              <NextUp
                kicker={resuming ? "Continue watching" : "Up next"}
                line={video ? `${shortCode(video)} · ${video.title?.trim() || `Episode ${video.episode}`}` : undefined}
                overview={video?.overview}
              >
                {resuming && watched && (
                  <div className="dk-t-resume-bar">
                    <ProgressBar fraction={watched.position / watched.duration} />
                    <span>{formatRemaining(watched.position, watched.duration)}</span>
                  </div>
                )}
              </NextUp>
            )}
          </div>
          <div className="dk-t-meta-side">
            <Credits meta={meta} series={series} genres={item.genres} />
          </div>
        </div>
      </div>
      <Tabs className="dk-t-tabs" value={shownTab} onValueChange={(v) => v && pickTab(v as Tab)}>
        <TabsList className="dk-t-tablist" aria-label="More about this title">
          <TabsIndicator className="dk-t-tab-mark" />
          {tabs.map((t) => (
            <TabsTab key={t.id} value={t.id} className="dk-t-tab">
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value={shownTab} className="dk-t-panel">
          <AnimatedSwap activeKey={shownTab} dir={tabDir}>
            {shownTab === "episodes" && meta && (
              <Episodes
                meta={meta}
                progress={progress}
                episode={episode}
                initialSeason={season}
                animeSeasons={animeInfo?.isAnime ? animeInfo.seasons : undefined}
                animeMalId={animeInfo?.isAnime ? animeInfo.malId : undefined}
                onSheet={onSheet}
                onShelf={setShelf}
              />
            )}
            {shownTab === "collection" && meta?.details?.collection && <CollectionGrid id={meta.details.collection.id} current={meta.id} />}
            {shownTab === "more" && <MoreLikeThis type={type} id={id} />}
            {shownTab === "details" && animeInfo && (animeInfo.anilistId || animeInfo.malId) && (
              <AnimeDetailsTab anilistId={animeInfo.anilistId} malId={animeInfo.malId} titleName={item.name} />
            )}
            {shownTab === "trailers" && <Trailers item={item} meta={meta} />}
          </AnimatedSwap>
        </TabsPanel>
      </Tabs>
      <SourcePicker picker={picker} />
    </div>
  );
}

const shortCode = (v: Video) => (v.season === 0 ? `Special ${v.episode}` : `S${v.season}:E${v.episode}`);

/** A season as the Episodes tab shows it: what Download Season downloads. */
type Shelf = { id: number; label: string; videos: Video[] };

/** Before the Episodes tab has shown one: the season Play is in, else the first. */
function defaultShelf(meta: Meta, video?: Video): Shelf | undefined {
  const id = video?.season ?? seasonsOf(meta).find((s) => s > 0);
  if (id === undefined) return undefined;
  return { id, label: id === 0 ? "Specials" : `Season ${id}`, videos: meta.videos.filter((v) => v.season === id) };
}

/** Year, age rating, and runtime / season count. */
function Facts({ item, meta }: { item: MetaPreview; meta?: Meta }) {
  const year = item.releaseInfo?.match(/\d{4}/)?.[0];
  let size: string | undefined;
  if (item.type === "series" && meta) {
    const seasons = seasonsOf(meta).filter((s) => s > 0);
    if (seasons.length > 1) size = `${seasons.length} Seasons`;
    else {
      const eps = meta.videos.filter((v) => v.season > 0).length;
      size = eps ? `${eps} Episode${eps === 1 ? "" : "s"}` : undefined;
    }
  } else if (item.type === "movie") size = formatRuntime(meta?.runtime);
  const cert = meta?.certification ?? item.certification;
  if (!year && !cert && !size) return null;
  return (
    <p className="dk-t-facts">
      {year && <span>{year}</span>}
      {cert && <span className="dk-t-age">{cert}</span>}
      {size && <span>{size}</span>}
    </p>
  );
}

/** Full MDBList/OMDb ScoreRow when available, or a crisp IMDb badge fallback from catalog metadata. */
function TitleScores({ item, ratings, loading = false }: { item: MetaPreview; ratings?: ExternalRatings | null; loading?: boolean }) {
  const hasExternal =
    ratings &&
    (ratings.imdb != null ||
      ratings.tmdb != null ||
      ratings.trakt != null ||
      ratings.letterboxd != null ||
      ratings.rottenTomatoes != null ||
      ratings.audience != null ||
      ratings.metacritic != null);

  if (hasExternal) {
    // Merge catalog IMDb fallback if MDBList/OMDb omitted imdb specifically.
    const merged: ExternalRatings =
      ratings.imdb == null && item.imdbRating
        ? { ...ratings, imdb: Number(item.imdbRating) || undefined, links: { ...ratings.links, imdb: imdbUrl(item.id) } }
        : ratings;
    return (
      <div className="dk-t-scores">
        <ScoreRow ratings={merged} />
      </div>
    );
  }
  const imdb = item.imdbRating?.trim();
  if (!imdb) {
    if (!loading) return null;
    // The scores are on their way: hold their row's height (an invisible row of the same type), so Play and
    // everything under it don't step down when they arrive.
    return (
      <div className="dk-t-scores" aria-hidden>
        <ul className="score-row t-callout tabular" style={{ visibility: "hidden" }}>
          <li className="score-row-item">
            <span className="score-row-value">0.0</span>
          </li>
        </ul>
      </div>
    );
  }
  const href = imdbUrl(item.id);
  const body = (
    <>
      <span className="score-row-icon">
        <BrandIcon site="imdb" />
      </span>
      <span className="score-row-value">{imdb}</span>
    </>
  );
  return (
    <div className="dk-t-scores">
      <ul className="score-row t-callout tabular" aria-label="Scores">
        <li className="score-row-item" data-site="imdb" title={href ? "IMDb: open the page" : "IMDb"}>
          {href ? (
            <button type="button" className="score-row-link" onClick={() => void api.openExternal(href)} aria-label={`IMDb ${imdb}, open on the site`}>
              {body}
            </button>
          ) : (
            <span aria-label={`IMDb ${imdb}`}>{body}</span>
          )}
        </li>
      </ul>
    </div>
  );
}

function Synopsis({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <p className="dk-t-synopsis" data-open={open || undefined} onClick={() => setOpen(true)}>
      {text}
    </p>
  );
}

function Credits({ meta, series, genres }: { meta?: Meta; series: boolean; genres?: string[] }) {
  const { navigate } = useNavigation();
  const [all, setAll] = useState(false);
  const cast = meta?.cast ?? [];
  const crew = meta?.director ?? [];
  if (!cast.length && !crew.length && !genres?.length) return null;
  const ids = new Map((meta?.people ?? []).filter((p) => p.tmdbId).map((p) => [p.name, p.tmdbId!]));
  const names = (list: string[]) =>
    list.map((name, i) => {
      const pid = ids.get(name);
      return (
        <span key={name}>
          {i > 0 && ", "}
          {pid ? (
            <button type="button" className="dk-t-person" onClick={() => navigate({ name: "person", id: pid, title: name })}>
              {name}
            </button>
          ) : (
            name
          )}
        </span>
      );
    });
  return (
    <div className="dk-t-credits">
      {/* Label / value rows, as Family's Review Details card lists a transaction's facts. */}
      {cast.length > 0 && (
        <p>
          <span className="dk-t-credit-label">Cast</span>
          <span>
            {names(all ? cast : cast.slice(0, 5))}
            {!all && cast.length > 5 && (
              <button type="button" className="dk-t-more" onClick={() => setAll(true)}>
                More
              </button>
            )}
          </span>
        </p>
      )}
      {crew.length > 0 && (
        <p>
          <span className="dk-t-credit-label">{series ? (crew.length > 1 ? "Creators" : "Creator") : crew.length > 1 ? "Directors" : "Director"}</span>
          <span>{names(crew.slice(0, 3))}</span>
        </p>
      )}
      {!!genres?.length && (
        <p>
          <span className="dk-t-credit-label">Genres</span>
          <span>{genres.slice(0, 4).join(", ")}</span>
        </p>
      )}
    </div>
  );
}

function Actions({
  item,
  meta,
  shelf,
  request,
  onSources,
  fileTrailer,
  waiting,
  trailerWaiting,
}: {
  item: MetaPreview;
  meta?: Meta;
  shelf?: Shelf;
  request: PlayRequest | null;
  onSources: () => void;
  fileTrailer: boolean;
  /** What Play, Sources and the season act on is still loading. */
  waiting: boolean;
  /** Whether there's a trailer isn't known yet. */
  trailerWaiting: boolean;
}) {
  const trailer = !!(meta?.trailerYtId || fileTrailer);
  // Every tile keeps its place from the first frame, so the row never re-lays itself out as things load: Trailer
  // stays (unavailable) when there isn't one, rather than the others moving up when that turns out.
  return (
    <div className="dk-t-actions">
      <ListAction item={item} />
      <Action label="Trailer" disabled={!trailer} wait={!trailer && trailerWaiting} onClick={() => openTrailer(trailerFor(item.name, item.id, meta))}>
        <IconTrailer size={27} />
      </Action>
      <Action label="Sources" disabled={!request} wait={!request && waiting} onClick={onSources}>
        <IconSources size={27} />
      </Action>
      {shelf ? <SeasonDownload item={item} shelf={shelf} /> : item.type === "series" && waiting && <WaitSeasonDownload />}
    </div>
  );
}

/** `wait`: not live yet because what it acts on is still loading; drawn at full strength, not as unavailable. */
function Action({
  label,
  onClick,
  pressed,
  disabled,
  wait,
  children,
}: {
  label: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  wait?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="dk-t-action" aria-pressed={pressed} disabled={disabled} data-wait={wait || undefined} onClick={onClick}>
      <span className="dk-t-action-glyph">{children}</span>
      <span className="dk-t-action-label">{label}</span>
    </button>
  );
}

/** Download Season: the season the Episodes tab is on (or Play's, before it has shown one). */
function SeasonDownload({ item, shelf }: { item: MetaPreview; shelf: Shelf }) {
  const videos = useMemo(() => downloadableEpisodes(shelf.videos), [shelf.videos]);
  const d = useBatchDownload({ item, videos, season: shelf.id });
  return (
    <Action
      label={
        d.running ? (
          "Downloading"
        ) : (
          <>
            Download
            <br />
            {shelf.label}
          </>
        )
      }
      disabled={d.disabled && !d.running}
      onClick={d.start}
    >
      <SeasonGlyph />
    </Action>
  );
}

/** A show's episodes: the season (Netflix's grey button opening the list of seasons), the layout switch, then the episodes. */
function Episodes({
  meta,
  progress,
  episode,
  initialSeason,
  animeSeasons,
  animeMalId,
  onSheet,
  onShelf,
}: {
  meta: Meta;
  progress?: Progress[];
  episode?: string;
  initialSeason?: number;
  animeSeasons?: AnimeSeasonMapping[];
  animeMalId?: number;
  onSheet: (open: boolean) => void;
  onShelf: (shelf: Shelf) => void;
}) {
  const prefs = usePrefs();
  const orders = useEpisodeOrders(meta);
  const view = orders.view;
  const seasons = useMemo(() => seasonsOf(meta), [meta]);
  const groups = useMemo(() => shelfGroups(meta.videos, seasons, view), [meta.videos, seasons, view]);
  const next = useMemo(() => upNext(meta, progress ?? [], view), [meta, progress, view]);
  const linked = episode ? meta.videos.find((v) => v.id === episode) : undefined;
  const [season, setSeason] = useState<number | undefined>(() => (linked ? shelfGroupOf(linked, view) : initialSeason));
  const [query, setQuery] = useState("");
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [layout, setLayout] = useEpisodeLayout();
  const [epDir, setEpDir] = useState(1);
  const ratingsGrid = useEpisodeRatings(meta.videos);
  const picker = useSourcePicker(onSheet);
  useEffect(() => {
    if (season === undefined && initialSeason === undefined && progress !== undefined && next.video) setSeason(shelfGroupOf(next.video, view));
  }, [next.video, season, initialSeason, progress, view]);
  const current = groups.some((g) => g.id === season) ? season! : (groups[0]?.id ?? seasons[0]);
  const group = groups.find((g) => g.id === current);
  const episodes = group?.videos ?? [];

  // Non-blocking anime enrichment for the active season: filler/recap badges + AniSkip/Kitsu playback context.
  const seasonMapping = useMemo(() => {
    if (!animeSeasons?.length) return undefined;
    return animeSeasons.find((m) => (m.season?.tmdb ?? m.season?.tvdb) === current) ?? (current === 1 ? animeSeasons[0] : undefined);
  }, [animeSeasons, current]);
  const activeMalId = seasonMapping?.mal_id ?? (current === 1 ? animeMalId : undefined);
  const { data: flags } = useEpisodeFlags(activeMalId, activeMalId ? [meta.name] : []);
  const hasFiller = !!flags && [...flags.values()].some((f) => f.filler || f.recap);

  // Record AniSkip (MAL id), Kitsu alt-ids, and filler episodes for the player without blocking UI.
  useEffect(() => {
    if (!seasonMapping && !activeMalId) return;
    const offset = seasonMapping?.episode_offset?.tmdb ?? seasonMapping?.episode_offset?.tvdb ?? 0;
    const lined = episodes.map((v): [string, number] => [v.id, Math.max(1, v.episode - offset)]);
    playContext.remember(
      meta.id,
      {
        mal: activeMalId,
        kitsu: seasonMapping?.kitsu_id,
        anilist: seasonMapping?.anilist_id,
        count: episodes.length || undefined,
      },
      lined,
    );
    if (flags) {
      playContext.filler(
        meta.id,
        episodes.map((v) => v.id),
        episodes.filter((v) => flags.get(Math.max(1, v.episode - offset))?.filler).map((v) => v.id),
      );
    }
  }, [meta.id, seasonMapping, activeMalId, episodes, flags]);

  const filteredByRecap = useMemo(() => {
    if (!flags || !prefs.animeHideRecaps) return episodes;
    const offset = seasonMapping?.episode_offset?.tmdb ?? seasonMapping?.episode_offset?.tvdb ?? 0;
    return episodes.filter((v) => !flags.get(Math.max(1, v.episode - offset))?.recap);
  }, [episodes, flags, prefs.animeHideRecaps, seasonMapping]);
  const shownEpisodes = useMemo(
    () => (query.trim() ? filterEpisodes(filteredByRecap, query, (v) => view?.number?.get(v.id) ?? v.episode) : filteredByRecap),
    [filteredByRecap, query, view],
  );
  const flagFor = useCallback(
    (v: Video): EpisodeFlags | undefined => {
      if (!flags) return undefined;
      const offset = seasonMapping?.episode_offset?.tmdb ?? seasonMapping?.episode_offset?.tvdb ?? 0;
      return flags.get(Math.max(1, v.episode - offset));
    },
    [flags, seasonMapping],
  );
  const map = useMemo(() => progressMap(progress), [progress]);
  useEffect(() => {
    if (group) onShelf({ id: group.id, label: group.label, videos: group.videos });
  }, [group, onShelf]);
  const request = (v: Video): PlayRequest => ({
    type: "series",
    metaId: meta.id,
    videoId: v.id,
    resumable: map.has(v.id),
    subtitle: v.title?.trim() ? `${episodeCode(v.season, v.episode)} · ${v.title.trim()}` : episodeCode(v.season, v.episode),
  });
  const offered = useRef(false);
  useEffect(() => {
    if (!linked || offered.current || progress === undefined) return;
    offered.current = true;
    picker.choose(request(linked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, progress]);

  const upNextId = next.kind !== "start" ? next.video?.id : undefined;
  const seasonOptions = useMemo(() => groups.map((g) => ({ id: g.id, label: g.label, count: g.videos.length })), [groups]);
  const pickSeason = (nextSeason: number) => {
    const prevIdx = groups.findIndex((g) => g.id === current);
    const nextIdx = groups.findIndex((g) => g.id === nextSeason);
    setEpDir(nextIdx >= prevIdx ? 1 : -1);
    setSeason(nextSeason);
  };
  const pickLayout = (nextLayout: "row" | "list") => {
    if (nextLayout === layout) return;
    setEpDir(nextLayout === "list" ? 1 : -1);
    setLayout(nextLayout);
  };
  return (
    <section className="dk-eps" data-layout={layout}>
      <div className="dk-eps-bar">
        {groups.length > 1 ? (
          <SeasonChooser
            options={seasonOptions}
            value={current}
            currentLabel={group?.label ?? `Season ${current}`}
            onPick={pickSeason}
            resetKey={meta.id}
          />
        ) : (
          <span className="dk-season-name">
            {group?.label ?? meta.name}
            {episodes.length > 0 && <span className="dk-season-inline-count tabular"> ({episodes.length} {episodes.length === 1 ? "Episode" : "Episodes"})</span>}
          </span>
        )}
        {hasFiller && (
          <button
            type="button"
            className="dk-season dk-season-range"
            aria-pressed={prefs.animeHideRecaps}
            onClick={() => setPrefs({ animeHideRecaps: !prefs.animeHideRecaps })}
          >
            {prefs.animeHideRecaps ? "Recaps hidden" : "Hide recaps"}
          </button>
        )}
        <span className="dk-flex" />
        {ratingsGrid && (
          <button type="button" className="dk-eps-ratings-btn" onClick={() => setRatingsOpen(true)}>
            <IconRatingsGrid />
            <span>Episode ratings</span>
          </button>
        )}
        <div className="dk-eps-layout" role="group" aria-label="Episode tools">
          <EpisodeSearch value={query} onChange={setQuery} resetKey={`${meta.id}:${current}`} />
          <span className="dk-eps-layout-sep" aria-hidden />
          <div className="dk-eps-radios" role="radiogroup" aria-label="Episode layout">
            <button type="button" role="radio" aria-checked={layout === "row"} aria-label="Side by side" onClick={() => pickLayout("row")}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <rect x="2" y="5" width="7" height="10" rx="2" fill="currentColor" />
                <rect x="11" y="5" width="7" height="10" rx="2" fill="currentColor" opacity="0.55" />
              </svg>
            </button>
            <button type="button" role="radio" aria-checked={layout === "list"} aria-label="Listed" onClick={() => pickLayout("list")}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <rect x="2" y="3.5" width="16" height="5.5" rx="1.8" fill="currentColor" />
                <rect x="2" y="11" width="16" height="5.5" rx="1.8" fill="currentColor" opacity="0.55" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <AnimatedSwap activeKey={`${current}:${layout}`} dir={epDir} slide={44}>
        {query.trim() && !shownEpisodes.length ? (
          <p className="dk-t-empty">No episodes match “{query.trim()}”.</p>
        ) : layout === "row" ? (
          <EpisodeStrip
            key={current}
            meta={meta}
            episodes={shownEpisodes}
            numbers={view?.number}
            progress={map}
            upNextId={upNextId}
            flagFor={flagFor}
            onPlay={(v) => picker.play(request(v))}
            onSources={(v) => picker.choose(request(v))}
          />
        ) : (
          <EpisodeList
            key={current}
            meta={meta}
            episodes={shownEpisodes}
            numbers={view?.number}
            progress={map}
            upNextId={upNextId}
            flagFor={flagFor}
            onPlay={(v) => picker.play(request(v))}
            onSources={(v) => picker.choose(request(v))}
          />
        )}
      </AnimatedSwap>
      {ratingsGrid && (
        <DeskRatingsOverlay
          grid={ratingsGrid}
          title={meta.name}
          open={ratingsOpen}
          onClose={() => setRatingsOpen(false)}
          onOpen={(v) => picker.choose(request(v))}
        />
      )}
      <SourcePicker picker={picker} />
    </section>
  );
}

/** Its sources can be checked: out, or listed for the coming week, since services often beat the listed date (#143). */
const aired = (v: Video) => isOpenable(v);
/** Openable but not out by its listed date: "Airs 30 Nov" on it, instead of "Coming", and it plays like the rest. */
const airsSoon = (v: Video) => isOpenable(v) && !isReleased(v);
const fullDateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
/** Under an episode: its air date, "Airs …" while it may be out early, "Coming …" further ahead. */
const dateLine = (v: Video) => {
  if (!v.released) return aired(v) ? undefined : "Not yet released";
  const date = fullDateFmt.format(new Date(v.released));
  return isReleased(v) ? date : aired(v) ? `Airs ${date}` : `Coming ${date}`;
};
const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const compactRuntime = (raw?: string) => raw?.replace(/\s*min\b/i, "m").replace(/\s*hr\b/i, "h");

function EpisodeList({
  meta,
  episodes,
  numbers,
  progress,
  upNextId,
  flagFor,
  onPlay,
  onSources,
}: {
  meta: Meta;
  episodes: Video[];
  numbers?: Map<string, number>;
  progress: Map<string, Progress>;
  upNextId?: string;
  flagFor?: (v: Video) => EpisodeFlags | undefined;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const win = useVerticalWindow(listRef, episodes.length, { estimateRowHeight: 132 });
  const visible = win.active ? episodes.slice(win.start, win.end) : episodes;
  const runtime = compactRuntime(formatRuntime(meta.runtime));
  return (
    <ol className="dk-ep-list" ref={listRef}>
      {win.topPx > 0 && <li data-spacer aria-hidden style={{ height: win.topPx }} />}
      {visible.map((v) => (
        <EpisodeRow
          key={v.id}
          meta={meta}
          video={v}
          number={numbers?.get(v.id) ?? v.episode}
          runtime={runtime}
          progress={progress.get(v.id)}
          isUpNext={v.id === upNextId}
          flag={flagFor?.(v)}
          onPlay={onPlay}
          onSources={onSources}
        />
      ))}
      {win.bottomPx > 0 && <li data-spacer aria-hidden style={{ height: win.bottomPx }} />}
    </ol>
  );
}

function EpisodeStrip({
  meta,
  episodes,
  numbers,
  progress,
  upNextId,
  flagFor,
  onPlay,
  onSources,
}: {
  meta: Meta;
  episodes: Video[];
  numbers?: Map<string, number>;
  progress: Map<string, Progress>;
  upNextId?: string;
  flagFor?: (v: Video) => EpisodeFlags | undefined;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
}) {
  const strip = useRef<HTMLOListElement>(null);
  const upNextIndex = useMemo(() => (upNextId ? Math.max(0, episodes.findIndex((v) => v.id === upNextId)) : 0), [episodes, upNextId]);
  const win = useHorizontalWindow(strip, episodes.length, { initialIndex: upNextIndex, estimateWidth: 264, estimateGap: 14 });
  const [ends, setEnds] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const s = strip.current;
    if (!s) return;
    const start = s.scrollLeft <= 2;
    const end = s.scrollLeft + s.clientWidth >= s.scrollWidth - 2;
    setEnds((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  const handleScroll = useCallback(() => {
    measure();
    win.onScroll();
  }, [measure, win.onScroll]);
  const { alignTo, page } = useCardStrip(strip);
  useLayoutEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>("[data-up-next]");
    if (el) alignTo(el);
    measure();
    // Only when the season opens: later progress mustn't move the row under the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const s = strip.current;
    if (!s) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    return () => ro.disconnect();
  }, [measure, episodes]);
  const runtime = compactRuntime(formatRuntime(meta.runtime));
  const visible = win.active ? episodes.slice(win.start, win.end) : episodes;
  return (
    <div className="dk-strip-wrap dk-ep-strip-wrap">
      <ol className="dk-ep-strip" ref={strip} onScroll={handleScroll}>
        {win.leadPx > 0 && <li data-spacer aria-hidden style={{ flex: "none", width: win.leadPx }} />}
        {visible.map((v) => (
          <EpisodeCard
            key={v.id}
            meta={meta}
            video={v}
            number={numbers?.get(v.id) ?? v.episode}
            runtime={runtime}
            progress={progress.get(v.id)}
            isUpNext={v.id === upNextId}
            flag={flagFor?.(v)}
            onPlay={onPlay}
            onSources={onSources}
          />
        ))}
        {win.trailPx > 0 && <li data-spacer aria-hidden style={{ flex: "none", width: win.trailPx }} />}
      </ol>
      {!ends.start && (
        <button
          type="button"
          className="dk-pager dk-pager-back"
          aria-label="Scroll episodes back"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            page(-1);
          }}
        >
          <IconChevronRight size={22} stroke={2.4} />
        </button>
      )}
      {!ends.end && (
        <button
          type="button"
          className="dk-pager"
          aria-label="Scroll episodes forward"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            page(1);
          }}
        >
          <IconChevronRight size={22} stroke={2.4} />
        </button>
      )}
    </div>
  );
}

const EpisodeCard = memo(function EpisodeCard({
  meta,
  video: v,
  number,
  runtime,
  progress: p,
  isUpNext,
  flag,
  onPlay,
  onSources,
}: {
  meta: Meta;
  video: Video;
  number: number;
  runtime?: string;
  progress?: Progress;
  isUpNext: boolean;
  flag?: EpisodeFlags;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
}) {
  const on = aired(v);
  const fraction = p && p.duration > 0 ? p.position / p.duration : 0;
  const watched = fraction >= watchedFraction();
  const inProgress = fraction > 0 && !watched;
  const timeLabel = inProgress && p ? formatRemaining(p.position, p.duration) : runtime;
  return (
    <li className="dk-ep-card" data-up-next={isUpNext || undefined} data-unreleased={!on || undefined} {...cardMenu(meta, episodeEntry(meta, v, p), { episode: true })}>
      <button type="button" className="dk-ep-still scheme-dark" data-progress={inProgress || undefined} aria-label={`Play episode ${number}`} disabled={!on} onClick={() => onPlay(v)}>
        <Img src={v.thumbnail ? sizedArt(v.thumbnail, "w500") : undefined} fallbacks={[cardArtUrl(meta.background, "landscape")]} alt="" loading="lazy" />
        {on ? (
          <>
            <span className="dk-ep-play dk-ep-play-hover" aria-hidden>
              <IconPlayRing size={40} />
            </span>
            {airsSoon(v) && v.released ? (
              <span className="dk-ep-soon">Airs {shortDateFmt.format(new Date(v.released))}</span>
            ) : timeLabel && (
              <span className="dk-ep-runtime tabular" aria-hidden>
                <IconPlay size={10} />
                {timeLabel}
              </span>
            )}
          </>
        ) : (
          <span className="dk-ep-soon">{v.released ? `Coming ${shortDateFmt.format(new Date(v.released))}` : "Upcoming"}</span>
        )}
        {watched && (
          <span className="dk-ep-watched" aria-label="Watched">
            <IconCheck size={12} stroke={3} />
          </span>
        )}
        {inProgress && <ProgressBar fraction={fraction} />}
      </button>
      {/* On the still, so they can only belong to this episode (not sit beside the next card's number). */}
      {on && (
        <span className="dk-ep-dl-slot dk-ep-card-tools">
          <DownloadButton item={meta} video={v} className="dk-ep-dl" size={16} />
          <button type="button" className="dk-ep-src" aria-label={`Sources for episode ${number}`} title="Choose source" onClick={() => onSources(v)}>
            <IconSources size={16} />
          </button>
        </span>
      )}
      <span className="dk-ep-kicker tabular">EPISODE {number}</span>
      <strong className="dk-ep-card-title">
        {v.title?.trim() || `Episode ${v.episode}`}
        {flag?.filler && <span className="dk-ep-badge">Filler</span>}
        {flag?.recap && <span className="dk-ep-badge">Recap</span>}
      </strong>
      {v.overview && <p className="dk-ep-text">{v.overview}</p>}
      <span className="dk-ep-date tabular">
        {dateLine(v)}
      </span>
    </li>
  );
});

const EpisodeRow = memo(function EpisodeRow({
  meta,
  video: v,
  number,
  runtime,
  progress,
  isUpNext,
  flag,
  onPlay,
  onSources,
}: {
  meta: Meta;
  video: Video;
  number: number;
  runtime?: string;
  progress?: Progress;
  isUpNext: boolean;
  flag?: EpisodeFlags;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
}) {
  const [failed, setFailed] = useState(false);
  const still = v.thumbnail ? sizedArt(v.thumbnail, "w300") : undefined;
  const on = aired(v);
  const fraction = progress && progress.duration > 0 ? progress.position / progress.duration : 0;
  const watched = fraction >= watchedFraction();
  const inProgress = fraction > 0 && !watched;
  const timeLabel = inProgress && progress ? formatRemaining(progress.position, progress.duration) : runtime;
  return (
    <li className="dk-ep" data-up-next={isUpNext || undefined} data-unreleased={!on || undefined} {...cardMenu(meta, episodeEntry(meta, v, progress), { episode: true })}>
      <button type="button" className="dk-ep-main" aria-label={`Play episode ${number}: ${v.title?.trim() || `Episode ${v.episode}`}`} disabled={!on} onClick={() => onPlay(v)}>
        <span className="dk-ep-row-num tabular">{number}</span>
        <span className="dk-ep-row-still scheme-dark" data-progress={inProgress || undefined}>
          {still && !failed ? <Img src={still} fallbacks={[cardArtUrl(meta.background, "landscape")]} alt="" loading="lazy" onFail={() => setFailed(true)} /> : <span className="dk-ep-blank" />}
          {on ? (
            <>
              <span className="dk-ep-play dk-ep-play-hover" aria-hidden>
                <IconPlayRing size={34} />
              </span>
              {airsSoon(v) && v.released ? (
                <span className="dk-ep-soon">{shortDateFmt.format(new Date(v.released))}</span>
              ) : timeLabel && (
                <span className="dk-ep-runtime tabular" aria-hidden>
                  <IconPlay size={9} />
                  {timeLabel}
                </span>
              )}
            </>
          ) : (
            <span className="dk-ep-soon">{v.released ? shortDateFmt.format(new Date(v.released)) : "TBA"}</span>
          )}
          {watched && (
            <span className="dk-ep-watched" aria-label="Watched">
              <IconCheck size={12} stroke={3} />
            </span>
          )}
          {inProgress && <ProgressBar fraction={fraction} />}
        </span>
        <span className="dk-ep-body">
          <span className="dk-ep-name">
            <strong>
              {v.title?.trim() || `Episode ${v.episode}`}
              {!on && <span className="dk-ep-upcoming-pill">Upcoming</span>}
              {flag?.filler && <span className="dk-ep-badge">Filler</span>}
              {flag?.recap && <span className="dk-ep-badge">Recap</span>}
            </strong>
          </span>
          {v.overview && <span className="dk-ep-text">{v.overview}</span>}
          <span className="dk-ep-date tabular">
            {dateLine(v)}
          </span>
        </span>
      </button>
      {on && (
        <span className="dk-ep-dl-slot">
          <DownloadButton item={meta} video={v} className="dk-ep-dl" size={18} />
          <button type="button" className="dk-ep-src" aria-label={`Sources for episode ${number}`} title="Choose source" onClick={() => onSources(v)}>
            <IconSources size={18} />
          </button>
        </span>
      )}
    </li>
  );
});

function MoreLikeThis({ type, id }: { type: ContentType; id: string }) {
  const { data, isError } = useRecommend(type, id);
  const visible = useBrowseVisible(useListable(data));
  const items = useMemo(() => (visible ?? []).filter((m) => m.id !== id), [visible, id]);
  if (isError || (data && !items.length)) return <p className="dk-t-empty">Nothing similar found yet.</p>;
  return <PosterGrid items={data ? items : undefined} />;
}

function CollectionGrid({ id, current }: { id: number; current: string }) {
  const { data } = useCollection(id);
  const items = useListable(data);
  return <PosterGrid items={items?.filter((m) => m.id !== current)} />;
}

function PosterGrid({ items }: { items?: readonly MetaPreview[] }) {
  return (
    <div className="dk-t-grid">
      {items ? items.map((m) => <Poster key={`${m.type}:${m.id}`} item={m} />) : Array.from({ length: 10 }, (_, i) => <span key={i} className="dk-poster dk-skeleton" aria-hidden />)}
    </div>
  );
}

function Trailers({ item, meta }: { item: MetaPreview; meta?: Meta }) {
  const extras: Extra[] = meta?.extras ?? [];
  const main = meta?.trailerYtId ? trailerFor(item.name, item.id, meta) : undefined;
  return (
    <div className="dk-t-trailers">
      {main && (
        <button type="button" className="dk-t-trailer" onClick={() => openTrailer(main)}>
          <span className="dk-t-trailer-still scheme-dark">
            <Img src={cardArtUrl(item.background, "landscape")} alt="" loading="lazy" />
            <span className="dk-ep-play" aria-hidden>
              <IconPlayRing size={44} />
            </span>
          </span>
          <span className="dk-t-trailer-name">Trailer: {item.name}</span>
        </button>
      )}
      {extras.map((e) => (
        <button key={e.key} type="button" className="dk-t-trailer" onClick={() => playExtra(e)}>
          <span className="dk-t-trailer-still scheme-dark">
            <Img src={extraStills(e)[0]} fallbacks={extraStills(e).slice(1)} alt="" loading="lazy" />
            <span className="dk-ep-play" aria-hidden>
              <IconPlayRing size={44} />
            </span>
          </span>
          <span className="dk-t-trailer-name">
            {extraKind(e.kind)}: {e.name}
          </span>
        </button>
      ))}
    </div>
  );
}

function formatShortDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const parts = iso.split("-").map(Number);
  if (!parts[0]) return undefined;
  if (parts.length === 1) return String(parts[0]);
  const d = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, parts.length === 3 ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });
}

const INITIAL_CHARS = 6;
const INITIAL_TAGS = 10;

/**
 * Uncluttered Family-native Details tab for anime: rankings strip, compact Characters & Voice Actors
 * cards (6 by default with JP/EN switcher & Show all), 2-column Information card, collapsible Tags,
 * and Watch Officially / Elsewhere links. Fetched lazily in 1 cached Rust call when the tab opens.
 */
function AnimeDetailsTab({ anilistId, malId, titleName }: { anilistId?: number; malId?: number; titleName: string }) {
  const { animeVoices, animeSpoilerTags } = usePrefs();
  const { data, isPending, isError } = useAnimeDetails(anilistId, malId, true);
  const [showAllChars, setShowAllChars] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);

  if (isPending) {
    return (
      <div className="dk-ad">
        <div className="dk-ad-cast">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="dk-ad-pair dk-skeleton" style={{ height: 68 }} aria-hidden />
          ))}
        </div>
        <div className="dk-ad-card dk-skeleton" style={{ height: 180 }} aria-hidden />
      </div>
    );
  }
  if (isError || !data || !data.anilistId) return <p className="dk-t-empty">No anime details available yet.</p>;

  const rankings = data.rankings ?? [];
  const characters = data.characters ?? [];
  const shownChars = showAllChars ? characters : characters.slice(0, INITIAL_CHARS);
  const hasVoiceEn = characters.some((c) => !!c.voiceEn);
  const hasVoiceJa = characters.some((c) => !!c.voiceJa);

  const airedParts = [
    formatShortDate(data.startDate),
    data.status === "RELEASING" ? "now" : formatShortDate(data.endDate),
  ].filter(Boolean);
  const seasonText =
    data.season && data.seasonYear
      ? `${SEASON_LABEL[data.season as MediaSeason] ?? data.season} ${data.seasonYear}`
      : undefined;
  const aka = (data.synonyms ?? [])
    .filter((s) => s.toLowerCase() !== titleName.toLowerCase())
    .slice(0, 4)
    .join(" · ");

  const facts: [string, string | undefined][] = [
    ["Format", data.format ? (FORMAT_LABEL[data.format as MediaFormat] ?? data.format) : undefined],
    ["Episodes", data.episodes ? String(data.episodes) : undefined],
    ["Episode length", data.duration ? `${data.duration} min` : undefined],
    ["Status", data.status ? (STATUS_LABEL[data.status as MediaStatus] ?? data.status) : undefined],
    ["Aired", airedParts.length ? airedParts.join(" to ") : undefined],
    ["Season", seasonText],
    ["Studio", data.studios?.length ? data.studios.join(", ") : undefined],
    ["Source", data.source ? (SOURCE_LABEL[data.source] ?? data.source) : undefined],
    ["Producers", data.producers?.length ? data.producers.join(", ") : undefined],
    ["Average score", data.averageScore ? `${data.averageScore}%` : undefined],
    ["Favourites", data.favourites ? data.favourites.toLocaleString() : undefined],
    ["Also known as", aka || undefined],
  ].filter(([, v]) => !!v) as [string, string][];

  const allTags = data.tags ?? [];
  const spoilerCount = allTags.filter((t) => t.spoiler).length;
  const eligibleTags = allTags.filter((t) => animeSpoilerTags || !t.spoiler);
  const shownTags = showAllTags ? eligibleTags : eligibleTags.slice(0, INITIAL_TAGS);
  const hiddenTagCount = eligibleTags.length - shownTags.length;
  const streaming = data.streamingLinks ?? [];

  return (
    <div className="dk-ad">
      {rankings.length > 0 && (
        <div className="dk-ad-ranks">
          {rankings.map((r) => {
            const ctx = r.context ? r.context[0].toUpperCase() + r.context.slice(1) : "";
            const when = !r.allTime && r.year ? ` ${r.season ? `${SEASON_LABEL[r.season as MediaSeason] ?? r.season} ` : ""}${r.year}` : "";
            return (
              <span key={`${r.rank}/${r.context}/${r.year}/${r.season}`} className="dk-ad-rank tabular">
                <strong>#{r.rank}</strong> {ctx}
                {when}
              </span>
            );
          })}
        </div>
      )}

      {characters.length > 0 && (
        <section className="dk-ad-section">
          <div className="dk-ad-head">
            <h3 className="dk-ad-label">Characters &amp; Voice Actors</h3>
            {hasVoiceJa && hasVoiceEn && (
              <div className="dk-ad-seg" role="radiogroup" aria-label="Voice actor language">
                <button
                  type="button"
                  role="radio"
                  aria-checked={animeVoices !== "english"}
                  onClick={() => setPrefs({ animeVoices: "japanese" })}
                >
                  Japanese
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={animeVoices === "english"}
                  onClick={() => setPrefs({ animeVoices: "english" })}
                >
                  English
                </button>
              </div>
            )}
          </div>
          <div className="dk-ad-cast">
            {shownChars.map((c) => {
              const preferEn = animeVoices === "english";
              const va = preferEn ? (c.voiceEn ?? c.voiceJa) : (c.voiceJa ?? c.voiceEn);
              const vaLang = preferEn && c.voiceEn ? "English" : "Japanese";
              return (
                <div key={c.id} className="dk-ad-pair">
                  <div className="dk-ad-side">
                    {c.image ? (
                      <Img src={c.image} alt="" className="dk-ad-photo" loading="lazy" />
                    ) : (
                      <span className="dk-ad-photo dk-ad-photo-empty" aria-hidden />
                    )}
                    <div className="dk-ad-meta">
                      <strong className="dk-ad-name">{c.name}</strong>
                      <span className="dk-ad-sub">{c.role}</span>
                    </div>
                  </div>
                  {va && (
                    <div className="dk-ad-side dk-ad-va">
                      <div className="dk-ad-meta">
                        <strong className="dk-ad-name">{va.name}</strong>
                        <span className="dk-ad-sub">{vaLang}</span>
                      </div>
                      {va.image ? (
                        <Img src={va.image} alt="" className="dk-ad-photo" loading="lazy" />
                      ) : (
                        <span className="dk-ad-photo dk-ad-photo-empty" aria-hidden />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {characters.length > INITIAL_CHARS && (
            <button type="button" className="dk-ad-more" onClick={() => setShowAllChars((v) => !v)}>
              {showAllChars ? "Show fewer characters" : `Show all ${characters.length} characters`}
            </button>
          )}
        </section>
      )}

      {facts.length > 0 && (
        <section className="dk-ad-section">
          <h3 className="dk-ad-label">Information</h3>
          <dl className="dk-ad-facts">
            {facts.map(([k, v]) => (
              <div key={k} className="dk-ad-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {allTags.length > 0 && (
        <section className="dk-ad-section">
          <div className="dk-ad-head">
            <h3 className="dk-ad-label">Tags</h3>
            {spoilerCount > 0 && (
              <button
                type="button"
                className="dk-ad-text-btn"
                onClick={() => setPrefs({ animeSpoilerTags: !animeSpoilerTags })}
              >
                {animeSpoilerTags ? "Hide spoiler tags" : `Show ${spoilerCount} spoiler tag${spoilerCount === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
          <div className="dk-ad-tags">
            {shownTags.map((t) => (
              <span key={t.name} className="dk-ad-tag" data-spoiler={t.spoiler || undefined} title={t.description}>
                <span>{t.name}</span>
                <span className="dk-ad-tag-pct tabular">{t.rank}%</span>
              </span>
            ))}
            {hiddenTagCount > 0 && (
              <button type="button" className="dk-ad-tag dk-ad-tag-btn" onClick={() => setShowAllTags(true)}>
                +{hiddenTagCount} more
              </button>
            )}
            {showAllTags && eligibleTags.length > INITIAL_TAGS && (
              <button type="button" className="dk-ad-tag dk-ad-tag-btn" onClick={() => setShowAllTags(false)}>
                Show less
              </button>
            )}
          </div>
        </section>
      )}

      <div className="dk-ad-links-row">
        {streaming.length > 0 && (
          <section className="dk-ad-section">
            <h3 className="dk-ad-label">Watch Officially</h3>
            <div className="dk-ad-links">
              {streaming.map((l) => (
                <button
                  key={`${l.site}:${l.url}`}
                  type="button"
                  className="dk-ad-link"
                  onClick={() => void api.openExternal(l.url)}
                >
                  {l.icon && <img src={l.icon} alt="" className="dk-ad-link-ico" />}
                  <span>{l.site}</span>
                  {l.language && l.language !== "English" && <span className="dk-ad-link-lang">· {l.language}</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="dk-ad-section">
          <h3 className="dk-ad-label">Elsewhere</h3>
          <div className="dk-ad-links">
            <button
              type="button"
              className="dk-ad-link"
              onClick={() => void api.openExternal(`https://anilist.co/anime/${data.anilistId}`)}
            >
              <BrandIcon site="anilist" size={14} />
              <span>AniList</span>
            </button>
            {data.malId && (
              <button
                type="button"
                className="dk-ad-link"
                onClick={() => void api.openExternal(`https://myanimelist.net/anime/${data.malId}`)}
              >
                <BrandIcon site="myanimelist" size={14} />
                <span>MyAnimeList</span>
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
