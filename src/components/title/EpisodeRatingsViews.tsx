import { AnimatePresence, motion, type Variants } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { formatDate } from "../../lib/format";
import { formatRating, timeline, trend, type RatingCell, type RatingGrid } from "../../lib/library";
import type { Video } from "../../lib/types";
import { prefersReducedMotion, springs } from "../../lib/ui";
import { Dropdown } from "../Dropdown";
import { Segmented } from "../Segmented";
import { Switch } from "../ui/Switch";
import { RatingsLegend, RatingsTable } from "./EpisodeRatings";

type View = "grid" | "wrapped" | "timeline" | "list";
type Axis = "vertical" | "horizontal";

const VIEWS: { id: View; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "wrapped", label: "Wrapped" },
  { id: "timeline", label: "Timeline" },
  { id: "list", label: "Episode List" },
];

/** The view last picked, kept on this device only (a convenience; the grid when it can't be read). */
const VIEW_KEY = "polar.episodeRatingsView";
const AXIS_KEY = "polar.episodeRatingsAxis";
function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEWS.some((o) => o.id === v) ? (v as View) : "grid";
  } catch {
    return "grid";
  }
}
function savedAxis(): Axis {
  try {
    return localStorage.getItem(AXIS_KEY) === "horizontal" ? "horizontal" : "vertical";
  } catch {
    return "vertical";
  }
}

/**
 * Switching views: the new one comes in from the side of the tab picked and the old one leaves the other way, both
 * a little blurred while they move, as the frame's height eases to the new one's. With less motion only the fade
 * stays; a change made with the arrow keys (they repeat) is instant.
 */
const SLIDE = 56;
type Motion = { dir: number; still: boolean };
const panel: Variants = {
  enter: ({ dir, still }: Motion) => ({ x: still ? 0 : dir * SLIDE, opacity: 0, filter: still ? "blur(0px)" : "blur(4px)" }),
  center: { x: 0, opacity: 1, filter: "blur(0px)" },
  exit: ({ dir, still }: Motion) => ({ x: still ? 0 : -dir * SLIDE, opacity: 0, filter: still ? "blur(0px)" : "blur(4px)" }),
};

/** An element's height as it changes, for a frame that eases to fit what's in it. */
function useHeight(ref: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return height;
}

/**
 * Episode Ratings' views in its dialog: the Grid (a column per season), Wrapped (each season's episodes as tiles
 * with their titles), a Timeline of every episode (or each season's average) along the show, and an Episode List of
 * one season at a time with its titles, votes and dates. One legend serves them all; any episode opens through
 * `onOpen`.
 */
