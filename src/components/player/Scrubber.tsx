import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatTime } from "../../lib/format";
import { preloadImage } from "../../lib/net";
import type { SeekCue, SeekTrack, SkipSegments, Span } from "../../lib/types";
import { isMpv, type MediaLike, type MpvChapter } from "./mpvMedia";

/** Rendered thumbnail width; tiles are cropped from the sheet and scaled to this. */
const PREVIEW_W = 240;

const SEGMENT_KINDS = ["recap", "intro", "outro", "postCredits"] as const;
type SegmentKind = (typeof SEGMENT_KINDS)[number];

const SEGMENT_LABEL: Record<SegmentKind, string> = {
  recap: "Recap",
  intro: "Intro",
  outro: "Credits",
  postCredits: "Post-Credits",
};

/**
 * The timeline. Everything that changes per frame (fill, knob, buffered
 * ranges, hover position, thumbnail) is written straight to `style` from a
 * rAF loop or pointer handler — never through React state — so scrubbing
 * costs no renders beyond the time label.
 *
 * Dragging tracks the pointer 1:1 (with pointer capture, so leaving the bar
 * doesn't drop the drag) and commits the seek on release: network streams
 * shouldn't be asked to seek 60 times a second.
 *
 * Thumbnails (optional) come from a Seekr track: one tile per ~10s cue, cut
 * out of a sprite sheet with background-position — no canvas, no decoding.
 */
