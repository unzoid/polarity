import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import logo from "../assets/polarity-white.png";
import { useArtFocus } from "../components/DetailArt";
import { Img } from "../components/Img";
import { useIntent } from "../components/PosterCard";
import { useLibraryToggle } from "../components/title/LibraryButton";
import {
  BROWSE_GENRES,
  catalogKey,
  catalogTitle,
  shelfKey,
  shelfRoute,
  useAddonCatalogRow,
  useBrowseVisible,
  useListable,
  type AddonCatalog,
  type Shelf,
} from "../lib/catalog";
import { useProgress } from "../lib/net";
import { useNavigation } from "../lib/router";
import type { ContentType, MetaPreview } from "../lib/types";
import { heroBackdropUrl, lazyNamed, prefersReducedMotion, sizedArt, useNearViewport, useOffscreenMark } from "../lib/ui";
import { useHomeFeed, useShelfItems } from "../screens/homeFeed";
import { TabHeader } from "./Header";
import { IconCheck, IconChevronDown, IconClose, IconPlay, IconPlus } from "./icons";
import { Row } from "./Rows";
import { ContinueRow } from "../components/ContinueRow";
import { categories } from "./store";
import { useArtTint } from "./tint";

const PlayNow = lazyNamed(() => import("./PlayNow"), "PlayNow");

/** What Home shows: everything, one kind (Shows, Movies), or one genre picked from Categories. */
export type HomeView = { kind: "all" } | { kind: "type"; type: ContentType } | { kind: "genre"; genre: string; type?: ContentType };

const EAGER = 2;
/** The featured titles turned through, and how long each stays. */
const FEATURED = 6;
const ADVANCE_MS = 8000;

/**
 * Home: Polarity's wordmark in the bar, a row of chips that scrolls away with the page (Shows, Movies, Anime,
 * Categories), the featured titles as tall cards that turn by themselves or under a finger (the next one peeking
 * in at the edge), then the rows. The page glows with the featured art's colour, easing from one title's to the
 * next as the cards turn.
 */
