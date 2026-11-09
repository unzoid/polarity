import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimeCard } from "../components/anime/AnimeCard";
import { PosterCard } from "../components/PosterCard";
import { Shelf } from "../components/title/Shelf";
import { type AnimeCard as Card, retryTitle, useAnimeAliases, useAnimeGenreArt, useAnimeResults, withoutAnime } from "../lib/anime";
import { api } from "../lib/api";
import {
  addRecentSearch,
  catalogKey,
  catalogTitle,
  clearRecentSearches,
  FOCUS_SEARCH_EVENT,
  genreOf,
  SEARCH_ANIME,
  SEARCH_GENRES,
  searchMinLength,
  searchRows,
  type SearchRow,
  setSearchText,
  useAddonSearches,
  useRecentSearches,
  useListable,
  useSearchText,
} from "../lib/catalog";
import { usePrefs } from "../lib/settings";
import { useRouter } from "../lib/router";
import { useFormFactor, useTogether } from "../lib/ui";
import { keys, useSearch } from "../lib/net";
import type { ContentType, MetaPreview } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchField } from "../components/ui/SearchField";
import { Search as SearchIcon } from "../components/icons";

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
function SearchStart() {
  const { animeEnabled } = usePrefs();
  const recent = useRecentSearches();
  const { data: animeArt } = useAnimeGenreArt(SEARCH_ANIME, animeEnabled);
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
              <GenreTile key={g} genre={g} image={animeArt?.[g]} />
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
  const { data } = useGenreRow("movie", genre);
  return <GenreTile genre={genre} image={data?.find((m) => m.background)?.background} />;
}

/** A genre to search by: its name over its picture in the genre's two colours (the colours alone until the picture's in). */
function GenreTile({ genre, image }: { genre: string; image?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [a, b] = TILE_HUES[genre] ?? [220, 280];
  return (
    <button className="genre-tile together-wait pressable" style={{ "--tile-a": a, "--tile-b": b } as CSSProperties} onClick={() => setSearchText(genre)}>
      {image && <img src={image} alt="" loading="lazy" decoding="async" draggable={false} data-loaded={loaded} onLoad={() => setLoaded(true)} />}
      <span>{genre}</span>
    </button>
  );
}

function useGenreRow(type: ContentType, genre: string, enabled = true) {
  return useQuery({
    queryKey: keys.genreRow(type, genre),
    queryFn: () => api.catalog(type, "popular", 0, genre),
    staleTime: 30 * 60_000,
    enabled,
  });
}

function Results({ text }: { text: string }) {
  const [query, setQuery] = useState(text);
  const deferred = useDeferredValue(query);
  const { animeEnabled } = usePrefs();

  // Keystrokes update the field instantly; the network waits for a pause.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), 180);
    return () => window.clearTimeout(t);
  }, [text]);

  const { data } = useSearch(deferred);
  const hasQuery = deferred.length >= searchMinLength(deferred);
  const genre = hasQuery ? genreOf(deferred) : undefined;
  // What the catalogs found (they forgive typos): what AniList is asked for when the typed words find nothing.
  const anime = useAnimeResults(animeEnabled && hasQuery ? deferred : "", retryTitle(data?.series ?? [], data?.movies ?? []));
  const aliases = useAnimeAliases();
  const fromAddons = useAddonSearches(hasQuery ? deferred : "");

  // An anime shows once, as the anime (AniList), not again as a series or movie.
  // Against every entry found, not one per franchise: a later part Cinemeta lists as its own show goes too.
  const movies = withoutAnime(data?.movies, anime.all, aliases);
  const series = withoutAnime(data?.series, anime.all, aliases);
  const waiting = !hasQuery || !data;
  const addonsBusy = fromAddons.some((r) => !r.items && !r.failed);
  const addonsFound = fromAddons.some((r) => r.items?.length);
  const rows: Record<SearchRow, ReactNode> = {
    movieGenre: genre && <GenreRow key="movieGenre" type="movie" genre={genre} />,
    seriesGenre: genre && <GenreRow key="seriesGenre" type="series" genre={genre} />,
    movies: <ResultRow key="movies" title={genre ? "Movies Named Like It" : "Movies"} items={waiting ? undefined : movies} />,
    series: <ResultRow key="series" title={genre ? "Series Named Like It" : "Series"} items={waiting ? undefined : series} />,
    anime: animeEnabled && (
      <AnimeRow key="anime" title={anime.title} items={anime.items} loading={anime.loading} failed={anime.failed} retry={anime.retry} />
    ),
  };
  const nothing = !waiting && !genre && !movies!.length && !series!.length && !anime.items?.length && !anime.loading && !addonsBusy && !addonsFound;

  return (
    <>
      {/* Opening a result counts as running the search (Recent, in the search field). */}
      <div className="rows search-rows" onClickCapture={(e) => (e.target as HTMLElement).closest(".card") && addRecentSearch(deferred)}>
        {searchRows(genre, !!anime.genre).map((row) => rows[row])}
        {/* A failing add-on leaves its row out; Polarity's results above never wait for one. */}
        {fromAddons.map((r) => !r.failed && <ResultRow key={catalogKey(r.catalog)} title={catalogTitle(r.catalog)} items={r.items} />)}
      </div>
      {nothing && <EmptyState>Nothing found for “{deferred}”.</EmptyState>}
    </>
  );
}

function GenreRow({ type, genre }: { type: ContentType; genre: string }) {
  const { data } = useGenreRow(type, genre);
  return <ResultRow title={`Popular ${genre} ${type === "movie" ? "Movies" : "Series"}`} items={data} />;
}

/** Leaves out what can't play and has nothing to show (#337): a stub whose poster and backdrop don't load. */
function ResultRow({ title, items: found }: { title: string; items?: MetaPreview[] }) {
  const items = useListable(found);
  if (items && !items.length) return null;
  return <Shelf title={title} items={items} card={(item) => <PosterCard key={item.id} item={item} />} />;
}

function AnimeRow({ title, items, loading, failed, retry }: { title: string; items?: Card[]; loading: boolean; failed: boolean; retry: () => void }) {
  // A failed search isn't "no anime": it says so, with a way to try again (test report 1, item 28).
  if (failed && !items?.length)
    return (
      <section className="row">
        <div className="row-header">
          <h2 className="t-title2">{title}</h2>
        </div>
        <EmptyState action={{ label: "Try Again", onClick: retry }}>Anime results couldn't load.</EmptyState>
      </section>
    );
  if (!loading && !items?.length) return null;
  return <Shelf title={title} items={items} card={(a) => <AnimeCard key={a.id} item={a} />} />;
}
