import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion, upNextMove } from "../../lib/ui";
import type { EpisodeLayout, MetaPreview, Progress, Video } from "../../lib/types";
import { Row } from "../Row";
import { EpisodeCard } from "./EpisodeCard";

/**
 * A season as a horizontal shelf of episode lockups (tvOS): still with a
 * "▶ 42m" label, then EPISODE N, title, a three-line synopsis and the airdate.
 * Opens scrolled to the episode you're up to.
 *
 * As a "list", the same episodes stack vertically: number, still, then the
 * title, runtime and synopsis beside it.
 *
 * A long season (a page of a long-running anime holds 100) draws only the cards on and near the screen, the
 * rest as empty slots of the same width that become cards as they come near (#397).
 */
export function EpisodeShelf({
  layout = "row",
  episodes,
  progress,
  runtime,
  stillFallback,
  upNextId,
  onPlay,
  onSources,
  menu,
  item,
}: {
  /** The show: given, each released episode gets a download control. */
  item?: MetaPreview;
  layout?: EpisodeLayout;
  episodes: Video[];
  progress: Map<string, Progress>;
  runtime?: string;
  /** A picture for episodes with no still, shown dimmed (the show's banner). */
  stillFallback?: string;
  upNextId?: string;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
  /** Right-click options for an episode. */
  menu?: (v: Video) => { onContextMenu: (e: React.MouseEvent<HTMLElement>) => void };
}) {
  const shelf = useRef<HTMLDivElement>(null);

  // Up next is the first card in view: jumped to when the list is new, glided to (or left where it
  // is, if in view) when only up next changed, as when the player closes (lib/ui/shelfScroll.ts).
  const shown = useRef("");
  const list = `${layout}|${episodes.length}|${episodes[0]?.id}|${episodes.at(-1)?.id}`;
  useLayoutEffect(() => {
    const scroller = shelf.current?.querySelector<HTMLElement>(".row-scroller");
    if (!scroller) return;
    const el = upNextId ? scroller.querySelector<HTMLElement>(`[data-video="${CSS.escape(upNextId)}"]`) : null;
    const pad = parseFloat(getComputedStyle(scroller).paddingLeft);
    const newList = shown.current !== list;
    shown.current = list;
    const move = upNextMove({
      newList,
      card: el && { left: el.offsetLeft, width: el.offsetWidth },
      view: { left: scroller.scrollLeft + pad, width: scroller.clientWidth - 2 * pad },
    });
    const left = el ? el.offsetLeft - pad : 0;
    if (move === "jump") scroller.scrollLeft = left;
    else if (move === "smooth") scroller.scrollTo({ left, behavior: prefersReducedMotion() ? "instant" : "smooth" });
  }, [list, upNextId]);

  const upNextAt = upNextId ? episodes.findIndex((v) => v.id === upNextId) : -1;
  const drawn = useShelfWindow(shelf, list, episodes.length, Math.max(0, upNextAt), layout);
  const cards = episodes.map((v, i) =>
    i < drawn.from || i >= drawn.to ? (
      <div key={v.id} className="episode-slot" data-layout={layout} data-video={v.id} data-slot={i} aria-hidden />
    ) : (
      <EpisodeCard
        key={v.id}
        layout={layout}
        video={v}
        progress={progress.get(v.id)}
        runtime={runtime}
        stillFallback={stillFallback}
        upNext={v.id === upNextId}
        onPlay={onPlay}
        onSources={onSources}
        menu={menu?.(v)}
        item={item}
      />
    ),
  );

  if (layout === "list")
    return (
      <div ref={shelf} className="episode-list" onFocus={drawn.focused}>
        {cards}
      </div>
    );
  return (
    <div ref={shelf} onFocus={drawn.focused}>
      <Row shape="episode" placed>
        {cards}
      </Row>
    </div>
  );
}

/** Seasons up to this long draw every card. */
const WHOLE = 40;
/** Cards drawn at first, from a little before up next (a list: from the top, so nothing above moves). */
const FIRST = 24;
/** Cards drawn on past one that comes near, or gets focus, so Tab and the remote always have a next one. */
const AHEAD = 12;

/**
 * Which of a long season's cards are drawn (from, to): a stretch around up next at first, growing as empty
 * slots come within about a screen of view, by scrolling or a jump, and as focus nears either end. It never
 * shrinks while the same list shows, so a card scrolled past stays as it was.
 */
function useShelfWindow(shelf: React.RefObject<HTMLDivElement | null>, list: string, count: number, anchor: number, layout: string) {
  const first = (): [number, number] => {
    if (count <= WHOLE) return [0, count];
    if (layout === "list") return [0, Math.min(count, anchor + FIRST)];
    const from = Math.max(0, Math.min(anchor - 4, count - FIRST));
    return [from, from + FIRST];
  };
  const [state, setState] = useState(() => ({ list, range: first() }));
  // A new list (another season, page or search) starts again from its up next.
  const range = state.list === list ? state.range : first();
  if (state.list !== list) setState({ list, range });
  const [from, to] = range;
  const grow = (i: number) =>
    setState((s) => {
      const [a, b] = s.list === list ? s.range : range;
      const next: [number, number] = [Math.min(a, Math.max(0, i - AHEAD)), Math.max(b, Math.min(count, i + AHEAD + 1))];
      return next[0] === a && next[1] === b && s.list === list ? s : { list, range: next };
    });

  useEffect(() => {
    const root = shelf.current;
    if (!root || (from === 0 && to >= count)) return;
    const row = layout !== "list";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) grow(Number((e.target as HTMLElement).dataset.slot));
      },
      // A row's slots come near sideways, inside its scroller; a list's as the page scrolls.
      row ? { root: root.querySelector(".row-scroller"), rootMargin: "0px 100%" } : { root: root.closest(".scroll"), rootMargin: "100% 0px" },
    );
    for (const slot of root.querySelectorAll(".episode-slot")) io.observe(slot);
    return () => io.disconnect();
    // `grow` is new each render; what it reads is in these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf, list, from, to, count, layout]);

  const focused = (e: React.FocusEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".episode-card");
    const at = card ? [...(shelf.current?.querySelectorAll(".episode-card, .episode-slot") ?? [])].indexOf(card) : -1;
    if (at >= 0 && (at < from + 3 || at >= to - 3)) grow(at);
  };
  return { from, to, focused };
}
