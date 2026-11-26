import "../styles/screens.css";
import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cardArtUrl } from "../lib/ui";
import { Img } from "../components/Img";
import { PosterCard } from "../components/PosterCard";
import { Segmented } from "../components/Segmented";
import { Shelf } from "../components/title/Shelf";
import { animeItemToPreview, useAnimeGenreArt, useAnimeSearchCatalog, withoutAnimeItems } from "../lib/anime";
import { api } from "../lib/api";
import {
  addRecentSearch,
  applySmartFilters,
  catalogKey,
  catalogTitle,
  clearRecentSearches,
  FOCUS_SEARCH_EVENT,
  genreOf,
  parseSmartQuery,
  SEARCH_ANIME,
  SEARCH_GENRES,
  searchMinLength,
  searchRows,
  trendingPicks,
  type SearchRow,
  setSearchText,
  useAddonSearches,
  useRecentSearches,
  useListable,
  useSearchText,
  useTrending,
  catalogBound,
  keepWithinLimit,
  useViewingLimit,
} from "../lib/catalog";
import { usePrefs } from "../lib/settings";
import { useRouter, useNavigation } from "../lib/router";
import { useFormFactor, useTogether } from "../lib/ui";
import { keys, useSearch } from "../lib/net";
import type { AnimeItem, ContentType, MetaPreview, PersonHit } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchField } from "../components/ui/SearchField";
import { Search as SearchIcon } from "../components/icons";
import { initialsOf } from "./Person";

/**
 * Results for whatever is typed, one row per kind so movies, series and anime all show without scrolling. A
 * search that names a genre ("horror") leads with that genre's titles; one that names an anime genre alone
 * ("isekai") leads with its anime (`searchRows`). Add-ons whose catalogs take a search
 * follow, a row each (#206).
 *
 * On a desktop or tablet the field is the navbar's. On a phone this is a page of its own, as in phone apps: a
 * title, the field, and with nothing typed your recent searches and genres to start from.
 */
export function Search() {
  const text = useSearchText().trim();
  const { animeEnabled } = usePrefs();
  const alone = useRouter().stack.length === 1;
  const phone = useFormFactor().form === "phone";

  return (
    <div className="scroll search-page" data-phone={phone || undefined}>
      {phone && <SearchHeader />}
      {!text ? (
        phone ? (
          <SearchStart />
        ) : (
          // The stack's root with nothing typed yet: say what the field above is for.
          alone && <EmptyState>{animeEnabled ? "Search for movies, series and anime." : "Search for movies and series."}</EmptyState>
        )
      ) : text.length < searchMinLength(text) ? (
        // One Latin letter matches half the catalog: ask for another rather than show an empty page.
        <EmptyState>Type another letter to search.</EmptyState>
      ) : (
        <Results text={text} />
      )}
    </div>
  );
}

/** The phone's field (its large title is the top bar's: NavBar). The field is the page's own, so leaving the page empties it. */
function SearchHeader() {
  const text = useSearchText();
  const { animeEnabled } = usePrefs();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => setSearchText(""), []);

  // The navbar's search icon and Ctrl K, while this page shows: back to the top, into the field.
  useEffect(() => {
    const onFocus = () => {
      const el = input.current;
      if (!el?.closest('.page[data-active="true"]')) return; // a page under a title opened from here
      el.closest(".scroll")?.scrollTo({ top: 0, behavior: "smooth" });
      el.focus({ preventScroll: true });
      el.select();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, onFocus);
  }, []);

  return (
    <header className="search-head">
      <SearchField
        ref={input}
        look="large"
        label="Search"
        value={text}
        onChange={setSearchText}
        placeholder={animeEnabled ? "Movies, series and anime" : "Movies and series"}
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          addRecentSearch(text);
          e.currentTarget.blur(); // the keyboard goes, the results show
        }}
      />
    </header>
  );
}

