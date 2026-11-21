import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Close, Filters, Play, Shuffle } from "../components/icons";
import { Img } from "../components/Img";
import { PosterCard } from "../components/PosterCard";
import { RatingRing } from "../components/RatingRing";
import { LibraryButton } from "../components/title/LibraryButton";
import { PosterGrid } from "../components/title/PosterGrid";
import { AgeRatingBadge } from "../components/title/TitleDetails";
import { Segmented } from "../components/Segmented";
import { Dropdown } from "../components/Dropdown";
import { Button } from "../components/ui/Button";
import { api } from "../lib/api";
import {
  BROWSE_GENRES,
  browsable,
  catalogBound,
  catalogExtra,
  catalogItems,
  catalogKey,
  catalogTitle,
  keepWithinLimit,
  pickForMe,
  useAddonCatalogs,
  useBrowseVisible,
  useListable,
  useTasteProfile,
  useViewingLimit,
} from "../lib/catalog";
import { joinFacts } from "../lib/format";
import type { ContentType, MetaPreview } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";
import { keys, useContinueWatching, useWatchHistory } from "../lib/net";
import { useNavigation } from "../lib/router";
import { detailBackdropUrl, useFormFactor } from "../lib/ui";

const NARROW_DISCOVER_QUERY = "(max-width: 920px)";