export function PhoneHome({ view, onView }: { view: HomeView; onView: (v: HomeView) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { items, shelves, excludes, settings, addonRows } = useHomeFeed();
  const typed = view.kind === "type" ? view.type : view.kind === "genre" ? view.type : undefined;

  const featured = useMemo(() => {
    const pool = items ?? [];
    const of = typed ? pool.filter((m) => m.type === typed) : pool;
    const withGenre = view.kind === "genre" ? of.filter((m) => m.genres?.includes(view.genre)) : of;
    return (withGenre.length ? withGenre : view.kind === "all" ? of : []).slice(0, FEATURED);
  }, [items, typed, view]);
  const [shown, setShown] = useState(0);
  const current = featured[Math.min(shown, featured.length - 1)];

  const rows = useMemo((): { shelf: Shelf; exclude: Set<string> }[] => {
    if (view.kind === "genre") return genreShelves(view.genre, view.type).map((shelf) => ({ shelf, exclude: NONE }));
    const all = shelves.map((shelf, i) => ({ shelf, exclude: excludes[i] }));
    if (!typed) return all;
    const own = all.filter((r) => r.shelf.type === typed);
    return [...own, ...typeExtras(typed, own.map((r) => r.shelf)).map((shelf) => ({ shelf, exclude: NONE }))];
  }, [view, shelves, excludes, typed]);

  const tint = useArtTint(current ? sizedArt(current.background ?? current.poster, "w300") : undefined);

  const tintStyle = useMemo<CSSProperties | undefined>(() => (tint ? ({ "--tint-dark": tint.dark, "--tint-light": tint.light } as CSSProperties) : undefined), [tint]);
  return (
    <div className="ph-tab-page ph-home">
      <TabHeader scroller={scroller} tint={tintStyle} lead={<img className="ph-wordmark" src={logo} alt="Polarity" draggable={false} />}>
        {view.kind !== "all" && <span className="ph-head-sub">{view.kind === "type" ? (view.type === "movie" ? "Movies" : "Shows") : view.genre}</span>}
      </TabHeader>
      <div className="ph-scroll" ref={scroller}>
        <div className="ph-tint" style={tintStyle} aria-hidden />
        <Chips view={view} onView={onView} />
        {featured.length ? (
          <Carousel key={`${view.kind}:${typed ?? ""}:${view.kind === "genre" ? view.genre : ""}`} items={featured} onShown={setShown} />
        ) : items === undefined ? (
          <div className="ph-carousel">
            <div className="ph-hero ph-skeleton" aria-hidden />
          </div>
        ) : null}
        <div className="ph-rows">
          {view.kind === "all" && (settings?.showContinueWatching ?? true) && <ContinueRow />}
          {view.kind !== "genre" &&
            addonRows.filter((c) => !typed || c.type === typed).map((c) => <AddonRow key={catalogKey(c)} catalog={c} />)}
          {rows.map(({ shelf, exclude }, i) => (
            <ShelfRow key={shelfKey(shelf).join("/")} shelf={shelf} eager={i < EAGER} exclude={exclude} />
          ))}
        </div>
      </div>
    </div>
  );
}

const NONE = new Set<string>();

/** A genre's rows: what's popular, new and best rated in it, each kind it exists for. */
function genreShelves(genre: string, only?: ContentType): Shelf[] {
  const types: ContentType[] = (only ? [only] : (["series", "movie"] as const)).filter((t) => BROWSE_GENRES[t].includes(genre));
  const name = (t: ContentType) => (t === "movie" ? "Movies" : "Shows");
  return [
    ...types.map((type): Shelf => ({ kind: "catalog", type, id: "popular", genre, title: `Popular ${genre} ${name(type)}`, shape: "poster" })),
    ...types.map((type): Shelf => ({ kind: "catalog", type, id: "new", genre, title: `New ${genre} ${name(type)}`, shape: "poster" })),
    ...types.map((type): Shelf => ({ kind: "catalog", type, id: "top_rated", genre, title: `Critically Acclaimed ${genre} ${name(type)}`, shape: "poster" })),
  ];
}

/** Shows or Movies alone has half Home's rows: its genres' rows fill it out. */
function typeExtras(type: ContentType, have: Shelf[]): Shelf[] {
  const name = type === "movie" ? "Movies" : "Shows";
  const seen = new Set(have.map((s) => shelfKey(s).join("/")));
  return BROWSE_GENRES[type]
    .map((genre): Shelf => ({ kind: "catalog", type, id: "popular", genre, title: `${genre} ${name}`, shape: "poster" }))
    .filter((s) => !seen.has(shelfKey(s).join("/")));
}

function Chips({ view, onView }: { view: HomeView; onView: (v: HomeView) => void }) {
  const scope = view.kind === "type" ? view.type : view.kind === "genre" ? (view.type ?? "all") : "all";
  if (view.kind !== "all") {
    const label = view.kind === "type" ? (view.type === "movie" ? "Movies" : "Shows") : view.type === "movie" ? "Movies" : view.type === "series" ? "Shows" : undefined;
    return (
      <nav className="ph-chips" aria-label="Browse">
        <button type="button" className="ph-chip ph-chip-x" aria-label="Back to everything" onClick={() => onView({ kind: "all" })}>
          <IconClose size={20} stroke={2} />
        </button>
        {label && (
          <button type="button" className="ph-chip" aria-pressed onClick={() => view.kind === "genre" && view.type && onView({ kind: "type", type: view.type })}>
            {label}
          </button>
        )}
        <button type="button" className="ph-chip" aria-pressed={view.kind === "genre" || undefined} onClick={() => categories.set(scope)}>
          {view.kind === "genre" ? view.genre : "Categories"}
          <IconChevronDown size={14} />
        </button>
      </nav>
    );
  }
  return (
    <nav className="ph-chips" aria-label="Browse">
      <button type="button" className="ph-chip" onClick={() => onView({ kind: "type", type: "series" })}>
        Shows
      </button>
      <button type="button" className="ph-chip" onClick={() => onView({ kind: "type", type: "movie" })}>
        Movies
      </button>
      <button type="button" className="ph-chip" onClick={() => categories.set("all")}>
        Categories
        <IconChevronDown size={14} />
      </button>
    </nav>
  );
}

/**
 * The featured titles in one card: every few seconds (while Home is in view and nobody's touching it) the card turns
 * to the next title, its art easing in over the last one's and its logo, genres and buttons coming up after it. A
 * swipe across the card turns it by hand, the art following the finger a little. Nothing shows which title it's
 * on or how long it has left.
 */
export function Carousel({
  items,
  onShown,
  wide,
  kicker,
}: {
  items: MetaPreview[];
  onShown: (i: number) => void;
  /** A section's: the card across the screen (16:10), its words to the left, two lines of what it's about. */
  wide?: boolean;
  /** A line over the title ("#1 in Popular"), for the title at `index`. */
  kicker?: (index: number) => string | undefined;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [{ index, prev, dir }, setState] = useState({ index: 0, prev: -1, dir: 1 });
  const go = useCallback(
    (step: 1 | -1) => setState((s) => ({ index: (s.index + step + items.length) % items.length, prev: s.index, dir: step })),
    [items.length],
  );
  useEffect(() => onShown(index), [index, onShown]);
  // The next title's art is in before its turn comes.
  useEffect(() => {
    const next = items[(index + 1) % items.length];
    const url = next && heroBackdropUrl(next.background ?? next.poster);
    if (url) new Image().src = url;
  }, [index, items]);

  // Turning by itself: only while Home is the page in view, nothing's over it, and no finger is on the card. A turn
  // that can't happen now waits a whole turn again (`tick`); so does the title a finger just chose.
  const touching = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (items.length < 2 || prefersReducedMotion()) return;
    const t = window.setTimeout(() => {
      const page = card.current?.closest<HTMLElement>(".ph-tab");
      const free = !touching.current && !document.hidden && page?.dataset.active === "true" && !document.querySelector(".ps-layer, .sheet, .ph-pushed, .ph-list-overlay, .ph-sources-overlay");
      if (free) go(1);
      else setTick((n) => n + 1);
    }, ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [index, tick, items.length, go]);

  // A sideways swipe turns it; the art follows the finger at a third of its speed until it's let go.
  useEffect(() => {
    const el = card.current;
    if (!el || items.length < 2) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let state: "idle" | "maybe" | "drag" = "idle";
    const set = (v: number) => el.style.setProperty("--drag", `${v.toFixed(1)}px`);
    const start = (e: TouchEvent) => {
      touching.current = true;
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      dx = 0;
      state = "maybe";
    };
    const move = (e: TouchEvent) => {
      if (state === "idle") return;
      const t = e.touches[0];
      const mx = t.clientX - x0;
      const my = t.clientY - y0;
      if (state === "maybe") {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) return void (state = "idle");
        if (Math.abs(mx) < 10) return;
        state = "drag";
        el.dataset.dragging = "";
      }
      e.preventDefault();
      dx = mx;
      set(mx * 0.35);
    };
    const end = () => {
      touching.current = false;
      setTick((n) => n + 1);
      if (state === "drag") {
        delete el.dataset.dragging;
        set(0);
        if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
      }
      state = "idle";
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [items.length, go]);

  const item = items[index];
  const { navigate } = useNavigation();
  const intent = useIntent(item);
  const open = () => navigate({ name: "detail", type: item.type, id: item.id, preview: item });
  return (
    <div className="ph-carousel" data-wide={wide || undefined}>
      <div
        ref={card}
        className="ph-hero scheme-dark"
        data-origin="16"
        role="button"
        tabIndex={0}
        aria-label={item.name}
        aria-roledescription="carousel"
        // Only taps on the card: the sources sheet Play opens is portalled, but its clicks still bubble here.
        onClick={(e) => e.currentTarget.contains(e.target as Node) && open()}
        onKeyDown={(e) => {
          if (e.key === "Enter") open();
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
        style={{ "--dir": dir } as CSSProperties}
        {...intent}
      >
        <div className="ph-hero-window">
          {/* The title coming in, over the one it replaces (first in the tree: the card's picture for the sheet). */}
          <HeroArt key={`${index}:${item.id}`} item={item} entering={prev >= 0} />
          {prev >= 0 && items[prev] && <HeroArt key={`${prev}:${items[prev].id}`} item={items[prev]} under />}
        </div>
        <div className="ph-hero-shade" aria-hidden />
        <HeroBody key={item.id} item={item} kicker={kicker?.(index)} wide={wide} />
      </div>
    </div>
  );
}

/** A featured title's picture, placed on its subject. */
function HeroArt({ item, entering, under }: { item: MetaPreview; entering?: boolean; under?: boolean }) {
  const art = heroBackdropUrl(item.background ?? item.poster);
  const focus = useArtFocus(art, true);
  return (
    <Img
      className="ph-hero-art"
      data-entering={entering || undefined}
      data-under={under || undefined}
      src={art}
      alt=""
      loading="eager"
      style={focus.style}
      draggable={false}
    />
  );
}

/** The title's logo, its kind and genres, and Play (which plays: the next episode or where you left off) beside My List. */
function HeroBody({ item, kicker, wide }: { item: MetaPreview; kicker?: string; wide?: boolean }) {
  const { data: progress } = useProgress(item.id);
  const { inLibrary, toggle } = useLibraryToggle(item);
  const [playing, setPlaying] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const series = item.type === "series";
  const started = !!progress?.some((p) => p.position > 30 && p.duration && p.position / p.duration < 0.95);
  return (
    <div className="ph-hero-body">
      {kicker && <span className="ph-hero-kicker">{kicker}</span>}
      {item.logo && !logoFailed ? (
        <Img className="ph-hero-logo" src={sizedArt(item.logo, "w500")} alt={item.name} onFail={() => setLogoFailed(true)} draggable={false} />
      ) : (
        <h2 className="ph-hero-name">{item.name}</h2>
      )}
      <p className="ph-hero-tags">
        <b>{series ? "Show" : "Movie"}</b>
        {(item.genres ?? []).slice(0, 3).map((t) => (
          <span key={t}>
            <i aria-hidden>✦</i>
            {t}
          </span>
        ))}
      </p>
      {wide && item.description && <p className="ph-hero-desc">{item.description}</p>}
      <div className="ph-hero-actions">
        <button
          type="button"
          className="ph-btn ph-btn-white"
          onPointerDown={() => void PlayNow.preload().catch(() => {})}
          onClick={(e) => {
            e.stopPropagation();
            setPlaying(true);
          }}
        >
          <IconPlay size={22} />
          {started ? "Resume" : "Play"}
        </button>
        <button
          type="button"
          className="ph-btn ph-btn-glass"
          aria-pressed={inLibrary}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          {inLibrary ? <IconCheck size={24} stroke={2} /> : <IconPlus size={24} stroke={2} />}
          My List
        </button>
      </div>
      {playing && (
        <Suspense fallback={null}>
          <PlayNow item={item} onDone={() => setPlaying(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** A Home shelf: held as grey posters until it's near the screen, then its titles. */
const ShelfRow = memo(function ShelfRow({ shelf, eager, exclude }: { shelf: Shelf; eager: boolean; exclude: Set<string> }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(eager);
  const { items, skip } = useShelfItems(shelf, near, exclude);
  useOffscreenMark(ref, !items && !skip);
  const { navigate } = useNavigation();
  const to = shelfRoute(shelf);
  return (
    <div ref={ref} className="ph-row-slot">
      {!skip && <Row title={shelf.title} items={items} onMore={to && (() => navigate(to))} />}
    </div>
  );
});

/** One of the user's add-on catalogs, as a row; left out when it fails or has nothing. */
const AddonRow = memo(function AddonRow({ catalog }: { catalog: AddonCatalog }) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const { data: found, isError } = useAddonCatalogRow(catalog, near);
  const data = useBrowseVisible(useListable(found));
  useOffscreenMark(ref, !data && !isError);
  const { navigate } = useNavigation();
  return (
    <div ref={ref} className="ph-row-slot" data-addon-row={catalog.id}>
      {!isError && !(data && !data.length) && (
        <Row
          title={catalogTitle(catalog)}
          items={data}
          onMore={() => navigate({ name: "discover", type: catalog.type, catalog: catalog.id, addon: catalog.addon })}
        />
      )}
    </div>
  );
});
