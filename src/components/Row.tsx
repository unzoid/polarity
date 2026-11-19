import { ChevronLeft, ChevronRight } from "./icons";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EdgeBlur } from "./EdgeBlur";
import { prefersReducedMotion, useOffscreenMark, useTogether } from "../lib/ui";

/**
 * A horizontal shelf. Native scrolling (wheel, trackpad momentum, scroll-snap)
 * does the physics; paddles page by one viewport width. With `onOpen`, the
 * heading is a link to the shelf's full list, a chevron after it (#48).
 */
export function Row({
  title,
  onOpen,
  action,
  shape = "poster",
  order,
  loading = false,
  placed = false,
  children,
}: {
  title?: string;
  /** Opens the full list behind the shelf. */
  onOpen?: () => void;
  action?: ReactNode;
  shape?: "poster" | "landscape" | "episode";
  /** The items' ids in order. When it changes, the shelf goes back to its start, or keeps a focused card in view. */
  order?: string;
  /** Skeletons stand in for the cards: their shimmer pauses while the shelf is out of view. */
  loading?: boolean;
  /** Its owner puts it where it should be (EpisodeShelf, at up next): it isn't sent back to its start. */
  placed?: boolean;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  useOffscreenMark(section, loading);
  const together = useTogether();
  const [edges, setEdges] = useState({ start: true, end: false });
  // Until someone scrolls it, a shelf shows its first title. Titles shown
  // higher up are taken out of it as they load; without this, scroll-snap
  // keeps the card it was on in view and the shelf opens part-way along.
  const touched = useRef(false);
  // A shelf that has just mounted is at its start already: reading scrollLeft then would only force a layout.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const el = scroller.current;
    if (el && !placed && !touched.current && el.scrollLeft !== 0) el.scrollLeft = 0;
  }, [children, placed]);

  // Resuming a title moves it to the front of Continue Watching; the shelf kept
  // its scroll offset, which now shows whatever took the title's old place.
  const shownOrder = useRef(order);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (shownOrder.current === order) return;
    shownOrder.current = order;
    if (!el) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && el.contains(focused)) {
      focused.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    touched.current = false;
    el.scrollLeft = 0;
  }, [order]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Same edges, same object: a new one on every scroll event would
    // re-render the shelf and all its cards for each frame scrolled.
    const update = () => {
      const start = el.scrollLeft < 4;
      const end = el.scrollLeft + el.clientWidth > el.scrollWidth - 4;
      setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
    };
    // No first read here: the ResizeObserver's first callback comes in the same frame, after layout, so it
    // doesn't force one (nor lay out a shelf that content-visibility is skipping).
    const touch = () => (touched.current = true);
    const events = ["wheel", "pointerdown", "touchstart", "keydown", "focusin"] as const;
    for (const e of events) el.addEventListener(e, touch, { passive: true });
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      for (const e of events) el.removeEventListener(e, touch);
      ro.disconnect();
    };
  }, []);

  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    touched.current = true;
    if (!el) return;
    const style = getComputedStyle(el);
    const padStart = parseFloat(style.paddingLeft) || 0;
    const padEnd = parseFloat(style.paddingRight) || 0;
    const gap = parseFloat(style.columnGap) || 0;
    const first = el.firstElementChild as HTMLElement | null;
    const cardW = first?.offsetWidth ?? 0;
    const stride = cardW > 0 ? cardW + gap : 0;
    const inner = el.clientWidth - padStart - padEnd;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (stride > 0 && inner > 0) {
      const perPage = Math.max(1, Math.floor((inner + gap) / stride));
      const base = dir > 0 ? Math.floor(el.scrollLeft / stride + 0.05) : Math.ceil(el.scrollLeft / stride - 0.05);
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const target = Math.max(0, Math.min(maxScroll, (base + dir * perPage) * stride));
      el.scrollTo({ left: target, behavior });
    } else {
      el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior });
    }
  };

  return (
    <section className="row" data-shape={shape} ref={section}>
      {(title || action) && (
        <header className="row-header">
          {title && (
            <h2 className="t-title2 row-title" title={onOpen ? undefined : title}>
              {onOpen ? (
                <button className="row-title-link" onClick={onOpen} title={`See all: ${title}`}>
                  <span className="row-title-text">{title}</span>
                  <ChevronRight className="row-title-chevron" size={20} strokeWidth={2.5} aria-hidden />
                </button>
              ) : (
                title
              )}
            </h2>
          )}
          {action}
        </header>
      )}
      {/* The shelf's pictures come in as one (lib/ui/together.ts). */}
      <div className="row-viewport" data-start={edges.start} data-end={edges.end} {...together}>
        <RowPaddle dir="prev" visible={!edges.start} onPage={page} />
        <div className="row-scroller" ref={scroller}>
          {children}
        </div>
        <RowPaddle dir="next" visible={!edges.end} onPage={page} />
      </div>
    </section>
  );
}

/**
 * One end of a sideways scroller: a blurred edge with a chevron that pages it. Home's shelves and
 * the player's episode rail share it (#250). Its parent is a `.row-viewport` whose `data-start` and
 * `data-end` say which ends are reached; cards.css shows the paddles while the viewport is hovered
 * or holds the keyboard focus, and hides each at its end. It never takes the focus itself, so
 * the arrow keys go on from the card they were on.
 */
export function RowPaddle({
  dir,
  visible,
  onPage,
}: {
  dir: "prev" | "next";
  visible?: boolean;
  onPage: (dir: 1 | -1) => void;
}) {
  const prev = dir === "prev";
  return (
    <button
      className="row-paddle"
      data-dir={dir}
      data-visible={visible}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onPage(prev ? -1 : 1)}
      aria-label={prev ? "Scroll left" : "Scroll right"}
      tabIndex={-1}
    >
      {/* Barely blurred where it starts, gathering toward the edge, so it has no visible inner line. */}
      <EdgeBlur edge={prev ? "left" : "right"} layers={6} step={0.9} curve={1.6} />
      {prev ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );
}
