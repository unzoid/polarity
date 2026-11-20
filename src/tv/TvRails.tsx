import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { CardRating } from "../components/ImdbBadge";
import { Img } from "../components/Img";
import { LogoOrName, ProgressBar, useCardArt } from "../components/title/Card";
import { isAnimePreview, useEntryShown, type EntryAt } from "../lib/anime";
import { episodeCode, formatRemaining } from "../lib/format";
import { prefetchMeta, preloadImage, useCatalog, useMeta, useRecommend } from "../lib/net";
import { useUpNextContinueWatching, type ContinueEntry } from "../lib/library";
import { useNavigation } from "../lib/router";
import { cardArtUrl, detailBackdropUrl, useArtGate, useCardIntent } from "../lib/ui";
import { useBrowseShelf, useListable, type Shape, type Shelf } from "../lib/catalog";
import type { MetaPreview, Progress } from "../lib/types";
import { Facts, StageProvider, TvStage, titleFacts, useHasStage, useStage, useStageSeed, useStagedTitle, type StageEntry } from "./TvStage";
import { isMenuKey, openCardMenu } from "./TvCardMenu";
import { refocusNear } from "./spatial";
import { Skeleton } from "../components/ui/Skeleton";

/** Resting on a card this long means interest: fetch its page ahead. Longer than desktop — a held D-pad passes every card. */
const INTENT_MS = 450;

/**
 * How a browse screen lays its rails out (TvBrowse's `layout`). "shelves" (the Library): no stage, every
 * card a poster, the focused one opening out to the title's backdrop, its details under its own row.
 */
const ShelvesLayout = createContext(false);

/**
 * A title on a rail. Focus is the selection, as on any TV: the card lifts,
 * the stage above shows the title, and Enter / A opens it.
 */
