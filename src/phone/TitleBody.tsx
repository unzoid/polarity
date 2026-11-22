import "../styles/anime.css";
import "../styles/title/episode-ratings.css";
import { useQuery } from "@tanstack/react-query";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBatchDownload } from "../components/BatchDownload";
import { useBackdropTrailer } from "../components/BackdropTrailer";
import { cardMenu } from "../components/CardMenu";
import { DownloadButton } from "../components/DownloadButton";
import { Img } from "../components/Img";
import { preloadPlayerNow } from "../components/PlayerLayer";
import { playExtra } from "../components/title/ExtrasShelf";
import { useLibraryToggle } from "../components/title/LibraryButton";
import { SourcePicker, useSourcePicker } from "../components/title/SourcePicker";
import { AgeRatingBadge, ScoreRow } from "../components/title/TitleDetails";
import { openTrailer, useTrailerOpen } from "../components/Trailer";
import { EmptyState } from "../components/ui/EmptyState";
import { titlePageQuery } from "../lib/anime";
import { extraKind, extraStills, LIMIT_NOTICE, useBrowseVisible, useListable, useTitleVerdict } from "../lib/catalog";
import { errorMessage } from "../lib/errors";
import { episodeCode, formatRemaining, formatRuntime } from "../lib/format";
import { downloadableEpisodes, episodeEntry, progressMap, seasonsOf, shelfGroupOf, shelfGroups, upNext, useEpisodeOrders } from "../lib/library";
import { useCollection, useMeta, useProgress, useRatings, useRecommend, useStreams } from "../lib/net";
import { useEpisodeLayout } from "../lib/settings";
import { useNavigation } from "../lib/router";
import { trailerFor, useFileTrailer, usePlayTarget, type PlayRequest } from "../lib/playback";
import type { ContentType, Extra, Meta, MetaPreview, Progress, Video } from "../lib/types";
import { cardArtUrl, detailBackdropUrl, sizedArt } from "../lib/ui";
import { useHorizontalWindow, useVerticalWindow } from "../lib/ui/windowing";
import { LazyAnimeDetail } from "../screens/lazyScreens";
import { IconBack, IconCheck, IconClose, IconMuted, IconPlay, IconPlayRing, IconPlus, IconSound, IconSources, IconTrailer } from "./icons";
import { ListOverlay } from "./ListOverlay";
import { Poster } from "./Rows";
import { SeasonPicker } from "../components/title/SeasonPicker";

type Props = {
  type: ContentType;
  id: string;
  preview?: MetaPreview;
  episode?: string;
  /** This title is the one showing in its sheet (not one under a title opened from it). */
  top: boolean;
  onClose: () => void;
  /** A title opened from another in the same sheet: back to that one. */
  onBack?: () => void;
};

/**
 * One title in the sheet. Which page a title gets is settled first (an anime reached by any id opens as the anime,
 * App.tsx TitleRoute), with the sheet's own outline meanwhile, never one page swapped for the other.
 */
export function TitleBody(props: Props) {
  const { data: page } = useQuery(titlePageQuery(props.type, props.id, props.preview));
  if (page?.kind === "anime") return <AnimeBody id={page.anilist} episode={props.episode} onClose={props.onClose} onBack={props.onBack} />;
  if (!page) return <BodySkeleton {...props} />;
  return <NetflixTitle {...props} />;
}

/** An anime's own page (by AniList id) in the sheet, under the sheet's Close and Back. */
export function AnimeBody({ id, episode, onClose, onBack }: { id: number; episode?: string; onClose: () => void; onBack?: () => void }) {
  return (
    <div className="ps-body ps-anime">
      <MediaButtons onClose={onClose} onBack={onBack} />
      <Suspense fallback={null}>
        <LazyAnimeDetail id={id} episode={episode} />
      </Suspense>
    </div>
  );
}

function MediaButtons({ onClose, onBack }: { onClose: () => void; onBack?: () => void }) {
  return (
    <div className="ps-media-buttons scheme-dark">
      {onBack && (
        <button type="button" className="ps-round" aria-label="Back" onClick={onBack}>
          <IconBack size={24} stroke={2.2} />
        </button>
      )}
      <span className="ps-flex" />
      <button type="button" className="ps-round" aria-label="Close" onClick={onClose}>
        <IconClose size={26} stroke={1.8} />
      </button>
    </div>
  );
}

