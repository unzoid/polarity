import "../styles/anime.css";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { menuPoint, openCardMenu } from "../components/CardMenu";
import { Dropdown } from "../components/Dropdown";
import { Calendar, Close, Filters, Grid, Play, Star, Warning } from "../components/icons";
import { Img } from "../components/Img";
import { Sheet } from "../components/Sheet";
import { ArtTitle, Card } from "../components/title/Card";
import { LibraryButton } from "../components/title/LibraryButton";
import { PosterGrid } from "../components/title/PosterGrid";
import { Shelf } from "../components/title/Shelf";
import { TitleHeading } from "../components/title/TitleHeading";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchField } from "../components/ui/SearchField";
import { Skeleton } from "../components/ui/Skeleton";
import {
  ANIME_GENRES,
  ANIME_TAGS,
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
  useAnimeBrowseCatalog,
  useAnimeGenreShelf,
  useAnimeHomeCatalog,
  useAnimeSchedule,
  useAnimeToday,
  useShelfVisible,
  type AnimeShelfId,
  type BrowseFilters,
  type MediaFormat,
  type MediaSeason,
  type MediaStatus,
} from "../lib/anime";
import { useMatureContent } from "../lib/catalog";
import { joinFacts } from "../lib/format";
import { metaQuery } from "../lib/net";
import { useNavigation, useRouter, type Route } from "../lib/router";
import { usePrefs } from "../lib/settings";
import type { AnimeItem, MetaPreview } from "../lib/types";
import { useCardIntent, useFormFactor, useNearViewport } from "../lib/ui";
import { HeroCarousel } from "./Home";

type Shape = "poster" | "landscape";

const HERO_COUNT = 6;
const INTENT_DELAY = 150;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function useOpenItem(item: AnimeItem) {
  const { navigate } = useNavigation();
  const { animeTitles } = usePrefs();
  const qc = useQueryClient();
  const preview = useMemo(() => animeItemToPreview(item, animeTitles), [item, animeTitles]);
  const open = useCallback(
    () => navigate({ name: "detail", type: item.type, id: item.id, preview, season: item.seasonHint }),
    [navigate, item.type, item.id, preview, item.seasonHint],
  );
  const intent = useCardIntent(() => void qc.prefetchQuery(metaQuery(item.type, item.id)), INTENT_DELAY);
  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      openCardMenu(preview, menuPoint(e), open);
    },
    [preview, open],
  );
  return { onClick: open, onContextMenu, preview, ...intent };
}

function MatureCover() {
  return (
    <span className="card-mature" title="Mature content" aria-label="Mature content">
      <Warning size={24} />
      <span className="card-mature-label">18+</span>
    </span>
  );
}

function ShowAnimeCard({ item, shape, label }: { item: AnimeItem; shape: Shape; label?: string }) {
  const { animeTitles, animeCardScores, animeScoreFormat, animeCardCountdown } = usePrefs();
  const matureContent = useMatureContent();
  const open = useOpenItem(item);
  if (matureContent === "hide" && item.mature) return null;

  const title = animeItemName(item, animeTitles);
  const score = animeCardScores ? formatAnimeItemScore(item.score, animeScoreFormat) : undefined;
  const airing = animeCardCountdown ? item.airing : undefined;
  const detail =
    label ??
    item.seasonLabel ??
    (airing
      ? [item.format && FORMAT_LABEL[item.format as MediaFormat], `in ${countdown(untilAiring(airing.airingAt))}`].filter(Boolean).join(" · ")
      : [item.year, item.format && FORMAT_LABEL[item.format as MediaFormat]].filter(Boolean).join(" · "));

  const [art, ...artFallbacks] =
    shape === "landscape"
      ? [item.background, item.poster].filter((u, i, all): u is string => !!u && all.indexOf(u) === i)
      : [item.poster, item.background].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);

  return (
    <Card
      shape={shape}
      className="anime-card"
      frameClass="anime-card-frame"
      art={art}
      artFallbacks={artFallbacks}
      title={title}
      detail={detail}
      onClick={open.onClick}
      onContextMenu={open.onContextMenu}
      onPointerEnter={open.onPointerEnter}
      onPointerLeave={open.onPointerLeave}
      onFocus={open.onFocus}
      onBlur={open.onBlur}
    >
      {shape === "landscape" && <ArtTitle name={title} logo={item.logo} logos={item.logos} decorative />}
      {matureContent === "blur" && item.mature && <MatureCover />}
      {shape === "poster" && score && (
        <span className="card-score card-score-art anime-card-score tabular" title="Score">
          <Star size={11} />
          {score}
        </span>
      )}
    </Card>
  );
}