export const TvCard = memo(function TvCard({
  item: stored,
  shape,
  artFallbacks,
  progress,
  kicker,
  chip,
  entry,
  watching,
  onOpen,
  localOnly,
  onFocusChange,
  staged,
  stagePending = false,
  logoPending = false,
}: {
  item: MetaPreview;
  shape: Shape;
  /** Pictures to try in turn when the card's own won't load. */
  artFallbacks?: string[];
  progress?: number;
  kicker?: string;
  /** Short label shown on the card itself, e.g. "S2, E4 · 23m left". */
  chip?: string;
  /** The watch progress this card stands for, if it's one video (Continue Watching). */
  entry?: Progress;
  /** The episode being watched (`entry`'s by default): with seasons as separate shows, an anime shows its entry (#22). */
  watching?: string;
  onOpen?: () => void;
  /** Not (yet) one of the app's titles, as with anime from AniList: no page to fetch ahead, no options menu. */
  localOnly?: boolean;
  onFocusChange?: (focused: boolean) => void;
  /** What the stage shows for this card where it isn't the card's own art (the Anime tab's featured row, #325). */
  staged?: MetaPreview;
  /** The stage's art and logo aren't known yet: it shows neither, nor the name for a moment (#343, #431). */
  stagePending?: boolean;
  /** The card's logo isn't known yet: the name waits a moment for it (#343). */
  logoPending?: boolean;
}) {
  const { navigate } = useNavigation();
  const { item, entry: shownEntry } = useEntryShown(stored, watching ?? entry?.videoId);
  const onStage = staged ?? item;
  const stage = useStage();
  const hasStage = useHasStage();
  const seedStage = useStageSeed();
  const shelves = useContext(ShelvesLayout);
  // On the shelves every card is a poster, whatever the rail asked for; focus opens it out (`wide`).
  const look: Shape = shelves ? "poster" : shape;
  // The backdrop is only fetched once the card has had focus: a library can be hundreds of titles.
  const [woke, setWoke] = useState(false);
  const el = useRef<HTMLButtonElement>(null);
  const intent = useCardIntent(() => {
    if (!localOnly) prefetchMeta(item.type, item.id);
    preloadImage(detailBackdropUrl(item.background));
  }, INTENT_MS);
  // Show on the stage until something is focused, if this is the page's first title.
  useEffect(() => {
    if (el.current) seedStage({ item: onStage, kicker, pending: stagePending }, el.current);
    // Again once a placeholder title (a playlist entry still loading) fills in, or better art arrives.
  }, [item.id, onStage.name, onStage.background, onStage.logo, stagePending]);
  // Art that won't load falls back to the title, not an empty frame; better art arriving gets a fresh try.
  const preferred = cardArtUrl(look === "poster" ? (item.poster ?? item.background) : (item.background ?? item.poster), look);
  const sizedFallbacks = useMemo(
    () => artFallbacks?.map((u) => cardArtUrl(u, look)).filter((u): u is string => !!u),
    [artFallbacks, look],
  );
  const { shown: art, onError: onArtError } = useCardArt(preferred);
  // The logo and name wait for the art (#173).
  const gate = useArtGate(art, sizedFallbacks);
  // An anime shown by its entry opens that entry (TvAnimeDetail takes it on to the title's page with just its episodes).
  const open = onOpen ?? (() => navigate(shownEntry ? { name: "anime-detail", id: shownEntry.anilist } : { name: "detail", type: item.type, id: item.id, preview: item }));

  return (
    <button
      ref={el}
      className="tv-card"
      data-shape={look}
      aria-label={item.name}
      onClick={open}
      onFocus={() => {
        if (shelves) setWoke(true);
        stage({ item: onStage, kicker, pending: stagePending });
        onFocusChange?.(true);
        intent.onFocus();
      }}
      onBlur={() => {
        intent.onBlur();
        onFocusChange?.(false);
      }}
      // Options: X / Square on a controller (sent as the Menu key), the Menu key, or a right-click.
      onKeyDown={(e) => {
        if (localOnly || !isMenuKey(e)) return;
        e.preventDefault();
        openCardMenu({ item: stored, entry, anchor: e.currentTarget });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (localOnly) return;
        e.currentTarget.focus({ preventScroll: true });
        openCardMenu({ item: stored, entry, anchor: e.currentTarget });
      }}
    >
      <span className="tv-card-frame" {...gate}>
        {art ? (
          <Img src={art} fallbacks={sizedFallbacks} alt="" className="tv-card-img" onFail={onArtError} />
        ) : (
          <span className="tv-card-fallback">{item.name}</span>
        )}
        {look === "landscape" && art && (
          <>
            <span className="tv-card-scrim art-after" />
            <LogoOrName logo={item.logo} logos={item.logos} pending={logoPending} alt="" logoClass="tv-card-logo" name={<span className="tv-card-name art-after">{item.name}</span>} />
          </>
        )}
        {shelves && <WideArt item={item} awake={woke} localOnly={localOnly} />}
        {chip && <span className="tv-card-chip">{chip}</span>}
        {progress != null && <ProgressBar fraction={progress} />}
        {look === "poster" && <CardRating rating={item.imdbRating} placement="poster" />}
      </span>
      {look === "poster" && <CardRating rating={item.imdbRating} />}
      {!hasStage && look === "poster" && item.name && (
        <span className="tv-card-caption" aria-hidden>
          {item.name}
        </span>
      )}
    </button>
  );
});

/**
 * A shelves card opened out (focused): the title's backdrop and logo across the wider frame, over its poster.
 * Its logo comes from the title's page where the card doesn't carry one (the history only knows the art).
 */
function WideArt({ item, awake, localOnly }: { item: MetaPreview; awake: boolean; localOnly?: boolean }) {
  const meta = useMeta(item.type, item.id, awake && !item.logo && !localOnly && !isAnimePreview(item.id));
  const logo = item.logo ?? meta.data?.logo ?? undefined;
  const logos = item.logos ?? meta.data?.logos;
  const art = cardArtUrl(item.background ?? item.poster, "landscape");
  return (
    <span className="tv-card-wide" aria-hidden>
      {awake && art && <Img src={art} alt="" className="tv-card-img" />}
      <span className="tv-card-scrim" />
      {awake && (
        <LogoOrName logo={logo} logos={logos} pending={meta.isLoading} alt="" logoClass="tv-card-logo" name={<span className="tv-card-name">{item.name}</span>} />
      )}
    </span>
  );
}

