import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLibraryToggle } from "../components/title/LibraryButton";
import { PlaylistChecklist, usePlaylistChecklist } from "../components/title/PlaylistChecklist";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "../components/ui/Popover";
import type { MetaPreview } from "../lib/types";
import { IconCheck, IconPlay, IconPlus } from "../phone/icons";
import { reduced } from "./motion";

/** Play or Resume as the pinned bar draws it: the title's white pill, smaller. */
export function CompactPlay({ label, disabled, onPlay, onPreload }: { label: string; disabled?: boolean; onPlay: () => void; onPreload?: () => void }) {
  return (
    <button type="button" className="dk-t-btn dk-t-btn-white dk-t-play-sm" disabled={disabled} onPointerEnter={onPreload} onPointerDown={onPreload} onClick={onPlay}>
      <IconPlay size={16} />
      {label}
    </button>
  );
}

/**
 * What Play is about to play, under the show's own description: "Continue watching", the episode, how far in you are
 * (`children`, the progress line), and the episode's synopsis.
 */
export function NextUp({ kicker, line, overview, children }: { kicker: string; line?: string; overview?: string; children?: ReactNode }) {
  if (!line && !overview && !children) return null;
  return (
    <div className="dk-t-next">
      <p className="dk-t-next-kicker">{kicker}</p>
      {line && <p className="dk-t-next-line">{line}</p>}
      {children}
      {overview && <p className="dk-t-next-text">{overview}</p>}
    </div>
  );
}

/**
 * The title's name and Play, pinned to the top of the dialog once the real ones scroll away, so you can play or
 * leave from episode 12 without scrolling back up. `anchor` is the row it stands in for.
 */
export function PinnedBar({ anchor, name, children }: { anchor: RefObject<HTMLElement | null>; name: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = anchor.current;
    const root = el?.closest<HTMLElement>(".dk-dlg-content");
    if (!el || !root) return;
    const h = bar.current?.firstElementChild?.getBoundingClientRect().height || 64;
    const io = new IntersectionObserver(
      ([e]) => setShown(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + h),
      { root, rootMargin: `${-Math.round(h)}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [anchor]);
  return (
    <div className="dk-t-pin" ref={bar} data-shown={shown || undefined} inert={!shown || undefined} aria-hidden={!shown || undefined}>
      <div className="dk-t-pin-bar">
        <span className="dk-t-pin-name">{name}</span>
        {children}
      </div>
    </div>
  );
}

/** The episode-ratings grid's glyph: a small heatmap, so it doesn't read as the title's star ratings. */
export function IconRatingsGrid({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="1" y="1" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="6" y="1" width="4" height="4" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="11" y="1" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="1" y="6" width="4" height="4" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="6" y="6" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="11" y="6" width="4" height="4" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="1" y="11" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="6" y="11" width="4" height="4" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="11" y="11" width="4" height="4" rx="1" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

/**
 * Paging for a strip of episode cards: cards line up with the page's gutter (the strip's padding), the arrows move by
 * whole cards, and the up-next card opens at the gutter, in line with the season button above it.
 */
export function useCardStrip(strip: RefObject<HTMLElement | null>) {
  const metrics = useCallback(() => {
    const s = strip.current;
    const card = s?.querySelector<HTMLElement>(".dk-ep-card");
    if (!s || !card) return undefined;
    const cs = getComputedStyle(s);
    const gap = parseFloat(cs.columnGap) || 0;
    return { s, gap, size: card.getBoundingClientRect().width + gap, pad: parseFloat(cs.paddingLeft) || 0 };
  }, [strip]);
  const alignTo = useCallback(
    (el: HTMLElement) => {
      const m = metrics();
      if (m) m.s.scrollLeft = Math.max(0, el.offsetLeft - m.pad);
    },
    [metrics],
  );
  const page = useCallback(
    (dir: 1 | -1) => {
      const m = metrics();
      if (!m) return;
      const max = Math.max(0, m.s.scrollWidth - m.s.clientWidth);
      const per = Math.max(1, Math.floor((m.s.clientWidth - m.pad * 2 + m.gap) / m.size));
      const at = Math.round(m.s.scrollLeft / m.size);
      const target = Math.min(max, Math.max(0, (at + dir * per) * m.size));
      m.s.scrollTo({ left: target, behavior: reduced() ? "auto" : "smooth" });
    },
    [metrics],
  );
  return { alignTo, page };
}

/**
 * Add to List in a title's row of actions: My List and the playlists to tick this title into, and New Playlist, in a
 * popover under the tile (docs/ui-components.md U10). Ticked, and "Added", while the title is in My List or any playlist.
 */
export function ListAction({ item }: { item: MetaPreview }) {
  const { inLibrary } = useLibraryToggle(item);
  const { inAny } = usePlaylistChecklist(item);
  const saved = !!inLibrary || inAny;
  return (
    <PopoverRoot>
      <PopoverTrigger className="dk-t-action" aria-pressed={saved}>
        <span className="dk-t-action-glyph">{saved ? <IconCheck size={28} stroke={1.6} /> : <IconPlus size={28} stroke={1.5} />}</span>
        <span className="dk-t-action-label">{saved ? "Added" : "Add to List"}</span>
      </PopoverTrigger>
      <PopoverPopup sideOffset={8} align="center" collisionPadding={12} className="playlist-menu">
        <p className="playlist-menu-title">Add to List</p>
        <PlaylistChecklist item={item} look="popover" withLibrary />
      </PopoverPopup>
    </PopoverRoot>
  );
}
