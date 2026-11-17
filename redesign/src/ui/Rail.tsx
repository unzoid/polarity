import { useRef, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Button, IconButton } from "./Button";

/**
 * A titled row that scrolls sideways: the heading and "See all" on the left edge of the page, the arrows at its
 * right for a mouse, the cards snapping to the page's margin.
 */
export function Rail({ title, onSeeAll, children, kind = "poster" }: { title: ReactNode; onSeeAll?: () => void; children: ReactNode; kind?: "poster" | "still" }) {
  const track = useRef<HTMLDivElement>(null);
  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <section className="rail">
      <div className="section section-head">
        <h2 className="t-section">{title}</h2>
        <div className="rail-tools">
          {onSeeAll && (
            <Button kind="quiet" onClick={onSeeAll}>
              See all
            </Button>
          )}
          <IconButton icon={ChevronLeftIcon} label="Scroll back" className="rail-arrow" onClick={() => page(-1)} />
          <IconButton icon={ChevronRightIcon} label="Scroll on" className="rail-arrow" onClick={() => page(1)} />
        </div>
      </div>
      <div className="rail-track" data-kind={kind} ref={track}>
        {children}
      </div>
    </section>
  );
}

/** Placeholder cards while a rail loads, in the shape it will have. */
export function RailSkeleton({ kind = "poster", count = 8 }: { kind?: "poster" | "still"; count?: number }) {
  return (
    <div className="rail-track" data-kind={kind} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card">
          <div className={`skeleton frame-${kind}`} />
          <div className="skeleton card-line" />
        </div>
      ))}
    </div>
  );
}
