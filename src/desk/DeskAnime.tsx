import "../styles/anime.css";
import { useQueries } from "@tanstack/react-query";
import { createContext, memo, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOpenAnime } from "../components/anime/AnimeCard";
import { useArtFocus } from "../components/DetailArt";
import { Star, Warning } from "../components/icons";
import { Img } from "../components/Img";
import { ArtTitle } from "../components/title/Card";
import {
  ANIME_GENRES,
  FORMAT_LABEL,
  SEASON_LABEL,
  STATUS_LABEL,
  aniZipQuery,
  animePreview,
  cardFacts,
  cleanDescription,
  countdown,
  isMature,
  landscapeArt,
  nextSeason,
  reprioritiseAniList,
  rowPriority,
  seasonOf,
  slidesReady,
  untilAiring,
  useAiringToday,
  useAnimeGenre,
  useAnimeHome,
  useAnimePageArt,
  useAnimeScore,
  useAnimeTitle,
  useCardsShown,
  useFranchiseBanners,
  useLinkedImdb,
  useShelfVisible,
  type AiringSlot,
  type AnimeCard as Card,
  type AnimeShelfId,
  type AniZip,
  type BrowseFilters,
} from "../lib/anime";
import { useMatureContent } from "../lib/catalog";
import { joinFacts } from "../lib/format";
import { PRIORITY } from "../lib/net";
import { useNavigation, type Route } from "../lib/router";
import { usePrefs } from "../lib/settings";
import { heroBackdropUrl, lazyNamed, prefersReducedMotion, sizedArt, useNearViewport, useOffscreenMark, useViewportPlace } from "../lib/ui";
import { IconPlay } from "../phone/icons";
import { useArtTint } from "../phone/tint";
import { TopBar } from "./Bar";
import type { Chrome } from "./Nav";
import { LandscapeSkeletons, Row } from "./Rows";

const ListDialog = lazyNamed(() => import("./ListDialog"), "ListDialog");

type Shape = "poster" | "landscape";

const HERO_COUNT = 6;
const HERO_POOL = 10;
const ADVANCE_MS = 9000;
const PEEK_DELAY_MS = 360;

