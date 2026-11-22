import { AnimatePresence, motion, type Variants } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Video } from "../lib/types";
import { prefersReducedMotion, springs } from "../lib/ui";
import { IconSearch } from "../phone/icons";

const swapVariants: Variants = {
  enter: ({ dir, still, slide }: { dir: number; still: boolean; slide: number }) => ({
    x: still ? 0 : dir * slide,
    opacity: 0,
    filter: still ? "blur(0px)" : "blur(4px)",
  }),
  center: { x: 0, opacity: 1, filter: "blur(0px)" },
  exit: ({ dir, still, slide }: { dir: number; still: boolean; slide: number }) => ({
    x: still ? 0 : -dir * slide,
    opacity: 0,
    filter: still ? "blur(0px)" : "blur(4px)",
  }),
};

/**
 * Smooth directional slide + blur + height-ease view swapper (matching EpisodeRatingsViews):
 * keeps tab transitions and episode layout switches crisp instead of abrupt layout snaps.
 */
export function AnimatedSwap({
  activeKey,
  dir = 1,
  slide = 44,
  children,
}: {
  activeKey: string | number;
  dir?: number;
  slide?: number;
  children: ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const still = prefersReducedMotion();

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      setHeight((prev) => (prev !== null && Math.abs(prev - next) < 0.5 ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const transition = still ? { duration: 0.15 } : springs.tabs;
  const custom = { dir, still, slide };

  return (
    <motion.div
      className="dk-swap-frame"
      initial={false}
      animate={height === null ? undefined : { height }}
      transition={transition}
    >
      <div ref={innerRef} className="dk-swap-inner">
        <AnimatePresence mode="popLayout" initial={false} custom={custom}>
          <motion.div
            key={activeKey}
            className="dk-swap-panel"
            custom={custom}
            variants={swapVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** Matches an episode by number ("42", "ep 42", "s1e42", "#42"), title, or overview. */
export function filterEpisodes<T extends Video>(episodes: readonly T[], rawQuery: string, numberOf?: (v: T) => number): T[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return episodes as T[];

  // Extract explicit episode number patterns: "42", "#42", "ep 42", "ep.42", "e42", "s2e42", "s2 e42"
  const seMatch = q.match(/^s(\d+)\s*e(\d+)$/i);
  const numMatch = !seMatch ? q.match(/^(?:ep\.?\s*|episode\s*|e|#)?(\d+)$/i) : null;
  const targetSeason = seMatch ? Number(seMatch[1]) : undefined;
  const targetNum = seMatch ? Number(seMatch[2]) : numMatch ? Number(numMatch[1]) : undefined;

  return episodes.filter((v) => {
    const num = numberOf ? numberOf(v) : v.episode;
    if (targetNum !== undefined) {
      if (targetSeason !== undefined && v.season !== targetSeason) return false;
      if (num === targetNum || v.episode === targetNum || String(num).startsWith(String(targetNum))) return true;
    }
    const title = v.title?.toLowerCase() ?? "";
    if (title.includes(q)) return true;
    const overview = v.overview?.toLowerCase() ?? "";
    if (overview.includes(q)) return true;
    return false;
  });
}

/**
 * Expandable episode search tucked directly inside the `.dk-eps-layout` pill:
 * starts as a compact search icon button matching the layout radios, and smoothly
 * expands into an inline filter input for jumping straight to any episode.
 */
export function EpisodeSearch({
  value,
  onChange,
  resetKey,
}: {
  value: string;
  onChange: (next: string) => void;
  resetKey?: string | number;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    onChange("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const expanded = open || value.length > 0;

  return (
    <div ref={wrapRef} className="dk-eps-search" data-open={expanded || undefined}>
      <button
        type="button"
        className="dk-eps-search-btn"
        aria-label={expanded ? "Focus episode search" : "Search episodes"}
        aria-expanded={expanded}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <IconSearch size={15} stroke={2.1} />
      </button>
      <input
        ref={inputRef}
        type="search"
        className="dk-eps-search-input"
        aria-label="Search episodes"
        placeholder="Episode # or title"
        autoComplete="off"
        spellCheck={false}
        tabIndex={expanded ? 0 : -1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          if (!value && !wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (value) onChange("");
            else {
              setOpen(false);
              inputRef.current?.blur();
            }
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="dk-eps-search-clear"
          aria-label="Clear episode search"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
