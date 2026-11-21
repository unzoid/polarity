import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { DownloadButton } from "../components/DownloadButton";
import { Info, Instant } from "../components/icons";
import { Img } from "../components/Img";
import { AudioSettings } from "../components/player/AudioSettings";
import { isMpv, type MediaLike } from "../components/player/mpvMedia";
import type { OptionColumn, OptionItem } from "../components/player/OptionsOverlay";
import { SubtitleSettings } from "../components/player/SubtitleSettings";
import { VideoBackdrop } from "../components/player/VideoBackdrop";
import { SourceFilterBar } from "../components/SourceFilters";
import { useSourceRowPress } from "../components/SourceInfo";
import { StillPlaceholder } from "../components/StillPlaceholder";
import { airLabel, formatRemaining, shortRuntime } from "../lib/format";
import { episodeState, watchedFraction } from "../lib/library";
import { os } from "../lib/platform";
import type { useSourceFilters } from "../lib/playback";
import { SLEEP_CHOICES, type SleepChoice } from "../lib/playback/sleepTimer";
import type { ContentType, Meta, Progress, SubtitleStyle, Video } from "../lib/types";
import { useLayer } from "../lib/ui";
import { IconPlayRing } from "../phone/icons";
import {
  IconCheck,
  IconPlayerClose,
  IconShuffle,
  IconTune,
} from "./DeskPlayerIcons";
import { SeasonChooser, type SeasonOption } from "./SeasonChooser";

export type DeskSheetKind = "speed" | "sleep" | "tracks" | "episodes" | "sources" | "party";

const EXIT_MS = 180;
const INITIAL_SOURCES = 32;
const SOURCES_STEP = 32;
const FROST_SIZE = {
  top: [220, 110] as const,
  right: [110, 220] as const,
  bottom: [240, 48] as const,
};

/**
 * Shared edge-sheet shell for the desk Netflix player:
 * - "bottom": Speed slider bar (IMG_3254)
 * - "top": Audio & Subtitles sheet (IMG_3253) — bottom controls remain visible beneath it
 * - "right": Episodes drawer (IMG_3252), Sources, Sleep Timer, Watch Party
 *
 * Renders a live cropped frosted video backdrop (VideoBackdrop) so translucent glass matches
 * Netflix's iPad sheets over both mpv and HTML5 video on Windows/macOS.
 * Clicking the dimmed video outside closes the sheet without pausing playback.
 */
function DeskSheet({
  open,
  side,
  kind,
  label,
  media,
  onClose,
  instant = false,
  expanded = false,
  children,
}: {
  open: boolean;
  side: "top" | "bottom" | "right";
  kind: DeskSheetKind;
  label: string;
  media: MediaLike | null;
  onClose: () => void;
  instant?: boolean;
  expanded?: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const shown = open || mounted;

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), instant ? 0 : EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, instant]);

  useLayer(root, open, onClose, { modal: true });

  // Swallow Space/Enter inside sheets so the player underneath never toggles playback on sheet keypresses.
  useEffect(() => {
    if (!open || !shown) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        const t = e.target as HTMLElement | null;
        if (root.current?.contains(t)) e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, shown]);

  if (!shown) return null;

  return (
    <div
      ref={root}
      className="dk-pl-sheet-layer"
      data-side={side}
      data-kind={kind}
      data-open={open}
      data-instant={instant || undefined}
      data-expanded={expanded || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-layer=""
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && e.button === 0) {
          e.stopPropagation();
          onClose();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dk-pl-sheet" data-side={side} data-kind={kind}>
        {media && !(os === "android" && isMpv(media)) && (
          <VideoBackdrop
            media={media}
            className="dk-pl-frost"
            crop
            fade
            cropSize={FROST_SIZE[side]}
            cropFilter="blur(14px) saturate(92%)"
          />
        )}
        <button type="button" className="dk-pl-sheet-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <IconPlayerClose size={side === "bottom" ? 19 : 21} stroke={1.75} />
        </button>
        {children}
      </div>
    </div>
  );
}

/**
 * Playback Speed bottom sheet (IMG_3254): compact dark bottom bar, NO heading, thin horizontal track with crisp
 * white fill and white horizontal pill thumb, speed stops labelled underneath with "Normal" stacked under "1x".
 */