/** Compact single-unit countdown ("4d", "6h", "18m") so card subtitles stay calm and readable. */
function shortCountdown(seconds: number) {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  if (d > 0) return `${d}d`;
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}h`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

// --- Shared Hover Quick-Peek -----------------------------------------------

interface PeekTarget {
  card: Card;
  rect: DOMRect;
  kicker?: string;
}

interface PeekActions {
  enter: (card: Card, el: HTMLElement, kicker?: string) => void;
  leave: (cardId: number) => void;
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
  const pendingId = useRef<number | null>(null);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    pendingId.current = null;
    setPeek((p) => (p ? null : p));
  }, []);

  const enter = useCallback(
    (card: Card, el: HTMLElement, kicker?: string) => {
      if (!enabled || !useFineHover()) return;
      window.clearTimeout(timer.current);
      pendingId.current = card.id;
      timer.current = window.setTimeout(() => {
        if (pendingId.current !== card.id || !el.isConnected) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) return;
        setPeek({ card, rect, kicker });
      }, PEEK_DELAY_MS);
    },
    [enabled],
  );

  const leave = useCallback((cardId: number) => {
    if (pendingId.current === cardId) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      pendingId.current = null;
    }
    setPeek((p) => (p?.card.id === cardId ? null : p));
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
  const { card, rect, kicker } = target;
  const name = useAnimeTitle()(card.title);
  const { animeCardScores, animeCardCountdown } = usePrefs();
  const score = useAnimeScore()(animeCardScores ? card.averageScore : undefined);
  const next = animeCardCountdown ? card.nextAiringEpisode : undefined;
  const synopsis = useMemo(() => cleanDescription(card.description).slice(0, 2).join(" "), [card.description]);
  const facts = cardFacts(card);
  const statusPill =
    kicker ??
    (next
      ? `Ep ${next.episode} in ${countdown(untilAiring(next.airingAt))}`
      : card.status === "RELEASING"
        ? "Airing"
        : card.status === "NOT_YET_RELEASED"
          ? card.season && card.seasonYear
            ? `${SEASON_LABEL[card.season]} ${card.seasonYear}`
            : "Upcoming"
          : card.status
            ? STATUS_LABEL[card.status]
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
            <span className="dk-apeek-status" data-airing={card.status === "RELEASING" || !!next || undefined}>
              {statusPill}
            </span>
          )}
          {facts && <span className="dk-apeek-facts">{facts}</span>}
        </div>
      )}
      {synopsis && <p className="dk-apeek-desc">{synopsis}</p>}
      {card.genres && card.genres.length > 0 && (
        <div className="dk-apeek-genres">
          {card.genres.slice(0, 3).map((g) => (
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
 * Desk Anime: shares DeskHome's visual system (tinted backdrop wash, rounded featured billboard, browse/genre chips)
 * while adapting its shelves for AniList discovery — readable below-poster titles & metadata, ranked Trending,
 * 16:9 fanart + title logos on landscape rows, compact broadcast schedule tiles for Airing Today, and a hover quick-peek.
 */
export function DeskAnime({ chrome }: { chrome: Chrome }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { data, isError, refetch } = useAnimeHome();
  const { animeCardPeek } = usePrefs();
  const visible = useShelfVisible();
  const hasHero = visible("hero");
  const hero = useDeskAnimeHero(hasHero ? data?.trending : undefined);
  const today = useAiringToday(visible("today"));
  const now = seasonOf();
  const next = nextSeason(now);
  const { navigate } = useNavigation();
  const [shown, setShown] = useState(0);
  const [choosingGenre, setChoosingGenre] = useState(false);
  const [everChoseGenre, setEverChoseGenre] = useState(false);
  if (choosingGenre && !everChoseGenre) setEverChoseGenre(true);

  const currentHero = hero.slides[Math.min(shown, Math.max(0, hero.slides.length - 1))];
  const tint = useArtTint(currentHero ? sizedArt(currentHero.background ?? currentHero.poster, "w300") : undefined);
  const tintStyle = useMemo<CSSProperties | undefined>(() => (tint ? ({ "--tint-dark": tint.dark, "--tint-light": tint.light } as CSSProperties) : undefined), [tint]);

  if (isError && !data) {
    return (
      <div className="dk-page dk-home dk-anime">
        {chrome === "tabs" && <TopBar logo title="Anime" scroller={scroller} />}
        <div className="dk-scroll" ref={scroller}>
          <div className="dk-state">
            <h2>AniList didn't answer</h2>
            <p>It limits how often it can be asked, so give it a minute.</p>
            <button type="button" className="dk-btn dk-btn-glass" onClick={() => void refetch()}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const featuredIds = new Set(hero.featured);
  const browse = (title: string, filters: Partial<BrowseFilters>): Route => ({ name: "anime-browse", title, ...filters });
  const seasonTitle = `Airing This ${SEASON_LABEL[now.season]}`;
  const upcomingTitle = `Coming in ${SEASON_LABEL[next.season]} ${next.year}`;
  const shelves: {
    id: AnimeShelfId;
    title: string;
    shape: Shape;
    items?: Card[];
    label?: (a: Card) => string | undefined;
    to: Route;
  }[] = [
    { id: "season", title: seasonTitle, shape: "landscape", items: data?.season, to: browse(seasonTitle, { ...now, sort: "POPULARITY_DESC" }) },
    {
      id: "trending",
      title: "Trending Now",
      shape: "poster",
      items: data?.trending.filter((a) => !featuredIds.has(a.id)),
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
  const showToday = visible("today") && !today.isError && today.slots?.length !== 0;
  const showGenres = visible("genres");
  const todayAt = Math.min(2, on.length);

  const todayRow = showToday && (
    <Row key="today" title="Airing Today" className="dk-row-air" onMore={() => navigate({ name: "anime-schedule" })}>
      {today.slots
        ? today.slots.map((s) => <DeskAiringCard key={s.id} slot={s} />)
        : <AiringSkeletons count={5} />}
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
            (hero.slides.length ? (
              <AnimeBillboard slides={hero.slides} onShown={setShown} />
            ) : (
              <div className="dk-billboard dk-skeleton" aria-hidden />
            ))}

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

interface HeroSlide {
  card: Card;
  name: string;
  background?: string;
  poster?: string;
  logo?: string;
  description?: string;
  part?: string;
}

function useDeskAnimeHero(trending?: Card[]) {
  const { animeTitles } = usePrefs();
  const pool = useMemo(() => trending?.slice(0, HERO_POOL), [trending]);
  const zips = useQueries({ queries: (pool ?? []).map((a) => aniZipQuery(a.id, PRIORITY.page)) });
  const updated = zips.map((z) => (z.isLoading ? "…" : z.dataUpdatedAt)).join();
  const picks = useMemo(() => {
    if (!pool) return undefined;
    const out: { card: Card; zip: AniZip | null | undefined }[] = [];
    for (let i = 0; i < pool.length && out.length < HERO_COUNT; i++) {
      if (zips[i]?.isLoading) break;
      const card = pool[i]!;
      const zip = zips[i]?.data;
      if (card.bannerImage || zip?.images?.some((m) => m.coverType === "Fanart")) out.push({ card, zip });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, updated]);
  const settled = !!pool && zips.every((z) => !z.isLoading);
  const cards = useMemo(() => picks?.map((p) => p.card), [picks]);
  const banners = useFranchiseBanners(cards, PRIORITY.visible, PRIORITY.page);

  return useMemo(() => {
    const featured = settled && picks ? picks.map((p) => p.card.id) : [];
    if (!picks || !banners) return { slides: [] as HeroSlide[], featured };
    const shown = slidesReady(banners);
    if (!shown) return { slides: [] as HeroSlide[], featured };
    const slides: HeroSlide[] = picks.slice(0, shown).map(({ card, zip }, i) => {
      const own = animePreview(card, zip, animeTitles);
      const b = banners[i];
      return {
        card,
        name: b?.name ?? own.name,
        background: b?.background ?? own.background,
        poster: own.poster,
        logo: b?.logo,
        description: own.description,
        part: b?.label,
      };
    });
    return { slides, featured };
  }, [picks, banners, animeTitles, settled]);
}

function AnimeBillboard({ slides, onShown }: { slides: HeroSlide[]; onShown: (i: number) => void }) {
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
  useEffect(() => setLogoFailed(false), [slide.card.id]);

  const open = () => navigate({ name: "anime-detail", id: slide.card.id, preview: slide.card });
  const nextEp = animeCardCountdown ? slide.card.nextAiringEpisode : undefined;
  const year = slide.card.seasonYear ?? slide.card.startDate?.year;
  const line = joinFacts([
    slide.part,
    slide.card.format && FORMAT_LABEL[slide.card.format],
    ...(slide.card.genres ?? []).slice(0, 2),
    year,
    nextEp && `Ep ${nextEp.episode} in ${shortCountdown(untilAiring(nextEp.airingAt))}`,
  ]);

  return (
    <div
      ref={cardRef}
      className="dk-billboard scheme-dark"
      data-origin="12"
      role="button"
      tabIndex={0}
      aria-label={slide.name}
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
        <AnimeBillboardArt key={`${index}:${slide.card.id}`} slide={slide} entering={prev >= 0} />
        {prevSlide && <AnimeBillboardArt key={`${prev}:${prevSlide.card.id}`} slide={prevSlide} under />}
      </div>
      <div className="dk-bb-shade" aria-hidden />
      <div className="dk-bb-body" key={slide.card.id}>
        {slide.logo && !logoFailed ? (
          <Img className="dk-bb-logo" src={sizedArt(slide.logo, "w500")} alt={slide.name} onFail={() => setLogoFailed(true)} draggable={false} />
        ) : (
          <h2 className="dk-bb-name">{slide.name}</h2>
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

function AnimeBillboardArt({ slide, entering, under }: { slide: HeroSlide; entering?: boolean; under?: boolean }) {
  const art = heroBackdropUrl(slide.background ?? slide.poster);
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
  items?: Card[];
  label?: (a: Card) => string | undefined;
  onMore: () => void;
}) {
  const filterCards = useCardsShown();
  const { animeCardTitles } = usePrefs();
  const filtered = useMemo(() => {
    if (!items) return undefined;
    const shown = filterCards(items);
    if (shape === "poster") return shown;
    const withBanner = shown.filter((a) => a.bannerImage);
    return withBanner.length >= 5 ? withBanner : shown;
  }, [items, filterCards, shape]);

  if (filtered && !filtered.length) return null;
  return (
    <Row title={title} shape={shape} className={shape === "poster" && animeCardTitles ? "dk-row-acards" : undefined} onMore={onMore}>
      {filtered
        ? filtered.map((a) =>
            shape === "landscape" ? (
              <DeskAnimeLandscapeCard key={a.id} card={a} kicker={label?.(a)} />
            ) : (
              <DeskAnimePosterCard key={a.id} card={a} kicker={label?.(a)} />
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
  const { data } = useAnimeGenre(genre, near);
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

/**
 * Anime poster card: clean, unobstructed 2:3 key art with a quiet below-poster title & metadata line
 * (controlled by Settings → Anime → Show titles & details). Score and airing countdown stay inline in
 * the subtitle rather than stamping multiple badges over the artwork.
 */
const DeskAnimePosterCard = memo(function DeskAnimePosterCard({ card, kicker }: { card: Card; kicker?: string }) {
  const name = useAnimeTitle()(card.title);
  const open = useOpenAnime(card);
  const peek = useContext(PeekContext);
  const { animeCardTitles, animeCardScores, animeCardCountdown } = usePrefs();
  const matureContent = useMatureContent();
  const score = useAnimeScore()(animeCardScores ? card.averageScore : undefined);
  const [failed, setFailed] = useState(false);

  if (matureContent === "hide" && isMature(card)) return null;

  const poster = card.coverImage.extraLarge ?? card.coverImage.large ?? undefined;
  const next = animeCardCountdown ? card.nextAiringEpisode : undefined;
  const year = card.seasonYear ?? card.startDate?.year;
  const secondary =
    kicker ??
    (next
      ? `Ep ${next.episode} · ${shortCountdown(untilAiring(next.airingAt))}`
      : [year, card.genres?.[0]].filter(Boolean).join(" · ") || cardFacts(card));

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
        peek.enter(card, e.currentTarget, kicker);
      }}
      onPointerLeave={() => {
        open.onPointerLeave();
        peek.leave(card.id);
      }}
    >
      <span
        className="dk-poster dk-acard-art scheme-dark"
        data-origin="4"
        style={{ "--cover": card.coverImage.color ?? undefined } as CSSProperties}
      >
        {!failed && poster ? (
          <Img src={poster} alt="" loading="lazy" decoding="async" draggable={false} onFail={() => setFailed(true)} />
        ) : (
          <span className="dk-poster-name">{name}</span>
        )}
        {matureContent === "blur" && isMature(card) && <MatureCover />}
        {!animeCardTitles && score && (
          <span className="dk-acard-score tabular" title="AniList score">
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
 * Anime landscape card: upgrades to real 16:9 fanart + official logo via `useAnimePageArt` as it approaches
 * the viewport, keeping the artwork free of corner badges just like Home, Shows, and Movies.
 */
const DeskAnimeLandscapeCard = memo(function DeskAnimeLandscapeCard({ card, kicker }: { card: Card; kicker?: string }) {
  const name = useAnimeTitle()(card.title);
  const open = useOpenAnime(card);
  const peek = useContext(PeekContext);
  const { animeCardScores, animeCardCountdown, animeSeparateEntries: separate } = usePrefs();
  const matureContent = useMatureContent();
  const score = useAnimeScore()(animeCardScores ? card.averageScore : undefined);
  const [failed, setFailed] = useState(false);

  const [ref, near, place] = useViewportPlace<HTMLButtonElement>(reprioritiseAniList);
  const priority = useCallback(() => rowPriority(place.current), [place]);
  const page = useAnimePageArt(card, near, priority);
  const imdb = useLinkedImdb(page === null ? card.id : 0);

  if (matureContent === "hide" && isMature(card)) return null;

  const poster = card.coverImage.extraLarge ?? card.coverImage.large ?? undefined;
  const own = [card.bannerImage, poster].filter((u): u is string => !!u);
  const [bg, ...fallbacks] = page
    ? [page.background, ...own].filter((u, i, all): u is string => !!u && all.indexOf(u) === i)
    : page === null && imdb !== undefined
      ? landscapeArt({ imdb, bannerImage: card.bannerImage, cover: poster, separate })
      : own;

  const next = animeCardCountdown ? card.nextAiringEpisode : undefined;
  const sub = [
    score ? `★ ${score}` : undefined,
    kicker ?? (next ? `Ep ${next.episode} in ${shortCountdown(untilAiring(next.airingAt))}` : card.seasonYear ?? card.startDate?.year),
    card.genres?.[0],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      ref={ref}
      type="button"
      className="dk-lc scheme-dark"
      data-origin="10"
      aria-label={name}
      style={{ "--cover": card.coverImage.color ?? undefined } as CSSProperties}
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
        peek.enter(card, e.currentTarget, kicker);
      }}
      onPointerLeave={() => {
        open.onPointerLeave();
        peek.leave(card.id);
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
      {matureContent === "blur" && isMature(card) && <MatureCover />}
      <span className="dk-lc-shade" aria-hidden />
      <span className="dk-lc-body" aria-hidden>
        <span className="dk-lc-brand">
          <ArtTitle name={name} logo={page?.logo} logos={page?.logos} decorative />
        </span>
        {sub && <span className="dk-lc-sub tabular">{sub}</span>}
      </span>
    </button>
  );
});

/**
 * Compact horizontal schedule tile for Airing Today: keeps the crisp 2:3 cover thumbnail uncropped beside
 * the airing time, episode number, title, score, and genres — no stretched vertical covers.
 */
const DeskAiringCard = memo(function DeskAiringCard({ slot }: { slot: AiringSlot }) {
  const card = slot.media;
  const name = useAnimeTitle()(card.title);
  const open = useOpenAnime(card);
  const peek = useContext(PeekContext);
  const { animeCardScores } = usePrefs();
  const matureContent = useMatureContent();
  const score = useAnimeScore()(animeCardScores ? card.averageScore : undefined);
  const [failed, setFailed] = useState(false);

  if (matureContent === "hide" && isMature(card)) return null;

  const poster = card.coverImage.extraLarge ?? card.coverImage.large ?? undefined;
  const delta = untilAiring(slot.airingAt);
  const upcomingSoon = delta > 0 && delta <= 6 * 3600;
  const timeText = slotLabel(slot);
  const sub = [card.format && FORMAT_LABEL[card.format], ...(card.genres ?? []).slice(0, 2)].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className="dk-air"
      aria-label={`${name} — ${timeText}`}
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
        peek.enter(card, e.currentTarget, timeText);
      }}
      onPointerLeave={() => {
        open.onPointerLeave();
        peek.leave(card.id);
      }}
    >
      <span
        className="dk-air-thumb scheme-dark"
        data-origin="7"
        style={{ "--cover": card.coverImage.color ?? undefined } as CSSProperties}
      >
        {!failed && poster ? (
          <Img src={poster} alt="" loading="lazy" decoding="async" draggable={false} onFail={() => setFailed(true)} />
        ) : (
          <span className="dk-air-thumb-fallback">{name.slice(0, 2)}</span>
        )}
        {matureContent === "blur" && isMature(card) && <MatureCover />}
      </span>
      <span className="dk-air-body">
        <span className="dk-air-top tabular">
          <span className="dk-air-time" data-soon={upcomingSoon || undefined}>
            {timeText}
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

function slotLabel(s: AiringSlot) {
  const time = new Date(s.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Ep ${s.episode} · ${time}`;
}

function upcomingLabel(a: Card) {
  const d = a.startDate;
  if (d?.month && d.day) return new Date(d.year!, d.month - 1, d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return a.format ? FORMAT_LABEL[a.format] : undefined;
}