function BodySkeleton({ preview, onClose, onBack }: Props) {
  const art = detailBackdropUrl(preview?.background ?? preview?.poster);
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
          <span className="ps-sk ps-sk-text" />
          <span className="ps-sk ps-sk-text ps-sk-short" />
        </div>
      </div>
    </div>
  );
}

type Tab = "episodes" | "collection" | "more" | "trailers";

/**
 * The title as Netflix's sheet shows it: the trailer (or the art) pinned across the top at 16:9 with Close on it,
 * and under it, scrolling beneath, the name, its facts, Play (or Resume) and Download across the width, where you
 * are, what it's about, who's in it, a row of actions, then tabs: Episodes, Collection, More Like This, Trailers &
 * More.
 */
function NetflixTitle({ type, id, preview, episode, top, onClose, onBack }: Props) {
  const { data: meta, isError, error } = useMeta(type, id);
  const verdict = useTitleVerdict(meta ?? preview, !!meta || isError);
  const item: MetaPreview | undefined = verdict === "show" ? (meta ?? preview) : undefined;
  const series = type === "series";

  const [sheets, setSheets] = useState(0);
  const onSheet = useCallback((open: boolean) => setSheets((n) => Math.max(0, n + (open ? 1 : -1))), []);
  const bigTrailer = !!useTrailerOpen();
  const trailer = useBackdropTrailer(id, { active: top && verdict === "show", paused: sheets > 0 || bigTrailer });
  const picker = useSourcePicker(onSheet);
  const { next, videoId, resumeAt } = usePlayTarget(item ?? { id, type, name: "" }, meta);
  // Play's sources load as the sheet opens, so they're ready by the time a finger gets there.
  useStreams(type, videoId);
  const { data: progress } = useProgress(id);
  const { data: fileTrailer } = useFileTrailer(id);
  const { data: ratings } = useRatings(type, id);

  const tabs = useMemo((): { id: Tab; label: string }[] => {
    const list: { id: Tab; label: string }[] = [];
    if (series) list.push({ id: "episodes", label: "Episodes" });
    if (meta?.details?.collection) list.push({ id: "collection", label: "Collection" });
    list.push({ id: "more", label: "More Like This" });
    if (meta?.trailerYtId || fileTrailer || meta?.extras?.length) list.push({ id: "trailers", label: "Trailers & More" });
    return list;
  }, [series, meta, fileTrailer]);
  const [tab, setTab] = useState<Tab>(series ? "episodes" : "more");
  const shownTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  if (verdict === "hide")
    return (
      <div className="ps-body">
        <MediaButtons onClose={onClose} onBack={onBack} />
        <EmptyState>{LIMIT_NOTICE}</EmptyState>
      </div>
    );
  if (!item) {
    if (isError)
      return (
        <div className="ps-body">
          <MediaButtons onClose={onClose} onBack={onBack} />
          <EmptyState>Couldn't load this title: {errorMessage(error)}</EmptyState>
        </div>
      );
    return <BodySkeleton type={type} id={id} preview={preview} top={top} onClose={onClose} onBack={onBack} />;
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
  const playLabel = resumeAt ? "Resume" : series ? (next?.kind === "next" && video ? `Play ${shortCode(video)}` : "Play") : "Play";
  const art = detailBackdropUrl(item.background ?? item.poster);

  return (
    <div className="ps-body">
      <div className="ps-media scheme-dark">
        {art && <Img className="ps-media-art" src={art} fallbacks={[sizedArt(item.poster, "w780")]} alt="" loading="eager" fetchPriority="high" />}
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
          <h1 className="ps-title">{item.name}</h1>
          <Facts item={item} meta={meta} scored={ratings?.imdb != null} />
          {/* The scores the user's ratings keys find (MDBList, OMDb): IMDb, Rotten Tomatoes, Metacritic… */}
          <div className="ps-scores">
            <ScoreRow ratings={ratings} />
          </div>
          <button
            type="button"
            className="ps-btn ps-btn-white"
            disabled={!request}
            onPointerDown={preloadPlayerNow}
            onClick={() => request && picker.play(request)}
          >
            <IconPlay size={27} />
            {playLabel}
          </button>
          {(!series || video) && (
            <DownloadButton item={item} video={video} className="ps-btn ps-btn-grey" size={22} text={video ? `Download ${shortCode(video)}` : "Download"} />
          )}
          {resuming && watched && (
            <div className="ps-resume">
              {video && (
                <p className="ps-resume-title">
                  {shortCode(video)} {video.title?.trim() || `Episode ${video.episode}`}
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
          {!resuming && series && next?.kind === "next" && video && (
            <p className="ps-resume-title ps-up-next">
              {shortCode(video)} {video.title?.trim() || `Episode ${video.episode}`}
            </p>
          )}
          <Synopsis text={(resuming || next?.kind === "next") && video?.overview ? video.overview : item.description} />
          <Credits meta={meta} series={series} />
        </div>
        <Actions item={item} meta={meta} request={request} onSources={() => request && picker.choose(request)} fileTrailer={!!fileTrailer} />
        <nav className="ps-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === shownTab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ps-tab-body">
          {shownTab === "episodes" && meta && <Episodes meta={meta} progress={progress} episode={episode} onSheet={onSheet} />}
          {shownTab === "collection" && meta?.details?.collection && <CollectionGrid id={meta.details.collection.id} current={meta.id} />}
          {shownTab === "more" && <MoreLikeThis type={type} id={id} />}
          {shownTab === "trailers" && <Trailers item={item} meta={meta} />}
        </div>
      </div>
      <SourcePicker picker={picker} />
    </div>
  );
}

const shortCode = (v: Video) => (v.season === 0 ? `Special ${v.episode}` : `S${v.season}:E${v.episode}`);

/** Year, age rating, how much there is (seasons or episodes, or the runtime). */
function Facts({ item, meta, scored }: { item: MetaPreview; meta?: Meta; scored?: boolean }) {
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
  return (
    <p className="ps-facts">
      {year && <span>{year}</span>}
      <AgeRatingBadge certification={meta?.certification ?? item.certification} />
      {size && <span>{size}</span>}
      {item.imdbRating && !scored && <span className="ps-fact-badge">IMDb {item.imdbRating}</span>}
    </p>
  );
}

/** Three lines of what it's about; "more" opens the rest. */
function Synopsis({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <p className="ps-synopsis" data-open={open || undefined} onClick={() => setOpen(true)}>
      {text}
    </p>
  );
}

/**
 * Who's in it and who made it, two quiet lines: "Cast:" (cut short with "… more" until tapped) and "Director:" or
 * "Creators:". A name with a page of its own opens it.
 */
function Credits({ meta, series }: { meta?: Meta; series: boolean }) {
  const { navigate } = useNavigation();
  const [all, setAll] = useState(false);
  const cast = meta?.cast ?? [];
  const crew = meta?.director ?? [];
  if (!cast.length && !crew.length) return null;
  const ids = new Map((meta?.people ?? []).filter((p) => p.tmdbId).map((p) => [p.name, p.tmdbId!]));
  const names = (list: string[]) =>
    list.map((name, i) => {
      const id = ids.get(name);
      return (
        <span key={name}>
          {i > 0 && ", "}
          {id ? (
            <button type="button" className="ps-credit-name" onClick={() => navigate({ name: "person", id, title: name })}>
              {name}
            </button>
          ) : (
            name
          )}
        </span>
      );
    });
  return (
    <div className="ps-credits">
      {cast.length > 0 && (
        <p data-open={all || undefined}>
          Cast: {names(all ? cast : cast.slice(0, 3))}
          {!all && cast.length > 3 && (
            <button type="button" className="ps-credit-more" onClick={() => setAll(true)}>
              … more
            </button>
          )}
        </p>
      )}
      {crew.length > 0 && (
        <p>
          {series ? (crew.length > 1 ? "Creators" : "Creator") : crew.length > 1 ? "Directors" : "Director"}: {names(crew.slice(0, 3))}
        </p>
      )}
    </div>
  );
}

/** The row of labelled glyphs under the details: My List, Trailer, Sources, and a show's season download. */
function Actions({ item, meta, request, onSources, fileTrailer }: { item: MetaPreview; meta?: Meta; request: PlayRequest | null; onSources: () => void; fileTrailer: boolean }) {
  const { inLibrary, toggle } = useLibraryToggle(item);
  const season = useMemo(() => (meta && item.type === "series" ? seasonsOf(meta).find((s) => s > 0) : undefined), [meta, item.type]);
  return (
    <div className="ps-actions">
      <Action label="My List" pressed={inLibrary} onClick={toggle}>
        {inLibrary ? <IconCheck size={28} stroke={1.6} /> : <IconPlus size={28} stroke={1.5} />}
      </Action>
      {(meta?.trailerYtId || fileTrailer) && (
        <Action label="Trailer" onClick={() => openTrailer(trailerFor(item.name, item.id, meta))}>
          <IconTrailer size={27} />
        </Action>
      )}
      <Action label="Sources" disabled={!request} onClick={onSources}>
        <IconSources size={27} />
      </Action>
      {meta && season !== undefined && <SeasonDownload item={item} meta={meta} season={season} />}
    </div>
  );
}

function Action({ label, onClick, pressed, disabled, children }: { label: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="ps-action" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <span className="ps-action-glyph">{children}</span>
      <span className="ps-action-label">{label}</span>
    </button>
  );
}

function SeasonDownload({ item, meta, season }: { item: MetaPreview; meta: Meta; season: number }) {
  const videos = useMemo(() => downloadableEpisodes(meta.videos.filter((v) => v.season === season)), [meta.videos, season]);
  const d = useBatchDownload({ item, videos, season });
  return (
    <Action
      label={
        d.running ? (
          "Downloading"
        ) : (
          <>
            Download
            <br />
            Season {season}
          </>
        )
      }
      disabled={d.disabled && !d.running}
      onClick={d.start}
    >
      <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3.5v10.5M7.5 9.5l4.5 4.5 4.5-4.5M4 17.5h16M6.5 20.5h11" />
      </svg>
    </Action>
  );
}

/** A show's episodes: the season (a chooser when there's more than one, else its name and ⓘ), then the list. */
function Episodes({ meta, progress, episode, onSheet }: { meta: Meta; progress?: Progress[]; episode?: string; onSheet: (open: boolean) => void }) {
  const orders = useEpisodeOrders(meta);
  const view = orders.view;
  const seasons = useMemo(() => seasonsOf(meta), [meta]);
  const groups = useMemo(() => shelfGroups(meta.videos, seasons, view), [meta.videos, seasons, view]);
  const next = useMemo(() => upNext(meta, progress ?? [], view), [meta, progress, view]);
  const linked = episode ? meta.videos.find((v) => v.id === episode) : undefined;
  const [season, setSeason] = useState<number | undefined>(linked && shelfGroupOf(linked, view));
  const [choosing, setChoosing] = useState(false);
  const [layout, setLayout] = useEpisodeLayout();
  const picker = useSourcePicker(onSheet);
  useEffect(() => {
    if (season === undefined && progress !== undefined && next.video) setSeason(shelfGroupOf(next.video, view));
  }, [next.video, season, progress, view]);
  const current = groups.some((g) => g.id === season) ? season! : (groups[0]?.id ?? seasons[0]);
  const group = groups.find((g) => g.id === current);
  const episodes = group?.videos ?? [];
  const map = useMemo(() => progressMap(progress), [progress]);
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
  return (
    <section className="ps-episodes" data-layout={layout}>
      <div className="ps-season-bar">
        {groups.length > 1 ? (
          // The app's season dropdown, as Polarity's title pages have it.
          <div className="ps-season-dropdown">
            <SeasonPicker value={current} onChange={setSeason} options={groups.map((g) => ({ id: g.id, label: g.label }))} />
          </div>
        ) : (
          <span className="ps-season-name">{group?.label ?? meta.name}</span>
        )}
        <span className="ps-flex" />
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
      </div>
      {layout === "row" ? (
        <EpisodeStrip key={current} meta={meta} episodes={episodes} numbers={view?.number} progress={map} upNextId={upNextId} onPlay={(v) => picker.play(request(v))} />
      ) : (
        <EpisodeList key={current} meta={meta} episodes={episodes} numbers={view?.number} progress={map} onPlay={(v) => picker.play(request(v))} />
      )}
      <ListOverlay
        open={choosing}
        label="Seasons"
        options={groups.map((g) => ({ id: g.id, label: g.label }))}
        value={current}
        onPick={(id) => {
          setSeason(id);
          setChoosing(false);
        }}
        onClose={() => setChoosing(false)}
      />
      <SourcePicker picker={picker} />
    </section>
  );
}

const fullDateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function EpisodeList({
  meta,
  episodes,
  numbers,
  progress,
  onPlay,
}: {
  meta: Meta;
  episodes: Video[];
  numbers?: Map<string, number>;
  progress: Map<string, Progress>;
  onPlay: (v: Video) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const win = useVerticalWindow(listRef, episodes.length, { estimateRowHeight: 148 });
  const visible = win.active ? episodes.slice(win.start, win.end) : episodes;
  const runtime = formatRuntime(meta.runtime);
  return (
    <ol className="ps-episode-list" ref={listRef}>
      {win.topPx > 0 && <li data-spacer aria-hidden style={{ height: win.topPx }} />}
      {visible.map((v) => (
        <EpisodeRow
          key={v.id}
          meta={meta}
          video={v}
          number={numbers?.get(v.id) ?? v.episode}
          runtime={runtime}
          progress={progress.get(v.id)}
          onPlay={onPlay}
        />
      ))}
      {win.bottomPx > 0 && <li data-spacer aria-hidden style={{ height: win.bottomPx }} />}
    </ol>
  );
}

/**
 * A season's episodes side by side (Polarity's own layout): a wide still each with where you are along its foot, its
 * number and name, how long it is and the start of its story. It opens on the episode you're up to.
 */
function EpisodeStrip({
  meta,
  episodes,
  numbers,
  progress,
  upNextId,
  onPlay,
}: {
  meta: Meta;
  episodes: Video[];
  numbers?: Map<string, number>;
  progress: Map<string, Progress>;
  upNextId?: string;
  onPlay: (v: Video) => void;
}) {
  const strip = useRef<HTMLOListElement>(null);
  const upNextIndex = useMemo(() => (upNextId ? Math.max(0, episodes.findIndex((v) => v.id === upNextId)) : 0), [episodes, upNextId]);
  const win = useHorizontalWindow(strip, episodes.length, { initialIndex: upNextIndex, estimateWidth: 230, estimateGap: 12 });
  useLayoutEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>("[data-up-next]");
    if (el && strip.current) strip.current.scrollLeft = el.offsetLeft - 12;
    // Only when the season opens: later progress mustn't move the row under a finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const runtime = formatRuntime(meta.runtime);
  const visible = win.active ? episodes.slice(win.start, win.end) : episodes;
  return (
    <ol className="ps-ep-strip" ref={strip} onScroll={win.onScroll}>
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
          onPlay={onPlay}
        />
      ))}
      {win.trailPx > 0 && <li data-spacer aria-hidden style={{ flex: "none", width: win.trailPx }} />}
    </ol>
  );
}

const EpisodeCard = memo(function EpisodeCard({
  meta,
  video: v,
  number,
  runtime,
  progress: p,
  isUpNext,
  onPlay,
}: {
  meta: Meta;
  video: Video;
  number: number;
  runtime?: string;
  progress?: Progress;
  isUpNext: boolean;
  onPlay: (v: Video) => void;
}) {
  const aired = !v.released || new Date(v.released).getTime() <= Date.now();
  return (
    <li className="ps-ep-card" data-up-next={isUpNext || undefined} {...cardMenu(meta, episodeEntry(meta, v, p), { episode: true })}>
      <button type="button" className="ps-ep-still scheme-dark" aria-label={`Play episode ${number}`} disabled={!aired} onClick={() => onPlay(v)}>
        <Img src={v.thumbnail ? sizedArt(v.thumbnail, "w500") : undefined} fallbacks={[cardArtUrl(meta.background, "landscape")]} alt="" loading="lazy" />
        {aired ? (
          <span className="ps-ep-play" aria-hidden>
            <IconPlay size={18} />
          </span>
        ) : (
          <span className="ps-ep-soon">{v.released ? shortDateFmt.format(new Date(v.released)) : "Soon"}</span>
        )}
        {p && p.duration > 0 && (
          <span className="ph-progress" aria-hidden>
            <i style={{ width: `${Math.round(Math.min(1, p.position / p.duration) * 100)}%` }} />
          </span>
        )}
      </button>
      <div className="ps-ep-head">
        <strong>
          <span className="ps-ep-num">{number}</span>
          {v.title?.trim() || `Episode ${v.episode}`}
        </strong>
        {aired && <DownloadButton item={meta} video={v} className="ps-episode-dl" size={20} />}
      </div>
      <span className="ps-ep-meta">{[runtime, v.released && aired ? fullDateFmt.format(new Date(v.released)) : undefined].filter(Boolean).join(" · ")}</span>
      {v.overview && <p className="ps-ep-text">{v.overview}</p>}
    </li>
  );
});

const EpisodeRow = memo(function EpisodeRow({
  meta,
  video: v,
  number,
  runtime,
  progress,
  onPlay,
}: {
  meta: Meta;
  video: Video;
  number: number;
  runtime?: string;
  progress?: Progress;
  onPlay: (v: Video) => void;
}) {
  const [failed, setFailed] = useState(false);
  const still = v.thumbnail ? sizedArt(v.thumbnail, "w300") : undefined;
  const aired = !v.released || new Date(v.released).getTime() <= Date.now();
  return (
    <li className="ps-episode" {...cardMenu(meta, episodeEntry(meta, v, progress), { episode: true })}>
      <div className="ps-episode-head">
        <button type="button" className="ps-episode-still scheme-dark" aria-label={`Play episode ${number}`} disabled={!aired} onClick={() => onPlay(v)}>
          {still && !failed ? <Img src={still} fallbacks={[cardArtUrl(meta.background, "landscape")]} alt="" loading="lazy" onFail={() => setFailed(true)} /> : <span className="ps-episode-blank" />}
          {aired && (
            <span className="ps-episode-play" aria-hidden>
              <IconPlayRing size={34} />
            </span>
          )}
          {progress && progress.duration > 0 && (
            <span className="ph-progress" aria-hidden>
              <i style={{ width: `${Math.round(Math.min(1, progress.position / progress.duration) * 100)}%` }} />
            </span>
          )}
        </button>
        <div className="ps-episode-name">
          <strong>
            {number}. {v.title?.trim() || `Episode ${v.episode}`}
          </strong>
          <span>{aired ? runtime : v.released ? `Coming ${shortDateFmt.format(new Date(v.released))}` : ""}</span>
        </div>
        {aired && <DownloadButton item={meta} video={v} className="ps-episode-dl" size={22} />}
      </div>
      {v.overview && <p className="ps-episode-text">{v.overview}</p>}
    </li>
  );
});

/** Recommendations, three posters across. */
function MoreLikeThis({ type, id }: { type: ContentType; id: string }) {
  const { data, isError } = useRecommend(type, id);
  const visible = useBrowseVisible(useListable(data));
  const items = useMemo(() => (visible ?? []).filter((m) => m.id !== id), [visible, id]);
  if (isError || (data && !items.length)) return <p className="ps-empty">Nothing similar found yet.</p>;
  return <PosterGrid items={data ? items : undefined} />;
}

function CollectionGrid({ id, current }: { id: number; current: string }) {
  const { data } = useCollection(id);
  const items = useListable(data);
  return <PosterGrid items={items?.filter((m) => m.id !== current)} />;
}

function PosterGrid({ items }: { items?: readonly MetaPreview[] }) {
  return (
    <div className="ps-grid">
      {items
        ? items.map((m) => <Poster key={`${m.type}:${m.id}`} item={m} />)
        : Array.from({ length: 9 }, (_, i) => <span key={i} className="ph-poster ph-skeleton" aria-hidden />)}
    </div>
  );
}

/** The trailer and the title's other videos, each a wide still with its name under it. */
function Trailers({ item, meta }: { item: MetaPreview; meta?: Meta }) {
  const extras: Extra[] = meta?.extras ?? [];
  const main = meta?.trailerYtId ? trailerFor(item.name, item.id, meta) : undefined;
  return (
    <div className="ps-trailers">
      {main && (
        <button type="button" className="ps-trailer" onClick={() => openTrailer(main)}>
          <span className="ps-trailer-still scheme-dark">
            <Img src={cardArtUrl(item.background, "landscape")} alt="" loading="lazy" />
            <span className="ps-trailer-play" aria-hidden>
              <IconPlayRing size={44} />
            </span>
          </span>
          <span className="ps-trailer-name">Trailer: {item.name}</span>
        </button>
      )}
      {extras.map((e) => (
        <button key={e.key} type="button" className="ps-trailer" onClick={() => playExtra(e)}>
          <span className="ps-trailer-still scheme-dark">
            <Img src={extraStills(e)[0]} fallbacks={extraStills(e).slice(1)} alt="" loading="lazy" />
            <span className="ps-trailer-play" aria-hidden>
              <IconPlayRing size={44} />
            </span>
          </span>
          <span className="ps-trailer-name">
            {extraKind(e.kind)}: {e.name}
          </span>
        </button>
      ))}
    </div>
  );
}