export function Scrubber({
  media: video,
  previews,
  span,
  segments,
  active = true,
  onSeek,
  onScrubChange,
}: {
  /** The intro, when passed alone: shown as a faint band on the bar. */
  span?: Span | null;
  /** All known segments (`intro`, `recap`, `outro`, `postCredits`) for timeline markers and hover labels. */
  segments?: SkipSegments | null;
  /** A <video> or the mpv-backed equivalent. */
  media: MediaLike | null;
  /** Seekr thumbnail track, when the feature is on and the title has one. */
  previews?: SeekTrack | null;
  /** Whether the timeline is visible on screen; when hidden, the 60fps paint loop sleeps. */
  active?: boolean;
  onSeek: (t: number) => void;
  /** Keeps the player's chrome visible for the whole drag, even when the pointer drifts off the bar. */
  onScrubChange?: (scrubbing: boolean) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const barWidth = useRef(0);
  const fill = useRef<HTMLDivElement>(null);
  const buffered = useRef<HTMLDivElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tipWidth = useRef(0);
  const preview = useRef<HTMLDivElement>(null);
  const tile = useRef<HTMLDivElement>(null);
  const scrubbing = useRef<number | null>(null); // fraction while dragging
  const hoverFrac = useRef<number | null>(null);
  const scrubChangeRef = useRef(onScrubChange);
  scrubChangeRef.current = onScrubChange;
  const [tipText, setTipText] = useState("0:00");
  const [chapters, setChapters] = useState<MpvChapter[]>([]);
  const [dur, setDur] = useState(0);

  const resolvedSegments = useMemo<SkipSegments | undefined>(() => {
    if (segments) return { ...segments, intro: segments.intro ?? span ?? null };
    return span ? { intro: span } : undefined;
  }, [segments, span]);

  const placeTip = (f: number) => {
    const w = barWidth.current || bar.current?.clientWidth || 0;
    const tw = tipWidth.current;
    if (!tip.current || w <= 0) return;
    const x = Math.min(Math.max(tw / 2, w - tw / 2), Math.max(tw / 2, f * w));
    tip.current.style.transform = `translateX(${x - tw / 2}px)`;
  };

  // Track bar and tooltip widths via ResizeObserver so rAF and pointermove never force synchronous layout reads.
  useEffect(() => {
    const el = bar.current;
    const tipEl = tip.current;
    if (el) barWidth.current = el.clientWidth;
    if (tipEl) tipWidth.current = tipEl.offsetWidth;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (bar.current) barWidth.current = bar.current.clientWidth;
      if (tip.current) tipWidth.current = tip.current.offsetWidth;
      if (hoverFrac.current != null) placeTip(hoverFrac.current);
    });
    if (el) ro.observe(el);
    if (tipEl) ro.observe(tipEl);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (scrubbing.current != null) {
        scrubbing.current = null;
        scrubChangeRef.current?.(false);
      }
    },
    [],
  );

  // Chapters (mpv only) and the duration they're laid out against.
  useEffect(() => {
    if (!video) return;
    const sync = () => {
      setChapters(isMpv(video) ? [...video.chapters] : []);
      setDur(video.duration || 0);
    };
    sync();
    for (const e of ["chapters", "loadedmetadata", "durationchange"]) video.addEventListener(e, sync);
    return () => {
      for (const e of ["chapters", "loadedmetadata", "durationchange"]) video.removeEventListener(e, sync);
    };
  }, [video]);

  // Warm the first sheets so the first hover isn't blank.
  useEffect(() => {
    const sheets = [...new Set(previews?.cues.map((c) => c.sheet))];
    sheets.slice(0, 2).forEach(preloadImage);
  }, [previews]);

  // Paint loop: runs only while the controls are visible (`active`) and playing (or scrubbing);
  // syncs before paint whenever controls reappear so the playhead is already in place on frame 1.
  useLayoutEffect(() => {
    if (!video || !active) return;
    let raf = 0;
    const paintOnce = () => {
      const d = video.duration || 0;
      const f = Math.min(1, Math.max(0, scrubbing.current ?? (d ? video.currentTime / d : 0)));
      const w = barWidth.current || bar.current?.clientWidth || 0;
      if (fill.current) fill.current.style.transform = `scaleX(${f})`;
      if (knob.current) knob.current.style.translate = `${f * w}px 0`;
      if (buffered.current) {
        let bStart = 0;
        let bEnd = 0;
        if (d > 0 && video.buffered.length > 0) {
          const now = video.currentTime;
          for (let i = 0; i < video.buffered.length; i++) {
            const s = video.buffered.start(i);
            const e = video.buffered.end(i);
            if (s <= now + 1 && e >= now - 1) {
              bStart = s;
              bEnd = e;
              for (let j = i + 1; j < video.buffered.length; j++) {
                if (video.buffered.start(j) <= bEnd + 1) bEnd = Math.max(bEnd, video.buffered.end(j));
                else break;
              }
              break;
            }
          }
        }
        const spanFrac = d > 0 ? Math.min(1, Math.max(0, (bEnd - bStart) / d)) : 0;
        const startPx = d > 0 ? Math.max(0, (bStart / d) * w) : 0;
        buffered.current.style.transform = spanFrac > 0 ? `translateX(${startPx}px) scaleX(${spanFrac})` : "scaleX(0)";
      }
    };
    const loop = () => {
      raf = 0;
      paintOnce();
      if (!video.paused || scrubbing.current != null) {
        raf = requestAnimationFrame(loop);
      }
    };
    const startLoop = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const onDiscrete = () => {
      paintOnce();
      if (!video.paused || scrubbing.current != null) startLoop();
    };
    paintOnce();
    if (!video.paused || scrubbing.current != null) startLoop();
    const events = ["play", "playing", "pause", "seeked", "timeupdate", "progress", "loadedmetadata", "emptied"] as const;
    for (const e of events) video.addEventListener(e, onDiscrete);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      for (const e of events) video.removeEventListener(e, onDiscrete);
    };
  }, [video, active]);

  const fractionAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  };

  const showTile = (seconds: number) => {
    const el = tile.current;
    const durationMs = (video?.duration || 0) * 1000;
    if (!el || !previews || !durationMs) return;
    // A different release of the title (extra logo, black frames) shifts the whole
    // preview timeline by a constant: the sprites' source duration minus ours.
    const offset = previews.sourceDurationMs ? previews.sourceDurationMs - durationMs : 0;
    const cue = nearestCue(previews.cues, seconds * 1000 + offset);
    if (!cue || !(cue.w > 0) || !(cue.h > 0)) return;
    if (preview.current) preview.current.style.height = `${Math.round((PREVIEW_W * cue.h) / cue.w)}px`;
    el.style.width = `${cue.w}px`;
    el.style.height = `${cue.h}px`;
    el.style.backgroundImage = `url("${cue.sheet}")`;
    el.style.backgroundPosition = `-${cue.x}px -${cue.y}px`;
    el.style.transform = `scale(${PREVIEW_W / cue.w})`;
    preloadImage(cue.sheet);
  };

  const showTip = (clientX: number) => {
    const f = fractionAt(clientX);
    hoverFrac.current = f;
    if (hover.current) hover.current.style.transform = `scaleX(${f})`;
    placeTip(f);
    const t = f * (video?.duration || 0);
    const label = segmentLabelAt(resolvedSegments, t) ?? chapterTitleAt(chapters, t);
    const nextText = label ? `${formatTime(t)} · ${label}` : formatTime(t);
    setTipText((prev) => (prev === nextText ? prev : nextText));
    showTile(t);
  };

  const syncPlayhead = (f: number) => {
    const w = barWidth.current || bar.current?.clientWidth || 0;
    if (fill.current) fill.current.style.transform = `scaleX(${f})`;
    if (knob.current) knob.current.style.translate = `${f * w}px 0`;
  };

  const firstCue = previews?.cues[0];
  const initialPreviewH = firstCue && firstCue.w > 0 && firstCue.h > 0 ? Math.round((PREVIEW_W * firstCue.h) / firstCue.w) : Math.round((PREVIEW_W * 9) / 16);

  return (
    <div
      className="scrubber"
      ref={bar}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(video?.duration || 0)}
      aria-valuenow={Math.round(video?.currentTime || 0)}
      tabIndex={-1}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const f = fractionAt(e.clientX);
        scrubbing.current = f; // jump to the press point immediately
        e.currentTarget.dataset.scrubbing = "true";
        scrubChangeRef.current?.(true);
        syncPlayhead(f);
        showTip(e.clientX);
      }}
      onPointerMove={(e) => {
        showTip(e.clientX);
        if (scrubbing.current != null) {
          const f = fractionAt(e.clientX);
          scrubbing.current = f;
          syncPlayhead(f);
        }
      }}
      onPointerUp={(e) => {
        if (scrubbing.current == null) return;
        const f = fractionAt(e.clientX);
        e.currentTarget.dataset.scrubbing = "false";
        scrubChangeRef.current?.(false);
        onSeek(f * (video?.duration || 0));
        // Hold the knob where it was dropped until the video catches up.
        requestAnimationFrame(() => (scrubbing.current = null));
      }}
      onPointerCancel={(e) => {
        const was = scrubbing.current != null;
        scrubbing.current = null;
        e.currentTarget.dataset.scrubbing = "false";
        if (was) scrubChangeRef.current?.(false);
      }}
      onPointerLeave={() => {
        if (scrubbing.current == null) hoverFrac.current = null;
      }}
    >
      <div className="scrubber-track">
        <div className="scrubber-buffered" ref={buffered} />
        <div className="scrubber-hover" ref={hover} />
        <div className="scrubber-fill" ref={fill} />
        {resolvedSegments &&
          dur > 0 &&
          SEGMENT_KINDS.map((kind) => {
            const sp = resolvedSegments[kind];
            if (!sp) return null;
            const start = Math.max(0, sp.start);
            const end = Math.min(dur, sp.end);
            if (!(end > start)) return null;
            return (
              <div
                key={kind}
                className={kind === "intro" ? "scrubber-segment scrubber-intro" : "scrubber-segment"}
                data-kind={kind}
                title={SEGMENT_LABEL[kind]}
                style={{ left: `${(start / dur) * 100}%`, width: `${((end - start) / dur) * 100}%` }}
              />
            );
          })}
        {dur > 0 &&
          chapters.map((c, i) =>
            // The first chapter starts at 0: nothing to separate.
            c.time > 0.5 && c.time < dur - 0.5 ? <div key={i} className="scrubber-chapter" style={{ left: `${(c.time / dur) * 100}%` }} /> : null,
          )}
      </div>
      <div className="scrubber-knob" ref={knob} />
      <div className="scrubber-tip" data-preview={!!previews} ref={tip}>
        {previews && (
          <div className="scrubber-preview" ref={preview} style={{ width: PREVIEW_W, height: initialPreviewH }}>
            <div className="scrubber-tile" ref={tile} />
          </div>
        )}
        <span className="scrubber-time t-caption tabular">{tipText}</span>
      </div>
    </div>
  );
}

function segmentLabelAt(segments: SkipSegments | undefined, t: number): string | undefined {
  if (!segments) return undefined;
  for (const kind of SEGMENT_KINDS) {
    const sp = segments[kind];
    if (sp && t >= sp.start && t < sp.end) return SEGMENT_LABEL[kind];
  }
  return undefined;
}

function chapterTitleAt(chapters: MpvChapter[], t: number): string | undefined {
  let active: MpvChapter | undefined;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].time <= t) active = chapters[i];
    else break;
  }
  const title = active?.title?.trim();
  return title || undefined;
}

/**
 * The cue whose frame is closest to `ms`. A cue's frame is captured at its
 * start, so past a cue's midpoint the *next* cue's frame is the nearer one.
 */
function nearestCue(cues: SeekCue[], ms: number): SeekCue | undefined {
  if (!cues.length) return undefined;
  let lo = 0;
  let hi = cues.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cues[mid].startMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  const cue = cues[lo];
  const next = cues[lo + 1];
  return next && ms - cue.startMs > cue.endMs - ms ? next : cue;
}