export function EpisodeRatingsViews({ grid, onOpen }: { grid: RatingGrid; onOpen: (v: Video) => void }) {
  const [view, setView] = useState<View>(savedView);
  const [axis, setAxis] = useState<Axis>(savedAxis);
  const [dir, setDir] = useState(1);
  const byKey = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const height = useHeight(content);
  const still = prefersReducedMotion() || byKey.current;

  const pick = (v: View) => {
    setDir(VIEWS.findIndex((o) => o.id === v) >= VIEWS.findIndex((o) => o.id === view) ? 1 : -1);
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not kept: the grid next time.
    }
  };
  const pickAxis = (next: Axis) => {
    if (next === axis) return;
    setDir(next === "horizontal" ? 1 : -1);
    setAxis(next);
    try {
      localStorage.setItem(AXIS_KEY, next);
    } catch {
      // Not kept: vertical next time.
    }
  };
  const transition = byKey.current ? { duration: 0 } : prefersReducedMotion() ? { duration: 0.15 } : springs.tabs;
  const panelKey = view === "grid" ? `grid-${axis}` : view;

  return (
    <div className="ratings-views" data-view={view}>
      <div className="ratings-views-bar" onKeyDownCapture={() => (byKey.current = true)} onPointerDownCapture={() => (byKey.current = false)}>
        <Segmented label="Chart" value={view} onChange={pick} options={VIEWS} />
        {view === "grid" && (
          <div className="ratings-axis" role="radiogroup" aria-label="Grid orientation">
            <button
              type="button"
              role="radio"
              aria-checked={axis === "vertical"}
              aria-label="Vertical (seasons as columns)"
              title="Seasons as columns"
              onClick={() => pickAxis("vertical")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <rect x="2" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" />
                <rect x="6.4" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" opacity="0.72" />
                <rect x="10.8" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" opacity="0.45" />
              </svg>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={axis === "horizontal"}
              aria-label="Horizontal (seasons as rows)"
              title="Seasons as rows"
              onClick={() => pickAxis("horizontal")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <rect x="2.5" y="2" width="11" height="3.2" rx="1" fill="currentColor" />
                <rect x="2.5" y="6.4" width="11" height="3.2" rx="1" fill="currentColor" opacity="0.72" />
                <rect x="2.5" y="10.8" width="11" height="3.2" rx="1" fill="currentColor" opacity="0.45" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <motion.div className="ratings-views-frame" initial={false} animate={height === null ? undefined : { height }} transition={transition}>
        <div ref={content}>
          <AnimatePresence mode="popLayout" initial={false} custom={{ dir, still }}>
            <motion.div
              key={panelKey}
              className="ratings-views-panel"
              custom={{ dir, still }}
              variants={panel}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              {view === "grid" ? (
                <RatingsTable grid={grid} dialog legend={false} horizontal={axis === "horizontal"} onOpen={onOpen} />
              ) : view === "wrapped" ? (
                <Wrapped grid={grid} onOpen={onOpen} />
              ) : view === "timeline" ? (
                <Timeline grid={grid} onOpen={onOpen} />
              ) : (
                <EpisodeList grid={grid} onOpen={onOpen} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
      <RatingsLegend />
    </div>
  );
}

const stepStyle = (step: number | undefined) => (step === undefined ? undefined : ({ "--step-fill": `var(--rating-${step})` } as CSSProperties));
const shownRating = (c: RatingCell) => (c.rating === undefined ? "–" : formatRating(c.rating));
const episodeName = (c: RatingCell) => `Season ${c.video.season}, episode ${c.video.episode}${c.video.title ? `, ${c.video.title}` : ""}`;
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** Each season's episodes as tiles that wrap: the number and title on top, the rating large beneath. */
function Wrapped({ grid, onOpen }: { grid: RatingGrid; onOpen: (v: Video) => void }) {
  return (
    <div className="ratings-wrapped ratings-scroll">
      {grid.rows.map((row) => (
        <section key={row.season} aria-label={`Season ${row.season}`}>
          <h3 className="ratings-season-head">
            Season {row.season}
            {row.average !== undefined && (
              <span className="ratings-season-avg" data-step={row.averageStep} style={stepStyle(row.averageStep)}>
                {formatRating(row.average)}
              </span>
            )}
          </h3>
          <div className="ratings-wrapped-tiles">
            {row.cells.map((cell, i) =>
              cell.released ? (
                <button
                  key={i}
                  type="button"
                  className="ratings-tile"
                  data-step={cell.step}
                  style={stepStyle(cell.step)}
                  aria-label={`${episodeName(cell)}, ${cell.rating === undefined ? "no rating" : `rated ${shownRating(cell)}`}`}
                  title={cell.video.title || undefined}
                  onClick={() => onOpen(cell.video)}
                >
                  <span className="ratings-tile-head" aria-hidden>
                    <span className="ratings-tile-ep">E{i + 1}</span>
                    {cell.video.title && <span className="ratings-tile-title">{cell.video.title}</span>}
                  </span>
                  <span className="ratings-tile-num" aria-hidden>
                    {shownRating(cell)}
                  </span>
                </button>
              ) : null,
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One season at a time, picked from a menu: its episodes as rows with their rating, title, number, air date and votes. */
function EpisodeList({ grid, onOpen }: { grid: RatingGrid; onOpen: (v: Video) => void }) {
  const [season, setSeason] = useState(grid.rows[0]?.season ?? 1);
  const row = grid.rows.find((r) => r.season === season) ?? grid.rows[0];
  return (
    <div className="ratings-list">
      <div className="ratings-list-head">
        <Dropdown
          label="Season"
          value={String(row.season)}
          onChange={(v) => setSeason(Number(v))}
          options={grid.rows.map((r) => ({ value: String(r.season), label: `Season ${r.season}` }))}
        />
        {row.average !== undefined && (
          <span className="ratings-list-avg t-callout">
            Season average
            <span className="ratings-season-avg" data-step={row.averageStep} style={stepStyle(row.averageStep)}>
              {formatRating(row.average)}
            </span>
          </span>
        )}
      </div>
      <ol className="ratings-list-rows ratings-scroll">
        {row.cells.map((cell, i) => (
          <li key={i}>
            <button type="button" className="ratings-list-row" disabled={!cell.released} onClick={() => onOpen(cell.video)}>
              <span className="ratings-list-badge" data-step={cell.step} style={stepStyle(cell.step)}>
                {cell.released ? shownRating(cell) : "·"}
              </span>
              <span className="ratings-list-text">
                <span className="ratings-list-title">{cell.video.title || `Episode ${cell.video.episode}`}</span>
                <span className="ratings-list-sub tabular">
                  Episode {i + 1}
                  {cell.released ? ` · ${formatDate(cell.video.released)}` : " · Not out yet"}
                </span>
              </span>
              {cell.votes ? <span className="ratings-list-votes tabular">{compact.format(cell.votes)} votes</span> : <span />}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The chart's size in its own units; it scales to the dialog's width. */
const W = 880;
const H = 320;
const PAD = { left: 36, right: 14, top: 22, bottom: 30 };
/** Season numbers closer than this (in the chart's units) would run into each other: the later one is left out. */
const LABEL_GAP = 34;

type Point = { x: number; rating: number; step: number; label: string; video?: Video };

/**
 * A smooth line through the points that never overshoots them (monotone cubic, Fritsch–Carlson): a rating curve
 * that bulged past 10, or below an episode's real score, would misstate it.
 */
export function smoothPath(xs: readonly number[], ys: readonly number[]): string {
  const n = xs.length;
  if (n === 0) return "";
  if (n < 3) return xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join("");
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let path = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (xs[i + 1] - xs[i]) / 3;
    path += `C${(xs[i] + h).toFixed(1)},${(ys[i] + m[i] * h).toFixed(1)} ${(xs[i + 1] - h).toFixed(1)},${(ys[i + 1] - m[i + 1] * h).toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  return path;
}

/** Which season labels to draw: left to right, each at least `gap` past the last one drawn. */
export function spacedLabels(centres: readonly number[], gap = LABEL_GAP): boolean[] {
  let last = -Infinity;
  return centres.map((c) => {
    if (c - last < gap) return false;
    last = c;
    return true;
  });
}

/**
 * Every rated episode along the show (or each season's average): a soft line through dots coloured by rating, one
 * y axis from a little under the lowest rating to 10, seasons as alternating bands named under them where there's
 * room. The trendline (episodes only) is a moving average in the accent colour over a faint fill. Hovering a dot
 * names it; a dot opens its episode.
 */
function Timeline({ grid, onOpen }: { grid: RatingGrid; onOpen: (v: Video) => void }) {
  const [by, setBy] = useState<"episodes" | "seasons">("episodes");
  const [showTrend, setShowTrend] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const line = useMemo(() => timeline(grid), [grid]);

  const points: Point[] = useMemo(() => {
    if (by === "seasons")
      return grid.rows
        .flatMap((row) =>
          row.average === undefined || row.averageStep === undefined
            ? []
            : [{ x: 0, rating: row.average, step: row.averageStep, label: `Season ${row.season} · average ${formatRating(row.average)}` }],
        )
        .map((p, i) => ({ ...p, x: i }));
    return line.points.map((p) => {
      const v = grid.rows[p.row].cells[p.col].video;
      return { x: p.x, rating: p.rating, step: p.step, video: v, label: `S${v.season} E${v.episode}${v.title ? ` · ${v.title}` : ""} · ★ ${formatRating(p.rating)}` };
    });
  }, [by, grid, line]);

  if (!points.length) return <p className="ratings-empty t-callout faint">No rated episodes to chart yet.</p>;

  const low = Math.max(0, Math.floor(Math.min(...points.map((p) => p.rating)) - 0.4));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = plotW / points.length;
  const sx = (x: number) => PAD.left + (x + 0.5) * step;
  const sy = (r: number) => PAD.top + ((10 - r) / (10 - low)) * plotH;
  const xs = points.map((_, i) => sx(i));
  const ticks = Array.from({ length: 10 - low + 1 }, (_, i) => low + i);
  const seasons =
    by === "episodes" ? line.seasons : grid.rows.filter((r) => r.average !== undefined).map((r, i) => ({ season: r.season, from: i, to: i }));
  const centres = seasons.map((s) => PAD.left + ((s.from + s.to + 1) / 2) * step);
  const shown = spacedLabels(centres);
  const radius = by === "seasons" ? 6 : points.length > 150 ? 3.5 : 4.5;
  const trendYs = by === "episodes" && showTrend && points.length > 4 ? trend(points.map((p) => p.rating)).map(sy) : null;
  const trendPath = trendYs ? smoothPath(xs, trendYs) : "";
  const hovered = hover === null ? null : points[hover];

  return (
    <div className="ratings-timeline">
      <div className="ratings-timeline-bar">
        <Segmented
          label="Points"
          value={by}
          onChange={(v) => {
            setBy(v);
            setHover(null);
          }}
          options={[
            { id: "episodes", label: "Episodes" },
            { id: "seasons", label: "Seasons" },
          ]}
        />
        {by === "episodes" && (
          <label className="ratings-timeline-trend t-callout">
            Trendline
            <Switch checked={showTrend} onChange={setShowTrend} />
          </label>
        )}
      </div>
      <div className="ratings-timeline-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Ratings ${by === "episodes" ? "of every episode" : "of each season"} along the show`}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="ratings-trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="ratings-timeline-fill-top" />
              <stop offset="100%" className="ratings-timeline-fill-bottom" />
            </linearGradient>
          </defs>
          {seasons.map((s, i) =>
            i % 2 ? (
              <rect key={s.season} className="ratings-timeline-band" x={PAD.left + s.from * step} y={PAD.top} width={(s.to - s.from + 1) * step} height={plotH} rx={6} />
            ) : null,
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line className="ratings-timeline-grid" x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} />
              <text className="ratings-timeline-axis" x={PAD.left - 8} y={sy(t)} dy="0.32em" textAnchor="end">
                {t.toFixed(1)}
              </text>
            </g>
          ))}
          {seasons.map((s, i) =>
            shown[i] ? (
              <text key={s.season} className="ratings-timeline-axis" x={centres[i]} y={H - 10} textAnchor="middle">
                S{s.season}
              </text>
            ) : null,
          )}
          {trendYs && (
            <path className="ratings-timeline-area" d={`${trendPath}L${xs[xs.length - 1].toFixed(1)},${PAD.top + plotH}L${xs[0].toFixed(1)},${PAD.top + plotH}Z`} />
          )}
          <path className="ratings-timeline-line" d={smoothPath(xs, points.map((p) => sy(p.rating)))} />
          {trendYs && <path className="ratings-timeline-trendline" d={trendPath} />}
          {points.map((p, i) => (
            <g key={i} className="ratings-timeline-dot" onPointerEnter={() => setHover(i)} onClick={() => p.video && onOpen(p.video)}>
              {/* A hit target bigger than the dot. */}
              <circle cx={xs[i]} cy={sy(p.rating)} r={Math.max(9, step / 2)} fill="transparent" />
              <circle cx={xs[i]} cy={sy(p.rating)} r={hover === i ? radius + 2 : radius} style={{ fill: `var(--rating-${p.step})` }} className="ratings-timeline-mark" />
              {by === "seasons" && (
                <text className="ratings-timeline-value" x={xs[i]} y={sy(p.rating) - 12} textAnchor="middle">
                  {formatRating(p.rating)}
                </text>
              )}
            </g>
          ))}
        </svg>
        {hovered && (
          <div
            className="ratings-timeline-tip"
            style={{ left: `${(xs[hovered.x] / W) * 100}%`, top: `${(sy(hovered.rating) / H) * 100}%` }}
            data-flip={xs[hovered.x] > W * 0.7 || undefined}
            data-below={sy(hovered.rating) < H * 0.2 || undefined}
          >
            {hovered.label}
          </div>
        )}
      </div>
    </div>
  );
}
