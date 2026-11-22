import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Filters, Info, Instant, Puzzle, Reset } from "./icons";
import { useNavigation } from "../lib/router";
import { openSettings, type PageId } from "../lib/settings";
import { useMeta, usePartialStreams, useStreams } from "../lib/net";
import { runtimeSeconds } from "../lib/format";
import { airedAt, NO_TORRENT_ENGINE, READY_CHECKS, readinessNote, sourceKey, sourceRow, useReadiness, useSourceFilters, useTitleSettings } from "../lib/playback";
import { featuredMatchSummary, sourceBadges } from "../lib/playback/sources";
import { torrentsPlayHere } from "../lib/platform";
import type { ContentType, RankedStream, Readiness } from "../lib/types";
import { SourceFilterBar } from "./SourceFilters";
import { Button } from "./ui/Button";
import { errorMessage } from "../lib/errors";
import { Skeleton } from "./ui/Skeleton";
import { TvSourceMenu, useSourceInfo, useSourceRowPress } from "./SourceInfo";

/**
 * Sources for one video, with the filters on top (add-on, resolution,
 * language, size, tags) and the sort. Sorted by best match, the top pick
 * stands out above the rest; any other sort is one plain list.
 */
/** Initial source rows rendered when opening the drawer; additional batches load seamlessly as you scroll. */
const INITIAL_SOURCES = 24;
const SOURCES_STEP = 24;

