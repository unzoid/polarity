import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Img } from "../components/Img";
import { retryTitle, useAnimeAliases, useAnimeResults, withoutAnime, type AnimeCard } from "../lib/anime";
import { addRecentSearch, clearRecentSearches, searchMinLength, setSearchText, useBrowseFeatured, useFeatured, useRecentSearches, useSearchText } from "../lib/catalog";
import { useSearch } from "../lib/net";
import { useNavigation } from "../lib/router";
import { usePrefs } from "../lib/settings";
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

function Results({ text }: { text: string }) {
  const [query, setQuery] = useState(text);
  const [scope, setScope] = useState<ResultScope>("all");
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), 220);
    return () => window.clearTimeout(t);
  }, [text]);
  useEffect(() => setScope("all"), [text]);
  const deferred = useDeferredValue(query);
  const { animeEnabled } = usePrefs();
  const { data, isError, refetch } = useSearch(deferred);
  const anime = useAnimeResults(animeEnabled ? deferred : "", retryTitle(data?.series ?? [], data?.movies ?? []));
  const aliases = useAnimeAliases();
  const movies = useMemo(() => withoutAnime(data?.movies, anime.all, aliases) ?? [], [data?.movies, anime.all, aliases]);
  const series = useMemo(() => withoutAnime(data?.series, anime.all, aliases) ?? [], [data?.series, anime.all, aliases]);
  const animeItems = useMemo(() => (animeEnabled ? (anime.items ?? []) : []), [animeEnabled, anime.items]);
  const top = useMemo(() => interleave(series, movies), [series, movies]);

  if (isError)
    return (
      <div className="dk-state">
        <p>Search isn't working right now.</p>
        <button type="button" className="dk-btn dk-btn-glass" onClick={() => void refetch()}>
          Try Again
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="dk-grid-block">
        <h2 className="dk-row-title">
          <span className="dk-row-name">Top Results</span>
        </h2>
        <div className="dk-grid" aria-busy>
          <PosterSkeletons count={14} />
        </div>
      </div>
    );

  const totalCount = top.length + animeItems.length;
  if (!totalCount && !anime.loading)
    return (
      <div className="dk-state">
        <h2>No matches for “{deferred}”</h2>
        <p>Try a different title, actor, or genre.</p>
      </div>
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

function AnimePoster({ anime }: { anime: AnimeCard }) {
  const { navigate } = useNavigation();
  const title = anime.title.english || anime.title.romaji || anime.title.native || "";
  const cover = anime.coverImage?.extraLarge || anime.coverImage?.large;
  return (
    <button
      type="button"
      className="dk-poster scheme-dark"
      data-origin="4"
      aria-label={title}
      onClick={() => navigate({ name: "anime-detail", id: anime.id, preview: anime })}
    >
      {cover ? <Img src={cover} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="dk-poster-name">{title}</span>}
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