/** Nothing typed on the phone's page: your last searches, then genres as tiles, one tap from their titles. */
export function SearchStart() {
  const { animeEnabled } = usePrefs();
  const recent = useRecentSearches();
  const { data: animeArt, isPending: animeArtPending } = useAnimeGenreArt(SEARCH_ANIME, animeEnabled);
  // The tiles come in as one, pictures and colours together (lib/ui/together.ts), not colour first and a
  // picture here and there after.
  const together = useTogether();
  return (
    <div className="search-start" {...together}>
      {recent.length > 0 && (
        <section className="search-start-section">
          <div className="search-start-head">
            <h2 className="t-title2">Recent</h2>
            <button className="search-start-clear" onClick={clearRecentSearches}>
              Clear
            </button>
          </div>
          <div className="search-start-recent">
            {recent.map((r) => (
              <button key={r} className="search-recent-item" onClick={() => setSearchText(r)}>
                <SearchIcon size={18} aria-hidden />
                <span>{r}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="search-start-section">
        <h2 className="t-title2">Genres</h2>
        <div className="genre-tiles">
          {SEARCH_GENRES.map((g) => (
            <MovieGenreTile key={g} genre={g} />
          ))}
        </div>
      </section>
      {animeEnabled && (
        <section className="search-start-section">
          <h2 className="t-title2">Anime</h2>
          <div className="genre-tiles">
            {SEARCH_ANIME.map((g) => (
              <GenreTile key={g} genre={g} image={animeArt?.[g]} pending={animeArtPending} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Each tile's two hues, as Apple TV's genre tiles: the picture's light parts take the first, shading across to the
 * second, and its shadows a deep shade of the second, so every tile is a pair of opposing colours of its own.
 */
const TILE_HUES: Record<string, [number, number]> = {
  Action: [32, 345],
  Comedy: [95, 185],
  Drama: [200, 250],
  Horror: [0, 285],
  "Sci-Fi": [175, 225],
  Thriller: [280, 210],
  Romance: [330, 15],
  Documentary: [140, 45],
  Isekai: [195, 300],
  Shounen: [20, 50],
  "Slice of Life": [85, 330],
  Mecha: [220, 165],
  Iyashikei: [160, 95],
  Psychological: [265, 320],
};

/**
 * A movie genre's tile: the backdrop of its most popular movie, from the same request the genre's results lead
 * with, so a tap finds them already loaded.
 */
function MovieGenreTile({ genre }: { genre: string }) {
  const { data, isPending } = useGenreRow("movie", genre);
  return <GenreTile genre={genre} image={cardArtUrl(data?.find((m) => m.background)?.background, "landscape")} pending={isPending} />;
}

/**
 * A genre to search by: its name over its picture in the genre's two colours. Until its picture is in (and the
 * set's, screens.css) it's a placeholder; a genre with no picture to be had shows its two colours alone.
 */
function GenreTile({ genre, image, pending }: { genre: string; image?: string; pending: boolean }) {
  const [loaded, setLoaded] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const [a, b] = TILE_HUES[genre] ?? [220, 280];
  const art = image && failed !== image ? (loaded === image ? "ready" : "loading") : pending ? "loading" : "none";
  return (
    <button className="genre-tile pressable" data-art={art} style={{ "--tile-a": a, "--tile-b": b } as CSSProperties} onClick={() => setSearchText(genre)}>
      {image && failed !== image && (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          data-loaded={loaded === image}
          onLoad={() => setLoaded(image)}
          onError={() => setFailed(image)}
        />
      )}
      <span>{genre}</span>
    </button>
  );
}

function useGenreRow(type: ContentType, genre: string, enabled = true) {
  const viewing = useViewingLimit();
  return useQuery({
    queryKey: keys.genreRow(type, genre),
    queryFn: () => api.catalog(type, "popular", 0, genre, catalogBound(type)),
    staleTime: 30 * 60_000,
    enabled,
    select: useCallback((list: MetaPreview[]) => keepWithinLimit(list, viewing), [viewing]),
  });
}

type SearchFilter = "all" | "movies" | "series" | "people" | "anime";

function Results({ text }: { text: string }) {
  const [query, setQuery] = useState(text);
  const deferred = useDeferredValue(query);

  // Keystrokes update the field instantly; the network and result shelves wait for a pause.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), 180);
    return () => window.clearTimeout(t);
  }, [text]);

  return <ResultsBody query={deferred} typing={text !== deferred} />;
}

const ResultsBody = memo(function ResultsBody({ query: deferred, typing }: { query: string; typing: boolean }) {
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [dismissedChips, setDismissedChips] = useState<Set<string>>(() => new Set());
  const { animeEnabled } = usePrefs();
  const { navigate } = useNavigation();
  useEffect(() => {
    setFilter("all");
    setDismissedChips(new Set());
  }, [deferred]);

  const parsed = useMemo(() => parseSmartQuery(deferred), [deferred]);
  const activeChips = useMemo(
    () => parsed.chips.filter((c) => !dismissedChips.has(c.id)),
    [parsed.chips, dismissedChips],
  );
  // When smart chips are active and literal text remains, search the cleaned text; otherwise search the raw query.
  const effectiveQuery = activeChips.length > 0 && parsed.textQuery.length >= searchMinLength(parsed.textQuery) ? parsed.textQuery : deferred;
  const activeTypeChip = activeChips.find((c) => c.kind === "type")?.mediaType;
  const activeGenreChip = activeChips.find((c) => c.kind === "genre")?.genre;

  const { data, isPlaceholderData, isError, refetch } = useSearch(effectiveQuery);
  const hasQuery = deferred.length >= searchMinLength(deferred);
  const genre = hasQuery ? (genreOf(deferred) ?? activeGenreChip) : undefined;
  // Show-first anime search backed by Rust/Jikan (zero AniList calls).
  const anime = useAnimeSearchCatalog(animeEnabled && hasQuery ? effectiveQuery : "");
  const fromAddons = useAddonSearches(hasQuery ? effectiveQuery : "");
  const viewing = useViewingLimit();

  // An anime shows once, in the Anime row, not duplicated in Movies or Series.
  const movies = useMemo(
    () => applySmartFilters(withoutAnimeItems(data?.movies, anime.items), parsed, dismissedChips),
    [data?.movies, anime.items, parsed, dismissedChips],
  );
  const series = useMemo(
    () => applySmartFilters(withoutAnimeItems(data?.series, anime.items), parsed, dismissedChips),
    [data?.series, anime.items, parsed, dismissedChips],
  );
  const people = data?.people ?? [];
  const waiting = !hasQuery || (!data && !isError);
  const stale = !waiting && !isError && (typing || isPlaceholderData);
  const mainIds = useMemo(
    () => new Set([...(movies ?? []).map((m) => m.id), ...(series ?? []).map((s) => s.id)]),
    [movies, series],
  );
  const dedupedAddons = useMemo(
    () =>
      fromAddons.map((r) => ({
        ...r,
        items: r.items ? keepWithinLimit(r.items, viewing).filter((m) => !mainIds.has(m.id)) : undefined,
      })),
    [fromAddons, viewing, mainIds],
  );
  const addonsBusy = dedupedAddons.some((r) => !r.items && !r.failed);
  const addonsFound = dedupedAddons.some((r) => r.items?.length);

  const filterOptions = useMemo(() => {
    const opts: { id: SearchFilter; label: string }[] = [{ id: "all", label: "All" }];
    if (movies?.length || (genre && filter === "movies")) opts.push({ id: "movies", label: "Movies" });
    if (series?.length || (genre && filter === "series")) opts.push({ id: "series", label: "Series" });
    if (people.length) opts.push({ id: "people", label: "People" });
    if (animeEnabled && anime.items?.length) opts.push({ id: "anime", label: "Anime" });
    return opts;
  }, [movies?.length, series?.length, people.length, animeEnabled, anime.items?.length, genre, filter]);

  const effectiveFilter: SearchFilter =
    filter !== "all"
      ? filter
      : activeTypeChip === "movie"
        ? "movies"
        : activeTypeChip === "series"
          ? "series"
          : activeTypeChip === "anime"
            ? "anime"
            : "all";

  const showRow = (row: SearchRow) => {
    if (effectiveFilter === "all") return true;
    if (effectiveFilter === "movies") return row === "movies" || row === "movieGenre";
    if (effectiveFilter === "series") return row === "series" || row === "seriesGenre";
    if (effectiveFilter === "anime") return row === "anime";
    return false;
  };
  const rows: Record<SearchRow, ReactNode> = {
    movieGenre: genre && <GenreRow key="movieGenre" type="movie" genre={genre} />,
    seriesGenre: genre && <GenreRow key="seriesGenre" type="series" genre={genre} />,
    movies: !isError && <ResultRow key="movies" title={genre ? "Movies Named Like It" : "Movies"} items={waiting ? undefined : movies} />,
    series: !isError && <ResultRow key="series" title={genre ? "Series Named Like It" : "Series"} items={waiting ? undefined : series} />,
    anime: animeEnabled && (
      <AnimeRow
        key="anime"
        title={anime.title}
        items={anime.items}
        loading={anime.loading}
        failed={anime.failed}
        retry={anime.retry}
        // A genre or kind of show: the heading opens it in Anime → Browse.
        onOpen={anime.browse && (() => navigate({ name: "anime-browse", ...anime.browse }))}
      />
    ),
  };
  const nothing =
    !waiting &&
    !stale &&
    !isError &&
    !genre &&
    !(movies?.length) &&
    !(series?.length) &&
    !people.length &&
    !anime.items?.length &&
    !anime.loading &&
    !addonsBusy &&
    !addonsFound;

  return (
    <>
      {activeChips.length > 0 && (
        <div className="search-filters" role="group" aria-label="Detected search filters">
          {activeChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="search-recent-item"
              onClick={() => setDismissedChips((prev) => new Set(prev).add(chip.id))}
              title={`Remove filter "${chip.label}" and search literally`}
            >
              <span>{chip.label}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
      {filterOptions.length > 2 && (
        <div className="search-filters">
          <Segmented label="Filter results" options={filterOptions} value={filter} onChange={setFilter} />
        </div>
      )}
      {isError && (
        <EmptyState action={{ label: "Try Again", onClick: () => void refetch() }}>
          Couldn't load search results. Check your connection and try again.
        </EmptyState>
      )}
      {/* Opening a result counts as running the search (Recent, in the search field). */}
      <div
        className="rows search-rows"
        data-stale={stale || undefined}
        onClickCapture={(e) => (e.target as HTMLElement).closest(".card, .search-person-card") && addRecentSearch(deferred)}
      >
        {searchRows(genre, !!anime.genre)
          .filter(showRow)
          .map((row) => rows[row])}
        {!isError && people.length > 0 && (filter === "all" || filter === "people") && <PeopleRow people={people} />}
        {/* A failing add-on leaves its row out; Polarity's results above never wait for one. */}
        {filter === "all" &&
          dedupedAddons.map(
            (r) => !r.failed && <ResultRow key={catalogKey(r.catalog)} title={catalogTitle(r.catalog)} items={r.items} />,
          )}
      </div>
      {nothing && (
        <>
          <EmptyState>Nothing found for “{deferred}”.</EmptyState>
          <TrendingRecovery />
        </>
      )}
    </>
  );
});

function PeopleRow({ people }: { people: PersonHit[] }) {
  const { navigate } = useRouter();
  return (
    <Shelf
      title="People"
      items={people}
      card={(p) => (
        <button key={p.id} className="search-person-card pressable" onClick={() => navigate({ name: "person", id: p.id, title: p.name })}>
          <span className="search-person-photo">
            {p.photo ? <Img src={p.photo} alt="" /> : <span aria-hidden>{initialsOf(p.name)}</span>}
          </span>
          <span className="search-person-name">{p.name}</span>
          {p.knownFor && <span className="search-person-role">{p.knownFor}</span>}
        </button>
      )}
    />
  );
}

/** Recovery shelf when a search returns zero hits so the user never hits a dead end. */
function TrendingRecovery() {
  const trending = useTrending();
  const picks = useMemo(() => trendingPicks(trending.series, trending.movies, [], 14), [trending.series, trending.movies]);
  if (!picks.length) return null;
  return (
    <div className="rows search-recovery">
      <ResultRow title="Trending Right Now" items={picks} />
    </div>
  );
}

function GenreRow({ type, genre }: { type: ContentType; genre: string }) {
  const { data } = useGenreRow(type, genre);
  const { navigate } = useNavigation();
  // The heading opens the genre's whole list in Movies or Series.
  return (
    <ResultRow
      title={`Popular ${genre} ${type === "movie" ? "Movies" : "Series"}`}
      items={data}
      onOpen={() => navigate({ name: "discover", type, genre })}
    />
  );
}

/** Leaves out what can't play and has nothing to show (#337): a stub whose poster and backdrop don't load. */
function ResultRow({ title, items: found, onOpen }: { title: string; items?: MetaPreview[]; onOpen?: () => void }) {
  const items = useListable(found);
  if (items && !items.length) return null;
  return <Shelf title={title} onOpen={onOpen} items={items} card={(item) => <PosterCard key={item.id} item={item} />} />;
}

function AnimeRow({
  title,
  items,
  loading,
  failed,
  retry,
  onOpen,
}: {
  title: string;
  items?: AnimeItem[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
  onOpen?: () => void;
}) {
  const { animeTitles } = usePrefs();
  const kept = useRef<AnimeItem[]>(undefined);
  if (items) kept.current = items;
  const shown = items ?? (loading ? kept.current : undefined);
  // A failed search isn't "no anime": it says so, with a way to try again (test report 1, item 28).
  if (failed && !shown?.length)
    return (
      <section className="row">
        <div className="row-header">
          <h2 className="t-title2">{title}</h2>
        </div>
        <EmptyState action={{ label: "Try Again", onClick: retry }}>Anime results couldn't load.</EmptyState>
      </section>
    );
  if (!loading && !shown?.length) return null;
  return (
    <Shelf
      title={title}
      onOpen={onOpen}
      items={shown}
      card={(a) => <PosterCard key={a.id} item={animeItemToPreview(a, animeTitles)} />}
    />
  );
}