/**
 * Classic desktop & mobile Anime screen: powered by the show-first Rust backend (zero AniList calls).
 */
export function Anime() {
  const { data, isError, refetch } = useAnimeHomeCatalog();
  const { animeTitles } = usePrefs();
  const visible = useShelfVisible();
  const hasHero = visible("hero");
  const today = useAnimeToday(visible("today"));
  const now = seasonOf();
  const next = nextSeason(now);
  const { navigate } = useNavigation();

  const heroItems = useMemo(() => {
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

  const heroPreviews = useMemo(
    () => (heroItems.length ? heroItems.map((i) => animeItemToPreview(i, animeTitles)) : undefined),
    [heroItems, animeTitles],
  );

  const heroHandlers = useCallback(
    (preview: MetaPreview) => {
      const found = heroItems.find((a) => a.id === preview.id);
      return {
        onClick: () => navigate({ name: "detail", type: preview.type, id: preview.id, preview, season: found?.seasonHint }),
        onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
          e.preventDefault();
          openCardMenu(preview, menuPoint(e), () =>
            navigate({ name: "detail", type: preview.type, id: preview.id, preview, season: found?.seasonHint }),
          );
        },
      };
    },
    [heroItems, navigate],
  );

  const heroContent = useCallback(
    (preview: MetaPreview) => {
      const found = heroItems.find((a) => a.id === preview.id);
      return found ? <AnimeHeroContent item={found} preview={preview} /> : null;
    },
    [heroItems],
  );

  if (isError && !data) {
    return (
      <div className="scroll anime">
        <EmptyState className="anime-unreachable" action={{ label: "Try again", onClick: () => void refetch() }}>
          Couldn't load anime catalogs. Check your connection and try again.
        </EmptyState>
      </div>
    );
  }

  const featured = new Set(heroItems.map((h) => h.id));
  const browse = (title: string, filters: Partial<BrowseFilters>): Route => ({ name: "anime-browse", title, ...filters });
  const seasonTitle = `Airing This ${SEASON_LABEL[now.season]}`;
  const upcomingTitle = `Coming in ${SEASON_LABEL[next.season]} ${next.year}`;
  const shelves: { id: AnimeShelfId; title: string; shape: Shape; items?: AnimeItem[]; label?: (a: AnimeItem) => string | undefined; to: Route }[] = [
    { id: "season", title: seasonTitle, shape: "poster", items: data?.season, to: browse(seasonTitle, { ...now, sort: "POPULARITY_DESC" }) },
    {
      id: "trending",
      title: "Trending Now",
      shape: "poster",
      items: data?.trending?.filter((a) => !featured.has(a.id)),
      to: browse("Trending Now", { sort: "TRENDING_DESC" }),
    },
    {
      id: "upcoming",
      title: upcomingTitle,
      shape: "poster",
      items: data?.upcoming,
      label: upcomingLabel,
      to: browse(upcomingTitle, { ...next, sort: "POPULARITY_DESC" }),
    },
    { id: "top", title: "Highest Rated", shape: "landscape", items: data?.top, to: browse("Highest Rated", { sort: "SCORE_DESC" }) },
    { id: "popular", title: "Most Popular", shape: "poster", items: data?.popular, to: browse("Most Popular", { sort: "POPULARITY_DESC" }) },
    { id: "movies", title: "Movies", shape: "landscape", items: data?.movies, to: browse("Anime Movies", { format: "MOVIE", sort: "POPULARITY_DESC" }) },
  ];
  const on = shelves.filter((s) => visible(s.id));
  const showToday = visible("today") && !today.isError && today.data?.length !== 0;
  const genres = visible("genres");
  const todayAt = Math.min(2, on.length);

  const todayRow = showToday && (
    <Shelf
      key="today"
      title="Airing Today"
      onOpen={() => navigate({ name: "anime-schedule" })}
      shape="landscape"
      items={today.data}
      skeletons={6}
      card={(item) => <ShowAnimeCard key={item.id} item={item} shape="landscape" label={airingTimeLabel(item)} />}
    />
  );

  return (
    <div className="scroll home anime" data-hero={hasHero}>
      {hasHero && <HeroCarousel items={heroPreviews} handlers={heroHandlers} content={heroContent} />}
      <AnimeNav />
      <div className="rows home-rows">
        {on.map((s, i) => [
          i === todayAt && todayRow,
          <AnimeShelf key={s.id} title={s.title} shape={s.shape} items={s.items} label={s.label} onOpen={() => navigate(s.to)} />,
        ])}
        {todayAt === on.length && todayRow}
        {genres && ANIME_GENRES.map((g, i) => <GenreShelf key={g} genre={g} shape={i % 3 === 0 ? "landscape" : "poster"} />)}
      </div>
    </div>
  );
}

function AnimeNav() {
  const { navigate } = useNavigation();
  return (
    <nav className="anime-nav" aria-label="Browse anime">
      <Chip className="anime-nav-main" onClick={() => navigate({ name: "anime-schedule" })}>
        <Calendar size={15} /> Schedule
      </Chip>
      <Chip className="anime-nav-main" onClick={() => navigate({ name: "anime-browse" })}>
        <Grid size={15} /> Browse All
      </Chip>
      <span className="anime-nav-sep" aria-hidden />
      {ANIME_GENRES.map((g) => (
        <Chip key={g} onClick={() => navigate({ name: "anime-browse", genre: g })}>
          {g}
        </Chip>
      ))}
      {ANIME_TAGS.map((t) => (
        <Chip key={t} onClick={() => navigate({ name: "anime-browse", tag: t })}>
          {t}
        </Chip>
      ))}
    </nav>
  );
}

function AnimeHeroContent({ item, preview }: { item: AnimeItem; preview: MetaPreview }) {
  const open = useOpenItem(item);
  const phone = useFormFactor().form === "phone";
  const { animeCardCountdown } = usePrefs();
  const airing = animeCardCountdown ? item.airing : undefined;
  const lead = item.format ? FORMAT_LABEL[item.format as MediaFormat] : "Anime";
  const phoneTags = (item.genres ?? []).slice(0, 3);
  return (
    <div className="hero-content">
      <TitleHeading name={preview.name} logo={preview.logo} logos={preview.logos} backdrop={preview.background} look="hero" />
      {item.seasonLabel && <p className="hero-part t-caption">{item.seasonLabel}</p>}
      <p className="hero-kind t-callout tabular">
        <span className="hero-kind-text">
          {phone ? (
            <>
              <span className="hero-kind-lead">{lead}</span>
              {(phoneTags.length ? phoneTags : item.year ? [String(item.year)] : []).map((tag) => (
                <Fragment key={tag}>
                  <span className="hero-kind-dot" aria-hidden>
                    •
                  </span>
                  <span>{tag}</span>
                </Fragment>
              ))}
            </>
          ) : (
            joinFacts([
              item.format && FORMAT_LABEL[item.format as MediaFormat],
              ...(item.genres ?? []).slice(0, 2),
              item.year,
              airing && `in ${countdown(untilAiring(airing.airingAt))}`,
            ])
          )}
        </span>
      </p>
      <p className="hero-description t-body">{preview.description}</p>
      <div className="hero-actions">
        <Button variant="primary" onClick={open.onClick}>
          <Play size={18} fill="currentColor" /> Watch Now
        </Button>
        <LibraryButton item={preview} labelled={phone} />
      </div>
    </div>
  );
}

function airingTimeLabel(item: AnimeItem) {
  if (!item.airing) return item.seasonLabel ?? "Today";
  const time = new Date(item.airing.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return item.seasonLabel ? `${item.seasonLabel} · ${time}` : time;
}

function upcomingLabel(item: AnimeItem) {
  if (item.startDate) {
    const parsed = new Date(`${item.startDate}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return item.format ? FORMAT_LABEL[item.format as MediaFormat] : undefined;
}

function AnimeShelf({
  title,
  shape,
  items,
  label,
  onOpen,
}: {
  title: string;
  shape: Shape;
  items?: AnimeItem[];
  label?: (a: AnimeItem) => string | undefined;
  onOpen?: () => void;
}) {
  return (
    <Shelf
      title={title}
      onOpen={onOpen}
      shape={shape}
      items={items}
      card={(a) => <ShowAnimeCard key={a.id} item={a} shape={shape} label={label?.(a)} />}
    />
  );
}

function GenreShelf({ genre, shape }: { genre: string; shape: Shape }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(false);
  const { data } = useAnimeGenreShelf(genre, near);
  const { navigate } = useNavigation();
  return (
    <div ref={ref}>
      <AnimeShelf title={genre} shape={shape} items={data} onOpen={() => navigate({ name: "anime-browse", genre, sort: "TRENDING_DESC" })} />
    </div>
  );
}

function SubPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="scroll anime">
      <header className="screen-header">
        <h1 className="t-title1">{title}</h1>
      </header>
      {children}
    </div>
  );
}

export const AnimeSchedule = () => (
  <SubPage title="Schedule">
    <ScheduleView />
  </SubPage>
);

export function AnimeBrowse() {
  const { current } = useRouter();
  const from = current.name === "anime-browse" ? current : undefined;
  const { name: _, title, ...filters } = from ?? { name: "anime-browse" };
  return (
    <SubPage title={title ?? from?.genre ?? from?.tag ?? "Browse Anime"}>
      <BrowseView from={filters} />
    </SubPage>
  );
}

// --- Schedule (7-day weekday tabs powered by Rust/Jikan) ---------------------

function ScheduleView() {
  const todayDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(todayDate);
        d.setDate(d.getDate() + i);
        return { date: d, weekday: WEEKDAYS[d.getDay()] };
      }),
    [todayDate],
  );
  const [dayIdx, setDayIdx] = useState(0);
  const active = days[dayIdx];
  const { data, isLoading, isError } = useAnimeSchedule(active.weekday);

  return (
    <div className="anime-schedule">
      <div className="anime-days" role="radiogroup" aria-label="Day">
        {days.map((d, i) => (
          <button key={d.weekday} role="radio" className="anime-day" aria-checked={i === dayIdx} onClick={() => setDayIdx(i)}>
            <span className="anime-day-name">{i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.date.toLocaleDateString(undefined, { weekday: "short" })}</span>
            <span className="anime-day-date tabular">{d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          </button>
        ))}
      </div>
      {isError && <EmptyState>Couldn't load the schedule.</EmptyState>}
      {isLoading && (
        <div className="anime-slots">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="anime-slot" height={88} />
          ))}
        </div>
      )}
      {data && !data.length && <EmptyState>Nothing airs this day.</EmptyState>}
      <div className="anime-slots">
        {(data ?? []).map((item) => (
          <ScheduleSlot key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function ScheduleSlot({ item }: { item: AnimeItem }) {
  const { animeTitles } = usePrefs();
  const title = animeItemName(item, animeTitles);
  const open = useOpenItem(item);
  const left = item.airing ? untilAiring(item.airing.airingAt) : 0;
  const aired = item.airing ? left <= 0 : false;
  const time = item.airing
    ? new Date(item.airing.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "TBA";
  return (
    <button className="anime-slot" data-aired={aired} onClick={open.onClick} onContextMenu={open.onContextMenu}>
      <span className="anime-slot-time tabular">{time}</span>
      <Img src={item.poster} alt="" className="anime-slot-cover" />
      <span className="anime-slot-text">
        <span className="anime-slot-title t-headline">{title}</span>
        <span className="t-caption muted tabular">
          {[item.seasonLabel, item.episodes ? `${item.episodes} Episodes` : undefined, item.format && item.format !== "TV" ? FORMAT_LABEL[item.format as MediaFormat] : undefined]
            .filter(Boolean)
            .join(" · ") || "TV"}
        </span>
      </span>
      <span className="anime-slot-when tabular">{item.airing ? (aired ? "Aired" : `in ${countdown(left)}`) : ""}</span>
    </button>
  );
}

// --- Browse (powered by Rust/Jikan) -----------------------------------------

const SORTS: { value: BrowseFilters["sort"]; label: string }[] = [
  { value: "POPULARITY_DESC", label: "Popularity" },
  { value: "TRENDING_DESC", label: "Trending" },
  { value: "SCORE_DESC", label: "Score" },
  { value: "START_DATE_DESC", label: "Newest" },
  { value: "TITLE_ROMAJI", label: "Title" },
];

const BROWSE_FORMATS: MediaFormat[] = ["TV", "MOVIE", "ONA", "OVA", "SPECIAL", "TV_SHORT"];
const BROWSE_STATUSES: MediaStatus[] = ["RELEASING", "FINISHED", "NOT_YET_RELEASED"];
const SEASONS: MediaSeason[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="anime-filter-field">
      <span className="anime-filter-label">{label}</span>
      {children}
    </div>
  );
}

const NO_FILTERS = { genre: "", tag: "", season: "", year: 0, format: "", status: "" } as const;

function BrowseView({ from }: { from: Partial<BrowseFilters> }) {
  const [text, setText] = useState("");
  const [f, setF] = useState<BrowseFilters>(() => ({ ...NO_FILTERS, search: "", sort: "POPULARITY_DESC", ...from }));
  useEffect(() => {
    const t = window.setTimeout(() => setF((f) => ({ ...f, search: text.trim() })), 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const set = (patch: Partial<BrowseFilters>) => setF((f) => ({ ...f, ...patch }));
  const q = useAnimeBrowseCatalog(f);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear + 2 - 1970 }, (_, i) => thisYear + 1 - i);
  const seen = new Set<string>();
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((m) => !seen.has(m.id) && seen.add(m.id));
  const [panel, setPanel] = useState(false);
  type Active = { label: string; clear: Partial<BrowseFilters> };
  const active = [
    f.genre ? { label: f.genre, clear: { genre: "" } } : null,
    f.tag ? { label: f.tag, clear: { tag: "" } } : null,
    f.year ? { label: String(f.year), clear: { year: 0 } } : null,
    f.season ? { label: SEASON_LABEL[f.season], clear: { season: "" } } : null,
    f.format ? { label: FORMAT_LABEL[f.format], clear: { format: "" } } : null,
    f.status ? { label: STATUS_LABEL[f.status], clear: { status: "" } } : null,
  ].filter(Boolean) as Active[];

  return (
    <div className="anime-browse">
      <div className="anime-filters">
        <SearchField className="anime-search" value={text} onChange={setText} label="Search anime" placeholder="Search anime" />
        <button className="anime-filter-button pressable" aria-label="Filters" title="Filters" aria-expanded={panel} onClick={() => setPanel(true)}>
          <Filters size={18} />
          {active.length > 0 && <span className="anime-filter-count tabular">{active.length}</span>}
        </button>
        <span className="anime-sort">
          <Dropdown label="Sort" value={f.sort} onChange={(v) => set({ sort: v })} options={SORTS} />
        </span>
      </div>
      <Sheet open={panel} onClose={() => setPanel(false)} title="Filters" subtitle={active.length ? `${active.length} on` : "Narrow the list down"}>
        <div className="anime-filter-panel">
          <FilterField label="Genre">
            <Dropdown label="Genre" value={f.genre || "any"} onChange={(v) => set({ genre: v === "any" ? "" : v })} options={[{ value: "any", label: "Any" }, ...ANIME_GENRES.map((g) => ({ value: g, label: g }))]} />
          </FilterField>
          <FilterField label="Kind">
            <Dropdown label="Kind" value={f.tag || "any"} onChange={(v) => set({ tag: v === "any" ? "" : v })} options={[{ value: "any", label: "Any" }, ...ANIME_TAGS.map((t) => ({ value: t, label: t }))]} />
          </FilterField>
          <FilterField label="Year">
            <Dropdown label="Year" value={String(f.year || "any")} onChange={(v) => set({ year: v === "any" ? 0 : Number(v) })} options={[{ value: "any", label: "Any" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} />
          </FilterField>
          <FilterField label="Season">
            <Dropdown label="Season" value={f.season || "any"} onChange={(v) => set({ season: v === "any" ? "" : (v as MediaSeason) })} options={[{ value: "any", label: "Any" }, ...SEASONS.map((s) => ({ value: s, label: SEASON_LABEL[s] }))]} />
          </FilterField>
          <FilterField label="Format">
            <Dropdown label="Format" value={f.format || "any"} onChange={(v) => set({ format: v === "any" ? "" : (v as MediaFormat) })} options={[{ value: "any", label: "Any" }, ...BROWSE_FORMATS.map((s) => ({ value: s, label: FORMAT_LABEL[s] }))]} />
          </FilterField>
          <FilterField label="Status">
            <Dropdown label="Status" value={f.status || "any"} onChange={(v) => set({ status: v === "any" ? "" : (v as MediaStatus) })} options={[{ value: "any", label: "Any" }, ...BROWSE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
          </FilterField>
          {active.length > 0 && (
            <button className="anime-row-link anime-clear" onClick={() => set(NO_FILTERS)}>
              Clear all
            </button>
          )}
        </div>
      </Sheet>
      {active.length > 0 && (
        <div className="anime-active-filters">
          {active.map((a) => (
            <Chip key={a.label} variant="tag" pressed onClick={() => set(a.clear)} aria-label={`Remove ${a.label}`}>
              {a.label}
              <Close size={11} strokeWidth={2.5} />
            </Chip>
          ))}
          {active.length > 1 && (
            <button className="anime-row-link anime-clear" onClick={() => set(NO_FILTERS)}>
              Clear all
            </button>
          )}
        </div>
      )}
      <PosterGrid pager={q}>
        {items.map((a) => (
          <ShowAnimeCard key={a.id} item={a} shape="poster" />
        ))}
      </PosterGrid>
      {q.data && !items.length && <EmptyState>Nothing matches. Try fewer filters.</EmptyState>}
      {q.isError && <EmptyState>Couldn't load anime right now. Try again in a moment.</EmptyState>}
    </div>
  );
}