function subscribeNarrowDiscover(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(NARROW_DISCOVER_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function readNarrowDiscover() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(NARROW_DISCOVER_QUERY).matches
    : false;
}

export const CATALOGS = [
  { id: "trending", label: "Trending" },
  { id: "popular", label: "Popular" },
  { id: "top_rated", label: "Top Rated" },
  { id: "new", label: "New" },
  { id: "gems", label: "Hidden Gems" },
  { id: "classics", label: "Classics" },
];

type Era = "" | "2020s" | "2010s" | "2000s" | "classic";
const ERAS: { value: Era; label: string }[] = [
  { value: "", label: "Any Era" },
  { value: "2020s", label: "2020s" },
  { value: "2010s", label: "2010s" },
  { value: "2000s", label: "2000s" },
  { value: "classic", label: "Pre-2000" },
];

type MinRating = "" | "7" | "8";
const RATINGS: { value: MinRating; label: string }[] = [
  { value: "", label: "Any Rating" },
  { value: "7", label: "7.0+" },
  { value: "8", label: "8.0+" },
];

function releaseYearOf(item: MetaPreview): number | undefined {
  const m = item.releaseInfo?.match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
}

function matchesEra(item: MetaPreview, era: Era): boolean {
  if (!era) return true;
  const y = releaseYearOf(item);
  if (y == null) return false;
  if (era === "2020s") return y >= 2020;
  if (era === "2010s") return y >= 2010 && y <= 2019;
  if (era === "2000s") return y >= 2000 && y <= 2009;
  return y < 2000;
}

function matchesRating(item: MetaPreview, minRating: MinRating): boolean {
  if (!minRating) return true;
  const r = Number.parseFloat(item.imdbRating ?? "");
  return Number.isFinite(r) && r >= Number(minRating);
}

/**
 * `catalog` and `genre`: where it opens (a Home shelf's heading opens its own list, #48). With `addon`, `catalog` is
 * one of that add-on's (#206): the List menu picks between Polarity's catalogs and the add-ons' that can be browsed,
 * whose genres are their own and whose pages follow `skip` when they declare it.
 */
export function Discover({
  type,
  catalog: initialCatalog,
  genre: initialGenre,
  addon: initialAddon,
}: {
  type: ContentType;
  catalog?: string;
  genre?: string;
  addon?: string;
}) {
  const phone = useFormFactor().form === "phone";
  const narrow = useSyncExternalStore(subscribeNarrowDiscover, readNarrowDiscover, () => false);
  const { navigate } = useNavigation();
  const {
    own,
    lists,
    list,
    setList,
    catalog,
    setCatalog,
    genres,
    genre,
    setGenre,
    era,
    setEra,
    minRating,
    setMinRating,
    filtersOpen,
    setFiltersOpen,
    query,
    items,
    refinedCount,
    hasFilters,
    resetFilters,
    surprise,
    empty,
    catalogLabel,
    spotlight,
    gridItems,
  } = useDiscover({ type, catalog: initialCatalog, genre: initialGenre, addon: initialAddon });

  return (
    <div className="scroll">
      <header className="screen-header discover-header">
        {/* The selected tab already says which this is; the heading stays for screen readers. */}
        <h1 className="discover-title">{type === "movie" ? "Movies" : "Series"}</h1>
        <div className="discover-top">
          <div className="discover-primary">
            {!!lists.length && (
              <Dropdown
                label="List"
                value={own ? list : ""}
                onChange={setList}
                options={[{ value: "", label: "Polarity" }, ...lists.map((c) => ({ value: catalogKey(c), label: catalogTitle(c) }))]}
              />
            )}
            {!own &&
              (phone || narrow ? (
                <Dropdown label="Catalog" value={catalog} onChange={setCatalog} options={CATALOGS.map((c) => ({ value: c.id, label: c.label }))} />
              ) : (
                <Segmented options={CATALOGS} value={catalog} onChange={setCatalog} label="Catalog" />
              ))}
          </div>
          <div className="discover-tools">
            {!own && (
              <button
                type="button"
                className="discover-tool-btn pressable"
                aria-expanded={filtersOpen}
                data-active={filtersOpen || refinedCount > 0 || undefined}
                onClick={() => setFiltersOpen((o) => !o)}
              >
                <Filters size={14} />
                <span>Filters</span>
                {refinedCount > 0 && <span className="discover-tool-count tabular">{refinedCount}</span>}
              </button>
            )}
            {items.length > 0 && (
              <button
                type="button"
                className="discover-tool-btn pressable"
                onClick={surprise}
                title="Pick an unwatched title from this view"
              >
                <Shuffle size={14} />
                <span>Surprise Me</span>
              </button>
            )}
          </div>
        </div>

        {/* One-click genre pill rail: browse genres immediately without hunting through dropdown menus. */}
        {genres.length > 0 && (
          <div className="discover-genres" role="group" aria-label="Filter by genre">
            {!own?.genreRequired && (
              <button
                type="button"
                className="discover-genre-pill pressable"
                aria-pressed={!genre}
                onClick={() => setGenre(undefined)}
              >
                All
              </button>
            )}
            {genres.map((g) => (
              <button
                key={g}
                type="button"
                className="discover-genre-pill pressable"
                aria-pressed={genre === g}
                onClick={() => setGenre(genre === g && !own?.genreRequired ? undefined : g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        {/* Inline 1-click Era & Rating refinement tray when Filters is open. */}
        {!own && filtersOpen && (
          <div className="discover-filter-tray" role="region" aria-label="Refine results">
            <div className="discover-filter-group">
              <span className="discover-filter-label">Era</span>
              <div className="discover-filter-pills" role="group" aria-label="Era">
                {ERAS.map((opt) => (
                  <button
                    key={opt.value || "any"}
                    type="button"
                    className="discover-filter-pill pressable"
                    aria-pressed={era === opt.value}
                    onClick={() => setEra(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="discover-filter-group">
              <span className="discover-filter-label">Rating</span>
              <div className="discover-filter-pills" role="group" aria-label="Minimum rating">
                {RATINGS.map((opt) => (
                  <button
                    key={opt.value || "any"}
                    type="button"
                    className="discover-filter-pill pressable"
                    aria-pressed={minRating === opt.value}
                    onClick={() => setMinRating(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {hasFilters && (
              <button type="button" className="discover-filter-reset" onClick={resetFilters}>
                Reset all
              </button>
            )}
          </div>
        )}

        {/* When the tray is closed, show active Era / Rating chips so filters are always visible and 1-click removable. */}
        {!own && !filtersOpen && refinedCount > 0 && (
          <div className="discover-active-bar">
            {era && (
              <button type="button" className="discover-active-chip pressable" onClick={() => setEra("")}>
                {ERAS.find((e) => e.value === era)?.label} <Close size={12} />
              </button>
            )}
            {minRating && (
              <button type="button" className="discover-active-chip pressable" onClick={() => setMinRating("")}>
                {RATINGS.find((r) => r.value === minRating)?.label} Rated <Close size={12} />
              </button>
            )}
            <button type="button" className="discover-filter-reset" onClick={resetFilters}>
              Clear all
            </button>
          </div>
        )}
      </header>

      {spotlight && (
        <DiscoverSpotlight
          item={spotlight}
          kicker={genre ? `#1 in ${genre} · ${catalogLabel}` : `#1 in ${catalogLabel}`}
          phone={phone}
          onOpen={() => navigate({ name: "detail", type: spotlight.type, id: spotlight.id, preview: spotlight })}
        />
      )}

      <PosterGrid pager={query} stale={query.isPlaceholderData}>
        {gridItems.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </PosterGrid>
      {empty && (
        <EmptyState action={hasFilters ? { label: "Reset Filters", onClick: resetFilters } : undefined}>
          {hasFilters
            ? "No titles match these filters."
            : `No ${type === "movie" ? "movies" : "series"} in this list right now.`}
        </EmptyState>
      )}
      {query.isError && (
        <EmptyState>{own ? `${own.addonName} didn't send this list. Try again later.` : "Couldn't load this catalog. Check your connection."}</EmptyState>
      )}
    </div>
  );
}

/**
 * What a Discover view shows, for any layout of it (this page and the phone shell's section page): Polarity's
 * catalogs or one of an add-on's, a genre, the Era and Rating narrow-downs, its titles page by page, the spotlight
 * at its top and the grid under it.
 */
export function useDiscover({
  type,
  catalog: initialCatalog,
  genre: initialGenre,
  addon: initialAddon,
}: {
  type: ContentType;
  catalog?: string;
  genre?: string;
  addon?: string;
}) {
  const viewing = useViewingLimit();
  const { navigate } = useNavigation();
  const taste = useTasteProfile();
  const { data: watching } = useContinueWatching();
  const { data: history } = useWatchHistory();
  const [catalog, setCatalog] = useState(() => (CATALOGS.some((c) => c.id === initialCatalog) ? initialCatalog! : "trending"));
  const [picked, setGenre] = useState(initialGenre);
  const [era, setEra] = useState<Era>("");
  const [minRating, setMinRating] = useState<MinRating>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const lists = useAddonCatalogs().filter((c) => c.type === type && browsable(c));
  const [list, setList] = useState(() => (initialAddon && initialCatalog ? catalogKey({ addon: initialAddon, type, id: initialCatalog }) : ""));
  // Movies and Series share this screen: a list or genre from one may not exist in the other.
  const own = lists.find((c) => catalogKey(c) === list);
  const genres = own ? own.genres : BROWSE_GENRES[type];
  const genre = picked && genres.includes(picked) ? picked : own?.genreRequired ? own.genres[0] : undefined;

  const query = useInfiniteQuery({
    queryKey: own ? keys.addonCatalogPages(own.addon, type, own.id, genre) : keys.discover(type, catalog, genre),
    queryFn: ({ pageParam }) =>
      own ? api.addonCatalog(own.addon, type, own.id, catalogExtra(own, { genre, skip: pageParam })) : api.catalog(type, catalog, pageParam, genre, catalogBound(type)),
    initialPageParam: 0,
    // An add-on without `skip` answers with its whole list; one that ignores `skip` would repeat its page forever.
    getNextPageParam: (last: MetaPreview[], pages) => {
      if (!last.length || (own && !own.pages)) return undefined;
      const before = new Set(pages.slice(0, -1).flat().map((m) => m.id));
      return last.some((m) => !before.has(m.id)) ? pages.flat().length : undefined;
    },
    // Switching catalogs quickly: keep the last grid up (dimmed) instead of
    // collapsing to skeletons and back, which jolts the page each time.
    placeholderData: keepPreviousData,
  });

  // Dedupe across pages — upstream catalogs occasionally repeat items.
  const seen = new Set<string>();
  // Titles over the profile's viewing limit stay out; pages are still counted whole for `skip`.
  const all = keepWithinLimit(query.data?.pages.flat() ?? [], viewing);
  // Nothing to play and nothing to show (#337) stays out.
  // Hidden titles too, and watched ones when asked (lib/catalog/browseFilter.ts); the grid's pager fills a short page.
  const visibleItems = useBrowseVisible(useListable(own ? catalogItems(own, all) : all.filter((m) => !seen.has(m.id) && seen.add(m.id))));
  const baseItems = visibleItems ?? [];
  const items = useMemo(
    () => (era || minRating ? baseItems.filter((m) => matchesEra(m, era) && matchesRating(m, minRating)) : baseItems),
    [baseItems, era, minRating],
  );
  const watchedIds = useMemo(
    () => new Set([...(watching ?? []).map((p) => p.metaId), ...(history ?? []).map((p) => p.metaId)]),
    [watching, history],
  );
  const refinedCount = (era ? 1 : 0) + (minRating ? 1 : 0);
  const hasFilters = !!genre || refinedCount > 0 || !!own;
  const resetFilters = () => {
    setList("");
    setGenre(undefined);
    setEra("");
    setMinRating("");
    setCatalog("trending");
    setFiltersOpen(false);
  };
  const surprise = () => {
    const chosen = pickForMe(items, watchedIds, taste);
    if (chosen) navigate({ name: "detail", type: chosen.type, id: chosen.id, preview: chosen });
  };
  const empty =
    !query.isPending &&
    !query.isFetchingNextPage &&
    !query.isError &&
    visibleItems !== undefined &&
    items.length === 0 &&
    (!query.hasNextPage || refinedCount > 0);

  // Editorial spotlight at the top of Discovery when browsing cleanly (no Era/Rating narrow-down or add-on list).
  const catalogLabel = CATALOGS.find((c) => c.id === catalog)?.label ?? "Trending";
  const spotlight = useMemo(() => {
    if (own || refinedCount > 0 || items.length < 4) return null;
    return items.find((m) => !!m.background) ?? null;
  }, [own, refinedCount, items]);
  const gridItems = useMemo(
    () => (spotlight ? items.filter((m) => m.id !== spotlight.id) : items),
    [items, spotlight],
  );

  return {
    own,
    lists,
    list,
    setList,
    catalog,
    setCatalog,
    genres,
    genre,
    setGenre,
    era,
    setEra,
    minRating,
    setMinRating,
    filtersOpen,
    setFiltersOpen,
    query,
    items,
    refinedCount,
    hasFilters,
    resetFilters,
    surprise,
    empty,
    catalogLabel,
    spotlight,
    gridItems,
  };
}

/** Compact editorial spotlight banner giving Discover a real curated presence above the grid. */
function DiscoverSpotlight({
  item,
  kicker,
  phone,
  onOpen,
}: {
  item: MetaPreview;
  kicker: string;
  phone: boolean;
  onOpen: () => void;
}) {
  const bg = detailBackdropUrl(item.background, phone);
  const facts = joinFacts([item.releaseInfo, ...(item.genres?.slice(0, 2) ?? [])]);
  return (
    <section
      className="discover-spotlight scheme-dark"
      aria-label={`Featured: ${item.name}`}
      onClick={(e) => {
        if (!(e.target as Element).closest("button, a")) onOpen();
      }}
    >
      {bg && <Img src={bg} alt="" loading="eager" className="discover-spotlight-bg" />}
      <div className="discover-spotlight-scrim" aria-hidden />
      <div className="discover-spotlight-body">
        <span className="discover-spotlight-kicker">{kicker}</span>
        <h2 className="discover-spotlight-title">{item.name}</h2>
        <p className="discover-spotlight-meta t-callout tabular">
          {item.imdbRating && <RatingRing value={item.imdbRating} imdbId={item.id} />}
          {facts && <span>{facts}</span>}
          <AgeRatingBadge certification={item.certification} />
        </p>
        {item.description && <p className="discover-spotlight-desc t-body">{item.description}</p>}
        <div className="discover-spotlight-actions">
          <Button variant="primary" size="sm" onClick={onOpen}>
            <Play size={15} fill="currentColor" /> Watch Now
          </Button>
          <LibraryButton item={item} />
        </div>
      </div>
    </section>
  );
}
