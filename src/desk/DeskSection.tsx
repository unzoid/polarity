import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { catalogKey, catalogTitle } from "../lib/catalog";
import type { ContentType } from "../lib/types";
import { sizedArt } from "../lib/ui";
import { useCollapse } from "../phone/Header";
import { IconBack } from "../phone/icons";
import { useArtTint } from "../phone/tint";
import { CATALOGS, useDiscover } from "../screens/Discover";
import { BarActions } from "./Bar";
import { Billboard } from "./DeskHome";
import { ListDialog } from "./ListDialog";
import type { Chrome } from "./Nav";
import { Poster, PosterSkeletons } from "./Rows";

const FEATURED = 5;

/**
 * A section (Shows or Movies by a list, a genre, an add-on's list), laid out as Home is: Back and its name in the bar,
 * the list and genre as chips, its first titles in the wide card, then all of it as a grid, more as you near the end.
 */
export function DeskSection({ type, catalog, genre, addon, onBack, chrome }: { type: ContentType; catalog?: string; genre?: string; addon?: string; onBack: () => void; chrome: Chrome }) {
  const d = useDiscover({ type, catalog, genre, addon });
  const scroller = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  useCollapse(scroller, bar, 48);
  const [choosing, setChoosing] = useState<"list" | "genre" | null>(null);

  const featured = useMemo(() => d.items.filter((m) => m.background).slice(0, FEATURED), [d.items]);
  const featuredIds = useMemo(() => new Set(featured.map((m) => m.id)), [featured]);
  const grid = useMemo(() => d.items.filter((m) => !featuredIds.has(m.id)), [d.items, featuredIds]);
  const [shown, setShown] = useState(0);
  const current = featured[Math.min(shown, featured.length - 1)];
  const tint = useArtTint(current ? sizedArt(current.background ?? current.poster, "w300") : undefined);

  const listName = d.own ? catalogTitle(d.own) : d.catalogLabel;
  const kind = type === "movie" ? "Movies" : "Shows";
  const title = d.genre ? `${d.genre} ${kind}` : kind;
  const listOptions = [...CATALOGS.map((c) => ({ id: `polarity:${c.id}`, label: c.label })), ...d.lists.map((c) => ({ id: `addon:${catalogKey(c)}`, label: catalogTitle(c) }))];

  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = d.query;
  useEffect(() => {
    const el = end.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && !isFetchingNextPage && void fetchNextPage(), { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const caret = (
    <svg className="dk-chip-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2 4.2h8L6 8.6z" fill="currentColor" />
    </svg>
  );
  const tintStyle = tint ? ({ "--tint-dark": tint.dark, "--tint-light": tint.light } as CSSProperties) : undefined;
  return (
    <div className="dk-page dk-section">
      <header className="dk-bar dk-center-bar" ref={bar} data-tauri-drag-region>
        <div className="dk-bar-bg" style={tintStyle} aria-hidden />
        <button type="button" className="dk-round dk-back" aria-label="Back" onClick={onBack}>
          <IconBack size={22} stroke={2.2} />
        </button>
        <h1 className="dk-bar-title dk-center-title">{title}</h1>
        {chrome === "tabs" ? <BarActions /> : <span className="dk-round-spacer" aria-hidden />}
      </header>
      <div className="dk-scroll" ref={scroller}>
        <div className="dk-tint" style={tintStyle} aria-hidden />
        <nav className="dk-chips" aria-label="Filter">
          <button type="button" className="dk-chip" aria-pressed={!!d.own || d.catalog !== "trending" || undefined} onClick={() => setChoosing("list")}>
            {listName}
            {caret}
          </button>
          {d.genres.length > 0 && (
            <button type="button" className="dk-chip" aria-pressed={!!d.genre || undefined} onClick={() => setChoosing("genre")}>
              {d.genre ?? "All Genres"}
              {caret}
            </button>
          )}
        </nav>
        {featured.length > 0 ? (
          <Billboard key={`${d.own ? catalogKey(d.own) : d.catalog}:${d.genre ?? ""}`} items={featured} onShown={setShown} kicker={(i) => `#${i + 1} in ${d.genre ?? listName}`} />
        ) : (
          d.query.isPending && <div className="dk-billboard dk-skeleton" aria-hidden />
        )}
        <div className="dk-grid dk-section-grid" data-stale={d.query.isPlaceholderData || undefined}>
          {grid.map((m) => (
            <Poster key={`${m.type}:${m.id}`} item={m} />
          ))}
          {(d.query.isPending || isFetchingNextPage) && <PosterSkeletons count={7} />}
        </div>
        <div ref={end} aria-hidden />
        {d.empty && <p className="dk-note">Nothing here right now.</p>}
        {d.query.isError && <p className="dk-note">This list didn't load. Check your connection.</p>}
      </div>
      <ListDialog
        open={choosing === "list"}
        label="List"
        options={listOptions}
        value={d.own ? `addon:${catalogKey(d.own)}` : `polarity:${d.catalog}`}
        onPick={(id) => {
          setChoosing(null);
          if (id.startsWith("addon:")) d.setList(id.slice(6));
          else {
            d.setList("");
            d.setCatalog(id.slice(9));
          }
        }}
        onClose={() => setChoosing(null)}
      />
      <ListDialog
        open={choosing === "genre"}
        label="Genre"
        options={[...(d.own?.genreRequired ? [] : [{ id: "", label: "All Genres" }]), ...d.genres.map((g) => ({ id: g, label: g }))]}
        value={d.genre ?? ""}
        onPick={(g) => {
          setChoosing(null);
          d.setGenre(g || undefined);
        }}
        onClose={() => setChoosing(null)}
      />
    </div>
  );
}
