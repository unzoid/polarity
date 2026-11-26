import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Img } from "../components/Img";
import { animeItemName, animeItemToPreview, useAnimeSearchCatalog, withoutAnimeItems } from "../lib/anime";
import { api } from "../lib/api";
import {
  addRecentSearch,
  applySmartFilters,
  catalogBound,
  clearRecentSearches,
  keepWithinLimit,
  parseSmartQuery,
  searchMinLength,
  setSearchText,
  useBrowseFeatured,
  useFeatured,
  useRecentSearches,
  useSearchText,
  useViewingLimit,
  type ParsedSmartQuery,
} from "../lib/catalog";
import { useSearch } from "../lib/net";
import { useNavigation } from "../lib/router";
import { usePrefs } from "../lib/settings";
import type { AnimeItem, ContentType, MetaPreview } from "../lib/types";
import { IconSearch } from "../phone/icons";
import { BarActions } from "./Bar";
import type { Chrome } from "./Nav";
import { Poster, PosterSkeletons } from "./Rows";

type ResultScope = "all" | "series" | "movie" | "anime";

/**
 * Clean, understated Search page: recent searches + popular poster grid while empty,
 * and scoped All / Shows / Movies / Anime poster grids when typing.
 */
export function DeskSearch({ active, chrome }: { active: boolean; chrome: Chrome }) {
  const text = useSearchText();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) input.current?.focus({ preventScroll: true });
    else input.current?.blur();
  }, [active]);
  const query = text.trim();
  return (
    <div className="dk-page dk-search">
      {chrome === "tabs" && (
        <header className="dk-bar dk-search-bar" data-tauri-drag-region>
          <label className="dk-field">
            <IconSearch size={22} />
            <input
              ref={input}
              type="search"
              aria-label="Search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search shows, movies, anime…"
              value={text}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query) addRecentSearch(query);
                if (e.key === "Escape" && text) {
                  e.preventDefault();
                  setSearchText("");
                }
              }}
            />
            {text && (
              <button
                type="button"
                className="dk-field-clear"
                aria-label="Clear"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSearchText("");
                  input.current?.focus();
                }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                  <circle cx="9" cy="9" r="9" fill="currentColor" />
                  <path d="M6 6l6 6M12 6l-6 6" stroke="var(--dk-field)" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </label>
          <BarActions />
        </header>
      )}
      <div className="dk-scroll">
        {query.length >= searchMinLength(query) ? (
          <Results text={query} />
        ) : (
          <div className="dk-search-discover">
            <Recent />
            <Popular />
          </div>
        )}
      </div>
    </div>
  );
}

