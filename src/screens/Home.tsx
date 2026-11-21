import "../styles/detail.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { prefetchTitlePage, useEntryShown } from "../lib/anime";
import { HeroGlow } from "../components/HeroGlow";
import { ChevronLeft, ChevronRight, Play, Shuffle } from "../components/icons";
import { Img } from "../components/Img";
import { TitleHeading } from "../components/title/TitleHeading";
import { AgeRatingBadge } from "../components/title/TitleDetails";
import { LandscapeCard, PosterCard, useIntent } from "../components/PosterCard";
import { ArtTitle, Card, ProgressBar } from "../components/title/Card";
import { Shelf } from "../components/title/Shelf";
import { ContinueEditRow } from "../components/ContinueEditRow";
import { RatingRing } from "../components/RatingRing";
import { api } from "../lib/api";
import { episodeCode, formatRemaining, joinFacts, kindFacts } from "../lib/format";
import {
  keys,
  preloadImage,
  useCatalog,
  useContinueWatching,
  useRecommend,
  useSettings,
  useWatchHistory,
} from "../lib/net";
import { dismissUpNext, removeContinueEntries, useUpNextContinueWatching, type ContinueEntry } from "../lib/library";
import { heroBackdropUrl, prefersReducedMotion, rubberband, useArtGate, useFormFactor, useNearViewport, type Rgb } from "../lib/ui";
import { useNavigation } from "../lib/router";
import {
  catalogKey,
  catalogTitle,
  pickForMe,
  progressItem,
  shelfKey,
  shelfRoute,
  todaysShelves,
  useAddonCatalogRow,
  useBrowseFeatured,
  useBrowseShelf,
  useBrowseVisible,
  useFeatured,
  useHomeCatalogs,
  useListable,
  useSeeds,
  useShownAbove,
  useTasteProfile,
  type AddonCatalog,
  type Shelf as HomeShelf,
} from "../lib/catalog";
import { cardMenu } from "../components/CardMenu";
import type { MetaPreview } from "../lib/types";
import { Button, IconButton } from "../components/ui/Button";
import { LibraryButton } from "../components/title/LibraryButton";
import { Skeleton } from "../components/ui/Skeleton";

/**
 * The page, top to bottom: featured carousel, what you're watching, then the
 * the add-on catalogs switched on in Settings → Add-ons (#206), then the
 * day's shelves (lib/catalog/shelves.ts). A title already shown higher up (the
 * carousel included) is left out of the shelves below it. Shelves below the
 * fold only fetch when scrolled near.
 */

const NO_TITLES: MetaPreview[] = [];

/** The first shelves load immediately; the rest wait until they're close. */
const EAGER_SHELVES = 2;