function DeskSpeedSheet({
  open,
  instant,
  media,
  speeds,
  value,
  onChange,
  label,
  onClose,
}: {
  open: boolean;
  instant: boolean;
  media: MediaLike | null;
  speeds: number[];
  value: number;
  onChange: (v: number) => void;
  label: (v: number) => string;
  onClose: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const at = Math.max(0, speeds.indexOf(value));
  const last = speeds.length - 1;
  const frac = last ? at / last : 0;

  const pick = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    const i = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * last);
    if (speeds[i] !== value) onChange(speeds[i]);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.drag = "";
    pick(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    delete e.currentTarget.dataset.drag;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const to =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? at - 1
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? at + 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    const i = Math.max(0, Math.min(last, to));
    if (i !== at) onChange(speeds[i]);
  };

  useLayoutEffect(() => {
    if (open) track.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <DeskSheet open={open} side="bottom" kind="speed" label="Playback Speed" media={media} instant={instant} onClose={onClose}>
      <div className="dk-pl-speed">
        <div
          ref={track}
          className="dk-pl-speed-track"
          role="slider"
          tabIndex={0}
          aria-label="Playback speed"
          aria-valuemin={speeds[0]}
          aria-valuemax={speeds[last]}
          aria-valuenow={value}
          aria-valuetext={label(value)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <span className="dk-pl-speed-rail" aria-hidden>
            <span className="dk-pl-speed-fill" style={{ transform: `scaleX(${frac})` }} />
          </span>
          <span className="dk-pl-speed-rider" style={{ left: `${frac * 100}%` }} aria-hidden>
            <span className="dk-pl-speed-thumb" />
          </span>
        </div>
        <div className="dk-pl-speed-stops" role="radiogroup" aria-label="Playback speed choices">
          {speeds.map((s, i) => {
            const selected = i === at;
            const pos = last ? (i / last) * 100 : 0;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={selected}
                className="dk-pl-speed-stop"
                style={{ left: `${pos}%` }}
                onClick={() => onChange(s)}
              >
                <span className="dk-pl-speed-val tabular">{s}x</span>
                {s === 1 && <span className="dk-pl-speed-norm">Normal</span>}
              </button>
            );
          })}
        </div>
      </div>
    </DeskSheet>
  );
}

/**
 * Audio & Subtitles top sheet (IMG_3253): full-width top sheet (~52% height) with bottom player controls
 * remaining visible underneath. Pure typography + crisp checkmarks (no white pill slabs). Audio and Subtitle
 * settings open cleanly in-place inside the same top sheet so the live video & real subtitles stay unobstructed
 * below (never duplicating subtitles).
 */
function DeskTracksSheet({
  open,
  instant,
  media,
  onClose,
  audioOptions,
  audioValue,
  onSelectAudio,
  canAudioSettings,
  audioSettingsOpen,
  onToggleAudioSettings,
  audioDelay,
  onAudioDelay,
  subOptions,
  subValue,
  onSelectSub,
  subsLoading,
  subSettingsOpen,
  onToggleSubSettings,
  subStyle,
  onSubStyleChange,
  subDelay,
  onSubDelay,
  onStepLine,
  secondSubtitles,
  onSecondSubtitlesChange,
  secondSubValue,
  onSelectSecondSub,
  canPosition,
}: {
  open: boolean;
  instant: boolean;
  media: MediaLike | null;
  onClose: () => void;
  audioOptions: OptionItem[];
  audioValue?: string;
  onSelectAudio: (id: string) => void;
  canAudioSettings: boolean;
  audioSettingsOpen: boolean;
  onToggleAudioSettings: () => void;
  audioDelay: number;
  onAudioDelay: (seconds: number) => void;
  subOptions: OptionItem[];
  subValue?: string;
  onSelectSub: (id: string) => void;
  subsLoading: boolean;
  subSettingsOpen: boolean;
  onToggleSubSettings: () => void;
  subStyle: SubtitleStyle;
  onSubStyleChange: (patch: Partial<SubtitleStyle>) => void;
  subDelay: number;
  onSubDelay: (seconds: number) => void;
  onStepLine?: (by: 1 | -1) => void;
  secondSubtitles: boolean;
  onSecondSubtitlesChange?: (on: boolean) => void;
  secondSubValue?: string;
  onSelectSecondSub?: (id: string) => void;
  canPosition: boolean;
}) {
  const audioListRef = useRef<HTMLDivElement>(null);
  const subListRef = useRef<HTMLDivElement>(null);
  const secondListRef = useRef<HTMLDivElement>(null);
  const prevState = useRef<{ open: boolean; sub: boolean; audio: boolean }>({ open, sub: subSettingsOpen, audio: audioSettingsOpen });
  const subTurnRef = useRef<"in" | "back" | undefined>(undefined);
  const audioTurnRef = useRef<"in" | "back" | undefined>(undefined);
  if (!open) {
    subTurnRef.current = undefined;
    audioTurnRef.current = undefined;
  } else if (prevState.current.open) {
    if (prevState.current.sub !== subSettingsOpen) subTurnRef.current = subSettingsOpen ? "in" : "back";
    if (prevState.current.audio !== audioSettingsOpen) audioTurnRef.current = audioSettingsOpen ? "in" : "back";
  }
  prevState.current = { open, sub: subSettingsOpen, audio: audioSettingsOpen };
  const subTurn = subTurnRef.current;
  const audioTurn = audioTurnRef.current;

  useLayoutEffect(() => {
    if (!open) return;
    for (const ref of [audioListRef, subListRef, secondListRef]) {
      const list = ref.current;
      const checked = list?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (list && checked) {
        list.scrollTop = Math.max(0, checked.offsetTop - list.clientHeight / 2 + checked.offsetHeight / 2);
      }
    }
  }, [open, audioSettingsOpen, subSettingsOpen]);

  const showSecond = secondSubtitles && !!onSelectSecondSub && !subSettingsOpen;
  const cols = subSettingsOpen ? 1 : showSecond ? 3 : 2;

  return (
    <DeskSheet
      open={open}
      side="top"
      kind="tracks"
      label="Audio & Subtitles"
      media={media}
      instant={instant}
      expanded={subSettingsOpen}
      onClose={onClose}
    >
      <div
        key={subSettingsOpen ? "sub-style" : "tracks"}
        className="dk-pl-tracks"
        data-cols={cols}
        data-sub-settings={subSettingsOpen || undefined}
        data-turn={subTurn}
      >
        {!subSettingsOpen && (
          <section className="dk-pl-tracks-col">
            <div className="dk-pl-tracks-head">
              <h2 className="dk-pl-tracks-title">Audio</h2>
              {canAudioSettings && (
                <button
                  type="button"
                  className="dk-pl-tune-btn"
                  aria-pressed={audioSettingsOpen}
                  aria-label="Audio settings"
                  title={audioSettingsOpen ? "Back to audio tracks" : "Audio settings"}
                  onClick={onToggleAudioSettings}
                >
                  <IconTune size={16} />
                  <span>{audioSettingsOpen ? "Tracks" : "Sound"}</span>
                </button>
              )}
            </div>
            {audioSettingsOpen ? (
              <div key="audio-settings" className="dk-pl-tracks-scroll dk-pl-settings-body dk-pl-pane" data-turn={audioTurn}>
                <AudioSettings delay={audioDelay} onDelay={onAudioDelay} />
              </div>
            ) : (
              <div key="audio-list" ref={audioListRef} className="dk-pl-tracks-scroll dk-pl-pane" data-turn={audioTurn} role="radiogroup" aria-label="Audio">
                {audioOptions.map((o) => {
                  const selected = o.id === audioValue;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={o.disabled}
                      className="dk-pl-track-row"
                      onClick={() => onSelectAudio(o.id)}
                    >
                      <span className="dk-pl-track-check" aria-hidden>
                        {selected && <IconCheck size={18} stroke={2.2} />}
                      </span>
                      <span className="dk-pl-track-text">
                        <span className="dk-pl-track-label">{o.label}</span>
                        {o.detail && <span className="dk-pl-track-detail">{o.detail}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <section className="dk-pl-tracks-col" data-wide={subSettingsOpen || undefined}>
          <div className="dk-pl-tracks-head">
            <h2 className="dk-pl-tracks-title">{subSettingsOpen ? "Subtitle Style" : "Subtitles"}</h2>
            <button
              type="button"
              className="dk-pl-tune-btn"
              aria-pressed={subSettingsOpen}
              aria-label="Subtitle settings"
              title={subSettingsOpen ? "Back to subtitles" : "Subtitle style & delay"}
              onClick={onToggleSubSettings}
            >
              <IconTune size={16} />
              <span>{subSettingsOpen ? "Tracks" : "Style"}</span>
            </button>
          </div>
          {subSettingsOpen ? (
            <div className="dk-pl-tracks-scroll dk-pl-settings-body dk-pl-sub-studio-host">
              <SubtitleSettings
                style={subStyle}
                onChange={onSubStyleChange}
                delay={subDelay}
                onDelay={onSubDelay}
                onStepLine={onStepLine}
                second={onSecondSubtitlesChange ? { on: secondSubtitles, onChange: onSecondSubtitlesChange } : undefined}
                canPosition={canPosition}
                look="studio"
              />
            </div>
          ) : (
            <div ref={subListRef} className="dk-pl-tracks-scroll" role="radiogroup" aria-label="Subtitles">
              {subOptions.length === 0 && subsLoading && <p className="dk-pl-empty">Loading…</p>}
              {subOptions.map((o) => {
                const selected = o.id === subValue;
                return (
                  <Fragment key={o.id}>
                    {o.heading && <p className="dk-pl-group-heading">{o.heading}</p>}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={o.disabled}
                      className="dk-pl-track-row"
                      onClick={() => onSelectSub(o.id)}
                    >
                      <span className="dk-pl-track-check" aria-hidden>
                        {selected && <IconCheck size={18} stroke={2.2} />}
                      </span>
                      <span className="dk-pl-track-text">
                        <span className="dk-pl-track-label">{o.label}</span>
                        {o.detail && <span className="dk-pl-track-detail">{o.detail}</span>}
                      </span>
                    </button>
                  </Fragment>
                );
              })}
            </div>
          )}
        </section>

        {showSecond && (
          <section className="dk-pl-tracks-col">
            <div className="dk-pl-tracks-head">
              <h2 className="dk-pl-tracks-title">Second Subtitles</h2>
            </div>
            <div ref={secondListRef} className="dk-pl-tracks-scroll" role="radiogroup" aria-label="Second Subtitles">
              {subOptions.map((o) => {
                const selected = o.id === secondSubValue;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={o.disabled}
                    className="dk-pl-track-row"
                    onClick={() => onSelectSecondSub?.(o.id)}
                  >
                    <span className="dk-pl-track-check" aria-hidden>
                      {selected && <IconCheck size={18} stroke={2.2} />}
                    </span>
                    <span className="dk-pl-track-text">
                      <span className="dk-pl-track-label">{o.label}</span>
                      {o.detail && <span className="dk-pl-track-detail">{o.detail}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </DeskSheet>
  );
}

/**
 * Episodes right drawer (IMG_3252): slides in over the right ~42% while main player controls stay visible
 * on the left. Rounded dark Season pill opening Netflix's ListDialog, clean episode rows with 16:9 still,
 * play ring only on non-playing episodes, bold title for current episode, download button on right, synopsis below.
 */
function DeskEpisodesSheet({
  open,
  instant,
  media,
  onClose,
  local,
  meta,
  seasonGroups,
  shownSeason,
  onSeason,
  episodes,
  numbers,
  playing,
  progress,
  still,
  onPlay,
  folderItems,
  shuffling,
  onToggleShuffle,
}: {
  open: boolean;
  instant: boolean;
  media: MediaLike | null;
  onClose: () => void;
  local: boolean;
  meta?: Meta;
  seasonGroups: SeasonOption[];
  shownSeason?: number;
  onSeason: (id: number) => void;
  episodes: Video[];
  numbers?: Map<string, number>;
  playing: string;
  progress: Map<string, Progress>;
  still: (v: Video) => string | undefined;
  onPlay: (id: string) => void;
  folderItems: OptionItem[];
  shuffling: boolean;
  onToggleShuffle: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const firstEp = episodes[0]?.id;
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (list && active) {
      list.scrollTop = Math.max(0, active.offsetTop - list.clientHeight / 3);
    } else if (list) {
      list.scrollTop = 0;
    }
  }, [open, firstEp, playing]);

  const seasonLabel = seasonGroups.find((g) => g.id === shownSeason)?.label ?? (shownSeason != null ? `Season ${shownSeason}` : "Episodes");

  return (
    <DeskSheet open={open} side="right" kind="episodes" label={local ? "In this folder" : "Episodes"} media={media} instant={instant} onClose={onClose}>
      <div className="dk-pl-drawer-head">
        {local ? (
          <h2 className="dk-pl-drawer-title">In this folder</h2>
        ) : seasonGroups.length > 1 ? (
          <SeasonChooser
            options={seasonGroups}
            value={shownSeason}
            currentLabel={seasonLabel}
            onPick={onSeason}
            triggerClassName="dk-pl-season-pill"
            popupClassName="dk-season-pop dk-season-pop-player"
            resetKey={open}
          />
        ) : (
          <span className="dk-pl-season-pill dk-pl-season-static">{seasonLabel}</span>
        )}
          {!local && (
            <button
              type="button"
              className="dk-pl-head-icon"
              aria-pressed={shuffling}
              aria-label="Shuffle"
              title={shuffling ? "Shuffle is on" : "Shuffle episodes"}
              onClick={onToggleShuffle}
            >
              <IconShuffle size={18} />
            </button>
          )}
        </div>

        <div ref={listRef} className="dk-pl-ep-scroll">
          {local ? (
            <div className="dk-pl-simple-list" role="radiogroup" aria-label="In this folder">
              {folderItems.map((o) => {
                const current = o.id === playing;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={current}
                    aria-current={current || undefined}
                    className="dk-pl-track-row"
                    onClick={() => {
                      if (current) return;
                      onClose();
                      onPlay(o.id);
                    }}
                  >
                    <span className="dk-pl-track-check" aria-hidden>
                      {current && <IconCheck size={18} stroke={2.2} />}
                    </span>
                    <span className="dk-pl-track-text">
                      <span className="dk-pl-track-label">{o.label}</span>
                      {o.detail && <span className="dk-pl-track-detail">{o.detail}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : !episodes.length ? (
            <p className="dk-pl-empty">No episodes in this season yet.</p>
          ) : (
            <ol className="dk-pl-ep-list">
              {episodes.map((v) => {
                const p = progress.get(v.id);
                const { released, openable, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
                const current = v.id === playing;
                const num = numbers?.get(v.id) ?? v.episode;
                const thumb = still(v);
                const runtime = inProgress && p ? formatRemaining(p.position, p.duration) : shortRuntime(meta?.runtime);
                return (
                  <li key={v.id} className="dk-pl-ep-item" aria-current={current || undefined} data-unwatched={!watched || undefined}>
                    <div className="dk-pl-ep-top">
                      <button
                        type="button"
                        className="dk-pl-ep-btn"
                        disabled={!openable}
                        aria-disabled={current || undefined}
                        aria-label={`${num}. ${v.title}${current ? ", playing" : ""}`}
                        onClick={() => {
                          if (current || !openable) return;
                          onClose();
                          onPlay(v.id);
                        }}
                      >
                        <span className="dk-pl-ep-thumb" data-unwatched={!watched || undefined}>
                          {thumb ? <Img src={thumb} alt="" /> : <StillPlaceholder />}
                          {!current && openable && (
                            <span className="dk-pl-ep-play" aria-hidden>
                              <IconPlayRing size={34} />
                            </span>
                          )}
                          {!watched && fraction > 0 && (
                            <span className="dk-pl-ep-bar" aria-hidden>
                              <span style={{ transform: `scaleX(${fraction})` }} />
                            </span>
                          )}
                        </span>
                        <span className="dk-pl-ep-info">
                          <span className="dk-pl-ep-title">
                            {num}. {v.title?.trim() || `Episode ${v.episode}`}
                          </span>
                          <span className="dk-pl-ep-meta tabular">{released ? runtime : airLabel(v)}</span>
                        </span>
                      </button>
                      {openable && meta && (
                        <DownloadButton item={meta} video={v} className="dk-pl-ep-dl" size={20} />
                      )}
                    </div>
                    {v.overview && <p className="dk-pl-ep-overview">{v.overview}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DeskSheet>
  );
}

/**
 * Sources right drawer: dark Netflix right sheet matching Episodes, with subtle quality pills, Filters popover,
 * and clean dark checkmark rows (no blinding white selection slab).
 */
function DeskSourcesSheet({
  open,
  instant,
  media,
  onClose,
  sourceFilters,
  hiddenSources,
  options,
  value,
  empty,
  onSelect,
}: {
  open: boolean;
  instant: boolean;
  media: MediaLike | null;
  onClose: () => void;
  sourceFilters: ReturnType<typeof useSourceFilters>;
  hiddenSources: number;
  options: OptionItem[];
  value?: string;
  empty?: string;
  onSelect: (id: string) => void;
}) {
  const selectedIdx = value !== undefined ? options.findIndex((o) => o.id === value) : -1;
  const minVisible = Math.max(INITIAL_SOURCES, selectedIdx >= 0 ? selectedIdx + 8 : 0);
  const [limit, setLimit] = useState(minVisible);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLimit((prev) => (prev < minVisible ? minVisible : options.length <= INITIAL_SOURCES ? minVisible : prev));
  }, [minVisible, options.length]);

  const shown = options.length > limit ? options.slice(0, limit) : options;
  const remaining = options.length - shown.length;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!open || !node || remaining <= 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => Math.min(options.length, n + SOURCES_STEP));
      },
      { root: listRef.current, rootMargin: "220px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [open, remaining, options.length, limit]);

  return (
    <DeskSheet open={open} side="right" kind="sources" label="Sources" media={media} instant={instant} onClose={onClose}>
      <div className="dk-pl-drawer-head dk-pl-sources-head">
        <h2 className="dk-pl-drawer-title">Sources</h2>
        <div className="dk-pl-sources-filters">
          <SourceFilterBar
            f={sourceFilters}
            tv={false}
            note={hiddenSources > 0 ? `${hiddenSources} more hidden by Settings → Sources` : undefined}
          />
        </div>
      </div>

      <div ref={listRef} className="dk-pl-ep-scroll dk-pl-sources-scroll" role="radiogroup" aria-label="Sources">
        {options.length === 0 && empty && <p className="dk-pl-empty">{empty}</p>}
        {shown.map((o) => (
          <Fragment key={o.id}>
            {o.heading && <p className="dk-pl-group-heading">{o.heading}</p>}
            <DeskSourceRow item={o} selected={o.id === value} onSelect={onSelect} />
          </Fragment>
        ))}
        {remaining > 0 && (
          <div ref={sentinelRef} className="dk-pl-show-more">
            <button type="button" onClick={() => setLimit((n) => Math.min(options.length, n + SOURCES_STEP))}>
              Show more ({remaining} left)
            </button>
          </div>
        )}
      </div>
    </DeskSheet>
  );
}

function DeskSourceRow({ item: o, selected, onSelect }: { item: OptionItem; selected: boolean; onSelect: (id: string) => void }) {
  const press = useSourceRowPress({ onPick: () => onSelect(o.id), onInfo: (a) => o.onInfo?.(a), onMenu: o.onMenu });
  return (
    <div className="dk-pl-src-wrap" data-selected={selected || undefined} data-ready={o.ready}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={o.disabled}
        className="dk-pl-src-row"
        title={o.note}
        onClick={() => onSelect(o.id)}
        {...(o.onInfo ? press : {})}
      >
        <span className="dk-pl-src-lead" aria-hidden>
          {selected ? <IconCheck size={17} stroke={2.3} /> : o.ready === "yes" ? <Instant size={15} fill="currentColor" strokeWidth={0} /> : null}
        </span>
        <span className="dk-pl-src-text">
          <span className="dk-pl-src-label">{o.label}</span>
          {o.detail && <span className="dk-pl-src-detail">{o.detail}</span>}
        </span>
        {o.badge && (
          <span className="dk-pl-src-badge" data-tone={o.badge.tone}>
            {o.badge.icon ?? o.badge.text}
          </span>
        )}
      </button>
      {o.onInfo && (
        <button
          type="button"
          className="dk-pl-src-info"
          aria-label="Source info"
          title="Source info"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const row = e.currentTarget.previousElementSibling as HTMLElement;
            o.onInfo?.(row);
          }}
        >
          <Info size={18} />
        </button>
      )}
    </div>
  );
}

/** Sleep Timer right sheet: clean Netflix checkmark rows matching Audio & Subtitles. */
function DeskSleepSheet({
  open,
  instant,
  media,
  onClose,
  type,
  choice,
  onSelect,
}: {
  open: boolean;
  instant: boolean;
  media: MediaLike | null;
  onClose: () => void;
  type: ContentType;
  choice: SleepChoice;
  onSelect: (choice: SleepChoice) => void;
}) {
  const choices = SLEEP_CHOICES.map((c) => (c.id === "episode" && type !== "series" ? { ...c, label: "When this video ends" } : c));
  return (
    <DeskSheet open={open} side="right" kind="sleep" label="Sleep Timer" media={media} instant={instant} onClose={onClose}>
      <div className="dk-pl-drawer-head">
        <h2 className="dk-pl-drawer-title">Sleep Timer</h2>
      </div>
      <div className="dk-pl-ep-scroll">
        <div className="dk-pl-simple-list" role="radiogroup" aria-label="Sleep Timer">
          {choices.map((c) => {
            const selected = c.id === choice;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className="dk-pl-track-row"
                onClick={() => {
                  onSelect(c.id as SleepChoice);
                  onClose();
                }}
              >
                <span className="dk-pl-track-check" aria-hidden>
                  {selected && <IconCheck size={18} stroke={2.2} />}
                </span>
                <span className="dk-pl-track-text">
                  <span className="dk-pl-track-label">{c.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </DeskSheet>
  );
}

/** Watch Party right drawer: hosts existing PartyStart / PartyRoomPane / PartySettingsPane in Netflix dark sheet. */
function DeskPartySheet({
  open,
  instant,
  media,
  onClose,
  columns,
}: {
  open: boolean;
  instant: boolean;
  media: MediaLike | null;
  onClose: () => void;
  columns: OptionColumn[];
}) {
  return (
    <DeskSheet open={open} side="right" kind="party" label="Watch Party" media={media} instant={instant} onClose={onClose}>
      <div className="dk-pl-drawer-head">
        <h2 className="dk-pl-drawer-title">Watch Party</h2>
      </div>
      <div className="dk-pl-ep-scroll dk-pl-party-body">
        {columns.map((col) => (
          <section key={col.title} className="dk-pl-party-sec">
            {!col.titleHidden && <h3 className="dk-pl-party-heading">{col.title}</h3>}
            {col.content}
          </section>
        ))}
      </div>
    </DeskSheet>
  );
}

export interface DeskPlayerSheetsProps {
  media: MediaLike | null;
  options: DeskSheetKind | null;
  instant: boolean;
  onClose: () => void;
  // Speed
  speeds: number[];
  rate: number;
  onRate: (r: number) => void;
  speedLabel: (r: number) => string;
  // Sleep
  type: ContentType;
  sleepChoice: SleepChoice;
  onSleepChoice: (c: SleepChoice) => void;
  // Tracks
  audioOptions: OptionItem[];
  audioValue?: string;
  onSelectAudio: (id: string) => void;
  canAudioSettings: boolean;
  audioSettingsOpen: boolean;
  onToggleAudioSettings: () => void;
  audioDelay: number;
  onAudioDelay: (seconds: number) => void;
  subOptions: OptionItem[];
  subValue?: string;
  onSelectSub: (id: string) => void;
  subsLoading: boolean;
  subSettingsOpen: boolean;
  onToggleSubSettings: () => void;
  subStyle: SubtitleStyle;
  onSubStyleChange: (patch: Partial<SubtitleStyle>) => void;
  subDelay: number;
  onSubDelay: (seconds: number) => void;
  onStepLine?: (by: 1 | -1) => void;
  secondSubtitles: boolean;
  onSecondSubtitlesChange?: (on: boolean) => void;
  secondSubValue?: string;
  onSelectSecondSub?: (id: string) => void;
  canPosition: boolean;
  // Episodes
  local: boolean;
  meta?: Meta;
  seasonGroups: SeasonOption[];
  shownSeason?: number;
  onSeason: (id: number) => void;
  episodes: Video[];
  numbers?: Map<string, number>;
  playing: string;
  progress: Map<string, Progress>;
  still: (v: Video) => string | undefined;
  onPlayEpisode: (id: string) => void;
  folderItems: OptionItem[];
  shuffling: boolean;
  onToggleShuffle: () => void;
  // Sources
  sourceFilters: ReturnType<typeof useSourceFilters>;
  hiddenSources: number;
  sourceOptions: OptionItem[];
  currentSource?: string;
  sourcesEmpty?: string;
  onSelectSource: (id: string) => void;
  // Watch Party
  canParty: boolean;
  partyColumns: OptionColumn[];
}

export function DeskPlayerSheets(props: DeskPlayerSheetsProps) {
  const { media, options, instant, onClose } = props;
  return (
    <>
      <DeskSpeedSheet
        open={options === "speed"}
        instant={instant}
        media={media}
        speeds={props.speeds}
        value={props.rate}
        onChange={props.onRate}
        label={props.speedLabel}
        onClose={onClose}
      />
      <DeskSleepSheet
        open={options === "sleep"}
        instant={instant}
        media={media}
        type={props.type}
        choice={props.sleepChoice}
        onSelect={props.onSleepChoice}
        onClose={onClose}
      />
      <DeskTracksSheet
        open={options === "tracks"}
        instant={instant}
        media={media}
        onClose={onClose}
        audioOptions={props.audioOptions}
        audioValue={props.audioValue}
        onSelectAudio={props.onSelectAudio}
        canAudioSettings={props.canAudioSettings}
        audioSettingsOpen={props.audioSettingsOpen}
        onToggleAudioSettings={props.onToggleAudioSettings}
        audioDelay={props.audioDelay}
        onAudioDelay={props.onAudioDelay}
        subOptions={props.subOptions}
        subValue={props.subValue}
        onSelectSub={props.onSelectSub}
        subsLoading={props.subsLoading}
        subSettingsOpen={props.subSettingsOpen}
        onToggleSubSettings={props.onToggleSubSettings}
        subStyle={props.subStyle}
        onSubStyleChange={props.onSubStyleChange}
        subDelay={props.subDelay}
        onSubDelay={props.onSubDelay}
        onStepLine={props.onStepLine}
        secondSubtitles={props.secondSubtitles}
        onSecondSubtitlesChange={props.onSecondSubtitlesChange}
        secondSubValue={props.secondSubValue}
        onSelectSecondSub={props.onSelectSecondSub}
        canPosition={props.canPosition}
      />
      <DeskEpisodesSheet
        open={options === "episodes"}
        instant={instant}
        media={media}
        onClose={onClose}
        local={props.local}
        meta={props.meta}
        seasonGroups={props.seasonGroups}
        shownSeason={props.shownSeason}
        onSeason={props.onSeason}
        episodes={props.episodes}
        numbers={props.numbers}
        playing={props.playing}
        progress={props.progress}
        still={props.still}
        onPlay={props.onPlayEpisode}
        folderItems={props.folderItems}
        shuffling={props.shuffling}
        onToggleShuffle={props.onToggleShuffle}
      />
      <DeskSourcesSheet
        open={options === "sources"}
        instant={instant}
        media={media}
        onClose={onClose}
        sourceFilters={props.sourceFilters}
        hiddenSources={props.hiddenSources}
        options={props.sourceOptions}
        value={props.currentSource}
        empty={props.sourcesEmpty}
        onSelect={props.onSelectSource}
      />
      {props.canParty && (
        <DeskPartySheet
          open={options === "party"}
          instant={instant}
          media={media}
          onClose={onClose}
          columns={props.partyColumns}
        />
      )}
    </>
  );
}
