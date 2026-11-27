import "../styles/anime.css";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, memo, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openCardMenu, menuPoint } from "../components/CardMenu";
import { useArtFocus } from "../components/DetailArt";
import { Star, Warning } from "../components/icons";
import { Img } from "../components/Img";
import { ArtTitle } from "../components/title/Card";
import {
  ANIME_GENRES,
  FORMAT_LABEL,
  SEASON_LABEL,
  STATUS_LABEL,
  animeItemName,
  animeItemToPreview,
  countdown,
  formatAnimeItemScore,
  nextSeason,
  seasonOf,
  untilAiring,
  useAnimeGenreShelf,
  useAnimeHomeCatalog,
  useAnimeToday,
  useShelfVisible,
  type AnimeShelfId,
  type BrowseFilters,
  type MediaFormat,
  type MediaStatus,
} from "../lib/anime";
import { useMatureContent } from "../lib/catalog";
import { joinFacts } from "../lib/format";
import { metaQuery } from "../lib/net";
import { useNavigation, type Route } from "../lib/router";
import { usePrefs } from "../lib/settings";
import type { AnimeItem } from "../lib/types";
import { heroBackdropUrl, lazyNamed, prefersReducedMotion, sizedArt, useCardIntent, useNearViewport, useOffscreenMark } from "../lib/ui";
import { IconPlay } from "../phone/icons";
import { useArtTint } from "../phone/tint";
import { TopBar } from "./Bar";
import type { Chrome } from "./Nav";
import { LandscapeSkeletons, Row } from "./Rows";

const ListDialog = lazyNamed(() => import("./ListDialog"), "ListDialog");

type Shape = "poster" | "landscape";

const HERO_COUNT = 6;
const ADVANCE_MS = 9000;
const PEEK_DELAY_MS = 360;
const INTENT_DELAY = 150;

