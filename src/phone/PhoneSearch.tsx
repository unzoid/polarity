import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Img } from "../components/Img";
import { useIntent } from "../components/PosterCard";
import { retryTitle, useAnimeAliases, useAnimeResults, withoutAnime, type AnimeCard } from "../lib/anime";
import { addRecentSearch, searchMinLength, setSearchText, useBrowseFeatured, useFeatured, useSearchText } from "../lib/catalog";
import { useSearch } from "../lib/net";
import { useNavigation } from "../lib/router";
import { usePrefs } from "../lib/settings";
import type { MetaPreview } from "../lib/types";
import { cardArtUrl, sizedArt } from "../lib/ui";
import { openSettings } from "../lib/settings";
import { IconBell, IconDownload, IconPlayRing, IconSearch, IconSettings } from "./icons";
import { PlayNow } from "./PlayNow";
import { SearchStart } from "../screens/Search";
import { PosterSkeletons, Row } from "./Rows";
import { notifications } from "./store";

/**
 * Search, as Netflix's: a large "Search" that scrolls away and the field that stays, pinned under the status
 * bar; while it's empty, a list of recommendations (a wide still, the name, a play ring); typed into, rows of
 * results. The field takes focus when the tab is opened, and Cancel (while it's focused) clears and lets go.
 */
export function PhoneSearch({ active }: { active: boolean }) {
  const text = useSearchText();
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { navigate } = useNavigation();
  useEffect(() => {
    if (active) input.current?.focus({ preventScroll: true });
    else input.current?.blur();
  }, [active]);
  const query = text.trim();
  return (
    <div className="ph-tab-page ph-search">
      <div
        className="ph-scroll"
        ref={scroller}
        // A drag through the results puts the keyboard away, as iOS's lists do.
        onTouchMove={() => document.activeElement === input.current && input.current?.blur()}
      >
        <header className="ph-search-head">
          <h1>Search</h1>
          <div className="ph-head-actions">
            <button type="button" className="ph-icon-btn" aria-label="Downloads" onClick={() => navigate({ name: "library-collection", view: "downloads" })}>
              <IconDownload size={26} />
            </button>
            <button type="button" className="ph-icon-btn" aria-label="Notifications" onClick={() => notifications.set(true)}>
              <IconBell size={26} />
            </button>
            <button type="button" className="ph-icon-btn" aria-label="Settings" onClick={() => openSettings()}>
              <IconSettings size={26} />
            </button>
          </div>
        </header>
        <div className="ph-search-bar">
          <label className="ph-search-field">
            <IconSearch size={22} />
            <input
              ref={input}
              type="search"
              aria-label="Search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search shows, movies, anime…"
              value={text}
              onChange={(e) => setSearchText(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (query) addRecentSearch(query);
                  input.current?.blur();
                }
              }}
            />
            {text && (
              <button
                type="button"
                className="ph-search-clear"
                aria-label="Clear"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSearchText("");
                  input.current?.focus();
                }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                  <circle cx="9" cy="9" r="9" fill="currentColor" />
                  <path d="M6 6l6 6M12 6l-6 6" stroke="#2d2d2d" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </label>
          <button
            type="button"
            className="ph-search-cancel"
            data-shown={focused || undefined}
            tabIndex={focused ? 0 : -1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              setSearchText("");
              input.current?.blur();
            }}
          >
            Cancel
          </button>
        </div>
        {query.length >= searchMinLength(query) ? (
          <Results text={query} />
        ) : (
          <>
            {/* Polarity's own start: what you searched lately, then genres and anime kinds to tap into. */}
            <div className="ph-search-start">
              <SearchStart />
            </div>
            <Suggestions />
          </>
        )}
      </div>
    </div>
  );
}

/** "Recommended TV Shows & Movies": what Home features, as a list. */
function Suggestions() {
  const items = useBrowseFeatured(useFeatured().data);
  return (
    <section className="ph-suggest">
      <h2 className="ph-row-title">Recommended TV Shows &amp; Movies</h2>
      <ul>
        {items
          ? items.slice(0, 16).map((m) => <Suggestion key={`${m.type}:${m.id}`} item={m} />)
          : Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="ph-suggest-row" aria-hidden>
                <span className="ph-suggest-still ph-skeleton" />
              </li>
            ))}
      </ul>
    </section>
  );
}