export function Home() {
  const { items, shelves, excludes, settings, addonRows, surpriseMe } = useHomeFeed();

  return (
    <div className="scroll home">
      {items?.length !== 0 && <HeroCarousel items={items} onSurprise={surpriseMe} />}
      <div className="rows home-rows">
        {(settings?.showContinueWatching ?? true) && <ContinueRow />}
        {addonRows.map((c) => (
          <AddonShelf key={catalogKey(c)} catalog={c} />
        ))}
        {shelves.map((shelf, i) => (
          <LazyShelf
            key={shelfKey(shelf).join("/")}
            shelf={shelf}
            eager={i < EAGER_SHELVES}
            exclude={excludes[i]}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * What Home shows, for any layout of it (this page, and the phone shell's): the featured titles, the shelves and
 * what each leaves out, the add-ons' rows, and Surprise Me.
 */
export function useHomeFeed() {
  // Without the hidden and (when asked) the watched (lib/catalog/browseFilter.ts).
  const items = useBrowseFeatured(useFeatured().data);
  const seeds = useSeeds();
  const taste = useTasteProfile();
  const shelves = useMemo(() => todaysShelves(seeds, taste), [seeds, taste]);
  const shownAbove = useShownAbove(shelves, items ?? NO_TITLES);
  const { data: watching } = useContinueWatching();
  const { data: history } = useWatchHistory();
  const watched = useMemo(
    () => new Set([...(watching ?? []).map((p) => p.metaId), ...(history ?? []).map((p) => p.metaId)]),
    [watching, history],
  );
  // Recommendations also skip what you're watching or have watched; memoized so shelves keep stable Set references.
  const excludes = useMemo(
    () => shelves.map((shelf, i) => (shelf.kind === "because" ? new Set([...shownAbove[i], ...watched]) : shownAbove[i])),
    [shelves, shownAbove, watched],
  );
  const { data: settings } = useSettings();
  const addonRows = useHomeCatalogs();
  const qc = useQueryClient();
  const { navigate } = useNavigation();

  const surpriseMe = useCallback(() => {
    const pool: MetaPreview[] = [...(items ?? [])];
    for (const s of shelves) {
      const list = qc.getQueryData<MetaPreview[]>(shelfKey(s));
      if (list?.length) pool.push(...list);
    }
    const chosen = pickForMe(pool, watched, taste);
    if (chosen) navigate({ name: "detail", type: chosen.type, id: chosen.id, preview: chosen });
  }, [items, shelves, qc, watched, taste, navigate]);

  return { items, shelves, excludes, settings, addonRows, surpriseMe };
}

// --- Hero ----------------------------------------------------------------

const ADVANCE_MS = 9000;

/**
 * Featured carousel: a framed card, with the page behind it tinted by the art. Auto-advances, but never while you're
 * pointing at it, while the window is in the background, or when the OS asks
 * for reduced motion. The art cross-fades rather than slides: a full-screen
 * slide is a vestibular trigger and an abrupt cut is a brightness jump.
 */
function subscribeUltrawide(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(min-aspect-ratio: 2/1)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function isUltrawide() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-aspect-ratio: 2/1)").matches;
}

function subscribeOsReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getOsReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HeroCarousel({
  items,
  index: controlledIndex,
  setIndex: controlledSetIndex,
  content,
  handlers,
  onSurprise,
}: {
  items?: MetaPreview[];
  index?: number;
  setIndex?: (i: number | ((i: number) => number)) => void;
  /** The text block over the art, for a page whose titles open somewhere else (Anime). */
  content?: (item: MetaPreview) => ReactNode;
  /** What clicking and right-clicking the art does; by default the title's page and its options menu. */
  handlers?: (item: MetaPreview) => { onClick: () => void; onContextMenu: (e: React.MouseEvent<HTMLElement>) => void };
  /** Optional "Surprise Me" picker shown alongside the default hero actions. */
  onSurprise?: () => void;
}) {
  const { navigate } = useNavigation();
  const phone = useFormFactor().form === "phone";
  const ultrawide = useSyncExternalStore(subscribeUltrawide, isUltrawide, () => false);
  const osReduced = useSyncExternalStore(subscribeOsReducedMotion, getOsReducedMotion, () => false);
  const [picked, setPicked] = useState(0);
  const count = items?.length ?? 0;
  const rawIndex = controlledIndex ?? picked;
  const index = count ? ((rawIndex % count) + count) % count : 0;
  const setIndex = useCallback(
    (next: number | ((i: number) => number)) => {
      if (controlledSetIndex) controlledSetIndex(next);
      else setPicked((prev) => {
        const cur = count ? ((prev % count) + count) % count : 0;
        return typeof next === "function" ? next(cur) : next;
      });
    },
    [controlledSetIndex, count],
  );

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [windowInactive, setWindowInactive] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const onVis = () => setWindowInactive(document.hidden);
    const onBlur = () => setWindowInactive(true);
    const onFocus = () => setWindowInactive(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const hero = useRef<HTMLDivElement>(null);
  const rawItem = items?.[index];
  const bgOf = useCallback((u?: string) => heroBackdropUrl(u, phone), [phone]);
  const item = useMemo(() => (rawItem ? { ...rawItem, background: bgOf(rawItem.background) } : undefined), [rawItem, bgOf]);
  // The logo or name waits for the current backdrop (#173).
  const gate = useArtGate(item?.background);
  const gateReady = gate["data-art"] === "ready";
  const gateRef = gate.ref;
  const heroRef = useCallback(
    (node: HTMLDivElement | null) => {
      hero.current = node;
      gateRef(node);
    },
    [gateRef],
  );

  // Only mount slides that are active, were shown, or have been warmed ahead so hidden slides don't contend at t=0.
  const [warmed, setWarmed] = useState<ReadonlySet<number>>(() => new Set([index]));
  useEffect(() => {
    setWarmed((prev) => (prev.has(index) ? prev : new Set(prev).add(index)));
  }, [index]);

  const { data: settings } = useSettings();
  const rotate = settings?.heroAutoplay ?? true;
  const reducedMotion =
    settings?.reduceMotion === "on"
      ? true
      : settings?.reduceMotion === "off"
        ? false
        : osReduced || prefersReducedMotion();
  const canRotate = rotate && !reducedMotion && count > 1;
  const paused = hovered || focused || windowInactive;

  // Decode the next backdrop ahead of time once the current slide is in (after a short settle window),
  // so slide 0 never competes with slide 1 at initial load yet the cross-fade never waits.
  const [nextWarmed, setNextWarmed] = useState(false);
  useEffect(() => {
    setNextWarmed(false);
  }, [index]);
  useEffect(() => {
    if (!items || count < 2 || !gateReady) return;
    const nextIdx = (index + 1) % count;
    const t = window.setTimeout(() => {
      const nextBg = bgOf(items[nextIdx]?.background);
      preloadImage(nextBg);
      setNextWarmed(true);
      setWarmed((prev) => (prev.has(nextIdx) ? prev : new Set(prev).add(nextIdx)));
    }, 1500);
    return () => window.clearTimeout(t);
  }, [items, index, count, gateReady, bgOf]);

  // A sideways swipe on touch steps through the titles, as the arrows do.
  const swiped = useRef(false);
  const swipeHandlers = useHeroSwipe(count > 1, (dir) => setIndex((index + dir + count) % count), swiped);
  const [scrim, setScrim] = useState<Rgb | null>(null);

  if (!items || !item) {
    return (
      <section className="hero">
        <Skeleton className="hero-card hero-placeholder" />
      </section>
    );
  }

  const h = handlers?.(item) ?? {
    onClick: () => navigate({ name: "detail", type: item.type, id: item.id, preview: item }),
    onContextMenu: cardMenu(item).onContextMenu,
  };
  const nextBg = nextWarmed ? bgOf(items[(index + 1) % count]?.background) : undefined;
  const prevItem = items[(index - 1 + count) % count];
  const nextItem = items[(index + 1) % count];

  const pager = (
    <div className="hero-pager">
      <div className="hero-dots" role="tablist" aria-label="Featured">
        {items.map((it, i) => (
          <button
            key={it.id}
            role="tab"
            aria-selected={i === index}
            aria-label={it.name}
            className="hero-dot"
            onClick={() => setIndex(i)}
          >
            {i === index && canRotate && (
              <span key={index} className="hero-dot-clip">
                <span
                  className="hero-dot-fill"
                  data-paused={paused || undefined}
                  style={{ animationDuration: `${ADVANCE_MS}ms` }}
                  onAnimationEnd={(e) => {
                    if (e.target === e.currentTarget && hero.current?.checkVisibility({ visibilityProperty: true }) !== false) {
                      setIndex((prev) => (prev + 1) % count);
                    }
                  }}
                />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="hero" aria-roledescription="carousel">
      {/* The page around the card takes on a dark shade of the art's colour, as Netflix's, fading down the window. */}
      <HeroGlow src={item.background} next={nextBg} area={phone ? "middle" : "whole"} onColor={setScrim} />
      <div className="hero-stage">
      {ultrawide && count > 1 && prevItem && (
        <HeroPeek item={{ ...prevItem, background: bgOf(prevItem.background) }} side="prev" onClick={() => setIndex((index - 1 + count) % count)} />
      )}
      <div
        className="hero-card"
        ref={heroRef}
        data-art={gate["data-art"]}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") setHovered(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch") setHovered(false);
        }}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
        {...swipeHandlers}
        // The whole card opens the title, except where its own controls sit (or a swipe just ended on it).
        onClick={(e) => !swiped.current && !(e.target as Element).closest("button, a") && h.onClick()}
        // ← and → step through the featured titles while focus is on the card's controls.
        onKeyDown={(e) => {
          if (count < 2 || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          setIndex((index + (e.key === "ArrowLeft" ? count - 1 : 1)) % count);
        }}
        onContextMenu={h.onContextMenu}
      >
        <div className="hero-art">
          {items.map((it, i) =>
            i === index || warmed.has(i) ? (
              <Img
                key={it.id}
                src={bgOf(it.background)}
                alt=""
                loading={i === index ? "eager" : "lazy"}
                fetchPriority={i === index ? "high" : undefined}
                className="hero-backdrop"
                data-current={i === index}
              />
            ) : null,
          )}
        </div>
        <div className="hero-scrim" style={scrim ? ({ "--glow-scrim": `rgb(${scrim.join(" ")})` } as CSSProperties) : undefined} />

        {/* Keyed: the text block swaps with a short blur-masked fade. */}
        <Fragment key={item.id}>{content ? content(item) : <HeroContent item={item} />}</Fragment>

        {!phone && pager}
        {(count > 1 || (!phone && onSurprise)) && (
          <div className="hero-steps">
            {!phone && onSurprise && (
              <IconButton
                variant="glass"
                className="hero-next hero-surprise pressable"
                label="Surprise Me"
                title="Surprise Me — pick an unwatched title for you"
                onClick={onSurprise}
              >
                <Shuffle size={20} />
              </IconButton>
            )}
            {count > 1 && (
              <>
                <IconButton variant="glass" className="hero-next pressable" label="Previous featured" onClick={() => setIndex((index - 1 + count) % count)}>
                  <ChevronLeft size={22} />
                </IconButton>
                <IconButton variant="glass" className="hero-next pressable" label="Next featured" onClick={() => setIndex((index + 1) % count)}>
                  <ChevronRight size={22} />
                </IconButton>
              </>
            )}
          </div>
        )}
      </div>
      {ultrawide && count > 1 && nextItem && (
        <HeroPeek item={{ ...nextItem, background: bgOf(nextItem.background) }} side="next" onClick={() => setIndex((index + 1) % count)} />
      )}
      </div>
      {phone && count > 1 && pager}
    </section>
  );
}

/** Below this many pixels sideways a touch is a tap. */
const SWIPE_MIN_PX = 12;
/** Past either, the swipe turns the page: a long drag or a quick flick (px per ms), whichever comes first. */
const SWIPE_DISTANCE_PX = 56;
const SWIPE_VELOCITY = 0.3;

/**
 * Touch swipes on the featured card (mouse and pen keep their click). The card
 * lets the page scroll up and down (`touch-action: pan-y`), so a vertical move
 * cancels the pointer and only sideways ones reach here. `swiped` stays set
 * until the click that follows the lifted finger, so that click doesn't open
 * the title.
 */
function useHeroSwipe(enabled: boolean, step: (dir: 1 | -1) => void, swiped: React.RefObject<boolean>) {
  const start = useRef<{ id: number; x: number; y: number; lastX: number; lastT: number; vx: number; tracking: boolean } | null>(null);
  if (!enabled) return {};
  const reset = (el: HTMLElement | null) => {
    if (!el) return;
    delete el.dataset.dragging;
    el.style.removeProperty("--hero-drag-x");
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      swiped.current = false;
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: e.timeStamp, vx: 0, tracking: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.tracking) {
        if (Math.abs(dx) < SWIPE_MIN_PX) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          start.current = null;
          return;
        }
        s.tracking = true;
        swiped.current = true;
        if (!prefersReducedMotion()) e.currentTarget.dataset.dragging = "";
      }
      const dt = e.timeStamp - s.lastT;
      if (dt > 0) {
        const inst = (e.clientX - s.lastX) / dt;
        s.vx = s.vx === 0 ? inst : inst * 0.65 + s.vx * 0.35;
        s.lastX = e.clientX;
        s.lastT = e.timeStamp;
      }
      if (!prefersReducedMotion()) {
        const w = e.currentTarget.offsetWidth || 360;
        const follow = rubberband(dx, w, 0.28);
        e.currentTarget.style.setProperty("--hero-drag-x", `${follow.toFixed(1)}px`);
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      reset(e.currentTarget);
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(e.clientY - s.y)) return;
      swiped.current = true;
      const stale = e.timeStamp - s.lastT > 80;
      const vx = stale ? 0 : s.vx;
      const avgV = Math.abs(dx) / Math.max(1, e.timeStamp - s.lastT || 1);
      const speed = Math.abs(vx) > 0 ? Math.abs(vx) : avgV;
      const reversed = vx !== 0 && Math.sign(vx) !== Math.sign(dx) && Math.abs(vx) > SWIPE_VELOCITY;
      if (!reversed && (Math.abs(dx) >= SWIPE_DISTANCE_PX || speed > SWIPE_VELOCITY)) step(dx < 0 ? 1 : -1);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      start.current = null;
      reset(e.currentTarget);
    },
  };
}

/**
 * On a window much wider than the card (ultrawide), the featured titles
 * before and after it, dimmed at its sides, the way a carousel continues.
 * Hidden by CSS everywhere else.
 */
function HeroPeek({ item, side, onClick }: { item: MetaPreview; side: "prev" | "next"; onClick: () => void }) {
  // Keep the outgoing backdrop mounted briefly beneath the incoming one so peek slides crossfade smoothly.
  const [layers, setLayers] = useState<{ id: string; src?: string }[]>(() => [{ id: item.id, src: item.background }]);
  useEffect(() => {
    setLayers((prev) => {
      if (prev.at(-1)?.id === item.id) return prev;
      return [...prev.slice(-1), { id: item.id, src: item.background }];
    });
    const t = window.setTimeout(() => setLayers((prev) => prev.slice(-1)), 650);
    return () => window.clearTimeout(t);
  }, [item.id, item.background]);

  return (
    <button className="hero-peek" data-side={side} onClick={onClick} aria-label={`${side === "prev" ? "Previous" : "Next"} featured: ${item.name}`} tabIndex={-1}>
      {layers.map((l, idx) => (
        <Img
          key={l.id}
          src={l.src}
          alt=""
          className="hero-peek-img"
          data-current={idx === layers.length - 1}
        />
      ))}
    </button>
  );
}

function HeroContent({ item }: { item: MetaPreview }) {
  const { navigate } = useNavigation();
  const intent = useIntent(item);
  const open = () => navigate({ name: "detail", type: item.type, id: item.id, preview: item });
  // A phone's card is Netflix's: Watch Now and Save side by side, each half the width (cards.css).
  const phone = useFormFactor().form === "phone";
  const facts = joinFacts([...kindFacts(item), item.releaseInfo]);
  const kind = item.type === "movie" ? "Movie" : "Series";
  const phoneTags = item.genres?.length ? item.genres.slice(0, 3) : item.releaseInfo ? [item.releaseInfo] : [];

  return (
    <div className="hero-content">
      <TitleHeading name={item.name} logo={item.logo} logos={item.logos} backdrop={item.background} look="hero" />
      <p className="hero-kind t-callout tabular">
        {!phone && item.imdbRating && <RatingRing value={item.imdbRating} imdbId={item.id} />}
        {phone ? (
          <span className="hero-kind-text">
            <span className="hero-kind-lead">{kind}</span>
            {phoneTags.map((tag) => (
              <Fragment key={tag}>
                <span className="hero-kind-dot" aria-hidden>
                  •
                </span>
                <span>{tag}</span>
              </Fragment>
            ))}
          </span>
        ) : (
          facts && <span className="hero-kind-text">{facts}</span>
        )}
        {!phone && <AgeRatingBadge certification={item.certification} />}
      </p>
      <p className="hero-description t-body">{item.description}</p>
      <div className="hero-actions">
        <Button variant="primary" onClick={open} {...intent}>
          <Play size={18} fill="currentColor" /> Watch Now
        </Button>
        <LibraryButton item={item} labelled={phone} />
      </div>
    </div>
  );
}

// --- Shelves --------------------------------------------------------------

/** With fewer fresh titles than this, a shelf shows its full list, repeats and all. */
const MIN_FRESH = 6;

/**
 * A shelf's titles once `enabled` (near the screen): what its catalog or recommendations give, without what's
 * hidden, watched or already above (`exclude`) unless that leaves too few. `skip`: the shelf stays out (its catalog
 * failed, or there's too little worth recommending).
 */
export function useShelfItems(shelf: HomeShelf, enabled: boolean, exclude: Set<string>) {
  const isCatalog = shelf.kind === "catalog";
  const catalog = useCatalog(shelf.type, isCatalog ? shelf.id : "", isCatalog ? shelf.genre : undefined, enabled && isCatalog);
  const recommended = useRecommend(shelf.type, isCatalog ? "" : shelf.seed, enabled && !isCatalog);
  const { data, isLoading, isError } = isCatalog ? catalog : recommended;
  // Nothing to play and nothing to show (#337) stays out.
  // Hidden and watched titles go too, and a shelf they leave short loads more (lib/catalog/browseFilter.ts).
  const shown = useBrowseShelf(useListable(data), isCatalog ? { type: shelf.type, id: shelf.id, genre: shelf.genre } : undefined);
  const items = useMemo(() => {
    const fresh = (shown ?? []).filter((m) => !exclude.has(m.id));
    return fresh.length >= MIN_FRESH || shelf.kind === "because" ? fresh : (shown ?? []);
  }, [shown, exclude, shelf.kind]);
  // One failing catalog shouldn't break the page; nothing good to recommend leaves the row out rather than a stub.
  const skip = isError || (shelf.kind === "because" && !!data && items.length < 4);
  return { items: isLoading || !enabled ? undefined : items, skip };
}

function CatalogRow({ shelf, enabled, exclude }: { shelf: HomeShelf; enabled: boolean; exclude: Set<string> }) {
  const { title } = shelf;
  // An upright screen is a poster's shape: a phone's shelves are all posters, three and a bit across, and
  // only Continue Watching keeps its wide stills. Wide cards there showed one and a half to a row.
  const shape = useFormFactor().form === "phone" ? "poster" : shelf.shape;
  const { items, skip } = useShelfItems(shelf, enabled, exclude);
  const { navigate } = useNavigation();
  const to = shelfRoute(shelf);
  if (skip) return null;
  const TitleCard = shape === "landscape" ? LandscapeCard : PosterCard;
  return (
    <Shelf
      title={title}
      onOpen={to && (() => navigate(to))}
      shape={shape}
      items={items}
      card={(item) => <TitleCard key={item.id} item={item} />}
    />
  );
}

/** Holds a shelf back (as a skeleton) until it's near the viewport. */
function LazyShelf({ shelf, eager, exclude }: { shelf: HomeShelf; eager: boolean; exclude: Set<string> }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(eager);
  return (
    <div ref={ref}>
      <CatalogRow shelf={shelf} enabled={near} exclude={exclude} />
    </div>
  );
}

/**
 * An add-on's catalog as a row (#206): fetched once near, left out when the add-on fails, is
 * too slow or has nothing. Its titles aren't deduplicated against the shelves: it's the user's list.
 */
function AddonShelf({ catalog }: { catalog: AddonCatalog }) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const { data: found, isError } = useAddonCatalogRow(catalog, near);
  const data = useBrowseVisible(useListable(found));
  const { navigate } = useNavigation();
  return (
    <div ref={ref} data-addon-row={catalog.id}>
      {!isError && !(data && !data.length) && (
        <Shelf
          title={catalogTitle(catalog)}
          onOpen={() => navigate({ name: "discover", type: catalog.type, catalog: catalog.id, addon: catalog.addon })}
          items={data}
          card={(item) => <PosterCard key={item.id} item={item} />}
        />
      )}
    </div>
  );
}

export function ContinueRow() {
  const entries = useUpNextContinueWatching();
  const items = useMemo(() => entries.map((e) => e.progress), [entries]);
  const byVideo = useMemo(() => new Map(entries.map((e) => [e.progress.videoId, e])), [entries]);
  const order = useMemo(() => items.map((p) => p.videoId).join(" "), [items]);
  if (!entries.length) return null;
  // Edit picks several cards to remove at once (components/ContinueEditRow.tsx).
  return (
    <ContinueEditRow
      items={items}
      order={order}
      remove={(selected) => removeContinueEntries(selected.map((p) => byVideo.get(p.videoId) ?? { progress: p }))}
      card={(p) => <ContinueCard entry={byVideo.get(p.videoId) ?? { progress: p }} />}
    />
  );
}

/**
 * Continue Watching card: clicking the play button resumes (or starts the next episode) straight away;
 * clicking anywhere else on the card opens the title's page.
 * With seasons as separate shows, an anime shows the entry the episode is part of (#22).
 */
function ContinueCard({ entry: cw }: { entry: ContinueEntry }) {
  const { progress: p, upNext } = cw;
  const { navigate } = useNavigation();
  const stored = useMemo(() => progressItem(p), [p]);
  const { item, entry, opens } = useEntryShown(stored, p.videoId);
  // Which page it opens on is known before the menu is used (mostly a stored anime link: no network).
  useEffect(() => prefetchTitlePage(p.type, opens), [p.type, opens]);
  const open = () => navigate({ name: "detail", type: p.type, id: opens, preview: opens === item.id ? item : undefined });
  // The player goes on with the saved source only while the add-ons still offer it (#394).
  const resume = () => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId });
  const fraction = p.duration ? p.position / p.duration : 0;
  const remaining = formatRemaining(p.position, p.duration);
  const meta = useQuery({ queryKey: keys.meta(p.type, p.metaId), queryFn: () => api.meta(p.type, p.metaId), staleTime: 60 * 60_000 });
  const logo = meta.data?.logo;
  const artChain = useMemo(
    () => [p.background, meta.data?.background, p.poster, meta.data?.poster].filter((u, i, a): u is string => !!u && a.indexOf(u) === i),
    [p.background, meta.data?.background, p.poster, meta.data?.poster],
  );
  const captionTitle = entry
    ? `Episode ${entry.number} · ${p.episodeTitle ?? item.name}`
    : p.season != null
      ? `${episodeCode(p.season, p.episode)} · ${p.episodeTitle ?? p.name}`
      : joinFacts(["Movie", meta.data?.releaseInfo]);

  return (
    <Card
      shape="landscape"
      frameClass="card-frame-resume"
      art={artChain[0]}
      artFallbacks={artChain.slice(1)}
      fallback={<span className="card-fallback t-headline">{item.name}</span>}
      title={captionTitle}
      // Always shown: it's what you're watching, not a description.
      keepCaption
      onClick={open}
      actions={
        <button
          type="button"
          className="card-play"
          aria-label={upNext ? `Play next episode of ${item.name}` : `Resume ${item.name}`}
          onClick={(e) => {
            e.stopPropagation();
            resume();
          }}
        >
          <Play size={20} fill="currentColor" />
        </button>
      }
      {...cardMenu(stored, p, upNext ? { onRemoveContinue: () => dismissUpNext([cw]) } : undefined)}
    >
      {/* The logo names the show; an entry of it goes by its own name. */}
      <ArtTitle name={item.name} logo={entry ? undefined : logo} pending={!entry && meta.isLoading} />
      {/* Where you are, on the picture like Apple TV's: a bar and the time left, or Up Next (#38). */}
      <div className="card-resume">
        {upNext ? (
          <span className="card-resume-upnext">Up Next</span>
        ) : (
          <>
            <ProgressBar fraction={fraction} />
            {remaining && <span className="card-resume-left tabular">{remaining}</span>}
          </>
        )}
      </div>
    </Card>
  );
}