function Recent() {
  const recent = useRecentSearches();
  if (!recent.length) return null;
  return (
    <section className="dk-recent">
      <h2 className="dk-row-title">
        <span className="dk-row-name">Recent Searches</span>
        <button type="button" className="dk-text-btn" onClick={clearRecentSearches}>
          Clear
        </button>
      </h2>
      <div className="dk-recent-list">
        {recent.slice(0, 8).map((q) => (
          <button key={q} type="button" className="dk-search-pill" onClick={() => setSearchText(q)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span>{q}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Popular() {
  const items = useBrowseFeatured(useFeatured().data);
  return (
    <section className="dk-grid-block">
      <h2 className="dk-row-title">
        <span className="dk-row-name">Popular</span>
      </h2>
      <div className="dk-grid">
        {items ? (
          items.slice(0, 21).map((m) => <Poster key={`${m.type}:${m.id}`} item={m} />)
        ) : (
          <PosterSkeletons count={14} />
        )}
      </div>
    </section>
  );
}

/**
 * Catalog-backed lookup for pure smart-filter queries (e.g. "90s romcom movies 8+", "80s horror")
 * where no literal title text remains to send to `/search`.
 */
function useSmartCatalog(
  parsed: ParsedSmartQuery,
  dismissed: ReadonlySet<string>,
  enabled: boolean,
) {
  const viewing = useViewingLimit();
  const activeChips = useMemo(
    () => parsed.chips.filter((c) => !dismissed.has(c.id)),
    [parsed.chips, dismissed],
  );
  const genres = useMemo(
    () => activeChips.filter((c) => c.kind === "genre" && c.genre).map((c) => c.genre!),
    [activeChips],
  );
  const mediaType = activeChips.find((c) => c.kind === "type")?.mediaType;
  const decade = activeChips.find((c) => c.kind === "decade")?.yearRange;
  const types: ContentType[] = mediaType === "movie" ? ["movie"] : mediaType === "series" ? ["series"] : ["movie", "series"];
  const key = [genres.join(","), types.join(","), decade?.join("-") ?? ""].join("|");

  return useQuery({
    queryKey: ["smart-search-catalog", key],
    enabled: enabled && (genres.length > 0 || !!decade || activeChips.some((c) => c.kind === "rating")),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const wantClassics = !!decade && decade[0] < 2010;
      const catalogs = wantClassics ? ["classics", "top_rated", "popular"] : ["popular", "top_rated"];
      const primaryGenres = genres.length ? genres.slice(0, 2) : [undefined];
      const jobs: Promise<{ type: ContentType; items: MetaPreview[] }>[] = [];

      for (const ty of types) {
        const bound = catalogBound(ty);
        for (const g of primaryGenres) {
          for (const cat of catalogs) {
            jobs.push(
              api
                .catalog(ty, cat, 0, g, bound)
                .then((items) => ({ type: ty, items }))
                .catch(() => ({ type: ty, items: [] })),
            );
            if (cat === "popular") {
              jobs.push(
                api
                  .catalog(ty, cat, 20, g, bound)
                  .then((items) => ({ type: ty, items }))
                  .catch(() => ({ type: ty, items: [] })),
              );
            }
          }
        }
      }

      const settled = await Promise.all(jobs);
      const seenMovie = new Set<string>();
      const seenSeries = new Set<string>();
      const movies: MetaPreview[] = [];
      const series: MetaPreview[] = [];
      for (const { type, items } of settled) {
        for (const item of items) {
          if (type === "movie") {
            if (!seenMovie.has(item.id)) {
              seenMovie.add(item.id);
              movies.push(item);
            }
          } else if (!seenSeries.has(item.id)) {
            seenSeries.add(item.id);
            series.push(item);
          }
        }
      }
      return { movies, series };
    },
    select: (res) => ({
      movies: keepWithinLimit(res.movies, viewing),
      series: keepWithinLimit(res.series, viewing),
    }),
  });
}

function Results({ text }: { text: string }) {
  const [query, setQuery] = useState(text);
  const [scope, setScope] = useState<ResultScope>("all");
  const [dismissedChips, setDismissedChips] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), 220);
    return () => window.clearTimeout(t);
  }, [text]);
  useEffect(() => {
    setScope("all");
    setDismissedChips(new Set());
  }, [text]);

  const deferred = useDeferredValue(query);
  const { animeEnabled } = usePrefs();
  const parsed = useMemo(() => parseSmartQuery(deferred), [deferred]);
  const activeChips = useMemo(
    () => parsed.chips.filter((c) => !dismissedChips.has(c.id)),
    [parsed.chips, dismissedChips],
  );
  const hasLiteralText = parsed.textQuery.length >= searchMinLength(parsed.textQuery);
  // Pure filter query (e.g. "90s romcom movies 8+" or "80s horror"): query curated/genre catalogs instead of literal title search.
  const pureFilterQuery = activeChips.length > 0 && !hasLiteralText;
  const searchTerm = activeChips.length > 0 && hasLiteralText ? parsed.textQuery : pureFilterQuery ? "" : deferred;

  const textSearch = useSearch(searchTerm);
  const smartCatalog = useSmartCatalog(parsed, dismissedChips, pureFilterQuery);
  const rawMovies = pureFilterQuery ? smartCatalog.data?.movies : textSearch.data?.movies;
  const rawSeries = pureFilterQuery ? smartCatalog.data?.series : textSearch.data?.series;
  const isError = pureFilterQuery ? smartCatalog.isError : textSearch.isError;
  const ready = pureFilterQuery ? !!smartCatalog.data : !!textSearch.data;
  const refetch = pureFilterQuery ? smartCatalog.refetch : textSearch.refetch;

  const animeTerm = animeEnabled && !pureFilterQuery ? searchTerm : animeEnabled && activeChips.some((c) => c.mediaType === "anime") ? parsed.genres[0] ?? "anime" : "";
  const anime = useAnimeSearchCatalog(animeTerm);
  const movies = useMemo(
    () => applySmartFilters(withoutAnimeItems(rawMovies, anime.items), parsed, dismissedChips) ?? [],
    [rawMovies, anime.items, parsed, dismissedChips],
  );
  const series = useMemo(
    () => applySmartFilters(withoutAnimeItems(rawSeries, anime.items), parsed, dismissedChips) ?? [],
    [rawSeries, anime.items, parsed, dismissedChips],
  );
  const animeItems = useMemo(() => (animeEnabled ? (anime.items ?? []) : []), [animeEnabled, anime.items]);
  const top = useMemo(() => interleave(series, movies), [series, movies]);

  const chipsBar = activeChips.length > 0 && (
    <div className="dk-search-scopes" role="group" aria-label="Smart search filters">
      {activeChips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className="dk-search-pill"
          onClick={() => setDismissedChips((prev) => new Set(prev).add(chip.id))}
          title={`Remove "${chip.label}" filter`}
        >
          <span>{chip.label}</span>
          <span aria-hidden>×</span>
        </button>
      ))}
    </div>
  );

  if (isError)
    return (
      <>
        {chipsBar}
        <div className="dk-state">
          <p>Search isn't working right now.</p>
          <button type="button" className="dk-btn dk-btn-glass" onClick={() => void refetch()}>
            Try Again
          </button>
        </div>
      </>
    );
  if (!ready)
    return (
      <>
        {chipsBar}
        <div className="dk-grid-block">
          <h2 className="dk-row-title">
            <span className="dk-row-name">Top Results</span>
          </h2>
          <div className="dk-grid" aria-busy>
            <PosterSkeletons count={14} />
          </div>
        </div>
      </>
    );

  const totalCount = top.length + animeItems.length;
  if (!totalCount && !anime.loading)
    return (
      <>
        {chipsBar}
        <div className="dk-state">
          <h2>No matches for “{deferred}”</h2>
          <p>{activeChips.length ? "Click × on a filter chip above to broaden your search." : "Try a different title, actor, or genre."}</p>
        </div>
      </>
    );

  const tabs: { id: ResultScope; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalCount },
    ...(series.length ? [{ id: "series" as const, label: "Shows", count: series.length }] : []),
    ...(movies.length ? [{ id: "movie" as const, label: "Movies", count: movies.length }] : []),
    ...(animeEnabled && (animeItems.length || anime.loading) ? [{ id: "anime" as const, label: "Anime", count: animeItems.length }] : []),
  ];
  const activeScope = tabs.some((t) => t.id === scope) ? scope : "all";
  const shownTitles = activeScope === "series" ? series : activeScope === "movie" ? movies : activeScope === "all" ? top : [];
  const showAnime = animeEnabled && (activeScope === "all" || activeScope === "anime") && (anime.loading || animeItems.length > 0);

  return (
    <div onClickCapture={(e) => (e.target as HTMLElement).closest(".dk-poster") && addRecentSearch(deferred)}>
      {chipsBar}
      {tabs.length > 2 && (
        <div className="dk-search-scopes" role="tablist" aria-label="Filter results">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeScope === t.id}
              className="dk-search-scope"
              onClick={() => setScope(t.id)}
            >
              <span>{t.label}</span>
              {t.count > 0 && <span className="dk-search-scope-n tabular">{t.count}</span>}
            </button>
          ))}
        </div>
      )}
      {shownTitles.length > 0 && (
        <div className="dk-grid-block">
          <h2 className="dk-row-title">
            <span className="dk-row-name">{activeScope === "series" ? "Shows" : activeScope === "movie" ? "Movies" : "Top Results"}</span>
          </h2>
          <div className="dk-grid">
            {shownTitles.map((m) => (
              <Poster key={`${m.type}:${m.id}`} item={m} />
            ))}
          </div>
        </div>
      )}
      {showAnime && (
        <div className="dk-grid-block">
          <h2 className="dk-row-title">
            <span className="dk-row-name">Anime</span>
          </h2>
          <div className="dk-grid">
            {animeItems.length ? animeItems.map((a) => <AnimePoster key={a.id} anime={a} />) : <PosterSkeletons count={7} />}
          </div>
        </div>
      )}
    </div>
  );
}

function AnimePoster({ anime }: { anime: AnimeItem }) {
  const { navigate } = useNavigation();
  const { animeTitles } = usePrefs();
  const title = animeItemName(anime, animeTitles);
  return (
    <button
      type="button"
      className="dk-poster scheme-dark"
      data-origin="4"
      aria-label={title}
      onClick={() => navigate({ name: "detail", type: anime.type, id: anime.id, preview: animeItemToPreview(anime, animeTitles), season: anime.seasonHint })}
    >
      {anime.poster ? <Img src={anime.poster} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="dk-poster-name">{title}</span>}
    </button>
  );
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}