function Suggestion({ item }: { item: MetaPreview }) {
  const { navigate } = useNavigation();
  const intent = useIntent(item);
  const [armed, setArmed] = useState(false);
  const still = cardArtUrl(item.background ?? item.poster, "landscape");
  return (
    <li className="ph-suggest-row">
      <button
        type="button"
        className="ph-suggest-open"
        onClick={() => navigate({ name: "detail", type: item.type, id: item.id, preview: item })}
        {...intent}
      >
        <span className="ph-suggest-still scheme-dark" data-origin="4">
          {still && <Img src={still} alt="" loading="lazy" decoding="async" />}
          {item.logo && <Img className="ph-suggest-logo" src={sizedArt(item.logo, "w300")} alt="" loading="lazy" />}
        </span>
        <span className="ph-suggest-name">{item.name}</span>
      </button>
      <button type="button" className="ph-suggest-play" aria-label={`Play ${item.name}`} onClick={() => setArmed(true)}>
        <IconPlayRing size={36} />
      </button>
      {armed && <PlayNow item={item} onDone={() => setArmed(false)} />}
    </li>
  );
}

/** Results as rows: the best matches, then shows, movies and anime; a spinner while the first answer comes. */
function Results({ text }: { text: string }) {
  const [query, setQuery] = useState(text);
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), 220);
    return () => window.clearTimeout(t);
  }, [text]);
  const deferred = useDeferredValue(query);
  const { animeEnabled } = usePrefs();
  const { data, isError, refetch } = useSearch(deferred);
  const anime = useAnimeResults(animeEnabled ? deferred : "", retryTitle(data?.series ?? [], data?.movies ?? []));
  const aliases = useAnimeAliases();
  const movies = withoutAnime(data?.movies, anime.all, aliases);
  const series = withoutAnime(data?.series, anime.all, aliases);
  const top = useMemo(() => interleave(series ?? [], movies ?? []).slice(0, 12), [series, movies]);

  if (isError)
    return (
      <div className="ph-search-state">
        <p>Search isn't working right now.</p>
        <button type="button" className="ph-btn ph-btn-glass" onClick={() => void refetch()}>
          Try Again
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="ph-search-state" aria-busy>
        <span className="ph-spinner" aria-label="Searching" />
      </div>
    );
  const nothing = !top.length && !anime.items?.length && !anime.loading;
  if (nothing)
    return (
      <div className="ph-search-state">
        <h2>Oh darn. We don't have that.</h2>
        <p>Try searching for another show, movie or anime.</p>
      </div>
    );
  return (
    <div className="ph-rows ph-results" onClickCapture={(e) => (e.target as HTMLElement).closest(".ph-poster") && addRecentSearch(deferred)}>
      {top.length > 0 && <Row title="Top Results" items={top} />}
      {series && series.length > 0 && <Row title="Shows" items={series} />}
      {movies && movies.length > 0 && <Row title="Movies" items={movies} />}
      {animeEnabled && (anime.loading || !!anime.items?.length) && (
        <Row title={anime.title}>{anime.items ? anime.items.map((a) => <AnimePoster key={a.id} card={a} />) : <PosterSkeletons />}</Row>
      )}
    </div>
  );
}

const interleave = <T,>(a: readonly T[], b: readonly T[]) => {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
};

/** An anime found by AniList, as a poster; it opens in the title sheet like any other. */
function AnimePoster({ card }: { card: AnimeCard }) {
  const { navigate } = useNavigation();
  const name = card.title.english ?? card.title.romaji ?? card.title.native ?? "Anime";
  const art = card.coverImage.large ?? card.coverImage.extraLarge ?? undefined;
  return (
    <button type="button" className="ph-poster" data-origin="4" aria-label={name} onClick={() => navigate({ name: "anime-detail", id: card.id, preview: card })}>
      {art ? <Img src={art} alt="" loading="lazy" decoding="async" /> : <span className="ph-poster-name">{name}</span>}
    </button>
  );
}
