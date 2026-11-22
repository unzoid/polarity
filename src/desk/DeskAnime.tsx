import "../styles/anime.css";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useArtFocus } from "../components/DetailArt";
import { Calendar, Grid } from "../components/icons";
import { Img } from "../components/Img";
import { ArtTitle } from "../components/title/Card";
import {
  ANIME_GENRES,
  FORMAT_LABEL,
  SEASON_LABEL,
  aniZipQuery,
  animePreview,
  countdown,
  nextSeason,
  seasonOf,
  slidesReady,
  untilAiring,
  useAiringToday,
  useAnimeGenre,
  useAnimeHome,
  useAnimeTitle,
  useCardsShown,
  useFranchiseBanners,
  useShelfVisible,
  type AiringSlot,
  type AnimeCard as Card,
  type AnimeShelfId,
  type AniZip,
  type BrowseFilters,
} from "../lib/anime";
import { joinFacts } from "../lib/format";
import { PRIORITY } from "../lib/net";
import { useNavigation, type Route } from "../lib/router";
import { usePrefs } from "../lib/settings";
import { heroBackdropUrl, prefersReducedMotion, sizedArt, useNearViewport, useOffscreenMark } from "../lib/ui";
import { IconPlay } from "../phone/icons";
import { useArtTint } from "../phone/tint";
import { TopBar } from "./Bar";
import type { Chrome } from "./Nav";
import { LandscapeSkeletons, PosterSkeletons, Row } from "./Rows";

type Shape = "poster" | "landscape";

const HERO_COUNT = 6;
const HERO_POOL = 10;
const ADVANCE_MS = 9000;

/**
 * Desk Anime: shares DeskHome's exact visual system — tinted backdrop wash, 2.35:1 rounded featured billboard,
 * crisp browse/genre chips, and alternating landscape + poster shelves with arrow paging.
 */
export function DeskAnime({ chrome }: { chrome: Chrome }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { data, isError, refetch } = useAnimeHome();
  const visible = useShelfVisible();
  const hasHero = visible("hero");
  const hero = useDeskAnimeHero(hasHero ? data?.trending : undefined);
  const today = useAiringToday(visible("today"));
  const now = seasonOf();
  const next = nextSeason(now);
  const { navigate } = useNavigation();
  const [shown, setShown] = useState(0);

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
  const shelves: { id: AnimeShelfId; title: string; shape: Shape; items?: Card[]; label?: (a: Card) => string | undefined; to: Route }[] = [
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
    <Row key="today" title="Airing Today" shape="landscape" onMore={() => navigate({ name: "anime-schedule" })}>
      {today.slots
        ? today.slots.map((s) => <DeskAnimeCard key={s.id} card={s.media} shape="landscape" kicker={slotLabel(s)} />)
        : <LandscapeSkeletons count={5} />}
    </Row>
  );

  return (
    <div className="dk-page dk-home dk-anime">
      {chrome === "tabs" && <TopBar logo title="Anime" scroller={scroller} tint={tintStyle} />}
      <div className="dk-scroll" ref={scroller}>
        <div className="dk-tint" style={tintStyle} aria-hidden />
        {hasHero &&
          (hero.slides.length ? (
            <AnimeBillboard slides={hero.slides} onShown={setShown} />
          ) : (
            <div className="dk-billboard dk-skeleton" aria-hidden />
          ))}

        <nav className="dk-chips dk-anime-chips" aria-label="Browse anime">
          <button type="button" className="dk-chip dk-chip-primary" onClick={() => navigate({ name: "anime-schedule" })}>
            <Calendar size={15} />
            <span>Schedule</span>
          </button>
          <button type="button" className="dk-chip dk-chip-primary" onClick={() => navigate({ name: "anime-browse" })}>
            <Grid size={15} />
            <span>Browse All</span>
          </button>
          {ANIME_GENRES.slice(0, 12).map((g) => (
            <button key={g} type="button" className="dk-chip" onClick={() => navigate({ name: "anime-browse", genre: g })}>
              {g}
            </button>
          ))}
        </nav>

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
    </div>
  );
}

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
    nextEp && `Ep ${nextEp.episode} in ${countdown(untilAiring(nextEp.airingAt))}`,
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
  const filtered = useMemo(() => {
    if (!items) return undefined;
    const shown = filterCards(items);
    if (shape === "poster") return shown;
    const withBanner = shown.filter((a) => a.bannerImage);
    return withBanner.length >= 5 ? withBanner : shown;
  }, [items, filterCards, shape]);

  if (filtered && !filtered.length) return null;
  return (
    <Row title={title} shape={shape} onMore={onMore}>
      {filtered
        ? filtered.map((a) => <DeskAnimeCard key={a.id} card={a} shape={shape} kicker={label?.(a)} />)
        : shape === "landscape"
          ? <LandscapeSkeletons />
          : <PosterSkeletons />}
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

function DeskAnimeCard({ card, shape, kicker }: { card: Card; shape: Shape; kicker?: string }) {
  const { navigate } = useNavigation();
  const title = useAnimeTitle();
  const name = title(card.title);
  const [failed, setFailed] = useState(false);
  const poster = card.coverImage.extraLarge ?? card.coverImage.large ?? undefined;
  const open = () => navigate({ name: "anime-detail", id: card.id, preview: card });

  if (shape === "landscape") {
    const bg = card.bannerImage ?? poster;
    const sub = kicker ?? [card.seasonYear, card.genres?.[0]].filter(Boolean).join(" · ");
    return (
      <button type="button" className="dk-lc scheme-dark" data-origin="10" aria-label={name} onClick={open}>
        {!failed && bg ? (
          <Img
            className="dk-lc-img"
            src={bg}
            fallbacks={card.bannerImage && poster ? [poster] : undefined}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onFail={() => setFailed(true)}
          />
        ) : (
          <span className="dk-poster-name">{name}</span>
        )}
        <span className="dk-lc-shade" aria-hidden />
        <span className="dk-lc-body" aria-hidden>
          <span className="dk-lc-brand">
            <ArtTitle name={name} />
          </span>
          {sub && <span className="dk-lc-sub tabular">{sub}</span>}
        </span>
      </button>
    );
  }

  return (
    <button type="button" className="dk-poster scheme-dark" data-origin="4" aria-label={name} onClick={open}>
      {!failed && poster ? (
        <Img src={poster} alt="" loading="lazy" decoding="async" draggable={false} onFail={() => setFailed(true)} />
      ) : (
        <span className="dk-poster-name">{name}</span>
      )}
    </button>
  );
}

function slotLabel(s: AiringSlot) {
  const time = new Date(s.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Episode ${s.episode} · ${time}`;
}

function upcomingLabel(a: Card) {
  const d = a.startDate;
  if (d?.month && d.day) return new Date(d.year!, d.month - 1, d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return a.format ? FORMAT_LABEL[a.format] : undefined;
}
