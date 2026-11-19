import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../../lib/ui";
import { iconButtonClass } from "../ui/Button";

/** How long after the last press the count folds back into the circle. */
const HOLD_MS = 900;

/**
 * The centre seek-back / seek-ahead button. Each seek (`kick` goes up: a press, a double-tap, the
 * seek keys, the controller) slides the number out of the circle to its outer side as "+10" ("−10"
 * going back) while the arrow turns, and each further seek while it's out adds to it (+20, +30), so
 * you see how far you've gone; a moment after the last one it folds back in. With the controls
 * hidden, this is the only part of them that shows (player.css).
 */
export function SkipTransport({
  direction,
  seconds,
  kick,
  onSkip,
  label,
  title,
  onPointerEnter,
  onPointerLeave,
}: {
  direction: "back" | "forward";
  seconds: number;
  /** Goes up by one for every seek in this direction, from wherever it came. */
  kick: number;
  onSkip: () => void;
  label: string;
  title?: string;
  onPointerEnter?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLButtonElement>;
}) {
  // Out: the count is beside the circle. The count stays as it was while it folds back in.
  const [out, setOut] = useState(false);
  const outRef = useRef(false);
  const [count, setCount] = useState(seconds);
  const timer = useRef<number>(undefined);
  const seen = useRef(kick);
  const arrowRef = useRef<SVGSVGElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const flip = direction === "back";

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (kick === seen.current) return;
    const steps = Math.max(1, kick - seen.current);
    seen.current = kick;
    const wasOut = outRef.current;
    const delta = steps * seconds;
    setCount((c) => (wasOut ? c + delta : delta));
    outRef.current = true;
    setOut(true);
    if (wasOut && !prefersReducedMotion()) {
      totalRef.current?.animate?.([{ scale: 1 }, { scale: 1.18, offset: 0.35 }, { scale: 1 }], {
        duration: 220,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      });
      arrowRef.current?.animate?.([{ rotate: "0deg" }, { rotate: flip ? "-18deg" : "18deg", offset: 0.35 }, { rotate: "0deg" }], {
        duration: 240,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      });
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      outRef.current = false;
      setOut(false);
    }, HOLD_MS);
  }, [kick, seconds, flip]);

  return (
    <button
      className={iconButtonClass("transport", "skip-transport")}
      data-dir={direction}
      data-out={out}
      onClick={onSkip}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      aria-label={label}
      title={title}
    >
      <svg ref={arrowRef} className="skip-arrow" width={56} height={56} viewBox="0 0 24 24" fill="none" aria-hidden>
        <g transform={flip ? "translate(24 0) scale(-1 1)" : undefined} stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </g>
      </svg>
      <span className="skip-num tabular" aria-hidden>
        {seconds}
      </span>
      <span ref={totalRef} className="skip-total tabular" aria-hidden>
        {flip ? "−" : "+"}
        {count}
      </span>
    </button>
  );
}