/** One horizontal shelf. Its focused card stays pinned to the left edge as it scrolls. */
export function TvRail({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  const shelves = useContext(ShelvesLayout);
  const body = (
    <>
      {title && (
        <h2 className="tv-rail-title">
          {title}
          {note && <span className="tv-rail-note"> · {note}</span>}
        </h2>
      )}
      <div className="tv-rail-track" data-nav-rail>
        {children}
      </div>
    </>
  );
  return (
    <section className="tv-rail" data-nav-row data-nav-memory>
      {/* On the shelves each row is its own stage: its focused title's details sit under it. */}
      {shelves ? <StageProvider render={(entry) => <TvShelfInfo entry={entry} />}>{body}</StageProvider> : body}
    </section>
  );
}

/**
 * Under a shelves row (placed after the cards by CSS): the focused title's facts and synopsis, which a
 * stage shows above the rails elsewhere. Only the row you're on shows it (tv.css).
 */
function TvShelfInfo({ entry }: { entry: StageEntry | null }) {
  const { shown } = useStagedTitle(entry);
  return (
    <div className="tv-shelf-info" aria-live="polite">
      {shown && (
        <div key={shown.id} className="tv-shelf-info-body">
          {entry?.kicker && <p className="tv-stage-kicker">{entry.kicker}</p>}
          <Facts facts={titleFacts(shown)} />
          {shown.description && <p className="tv-shelf-description">{shown.description}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * A shelf still loading. Its first card can take focus, so moving down stops here instead of
 * jumping over it (test report 1, item 20); when the cards arrive, focus moves onto them.
 */
export function TvSkeletonRail({ title, shape, count = 8, note }: { title?: string; shape: Shape; count?: number; note?: string }) {
  const first = useRef<HTMLSpanElement>(null);
  const hasStage = useHasStage();
  const shelves = useContext(ShelvesLayout);
  useLayoutEffect(
    () => () => {
      const el = first.current;
      if (el && document.activeElement === el) refocusNear(el.getBoundingClientRect());
    },
    [],
  );
  return (
    <TvRail title={title} note={note}>
      {Array.from({ length: count }, (_, i) =>
        i === 0 ? (
          <span key={i} ref={first} className="tv-card tv-card-skeleton" data-shape={shape} tabIndex={0} role="img" aria-label="Loading" data-nav-loading>
            <Skeleton as="span" className="tv-card-frame" />
            {!hasStage && !shelves && shape === "poster" && <span className="tv-card-caption" aria-hidden />}
          </span>
        ) : (
          <span key={i} className="tv-card tv-card-skeleton" data-shape={shape} aria-hidden>
            <Skeleton as="span" className="tv-card-frame" />
          </span>
        ),
      )}
    </TvRail>
  );
}

/** `watching`: title id → the episode last watched, for saved anime shown by their entry (#22). */
export function TvItemsRail({
  title,
  items: given,
  shape,
  watching,
  saved,
}: {
  title: string;
  items?: MetaPreview[];
  shape: Shape;
  watching?: ReadonlyMap<string, string>;
  /** The user's own titles: all of them, even ones a catalog's list would leave out (#337). */
  saved?: boolean;
}) {
  const listed = useListable(given);
  const items = saved ? given : listed;
  if (!items) return <TvSkeletonRail title={title} shape={shape} />;
  if (!items.length) return null;
  return (
    <TvRail title={title}>
      {items.map((item) => (
        <TvCard key={item.id} item={item} shape={shape} watching={watching?.get(item.id)} />
      ))}
    </TvRail>
  );
}

/** With fewer fresh titles than this, a shelf shows its full list, repeats and all. */
const MIN_FRESH = 6;

/** A day's shelf (lib/catalog/shelves.ts), fetched once it's close to the focused row. */
export function TvShelfRail({ shelf, enabled, exclude }: { shelf: Shelf; enabled: boolean; exclude: Set<string> }) {
  const isCatalog = shelf.kind === "catalog";
  const catalog = useCatalog(shelf.type, isCatalog ? shelf.id : "", isCatalog ? shelf.genre : undefined, enabled && isCatalog);
  const recommended = useRecommend(shelf.type, isCatalog ? "" : shelf.seed, enabled && !isCatalog);
  const { data: found, isError } = isCatalog ? catalog : recommended;
  // Hidden and watched titles go too, and a shelf they leave short loads more (lib/catalog/browseFilter.ts).
  const data = useBrowseShelf(found, isCatalog ? { type: shelf.type, id: shelf.id, genre: shelf.genre } : undefined);
  const items = useMemo(() => {
    if (!data) return undefined;
    const fresh = data.filter((m) => !exclude.has(m.id));
    return fresh.length >= MIN_FRESH || shelf.kind === "because" ? fresh : data;
  }, [data, exclude, shelf.kind]);

  if (isError) return null;
  if (shelf.kind === "because" && items && items.length < 4) return null;
  return <TvItemsRail title={shelf.title} items={items} shape={shelf.shape} />;
}

/** Pick up where you left off: straight into the player, no detour. */
export function TvContinueRail() {
  const entries = useUpNextContinueWatching();
  if (!entries.length) return null;
  return (
    <TvRail title="Continue Watching">
      {entries.map((cw) => (
        <TvContinueCard key={cw.progress.videoId} cw={cw} />
      ))}
    </TvRail>
  );
}

/**
 * With seasons as separate shows, an anime's episode goes by its number in its entry (#22). The title's logo over the
 * art, as desktop's Continue Watching (#437): the title page's logos, checked by `TitleLogo`; nothing in its place while
 * the title loads (#343), the name where there's none. An entry of a show goes by its own name.
 */
function TvContinueCard({ cw }: { cw: ContinueEntry }) {
  const { progress: p, upNext } = cw;
  const { navigate } = useNavigation();
  const plain = useMemo(() => continueItem(p), [p]);
  const { entry } = useEntryShown(plain, p.videoId);
  const meta = useMeta(p.type, p.metaId, !entry);
  const stored = useMemo(
    () => (entry || !meta.data ? plain : { ...plain, logo: meta.data.logo ?? undefined, logos: meta.data.logos }),
    [plain, entry, meta.data],
  );
  return (
    <TvCard
      item={stored}
      logoPending={!entry && meta.isLoading}
      shape="landscape"
      progress={!upNext && p.duration ? p.position / p.duration : undefined}
      kicker={continueKicker(p, entry, upNext)}
      chip={continueChip(p, entry, upNext)}
      entry={p}
      onOpen={() => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId })}
    />
  );
}

const continueItem = (p: Progress): MetaPreview => ({
  id: p.metaId,
  type: p.type,
  name: p.name,
  background: p.background,
  poster: p.poster,
});

const episodeOf = (p: Progress, entry?: EntryAt) => (entry ? `Episode ${entry.number}` : p.season != null ? episodeCode(p.season, p.episode) : null);

/** The short form for the card itself: episode code (shows only) and time left (or Up Next). */
function continueChip(p: Progress, entry?: EntryAt, upNext?: boolean) {
  return [episodeOf(p, entry), upNext ? "Up Next" : formatRemaining(p.position, p.duration)].filter(Boolean).join(" · ");
}

function continueKicker(p: Progress, entry?: EntryAt, upNext?: boolean) {
  const episode = episodeOf(p, entry);
  const where = episode ? `${episode}${p.episodeTitle ? ` · ${p.episodeTitle}` : ""}` : null;
  return [upNext ? "Up Next" : null, where, upNext ? null : formatRemaining(p.position, p.duration)].filter(Boolean).join(" · ");
}

/** Rows ahead of the focused one that load in advance, so moving down never waits. */
const LOOKAHEAD = 3;

export interface RailRow {
  key: string;
  render: (near: boolean) => ReactNode;
}

/**
 * One row of a browse screen. Moving to another row re-renders only the rows whose `near` changes,
 * not every shelf and card on the page each step of a held direction (#36).
 */
const BrowseRow = memo(function BrowseRow({ row, near }: { row: RailRow; near: boolean }) {
  return row.render(near);
});

/**
 * A browse screen: the stage on top, rails below. The focused rail always
 * sits at the same height just under the stage — moving down slides the
 * rails up rather than moving your eye down the screen.
 *
 * `layout="shelves"` (the Library): no stage and no colour from the art, just rows on black under the
 * navbar; the focused row sits at the top with its focused title's details under it (ShelvesLayout).
 */
export function TvBrowse({ rows, layout = "stage" }: { rows: RailRow[]; layout?: "stage" | "shelves" }) {
  const [maxRow, setMaxRow] = useState(0);
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!row) return;
    const idx = Number(row.dataset.row);
    setMaxRow((m) => (idx > m ? idx : m));
  };
  const rails = (
    <div className="tv-rails" data-nav-scroll="start" onFocus={onFocus}>
      {rows.map((r, i) => (
        <div key={r.key} data-row={i}>
          <BrowseRow row={r} near={i <= maxRow + LOOKAHEAD} />
        </div>
      ))}
    </div>
  );
  return (
    <div className="tv-browse" data-layout={layout}>
      {layout === "shelves" ? (
        <ShelvesLayout.Provider value>{rails}</ShelvesLayout.Provider>
      ) : (
        <StageProvider render={(entry) => <TvStage entry={entry} />}>{rails}</StageProvider>
      )}
    </div>
  );
}