export function StreamList({
  type,
  videoId,
  currentKey,
  onPick,
  tv = false,
}: {
  type: ContentType;
  videoId: string;
  currentKey?: string;
  onPick: (s: RankedStream) => void;
  /** TV mode: filters as chip rows a remote can reach. */
  tv?: boolean;
}) {
  const { tab } = useNavigation();
  // Desktop settings are the overlay over this page; TV has its own settings screen (no "addons" page on TV).
  const showSettings = (page: PageId) => (tv ? tab({ name: "settings", page }) : openSettings(page));
  const whole = useStreams(type, videoId);
  // While add-ons are still answering, the sources so far: the list fills in as each one does.
  const partial = usePartialStreams(type, videoId);
  const { isError, error } = whole;
  const data = whole.data ?? (whole.isLoading && partial?.streams.length ? partial : undefined);
  const isLoading = whole.isLoading && !data;
  // An anime's languages (default filter, Best Match) are Settings → Anime's (#235).
  const { settings } = useTitleSettings(type, videoId);
  // The title's length, for Best Match's bitrates: its meta is usually already loaded (the page behind this list).
  const { data: meta } = useMeta(type, videoId.replace(/:\d+:\d+$/, ""));
  const f = useSourceFilters(data?.streams, settings, undefined, runtimeSeconds(meta?.runtime), airedAt(meta, videoId), meta?.details?.originalLanguage);
  // The first few sources in view get a look ahead of time (#21).
  const ready = useReadiness(f.view.slice(0, Math.min(f.matched, READY_CHECKS)).map(({ r }) => r));
  // A source's "i" panel (#229); on TV, the row's menu that leads to it.
  const info = useSourceInfo(tv);
  const [menu, setMenu] = useState<{ s: RankedStream; anchor: HTMLElement } | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const handlePick = useCallback((s: RankedStream) => onPickRef.current(s), []);
  const infoRef = useRef({ info, f });
  infoRef.current = { info, f };
  const showInfo = useCallback(
    (s: RankedStream, anchor: HTMLElement) =>
      infoRef.current.info.show(
        s,
        sourceRow(s).title,
        { filter: infoRef.current.f.filter, sort: infoRef.current.f.sort, match: infoRef.current.f.match(s), best: infoRef.current.f.bestMatch },
        anchor,
      ),
    [],
  );
  const openMenu = useCallback((s: RankedStream, anchor: HTMLElement) => setMenu({ s, anchor }), []);
  // Cap initial DOM rows to keep opening the Sources drawer instant even when add-ons return 200+ streams;
  // scrolling near the bottom automatically appends the next batch via IntersectionObserver.
  const [visible, setVisible] = useState(INITIAL_SOURCES);
  const moreRef = useRef<HTMLDivElement>(null);
  const filterSig = `${videoId}|${f.sort}|${JSON.stringify(f.filter)}`;
  useEffect(() => setVisible(INITIAL_SOURCES), [filterSig]);
  const totalCount = f.view.length;
  const remaining = Math.max(0, totalCount - visible);
  useEffect(() => {
    const node = moreRef.current;
    if (!node || remaining <= 0 || typeof IntersectionObserver === "undefined") return;
    const root = node.closest<HTMLElement>(".sheet-body") ?? null;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((n) => Math.min(totalCount, n + SOURCES_STEP));
      },
      { root, rootMargin: "260px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [remaining, totalCount, visible]);

  if (isLoading) {
    return (
      <div className="stream-list" aria-busy="true" aria-label="Loading sources">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="stream-skeleton-row" data-featured={i === 0 || undefined} aria-hidden>
            <Skeleton className="stream-skeleton-lead" />
            <div className="stream-skeleton-text">
              <div className="stream-skeleton-main">
                <Skeleton shape="line" width={i === 0 ? "5.5rem" : "4.5rem"} height="0.95rem" />
                <Skeleton className="stream-skeleton-badge" />
                {i < 2 && <Skeleton className="stream-skeleton-badge" />}
              </div>
              <Skeleton shape="line" width={i % 2 === 0 ? "62%" : "48%"} height="0.75rem" />
            </div>
            <Skeleton shape="line" width="3.25rem" height="0.85rem" />
          </div>
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="stream-empty">
        <p className="t-body muted">Couldn't load sources: {errorMessage(error)}</p>
        <Button variant="glass" onClick={() => void whole.refetch()}>
          <Reset size={18} />
          Try Again
        </Button>
      </div>
    );
  }
  if (!data) return null;

  const hidden = data.hidden ?? 0;
  if (!data.streams.length) {
    const timedOut = !hidden && data.failed.length > 0;
    return (
      <div className="stream-empty">
        <p className="t-body muted">
          {hidden
            ? `All ${hidden} sources are hidden by your source filters.`
            : timedOut
              ? "Your add-ons didn't respond in time."
              : tv
                ? "No sources found. Manage stream add-ons in desktop mode, or try again."
                : "No sources found."}
        </p>
        <div className="stream-empty-actions">
          {hidden ? (
            <Button variant="glass" onClick={() => showSettings("sources")}>
              <Filters size={18} />
              Source Filters
            </Button>
          ) : timedOut ? (
            <>
              <Button variant="glass" onClick={() => void whole.refetch()}>
                <Reset size={18} />
                Try Again
              </Button>
              {!tv && (
                <Button variant="plain" onClick={() => showSettings("addons")}>
                  <Puzzle size={18} />
                  Manage Add-ons
                </Button>
              )}
            </>
          ) : tv ? (
            <Button variant="glass" onClick={() => void whole.refetch()}>
              <Reset size={18} />
              Try Again
            </Button>
          ) : (
            <Button variant="glass" onClick={() => showSettings("addons")}>
              <Puzzle size={18} />
              Manage Add-ons
            </Button>
          )}
        </div>
      </div>
    );
  }

  // What matches the filters; with filters that only order (Settings → Sources), the rest follows it.
  const shown = f.view.slice(0, f.matched).map(({ r }) => r);
  const others = f.view.slice(f.matched, f.otherEpisodes).map(({ r }) => r);
  // Files that name another episode than this one (#225): last, under their own heading.
  const otherEpisodes = f.view.slice(f.otherEpisodes).map(({ r }) => r);
  const grouped = f.sort === "best";
  // Don't feature a known-dead source as Best Match when a working source exists right below it.
  const bestIndex = grouped ? shown.findIndex((s) => ready.get(streamKey(s))?.state !== "notReady") : -1;
  const pickAt = bestIndex >= 0 ? bestIndex : 0;
  const best = shown[pickAt];
  const rest = shown.filter((_, i) => i !== pickAt);
  const bestSummary = grouped && best ? featuredMatchSummary(f.match(best)) : null;

  // Budget the currently visible row cap across groups in display order so at most `visible` rows mount at once.
  let budget = visible;
  const showBest = grouped && !!best && budget > 0;
  if (showBest) budget--;
  const visibleRest = grouped ? rest.slice(0, budget) : [];
  if (grouped) budget = Math.max(0, budget - visibleRest.length);
  const visibleFlat = !grouped ? shown.slice(0, budget) : [];
  if (!grouped) budget = Math.max(0, budget - visibleFlat.length);
  const visibleOthers = others.slice(0, budget);
  budget = Math.max(0, budget - visibleOthers.length);
  const visibleOtherEpisodes = otherEpisodes.slice(0, budget);

  return (
    <div className="stream-list">
      <SourceFilterBar f={f} tv={tv} />

      {!shown.length && (
        <div className="stream-empty">
          <p className="t-body muted">No sources match these filters.</p>
          <Button variant="glass" onClick={f.clear}>
            Clear Filters
          </Button>
        </div>
      )}

      {/* Sorted by best match, the top pick is set apart; the quality control
          above already sorts by picture, so the rest is one plain list. */}
      {showBest && best && (
        <>
          <div className="stream-group-label t-micro faint">Best Match</div>
          <StreamRow
            s={best}
            featured
            matchSummary={bestSummary}
            current={currentKey === streamKey(best)}
            readiness={ready.get(streamKey(best))}
            onPick={handlePick}
            onInfo={showInfo}
            onMenu={tv ? openMenu : undefined}
          />
          {visibleRest.length > 0 && <div className="stream-group-label t-micro faint">More Sources</div>}
          {visibleRest.map((s) => (
            <StreamRow key={streamKey(s)} s={s} current={currentKey === streamKey(s)} readiness={ready.get(streamKey(s))} onPick={handlePick} onInfo={showInfo} onMenu={tv ? openMenu : undefined} />
          ))}
        </>
      )}
      {!grouped && visibleFlat.map((s) => <StreamRow key={streamKey(s)} s={s} current={currentKey === streamKey(s)} readiness={ready.get(streamKey(s))} onPick={handlePick} onInfo={showInfo} onMenu={tv ? openMenu : undefined} />)}
      {visibleOthers.length > 0 && (
        <>
          <div className="stream-group-label t-micro faint">Other Sources</div>
          {visibleOthers.map((s) => (
            <StreamRow key={streamKey(s)} s={s} current={currentKey === streamKey(s)} readiness={ready.get(streamKey(s))} onPick={handlePick} onInfo={showInfo} onMenu={tv ? openMenu : undefined} />
          ))}
        </>
      )}

      {visibleOtherEpisodes.length > 0 && (
        <>
          <div className="stream-group-label t-micro faint">Other Episodes</div>
          {visibleOtherEpisodes.map((s) => (
            <StreamRow key={streamKey(s)} s={s} current={currentKey === streamKey(s)} readiness={ready.get(streamKey(s))} onPick={handlePick} onInfo={showInfo} onMenu={tv ? openMenu : undefined} />
          ))}
        </>
      )}

      {remaining > 0 && (
        <div ref={moreRef} className="stream-more">
          <Button variant="plain" size="sm" onClick={() => setVisible((n) => Math.min(totalCount, n + SOURCES_STEP))}>
            Show more ({remaining} left)
          </Button>
        </div>
      )}

      <div className="stream-footer" aria-live="polite">
        {!!data.waiting?.length && (
          <p className="stream-status t-caption" role="status">
            <span className="stream-status-dot" aria-hidden />
            <span>Asking {data.waiting.join(", ")}…</span>
          </p>
        )}
        {hidden > 0 && <p className="stream-failed t-caption faint">{hidden} more hidden by Settings → Sources</p>}
        {data.failed.length > 0 && (
          <p className="stream-failed t-caption faint">
            <AlertCircle size={12} /> No response from {data.failed.join(", ")}
          </p>
        )}
      </div>
      {menu && (
        <TvSourceMenu
          anchor={menu.anchor}
          onClose={() => {
            setMenu(null);
            menu.anchor.focus({ preventScroll: true });
          }}
          onInfo={() => {
            setMenu(null);
            showInfo(menu.s, menu.anchor);
          }}
          onPlay={() => {
            setMenu(null);
            onPick(menu.s);
          }}
        />
      )}
      {info.panel}
    </div>
  );
}

const StreamRow = memo(function StreamRow({
  s,
  featured,
  matchSummary,
  current,
  readiness,
  onPick,
  onInfo,
  onMenu,
}: {
  s: RankedStream;
  featured?: boolean;
  matchSummary?: string | null;
  current?: boolean;
  /** What a look at the link ahead of time found (#21); unchecked rows look as before. */
  readiness?: Readiness;
  onPick: (s: RankedStream) => void;
  /** The source's "i" panel (#229), opened from this row. */
  onInfo: (s: RankedStream, anchor: HTMLElement) => void;
  /** TV: the row's menu (Info, Play), from holding OK or the options button. */
  onMenu?: (s: RankedStream, anchor: HTMLElement) => void;
}) {
  const row = sourceRow(s);
  const badges = sourceBadges(s);
  // No torrent engine here (iOS, #458): the row says so, whatever a check found.
  const unplayable = !!s.stream.infoHash && !torrentsPlayHere;
  const isReady = !unplayable && readiness?.state === "ready";
  const note = unplayable ? { short: "Can't play on this device", long: NO_TORRENT_ENGINE } : readiness && readinessNote(readiness);
  // The release name is for the curious: on hover, not in the row.
  const release = s.stream.title ?? s.stream.description;
  const ref = useRef<HTMLButtonElement>(null);
  const press = useSourceRowPress({ onPick: () => onPick(s), onInfo: (a) => onInfo(s, a), onMenu: onMenu ? (a) => onMenu(s, a) : undefined });
  const button = (
    <button
      ref={ref}
      className="stream-row pressable"
      data-featured={featured}
      data-current={current}
      data-ready={isReady ? "yes" : unplayable || readiness?.state === "notReady" ? "no" : undefined}
      onClick={() => onPick(s)}
      {...press}
      title={[note?.long, release].filter(Boolean).join("\n") || undefined}
    >
      <span className="stream-lead" aria-hidden>
        {current ? <Check size={16} strokeWidth={2.5} /> : isReady ? <Instant size={15} fill="currentColor" strokeWidth={0} /> : null}
      </span>
      <span className="stream-text">
        <span className="stream-main">
          <span className="stream-title">{row.title}</span>
          {badges.map((b) => (
            <span key={b.key} className="badge" data-kind={b.kind}>
              {b.label}
            </span>
          ))}
          {s.quality.lowQualitySource && <span className="badge badge-bad">CAM</span>}
          {s.stream.infoHash && <span className="badge">Torrent</span>}
        </span>
        <span className="stream-sub t-caption">
          {current ? "Playing · " : note ? `${note.short} · ` : ""}
          {row.detail}
        </span>
        {featured && matchSummary && <span className="stream-match-pill">{matchSummary}</span>}
      </span>
      {row.size && <span className="stream-size tabular">{row.size}</span>}
    </button>
  );
  if (onMenu) return button;
  // Desktop: the "i" sits on the row's right, shown while the row is hovered or focused (sheet.css).
  return (
    <div className="stream-row-wrap">
      {button}
      <button className="stream-info" aria-label="Source info" title="Source info" onClick={() => onInfo(s, ref.current ?? document.body)}>
        <Info size={18} />
      </button>
    </div>
  );
});

export function streamKey(s: RankedStream | { stream: RankedStream["stream"] }) {
  return sourceKey(s.stream);
}