/** Compact single-unit countdown ("4d", "6h", "18m") so card subtitles stay calm and readable. */
function shortCountdown(seconds: number) {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  if (d > 0) return `${d}d`;
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}h`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

function itemFacts(item: AnimeItem): string {
  const fmt = item.format && FORMAT_LABEL[item.format as MediaFormat];
  const eps = item.format === "MOVIE" ? (item.duration ? `${item.duration} min` : undefined) : item.episodes ? `${item.episodes} ep` : undefined;
  return [item.year, fmt, eps].filter(Boolean).join(" · ");
}

/** Click, right-click, and hover prefetch for a show-first `AnimeItem` (zero AniList calls). */
function useOpenAnimeItem(item: AnimeItem) {
  const { navigate } = useNavigation();
  const { animeTitles } = usePrefs();
  const qc = useQueryClient();
  const preview = useMemo(() => animeItemToPreview(item, animeTitles), [item, animeTitles]);
  const openPage = useCallback(
    () => navigate({ name: "detail", type: item.type, id: item.id, preview, season: item.seasonHint }),
    [navigate, item.type, item.id, preview, item.seasonHint],
  );
  const intent = useCardIntent(() => void qc.prefetchQuery(metaQuery(item.type, item.id)), INTENT_DELAY);
  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      openCardMenu(preview, menuPoint(e), openPage);
    },
    [preview, openPage],
  );
  return { onClick: openPage, onContextMenu, ...intent };
}

// --- Shared Hover Quick-Peek -----------------------------------------------

interface PeekTarget {
  item: AnimeItem;
  rect: DOMRect;
  kicker?: string;
}

interface PeekActions {
  enter: (item: AnimeItem, el: HTMLElement, kicker?: string) => void;
  leave: (itemId: string) => void;
  hide: () => void;
}

const NOOP_PEEK: PeekActions = { enter: () => {}, leave: () => {}, hide: () => {} };
const PeekContext = createContext<PeekActions>(NOOP_PEEK);

function useFineHover() {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
}

function AnimePeekProvider({ enabled, scroller, children }: { enabled: boolean; scroller: React.RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pendingId = useRef<string | null>(null);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    pendingId.current = null;
    setPeek((p) => (p ? null : p));
  }, []);

  const enter = useCallback(
    (item: AnimeItem, el: HTMLElement, kicker?: string) => {
      if (!enabled || !useFineHover()) return;
      window.clearTimeout(timer.current);
      pendingId.current = item.id;
      timer.current = window.setTimeout(() => {
        if (pendingId.current !== item.id || !el.isConnected) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) return;
        setPeek({ item, rect, kicker });
      }, PEEK_DELAY_MS);
    },
    [enabled],
  );

  const leave = useCallback((itemId: string) => {
    if (pendingId.current === itemId) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      pendingId.current = null;
    }
    setPeek((p) => (p?.item.id === itemId ? null : p));
  }, []);

  useEffect(() => {
    if (!enabled) hide();
  }, [enabled, hide]);

  useEffect(() => {
    const el = scroller.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    el?.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer.current);
      el?.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", hide);
    };
  }, [scroller, hide]);

  const actions = useMemo(() => ({ enter, leave, hide }), [enter, leave, hide]);

  return (
    <PeekContext.Provider value={actions}>
      {children}
      {peek && createPortal(<AnimeHoverPeek target={peek} />, document.body)}
    </PeekContext.Provider>
  );
}

function AnimeHoverPeek({ target }: { target: PeekTarget }) {
  const { item, rect, kicker } = target;
  const { animeTitles, animeCardScores, animeScoreFormat, animeCardCountdown } = usePrefs();
  const name = animeItemName(item, animeTitles);
  const score = animeCardScores ? formatAnimeItemScore(item.score, animeScoreFormat) : undefined;
  const airing = animeCardCountdown ? item.airing : undefined;
  const synopsis = item.description;
  const facts = itemFacts(item);
  const statusPill =
    kicker ??
    item.seasonLabel ??
    (airing
      ? `${airing.episode ? `Ep ${airing.episode} ` : ""}in ${countdown(untilAiring(airing.airingAt))}`
      : item.status === "RELEASING"
        ? "Airing"
        : item.status === "NOT_YET_RELEASED"
          ? "Upcoming"
          : item.status
            ? STATUS_LABEL[item.status as MediaStatus]
            : undefined);

  const width = 304;
  const estHeight = synopsis ? 216 : 124;
  const gap = 12;
  const margin = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsRight = rect.right + gap + width + margin <= vw;
  const fitsLeft = rect.left - gap - width >= margin;
  const left = fitsRight
    ? rect.right + gap
    : fitsLeft
      ? rect.left - gap - width
      : Math.max(margin, Math.min(vw - width - margin, rect.left + (rect.width - width) / 2));
  const top = Math.max(margin + 56, Math.min(vh - estHeight - margin, rect.top));
  const side = fitsRight ? "right" : "left";

  return (
    <aside className="dk-apeek" data-side={side} style={{ left, top, width }} aria-hidden>
      <div className="dk-apeek-head">
        <h3 className="dk-apeek-title">{name}</h3>
        {score && (
          <span className="dk-apeek-score tabular">
            <Star size={11} />
            {score}
          </span>
        )}
      </div>
      {(facts || statusPill) && (
        <div className="dk-apeek-meta tabular">
          {statusPill && (
            <span className="dk-apeek-status" data-airing={item.status === "RELEASING" || !!airing || undefined}>
              {statusPill}
            </span>
          )}
          {facts && <span className="dk-apeek-facts">{facts}</span>}
        </div>
      )}
      {synopsis && <p className="dk-apeek-desc">{synopsis}</p>}
      {item.genres && item.genres.length > 0 && (
        <div className="dk-apeek-genres">
          {item.genres.slice(0, 3).map((g) => (
            <span key={g} className="dk-apeek-genre">
              {g}
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}

// --- Desk Anime Screen -----------------------------------------------------

/**
 * Show-first Desk Anime screen: powered by the Rust backend (TMDB Discover for evergreen shelves
 * when enabled + Jikan seasonal/schedule feeds, hydrated in parallel with 16:9 fanart & logos).
 * Zero per-card API calls, instant Hero billboard, and seamless unified show modals.
 */
export function DeskAnime({ chrome }: { chrome: Chrome }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { data, isError, refetch } = useAnimeHomeCatalog();
  const { animeCardPeek, animeTitles } = usePrefs();
  const visible = useShelfVisible();
  const hasHero = visible("hero");
  const today = useAnimeToday(visible("today"));
  const now = seasonOf();
  const next = nextSeason(now);
  const { navigate } = useNavigation();
  const [shown, setShown] = useState(0);
  const [choosingGenre, setChoosingGenre] = useState(false);
  const [everChoseGenre, setEverChoseGenre] = useState(false);
  if (choosingGenre && !everChoseGenre) setEverChoseGenre(true);

  // Hero slides come straight from the already-hydrated shelf response — zero extra requests, zero blocking.
  const heroSlides = useMemo(() => {
    if (!hasHero || !data) return [] as AnimeItem[];
    const pool = [...(data.trending ?? []), ...(data.season ?? [])];
    const seen = new Set<string>();
    const withArt: AnimeItem[] = [];
    for (const item of pool) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.background) withArt.push(item);
      if (withArt.length >= HERO_COUNT) break;
    }
    return withArt.length ? withArt : pool.slice(0, HERO_COUNT);
  }, [hasHero, data]);

  const currentHero = heroSlides[Math.min(shown, Math.max(0, heroSlides.length - 1))];
  const tint = useArtTint(currentHero ? sizedArt(currentHero.background ?? currentHero.poster, "w300") : undefined);
  const tintStyle = useMemo<CSSProperties | undefined>(() => (tint ? ({ "--tint-dark": tint.dark, "--tint-light": tint.light } as CSSProperties) : undefined), [tint]);

  if (isError && !data) {
    return (
      <div className="dk-page dk-home dk-anime">
        {chrome === "tabs" && <TopBar logo title="Anime" scroller={scroller} />}
        <div className="dk-scroll" ref={scroller}>
          <div className="dk-state">
            <h2>Couldn't load anime</h2>
            <p>Check your connection and try again.</p>
            <button type="button" className="dk-btn dk-btn-glass" onClick={() => void refetch()}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const featuredIds = new Set(heroSlides.map((s) => s.id));
  const browse = (title: string, filters: Partial<BrowseFilters>): Route => ({ name: "anime-browse", title, ...filters });
  const seasonTitle = `Airing This ${SEASON_LABEL[now.season]}`;
  const upcomingTitle = `Coming in ${SEASON_LABEL[next.season]} ${next.year}`;
  const shelves: {
    id: AnimeShelfId;
    title: string;
    shape: Shape;
    items?: AnimeItem[];
    label?: (a: AnimeItem) => string | undefined;
    to: Route;
  }[] = [
    { id: "season", title: seasonTitle, shape: "landscape", items: data?.season, to: browse(seasonTitle, { ...now, sort: "POPULARITY_DESC" }) },
    {
      id: "trending",
      title: "Trending Now",
      shape: "poster",
      items: data?.trending?.filter((a) => !featuredIds.has(a.id)),
      to: browse("Trending Now", { sort: "TRENDING_DESC" }),
    },
    { id: "top", title: "Highest Rated", shape: "landscape", items: data?.top, to: browse("Highest Rated", { sort: "SCORE_DESC" }) },
    {
      id: "upcoming",
      title: upcomingTitle,
      shape: "poster",
      items: data?.upcoming,
      label: upcomingLabel,
      to: browse(upcomingTitle, { ...next, sort: "POPULARITY_DESC" }),
    },
    { id: "movies", title: "Anime Movies", shape: "landscape", items: data?.movies, to: browse("Anime Movies", { format: "MOVIE", sort: "POPULARITY_DESC" }) },
    { id: "popular", title: "Most Popular", shape: "poster", items: data?.popular, to: browse("Most Popular", { sort: "POPULARITY_DESC" }) },
  ];
  const on = shelves.filter((s) => visible(s.id));
  const showToday = visible("today") && !today.isError && today.data?.length !== 0;
  const showGenres = visible("genres");
  const todayAt = Math.min(2, on.length);

  const todayRow = showToday && (
    <Row key="today" title="Airing Today" className="dk-row-air" onMore={() => navigate({ name: "anime-schedule" })}>
      {today.data ? today.data.map((item) => <DeskAiringCard key={item.id} item={item} />) : <AiringSkeletons count={5} />}
    </Row>
  );

  const caret = (
    <svg className="dk-chip-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2 4.2h8L6 8.6z" fill="currentColor" />
    </svg>
  );

  return (
    <AnimePeekProvider enabled={animeCardPeek} scroller={scroller}>
      <div className="dk-page dk-home dk-anime">
        {chrome === "tabs" && <TopBar logo title="Anime" scroller={scroller} tint={tintStyle} />}
        <div className="dk-scroll" ref={scroller}>
          <div className="dk-tint" style={tintStyle} aria-hidden />
          {chrome === "nav" ? (
            <div className="dk-head">
              <h1 className="dk-head-name">Anime</h1>
              <button type="button" className="dk-chip dk-head-genres" onClick={() => setChoosingGenre(true)}>
                Genres
                {caret}
              </button>
              <button type="button" className="dk-chip" onClick={() => navigate({ name: "anime-schedule" })}>
                Schedule
              </button>
              <button type="button" className="dk-chip" onClick={() => navigate({ name: "anime-browse" })}>
                Browse All
              </button>
            </div>
          ) : (
            <nav className="dk-chips" aria-label="Browse anime">
              <button type="button" className="dk-chip" onClick={() => setChoosingGenre(true)}>
                Genres
                {caret}
              </button>
              <button type="button" className="dk-chip" onClick={() => navigate({ name: "anime-schedule" })}>
                Schedule
              </button>
              <button type="button" className="dk-chip" onClick={() => navigate({ name: "anime-browse" })}>
                Browse All
              </button>
            </nav>
          )}
          {hasHero &&
            (heroSlides.length ? (
              <AnimeBillboard slides={heroSlides} titlePref={animeTitles} onShown={setShown} />
            ) : !data ? (
              <div className="dk-billboard dk-skeleton" aria-hidden />
            ) : null)}

          <div className="dk-rows">
            {on.map((s, i) => [
              i === todayAt && todayRow,
              <DeskAnimeShelf key={s.id} title={s.title} shape={s.shape} items={s.items} label={s.label} onMore={() => navigate(s.to)} />,
            ])}
            {todayAt === on.length && todayRow}
            {showGenres &&
              ANIME_GENRES.slice(0, 8).map((g, i) => <DeskAnimeGenreShelf key={g} genre={g} shape={i % 2 === 0 ? "landscape" : "poster"} />)}
          </div>
        </div>
        {everChoseGenre && (
          <Suspense fallback={null}>
            <ListDialog
              open={choosingGenre}
              label="Genres"
              options={ANIME_GENRES.map((g) => ({ id: g, label: g }))}
              onPick={(genre) => {
                setChoosingGenre(false);
                navigate({ name: "anime-browse", genre: String(genre) });
              }}
              onClose={() => setChoosingGenre(false)}
            />
          </Suspense>
        )}
      </div>
    </AnimePeekProvider>
  );
}

// --- Featured Hero Billboard -----------------------------------------------

function AnimeBillboard({
  slides,
  titlePref,
  onShown,
}: {
  slides: AnimeItem[];
  titlePref: "romaji" | "english" | "native";
  onShown: (i: number) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [{ index, prev }, setState] = useState({ index: 0, prev: -1 });
  const go = useCallback((step: 1 | -1) => setState((s) => ({ index: (s.index + step + slides.length) % slides.length, prev: s.index })), [slides.length]);
  useEffect(() => onShown(index), [index, onShown]);

  const hovered = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (slides.length < 2 || prefersReducedMotion()) return;
    const t = window.setTimeout(() => {
      const page = cardRef.current?.closest<HTMLElement>(".dk-tab-page");
      const free = !hovered.current && !document.hidden && page?.dataset.active === "true";
      if (free) go(1);
      else setTick((n) => n + 1);
    }, ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [index, tick, slides.length, go]);

  const slide = slides[Math.min(index, slides.length - 1)];
  const prevSlide = prev >= 0 ? slides[prev] : undefined;
  const { navigate } = useNavigation();
  const { animeCardCountdown } = usePrefs();
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [slide.id]);

  const name = animeItemName(slide, titlePref);
  const open = () =>
    navigate({
      name: "detail",
      type: slide.type,
      id: slide.id,
      preview: animeItemToPreview(slide, titlePref),
      season: slide.seasonHint,
    });
  const airing = animeCardCountdown ? slide.airing : undefined;
  const line = joinFacts([
    slide.seasonLabel,
    slide.format && FORMAT_LABEL[slide.format as MediaFormat],
    ...(slide.genres ?? []).slice(0, 2),
    slide.year,
    airing && `${airing.episode ? `Ep ${airing.episode} ` : ""}in ${shortCountdown(untilAiring(airing.airingAt))}`,
  ]);

  return (
    <div
      ref={cardRef}
      className="dk-billboard scheme-dark"
      data-origin="12"
      role="button"
      tabIndex={0}
      aria-label={name}
      aria-roledescription="carousel"
      onClick={(e) => e.currentTarget.contains(e.target as Node) && open()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") open();
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      onPointerEnter={() => {
        hovered.current = true;
      }}
      onPointerLeave={() => {
        hovered.current = false;
        setTick((n) => n + 1);
      }}
    >
      <div className="dk-bb-window">
        <AnimeBillboardArt key={`${index}:${slide.id}`} item={slide} entering={prev >= 0} />
        {prevSlide && <AnimeBillboardArt key={`${prev}:${prevSlide.id}`} item={prevSlide} under />}
      </div>
      <div className="dk-bb-shade" aria-hidden />
      <div className="dk-bb-body" key={slide.id}>
        {slide.logo && !logoFailed ? (
          <Img className="dk-bb-logo" src={sizedArt(slide.logo, "w500")} alt={name} onFail={() => setLogoFailed(true)} draggable={false} />
        ) : (
          <h2 className="dk-bb-name">{name}</h2>
        )}
        {line && <p className="dk-bb-line tabular">{line}</p>}
        {slide.description && <p className="dk-bb-desc">{slide.description}</p>}
        <div className="dk-bb-actions">
          <button
            type="button"
            className="dk-btn dk-btn-white"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
          >
            <IconPlay size={22} />
            Watch Now
          </button>
        </div>
      </div>
    </div>
  );
}

function AnimeBillboardArt({ item, entering, under }: { item: AnimeItem; entering?: boolean; under?: boolean }) {
  const art = heroBackdropUrl(item.background ?? item.poster);
  const focus = useArtFocus(art, true);
  return <Img className="dk-bb-art" data-entering={entering || undefined} data-under={under || undefined} src={art} alt="" loading="eager" style={focus.style} draggable={false} />;
}

// --- Shelves & Cards -------------------------------------------------------

function DeskAnimeShelf({
  title,
  shape,
  items,
  label,
  onMore,
}: {
  title: string;
  shape: Shape;
  items?: AnimeItem[];
  label?: (a: AnimeItem) => string | undefined;
  onMore: () => void;
}) {
  const { animeCardTitles } = usePrefs();
  if (items && !items.length) return null;
  return (
    <Row title={title} shape={shape} className={shape === "poster" && animeCardTitles ? "dk-row-acards" : undefined} onMore={onMore}>
      {items
        ? items.map((item) =>
            shape === "landscape" ? (
              <DeskAnimeLandscapeCard key={item.id} item={item} kicker={label?.(item)} />
            ) : (
              <DeskAnimePosterCard key={item.id} item={item} kicker={label?.(item)} />
            ),
          )
        : shape === "landscape"
          ? <LandscapeSkeletons />
          : <AnimePosterSkeletons captioned={animeCardTitles} />}
    </Row>
  );
}

function DeskAnimeGenreShelf({ genre, shape }: { genre: string; shape: Shape }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(false);
  const { data } = useAnimeGenreShelf(genre, near);
  useOffscreenMark(ref, !data);
  const { navigate } = useNavigation();
  return (
    <div ref={ref} className="dk-row-slot" data-shape={shape}>
      <DeskAnimeShelf title={genre} shape={shape} items={data} onMore={() => navigate({ name: "anime-browse", genre })} />
    </div>
  );
}

function MatureCover() {
  return (
    <span className="card-mature" title="Mature content" aria-label="Mature content">
      <Warning size={22} />
      <span className="card-mature-label">18+</span>
    </span>
  );
}

const DeskAnimePosterCard = memo(function DeskAnimePosterCard({ item, kicker }: { item: AnimeItem; kicker?: string }) {
  const { animeTitles, animeCardTitles, animeCardScores, animeScoreFormat, animeCardCountdown } = usePrefs();
  const name = animeItemName(item, animeTitles);
  const open = useOpenAnimeItem(item);
  const peek = useContext(PeekContext);
  const matureContent = useMatureContent();
  const score = animeCardScores ? formatAnimeItemScore(item.score, animeScoreFormat) : undefined;
  const [failed, setFailed] = useState(false);

  if (matureContent === "hide" && item.mature) return null;

  const airing = animeCardCountdown ? item.airing : undefined;
  const secondary =
    kicker ??
    item.seasonLabel ??
    (airing
      ? `${airing.episode ? `Ep ${airing.episode} · ` : ""}${shortCountdown(untilAiring(airing.airingAt))}`
      : [item.year, item.genres?.[0]].filter(Boolean).join(" · ") || itemFacts(item));

  return (
    <button
      type="button"
      className="dk-acard"
      aria-label={name}
      onClick={() => {
        peek.hide();
        open.onClick();
      }}
      onContextMenu={open.onContextMenu}
      onFocus={open.onFocus}
      onBlur={open.onBlur}
      onPointerDown={() => peek.hide()}
      onPointerEnter={(e) => {
        open.onPointerEnter();
        peek.enter(item, e.currentTarget, kicker);
      }}
      onPointerLeave={() => {
        open.onPointerLeave();
        peek.leave(item.id);
      }}
    >
      <span className="dk-poster dk-acard-art scheme-dark" data-origin="4">
        {!failed && item.poster ? (
          <Img src={item.poster} alt="" loading="lazy" decoding="async" draggable={false} onFail={() => setFailed(true)} />
        ) : (
          <span className="dk-poster-name">{name}</span>
        )}
        {matureContent === "blur" && item.mature && <MatureCover />}
        {!animeCardTitles && score && (
          <span className="dk-acard-score tabular" title="Score">
            <Star size={10} />
            {score}
          </span>
        )}
      </span>
      {animeCardTitles && (
        <span className="dk-acard-cap">
          <span className="dk-acard-title">{name}</span>
          {(score || secondary) && (
            <span className="dk-acard-meta tabular">
              {score && (
                <span className="dk-acard-meta-score">
                  <Star size={10} />
                  {score}
                </span>
              )}
              {score && secondary && <span aria-hidden>·</span>}
              {secondary && <span className="dk-acard-meta-text">{secondary}</span>}
            </span>
          )}
        </span>
      )}
    </button>
  );
});

/**
 * Anime landscape card: renders pre-hydrated 16:9 fanart + logo directly from the backend shelf response.
 * Zero per-card API calls.
 */
const DeskAnimeLandscapeCard = memo(function DeskAnimeLandscapeCard({ item, kicker }: { item: AnimeItem; kicker?: string }) {
  const { animeTitles, animeCardScores, animeScoreFormat, animeCardCountdown } = usePrefs();
  const name = animeItemName(item, animeTitles);
  const open = useOpenAnimeItem(item);
  const peek = useContext(PeekContext);
  const matureContent = useMatureContent();
  const score = animeCardScores ? formatAnimeItemScore(item.score, animeScoreFormat) : undefined;
  const [failed, setFailed] = useState(false);

  if (matureContent === "hide" && item.mature) return null;

  const [bg, ...fallbacks] = [item.background, item.poster].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  const airing = animeCardCountdown ? item.airing : undefined;
  const sub = [
    item.seasonLabel,
    score ? `★ ${score}` : undefined,
    kicker ?? (airing ? `in ${shortCountdown(untilAiring(airing.airingAt))}` : item.year),
    item.genres?.[0],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      className="dk-lc scheme-dark"
      data-origin="10"
      aria-label={name}
      onClick={() => {
        peek.hide();
        open.onClick();
      }}
      onContextMenu={open.onContextMenu}
      onFocus={open.onFocus}
      onBlur={open.onBlur}
      onPointerDown={() => peek.hide()}
      onPointerEnter={(e) => {
        open.onPointerEnter();
        peek.enter(item, e.currentTarget, kicker);
      }}
      onPointerLeave={() => {
        open.onPointerLeave();
        peek.leave(item.id);
      }}
    >
      {!failed && bg ? (
        <Img
          className="dk-lc-img"
          src={bg}
          fallbacks={fallbacks.length ? fallbacks : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onFail={() => setFailed(true)}
        />
      ) : (
        <span className="dk-poster-name">{name}</span>
      )}
      {matureContent === "blur" && item.mature && <MatureCover />}
      <span className="dk-lc-shade" aria-hidden />
      <span className="dk-lc-body" aria-hidden>
        <span className="dk-lc-brand">
          <ArtTitle name={name} logo={item.logo} logos={item.logos} decorative />
        </span>
        {sub && <span className="dk-lc-sub tabular">{sub}</span>}
      </span>
    </button>
  );
});

/**
 * Compact horizontal schedule tile for Airing Today: uncropped 2:3 cover thumbnail beside
 * local broadcast time, season badge, title, score, and genres.
 */
const DeskAiringCard = memo(function DeskAiringCard({ item }: { item: AnimeItem }) {
  const { animeTitles, animeCardScores, animeScoreFormat } = usePrefs();
  const name = animeItemName(item, animeTitles);
  const open = useOpenAnimeItem(item);
  const peek = useContext(PeekContext);
  const matureContent = useMatureContent();
  const score = animeCardScores ? formatAnimeItemScore(item.score, animeScoreFormat) : undefined;
  const [failed, setFailed] = useState(false);

  if (matureContent === "hide" && item.mature) return null;

  const delta = item.airing ? untilAiring(item.airing.airingAt) : 0;
  const upcomingSoon = delta > 0 && delta <= 6 * 3600;
  const timeText = item.airing
    ? new Date(item.airing.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "Today";
  const badge = item.seasonLabel ? `${item.seasonLabel} · ${timeText}` : timeText;
  const sub = [item.format && FORMAT_LABEL[item.format as MediaFormat], ...(item.genres ?? []).slice(0, 2)].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className="dk-air"
      aria-label={`${name} — ${badge}`}
      onClick={() => {
        peek.hide();
        open.onClick();
      }}
      onContextMenu={open.onContextMenu}
      onFocus={open.onFocus}
      onBlur={open.onBlur}
      onPointerDown={() => peek.hide()}
      onPointerEnter={(e) => {
        open.onPointerEnter();
        peek.enter(item, e.currentTarget, badge);
      }}
      onPointerLeave={() => {
        open.onPointerLeave();
        peek.leave(item.id);
      }}
    >
      <span className="dk-air-thumb scheme-dark" data-origin="7">
        {!failed && item.poster ? (
          <Img src={item.poster} alt="" loading="lazy" decoding="async" draggable={false} onFail={() => setFailed(true)} />
        ) : (
          <span className="dk-air-thumb-fallback">{name.slice(0, 2)}</span>
        )}
        {matureContent === "blur" && item.mature && <MatureCover />}
      </span>
      <span className="dk-air-body">
        <span className="dk-air-top tabular">
          <span className="dk-air-time" data-soon={upcomingSoon || undefined}>
            {badge}
          </span>
          {score && (
            <span className="dk-air-score">
              <Star size={10} />
              {score}
            </span>
          )}
        </span>
        <span className="dk-air-title">{name}</span>
        {sub && <span className="dk-air-sub">{sub}</span>}
      </span>
    </button>
  );
});

function AnimePosterSkeletons({ captioned, count = 8 }: { captioned: boolean; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="dk-acard dk-acard-sk" aria-hidden>
          <span className="dk-poster dk-skeleton" />
          {captioned && (
            <span className="dk-acard-cap">
              <span className="dk-acard-sk-line dk-skeleton" />
              <span className="dk-acard-sk-line dk-acard-sk-short dk-skeleton" />
            </span>
          )}
        </span>
      ))}
    </>
  );
}

function AiringSkeletons({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="dk-air dk-air-sk dk-skeleton" aria-hidden />
      ))}
    </>
  );
}

function upcomingLabel(item: AnimeItem) {
  if (item.startDate) {
    const parsed = new Date(`${item.startDate}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return item.format ? FORMAT_LABEL[item.format as MediaFormat] : undefined;
}
