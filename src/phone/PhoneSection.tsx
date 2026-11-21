import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { catalogKey, catalogTitle } from "../lib/catalog";
import type { ContentType } from "../lib/types";
import { sizedArt } from "../lib/ui";
import { CATALOGS, useDiscover } from "../screens/Discover";
import { useCollapse } from "./Header";
import { IconBack, IconChevronDown } from "./icons";
import { ListOverlay } from "./ListOverlay";
import { Carousel } from "./PhoneHome";
import { Poster } from "./Rows";
import { useArtTint } from "./tint";

/** How many of a section's first titles take turns in its card. */
const FEATURED = 5;

/**
 * A section (Shows or Movies by a catalog, a genre, an add-on's list), laid out as Home is: Back and the section's
 * name over the page, the list and genre as two centred pills, its first titles turning in a wide card, then all
 * of its titles three across, more as you near the end. The page takes the card's colour, as Home does.
 */
export function PhoneSection({ type, catalog, genre, addon, onBack }: { type: ContentType; catalog?: string; genre?: string; addon?: string; onBack: () => void }) {
  const d = useDiscover({ type, catalog, genre, addon });
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement | null>(null);
  useCollapse(scroller, head, 40);
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
  const listOptions = [
    ...CATALOGS.map((c) => ({ id: `polarity:${c.id}`, label: c.label })),
    ...d.lists.map((c) => ({ id: `addon:${catalogKey(c)}`, label: catalogTitle(c) })),
  ];

  // The next page as the end of the grid comes near.
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = d.query;
  useEffect(() => {
    const el = end.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && !isFetchingNextPage && void fetchNextPage(), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="ph-section" style={tint ? ({ "--tint-dark": tint.dark, "--tint-light": tint.light } as CSSProperties) : undefined}>
      <header className="ph-sect-head" ref={(el) => void (head.current = el)}>
        <div className="ph-head-bg" aria-hidden />
        <button type="button" className="ph-round" aria-label="Back" onClick={onBack}>
          <IconBack size={24} stroke={2.2} />
        </button>
        <h1>{title}</h1>
        <span className="ph-round-spacer" aria-hidden />
      </header>
      <div className="ph-scroll" ref={scroller}>
        <div className="ph-tint" aria-hidden />
        <div className="ph-sect-pills">
          <button type="button" className="ph-pill" data-set={d.own || d.catalog !== "trending" || undefined} onClick={() => setChoosing("list")}>
            {listName}
            <IconChevronDown size={14} />
          </button>
          {d.genres.length > 0 && (
            <button type="button" className="ph-pill" data-set={!!d.genre || undefined} onClick={() => setChoosing("genre")}>
              {d.genre ?? "All Genres"}
              <IconChevronDown size={14} />
            </button>
          )}
        </div>
        {featured.length > 0 ? (
          <Carousel key={`${d.own ? catalogKey(d.own) : d.catalog}:${d.genre ?? ""}`} items={featured} onShown={setShown} wide kicker={(i) => `#${i + 1} in ${d.genre ?? listName}`} />
        ) : (
          d.query.isPending && (
            <div className="ph-carousel" data-wide>
              <div className="ph-hero ph-skeleton" aria-hidden />
            </div>
          )
        )}
        <div className="ps-grid ph-sect-grid" data-stale={d.query.isPlaceholderData || undefined}>
          {grid.map((m) => (
            <Poster key={`${m.type}:${m.id}`} item={m} />
          ))}
          {(d.query.isPending || isFetchingNextPage) && Array.from({ length: 6 }, (_, i) => <span key={`sk${i}`} className="ph-poster ph-skeleton" aria-hidden />)}
        </div>
        <div ref={end} aria-hidden />
        {d.empty && <p className="ph-sect-note">Nothing here right now.</p>}
        {d.query.isError && <p className="ph-sect-note">This list didn't load. Check your connection.</p>}
      </div>
      <ListOverlay
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
      <ListOverlay
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
