import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { episodeState, watchedFraction } from "../../lib/library";
import { airLabel, formatRemaining, shortRuntime } from "../../lib/format";
import type { Meta, Progress, Video } from "../../lib/types";
import { Check, ChevronLeft } from "../icons";
import { Img } from "../Img";
import { StillPlaceholder } from "../StillPlaceholder";

/**
 * The desktop dock's Episodes (Player.tsx `dock`): a season's episodes as a list, each its number, title and how
 * far in it is. The one playing, and the one under the pointer or the keyboard, open up to show the still, the
 * synopsis and the length. The heading names the season; with more than one, it opens the list of seasons
 * (browsing them doesn't stop what's playing). Picking an episode plays it.
 */
export function EpisodeMenu({
  meta,
  seasons,
  season,
  onSeason,
  episodes,
  numbers,
  playing,
  progress,
  still,
  onPlay,
  header,
}: {
  meta: Meta;
  seasons: { id: number; label: string }[];
  season: number;
  onSeason: (id: number) => void;
  episodes: Video[];
  /** Each episode's number for display, by id: its place in a chosen episode order. */
  numbers?: Map<string, number>;
  playing: string;
  progress: Map<string, Progress>;
  still: (v: Video) => string | undefined;
  onPlay: (id: string) => void;
  /** Beside the heading (shuffle). */
  header?: ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const label = seasons.find((s) => s.id === season)?.label ?? `Season ${season}`;

  // Open on the one playing, in the middle of the list (the list scrolls itself, not the page).
  const first = episodes[0]?.id;
  useLayoutEffect(() => {
    const el = root.current;
    const list = el?.closest<HTMLElement>(".options-list");
    const current = el?.querySelector<HTMLElement>('.ep-menu-item[aria-current="true"]');
    if (!list) return;
    list.scrollTop = current ? current.offsetTop - list.clientHeight / 2 + current.offsetHeight / 2 : 0;
  }, [first, playing, picking]);

  if (picking)
    return (
      <div ref={root} className="ep-menu">
        <div className="ep-menu-head">
          <button className="ep-menu-back" onClick={() => setPicking(false)} aria-label={`Back to ${label}`}>
            <ChevronLeft size={18} strokeWidth={2.4} />
          </button>
          <h3 className="ep-menu-title">Seasons</h3>
        </div>
        <div role="radiogroup" aria-label="Seasons" className="ep-menu-seasons">
          {seasons.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={s.id === season}
              className="options-item"
              onClick={() => {
                onSeason(s.id);
                setPicking(false);
              }}
            >
              <span className="options-check" aria-hidden>
                {s.id === season && <Check size={16} strokeWidth={2.5} />}
              </span>
              <span className="options-text">
                <span className="options-label">{s.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div ref={root} className="ep-menu">
      <div className="ep-menu-head">
        {seasons.length > 1 && (
          <button className="ep-menu-back" onClick={() => setPicking(true)} aria-label="Seasons">
            <ChevronLeft size={18} strokeWidth={2.4} />
          </button>
        )}
        <h3 className="ep-menu-title">{label}</h3>
        {header}
      </div>
      {!episodes.length && <p className="options-empty">No episodes in this season yet.</p>}
      {episodes.map((v) => {
        const p = progress.get(v.id);
        const { released, openable, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
        const current = v.id === playing;
        const length = inProgress && p ? formatRemaining(p.position, p.duration) : shortRuntime(meta.runtime);
        return (
          <div key={v.id} className="ep-menu-item" aria-current={current || undefined} data-unwatched={!watched}>
            <button
              className="ep-menu-row"
              disabled={!openable}
              aria-disabled={current || undefined}
              onClick={() => !current && onPlay(v.id)}
              aria-label={`${numbers?.get(v.id) ?? v.episode}. ${v.title}${current ? ", playing" : watched ? ", watched" : ""}`}
            >
              <span className="ep-menu-num tabular">{numbers?.get(v.id) ?? v.episode}</span>
              <span className="ep-menu-name">{v.title}</span>
              <span className="ep-menu-bar" aria-hidden>
                <span style={{ transform: `scaleX(${watched ? 1 : fraction})` }} />
              </span>
            </button>
            <div className="ep-menu-more" aria-hidden>
              <div>
                <div className="ep-menu-body">
                  <span className="ep-menu-still">
                    {still(v) ? <Img src={still(v)} alt="" /> : <StillPlaceholder />}
                    {current && <span className="ep-menu-now">Playing</span>}
                  </span>
                  <span className="ep-menu-text">
                    {v.overview && <span className="ep-menu-overview">{v.overview}</span>}
                    <span className="ep-menu-meta tabular">{released ? length : airLabel(v)}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
