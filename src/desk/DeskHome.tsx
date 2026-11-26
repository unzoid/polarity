import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useArtFocus } from "../components/DetailArt";
import { Img } from "../components/Img";
import { useIntent } from "../components/PosterCard";
import { useLibraryToggle } from "../components/title/LibraryButton";
import { ScoreRow } from "../components/title/TitleDetails";
import {
  ALL_GENRES,
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
import { useProgress, useRatings, useSettings } from "../lib/net";
import { useNavigation } from "../lib/router";
import type { ContentType, MetaPreview } from "../lib/types";
import { heroBackdropUrl, lazyNamed, prefersReducedMotion, sizedArt, useNearViewport, useOffscreenMark } from "../lib/ui";
import { IconCheck, IconClose, IconPlay, IconPlus } from "../phone/icons";
import { useArtTint } from "../phone/tint";
import { useHomeFeed, useShelfItems } from "../screens/homeFeed";
import { TopBar } from "./Bar";
import type { Chrome } from "./Nav";
import { ContinueRow, Row } from "./Rows";

const PlayNow = lazyNamed(() => import("../phone/PlayNow"), "PlayNow");
const ListDialog = lazyNamed(() => import("./ListDialog"), "ListDialog");

export type HomeView = { kind: "all" } | { kind: "type"; type: ContentType } | { kind: "genre"; genre: string; type?: ContentType };

const EAGER = 2;
const FEATURED = 6;
const ADVANCE_MS = 9000;

const viewId = (v: HomeView) => (v.kind === "all" ? "all" : v.kind === "type" ? v.type : `genre:${v.type ?? ""}:${v.genre}`);
const viewRank = (v: HomeView) => (v.kind === "all" ? 0 : v.kind === "type" ? (v.type === "series" ? 1 : 2) : 3);

/**
 * Home, as Netflix's iPad app lays it out: Polarity's wordmark in the bar, a row of chips (Shows, Movies, Categories),
 * the featured titles in one wide card with rounded corners, then the rows. Under the computer's top bar (`nav`) the
 * chips go (Shows and Movies are in the bar): Shows or Movies gets its name and a Genres button over the card, as
 * Netflix's web app has. The page takes the featured art's colour at its top, easing from one title's to the next.
 */
export function DeskHome({ view, onView, chrome }: { view: HomeView; onView: (v: HomeView) => void; chrome: Chrome }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { items, shelves, excludes, settings, addonRows } = useHomeFeed();
  const typed = view.kind === "type" ? view.type : view.kind === "genre" ? view.type : undefined;
  const [choosing, setChoosing] = useState<"all" | ContentType | null>(null);
  const [everChose, setEverChose] = useState(false);
  if (choosing !== null && !everChose) setEverChose(true);

  const featured = useMemo(() => {
    const pool = items ?? [];
    const of = typed ? pool.filter((m) => m.type === typed) : pool;
    const withGenre = view.kind === "genre" ? of.filter((m) => m.genres?.includes(view.genre)) : of;
    return (withGenre.length ? withGenre : view.kind === "all" ? of : []).filter((m) => m.background).slice(0, FEATURED);
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
  const pageName = view.kind === "all" ? undefined : view.kind === "type" ? (view.type === "movie" ? "Movies" : "Shows") : view.genre;
  const genres = choosing === "movie" || choosing === "series" ? BROWSE_GENRES[choosing] : ALL_GENRES;

  const content = useRef<HTMLDivElement>(null);
  const prevView = useRef(view);
  useLayoutEffect(() => {
    if (viewId(prevView.current) === viewId(view)) return;
    const from = prevView.current;
    prevView.current = view;
    if (scroller.current) scroller.current.scrollTop = 0;
    if (!content.current || prefersReducedMotion()) return;
    const dir = Math.sign(viewRank(view) - viewRank(from)) || 1;
    content.current.getAnimations().forEach((a) => a.cancel());
    content.current.animate(
      [
        { opacity: 0, translate: `${dir * 48}px 0` },
        { opacity: 1, translate: "0 0" },
      ],
      { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }, [view]);

  const tintStyle = useMemo<CSSProperties | undefined>(() => (tint ? ({ "--tint-dark": tint.dark, "--tint-light": tint.light } as CSSProperties) : undefined), [tint]);
  return (
    <div className="dk-page dk-home">
      {chrome === "tabs" && <TopBar logo title={pageName} scroller={scroller} tint={tintStyle} />}
      <div className="dk-scroll" ref={scroller}>
        <div className="dk-tint" style={tintStyle} aria-hidden />
        <div className="dk-home-body" ref={content}>
          {chrome === "tabs" ? <Chips view={view} onView={onView} onCategories={setChoosing} /> : view.kind !== "all" && <PageHead view={view} onView={onView} onGenres={setChoosing} />}
          {featured.length ? (
            <Billboard key={`${view.kind}:${typed ?? ""}:${view.kind === "genre" ? view.genre : ""}`} items={featured} onShown={setShown} />
          ) : items === undefined ? (
            <div className="dk-billboard dk-skeleton" aria-hidden />
          ) : null}
          <div className="dk-rows">
            {view.kind === "all" && (settings?.showContinueWatching ?? true) && <ContinueRow />}
            {view.kind !== "genre" && addonRows.filter((c) => !typed || c.type === typed).map((c) => <AddonRow key={catalogKey(c)} catalog={c} />)}
            {rows.map(({ shelf, exclude }, i) => (
              <ShelfRow key={shelfKey(shelf).join("/")} shelf={shelf} shape={i % 2 === 1 ? "landscape" : "poster"} eager={i < EAGER} exclude={exclude} />
            ))}
          </div>
        </div>
      </div>
      {everChose && (
        <Suspense fallback={null}>
          <ListDialog
            open={choosing !== null}
            label="Categories"
            options={genres.map((g) => ({ id: g, label: g }))}
            value={view.kind === "genre" ? view.genre : undefined}
            onPick={(genre) => {
              const type = choosing === "movie" || choosing === "series" ? choosing : undefined;
              setChoosing(null);
              onView({ kind: "genre", genre: String(genre), type });
            }}
            onClose={() => setChoosing(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

const NONE = new Set<string>();

function genreShelves(genre: string, only?: ContentType): Shelf[] {
  const types: ContentType[] = (only ? [only] : (["series", "movie"] as const)).filter((t) => BROWSE_GENRES[t].includes(genre));
  const name = (t: ContentType) => (t === "movie" ? "Movies" : "Shows");
  return [
    ...types.map((type): Shelf => ({ kind: "catalog", type, id: "popular", genre, title: `Popular ${genre} ${name(type)}`, shape: "landscape" })),
    ...types.map((type): Shelf => ({ kind: "catalog", type, id: "new", genre, title: `New ${genre} ${name(type)}`, shape: "poster" })),
    ...types.map((type): Shelf => ({ kind: "catalog", type, id: "top_rated", genre, title: `Critically Acclaimed ${genre} ${name(type)}`, shape: "landscape" })),
  ];
}

function typeExtras(type: ContentType, have: Shelf[]): Shelf[] {
  const name = type === "movie" ? "Movies" : "Shows";
  const seen = new Set(have.map((s) => shelfKey(s).join("/")));
  return BROWSE_GENRES[type]
    .map((genre, i): Shelf => ({ kind: "catalog", type, id: "popular", genre, title: `${genre} ${name}`, shape: i % 2 === 0 ? "landscape" : "poster" }))
    .filter((s) => !seen.has(shelfKey(s).join("/")));
}

/** Netflix web's head over Shows and Movies: the name, then a Genres button (the genre once one is picked, and ✕). */
function PageHead({ view, onView, onGenres }: { view: Exclude<HomeView, { kind: "all" }>; onView: (v: HomeView) => void; onGenres: (scope: "all" | ContentType) => void }) {
  const type = view.type;
  const name = type === "movie" ? "Movies" : type === "series" ? "Shows" : view.kind === "genre" ? view.genre : "";
  return (
    <div className="dk-head">
      <h1 className="dk-head-name">
        {view.kind === "genre" && type ? (
          <button type="button" className="dk-head-crumb" onClick={() => onView({ kind: "type", type })}>
            {name}
          </button>
        ) : (
          name
        )}
      </h1>
      <button type="button" className="dk-chip dk-head-genres" aria-pressed={view.kind === "genre" || undefined} onClick={() => onGenres(type ?? "all")}>
        {view.kind === "genre" ? view.genre : "Genres"}
        <svg className="dk-chip-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2 4.2h8L6 8.6z" fill="currentColor" />
        </svg>
      </button>
      {view.kind === "genre" && (
        <button type="button" className="dk-chip dk-chip-x" aria-label={type ? `All ${name}` : "Back to everything"} onClick={() => onView(type ? { kind: "type", type } : { kind: "all" })}>
          <IconClose size={20} stroke={2} />
        </button>
      )}
    </div>
  );
}

/** Netflix's chips: rounded rectangles, not pills. Picked, the row becomes ✕, the kind and the genre. */
function Chips({ view, onView, onCategories }: { view: HomeView; onView: (v: HomeView) => void; onCategories: (scope: "all" | ContentType) => void }) {
  const caret = (
    <svg className="dk-chip-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2 4.2h8L6 8.6z" fill="currentColor" />
    </svg>
  );
  if (view.kind !== "all") {
    const type = view.kind === "type" ? view.type : view.type;
    return (
      <nav className="dk-chips" aria-label="Browse">
        <button type="button" className="dk-chip dk-chip-x" aria-label="Back to everything" onClick={() => onView({ kind: "all" })}>
          <IconClose size={20} stroke={2} />
        </button>
        {type && (
          <button type="button" className="dk-chip" aria-pressed onClick={() => view.kind === "genre" && onView({ kind: "type", type })}>
            {type === "movie" ? "Movies" : "Shows"}
          </button>
        )}
        <button type="button" className="dk-chip" aria-pressed={view.kind === "genre" || undefined} onClick={() => onCategories(type ?? "all")}>
          {view.kind === "genre" ? view.genre : "Categories"}
          {caret}
        </button>
      </nav>
    );
  }
  return (
    <nav className="dk-chips" aria-label="Browse">
      <button type="button" className="dk-chip" onClick={() => onView({ kind: "type", type: "series" })}>
        Shows
      </button>
      <button type="button" className="dk-chip" onClick={() => onView({ kind: "type", type: "movie" })}>
        Movies
      </button>
      <button type="button" className="dk-chip" onClick={() => onCategories("all")}>
        Categories
        {caret}
      </button>
    </nav>
  );
}

/**
 * The featured titles in one card across the page (2.35:1, Netflix's iPad proportions): every few seconds, while
 * Home is in view and the pointer isn't on it, the card turns to the next title, its art easing in over the last
 * one's and its words coming up after. Arrow keys turn it by hand. Nothing shows which title it's on.
 */
export const Billboard = memo(function Billboard({ items, onShown, kicker }: { items: MetaPreview[]; onShown: (i: number) => void; kicker?: (index: number) => string | undefined }) {
  const card = useRef<HTMLDivElement>(null);
  const [{ index, prev }, setState] = useState({ index: 0, prev: -1 });
  const go = useCallback((step: 1 | -1) => setState((s) => ({ index: (s.index + step + items.length) % items.length, prev: s.index })), [items.length]);
  useEffect(() => onShown(index), [index, onShown]);
  useEffect(() => {
    const next = items[(index + 1) % items.length];
    const url = next && heroBackdropUrl(next.background ?? next.poster);
    if (url) new Image().src = url;
  }, [index, items]);

  const hovered = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (items.length < 2 || prefersReducedMotion()) return;
    const t = window.setTimeout(() => {
      const page = card.current?.closest<HTMLElement>(".dk-tab-page");
      const free = !hovered.current && !document.hidden && page?.dataset.active === "true";
      if (free) go(1);
      else setTick((n) => n + 1);
    }, ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [index, tick, items.length, go]);

  const item = items[index];
  const { navigate } = useNavigation();
  const intent = useIntent(item);
  const open = () => navigate({ name: "detail", type: item.type, id: item.id, preview: item });
  return (
    <div
      ref={card}
      className="dk-billboard scheme-dark"
      data-origin="12"
      role="button"
      tabIndex={0}
      aria-label={item.name}
      aria-roledescription="carousel"
      onClick={(e) => e.currentTarget.contains(e.target as Node) && open()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") open();
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      {...intent}
      onPointerEnter={() => {
        hovered.current = true;
        intent.onPointerEnter?.();
      }}
      onPointerLeave={() => {
        hovered.current = false;
        setTick((n) => n + 1);
        intent.onPointerLeave?.();
      }}
    >
      <div className="dk-bb-window">
        <BillboardArt key={`${index}:${item.id}`} item={item} entering={prev >= 0} />
        {prev >= 0 && items[prev] && <BillboardArt key={`${prev}:${items[prev].id}`} item={items[prev]} under />}
      </div>
      <div className="dk-bb-shade" aria-hidden />
      <BillboardBody key={item.id} item={item} kicker={kicker?.(index)} />
    </div>
  );
});

function BillboardArt({ item, entering, under }: { item: MetaPreview; entering?: boolean; under?: boolean }) {
  const art = heroBackdropUrl(item.background ?? item.poster);
  const focus = useArtFocus(art, true);
  return <Img className="dk-bb-art" data-entering={entering || undefined} data-under={under || undefined} src={art} alt="" loading="eager" style={focus.style} draggable={false} />;
}

/** Logo, a line of what it is, three lines of what it's about, and Play beside My List, each 236 pt wide. */
function BillboardBody({ item, kicker }: { item: MetaPreview; kicker?: string }) {
  const { data: settings } = useSettings();
  const { data: ratings } = useRatings(item.type, item.id, !!settings?.ratingsOnHero);
  const { data: progress } = useProgress(item.id);
  const { inLibrary, toggle } = useLibraryToggle(item);
  const [playing, setPlaying] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const started = !!progress?.some((p) => p.position > 30 && p.duration && p.position / p.duration < 0.95);
  const year = item.releaseInfo?.match(/\d{4}/)?.[0];
  return (
    <div className="dk-bb-body">
      {item.logo && !logoFailed ? (
        <Img className="dk-bb-logo" src={sizedArt(item.logo, "w500")} alt={item.name} onFail={() => setLogoFailed(true)} draggable={false} />
      ) : (
        <h2 className="dk-bb-name">{item.name}</h2>
      )}
      <p className="dk-bb-line">
        {kicker ?? (
          <>
            {item.type === "series" ? "Show" : "Movie"}
            {year && <i aria-hidden>✦</i>}
            {year}
            {(item.genres ?? []).slice(0, 2).map((g) => (
              <span key={g}>
                <i aria-hidden>✦</i>
                {g}
              </span>
            ))}
          </>
        )}
      </p>
      {settings?.ratingsOnHero && ratings && (
        <div className="dk-bb-scores">
          <ScoreRow ratings={ratings} />
        </div>
      )}
      {item.description && <p className="dk-bb-desc">{item.description}</p>}
      <div className="dk-bb-actions">
        <button
          type="button"
          className="dk-btn dk-btn-white"
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
          className="dk-btn dk-btn-glass"
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

const ShelfRow = memo(function ShelfRow({ shelf, shape, eager, exclude }: { shelf: Shelf; shape: "poster" | "landscape"; eager: boolean; exclude: Set<string> }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(eager);
  const { items, skip } = useShelfItems(shelf, near, exclude);
  useOffscreenMark(ref, !items && !skip);
  const { navigate } = useNavigation();
  const to = shelfRoute(shelf);
  return (
    <div ref={ref} className="dk-row-slot" data-shape={shape}>
      {!skip && <Row title={shelf.title} items={items} shape={shape} onMore={to && (() => navigate(to))} />}
    </div>
  );
});

const AddonRow = memo(function AddonRow({ catalog }: { catalog: AddonCatalog }) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const { data: found, isError } = useAddonCatalogRow(catalog, near);
  const data = useBrowseVisible(useListable(found));
  useOffscreenMark(ref, !data && !isError);
  const { navigate } = useNavigation();
  return (
    <div ref={ref} className="dk-row-slot" data-addon-row={catalog.id}>
      {!isError && !(data && !data.length) && (
        <Row title={catalogTitle(catalog)} items={data} onMore={() => navigate({ name: "discover", type: catalog.type, catalog: catalog.id, addon: catalog.addon })} />
      )}
    </div>
  );
});
