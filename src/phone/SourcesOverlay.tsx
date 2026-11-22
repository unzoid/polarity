import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/sources-overlay.css";
import { AlertCircle, Check, Filters, Instant, Puzzle, Reset } from "../components/icons";
import { activeSourceFilters, sourceFilterSections, type SourceFilterSection } from "../components/SourceFilters";
import { useSourceInfo, useSourceRowPress } from "../components/SourceInfo";
import { streamKey } from "../components/StreamList";
import { errorMessage } from "../lib/errors";
import { runtimeSeconds } from "../lib/format";
import { useMeta, usePartialStreams, useStreams } from "../lib/net";
import { airedAt, NO_TORRENT_ENGINE, READY_CHECKS, readinessNote, sourceRow, useReadiness, useSourceFilters, useTitleSettings } from "../lib/playback";
import { featuredMatchSummary, sourceBadges } from "../lib/playback/sources";
import { torrentsPlayHere } from "../lib/platform";
import { openSettings, type PageId } from "../lib/settings";
import type { ContentType, RankedStream, Readiness } from "../lib/types";
import { useLayer } from "../lib/ui";
import { IconCheck, IconChevronDown, IconClose } from "./icons";

/** Initial source rows rendered when opening the overlay; more load automatically as you scroll. */
const INITIAL_SOURCES = 24;
const SOURCES_STEP = 24;
/** Number of options a filter section shows before folding behind "Show all". */
const FILTER_FOLD = 10;

type OverlayView = "list" | "addon" | "filters";

/**
 * Phone's full-screen Sources chooser, in the same dark blurred-glass overlay style as Categories
 * (`ListOverlay`): translucent pill chips for quality and filters at the top, full-width cardless stream rows
 * aligned cleanly underneath, fading behind a round white close button at the foot.
 */
export function SourcesOverlay({
  open,
  onClose,
  title = "Sources",
  subtitle,
  request,
  currentKey,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  request: { type: ContentType; videoId: string } | null;
  currentKey?: string;
  onPick: (s: RankedStream) => void;
}) {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const [view, setView] = useState<OverlayView>("list");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
      setView("list");
    } else if (shown) {
      setLeaving(true);
      const t = window.setTimeout(() => {
        setShown(false);
        setLeaving(false);
      }, 180);
      return () => window.clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape / Android back / iOS edge swipe steps out of Add-on or Filters first, then closes the overlay.
  const dismiss = () => {
    if (view !== "list") setView("list");
    else onClose();
  };
  useLayer(panel, open, dismiss, { modal: true });

  if (!shown || !request) return null;

  return createPortal(
    <div
      className="ph-sources-overlay scheme-dark"
      ref={panel}
      role="dialog"
      aria-modal
      aria-label={view === "addon" ? "Add-on" : view === "filters" ? "Filters" : title}
      data-view={view}
      data-leaving={leaving || undefined}
      tabIndex={-1}
    >
      <SourcesOverlayBody
        type={request.type}
        videoId={request.videoId}
        title={title}
        subtitle={subtitle}
        currentKey={currentKey}
        view={view}
        setView={setView}
        onPick={onPick}
        onClose={onClose}
      />
    </div>,
    document.querySelector(".ph") ?? document.body,
  );
}

function SourcesOverlayBody({
  type,
  videoId,
  title,
  subtitle,
  currentKey,
  view,
  setView,
  onPick,
  onClose,
}: {
  type: ContentType;
  videoId: string;
  title: string;
  subtitle?: string;
  currentKey?: string;
  view: OverlayView;
  setView: (v: OverlayView) => void;
  onPick: (s: RankedStream) => void;
  onClose: () => void;
}) {
  const showSettings = (page: PageId) => {
    onClose();
    openSettings(page);
  };

  const whole = useStreams(type, videoId);
  const partial = usePartialStreams(type, videoId);
  const { isError, error } = whole;
  const data = whole.data ?? (whole.isLoading && partial?.streams.length ? partial : undefined);
  const isLoading = whole.isLoading && !data;

  const { settings } = useTitleSettings(type, videoId);
  const { data: meta } = useMeta(type, videoId.replace(/:\d+:\d+$/, ""));
  const f = useSourceFilters(data?.streams, settings, undefined, runtimeSeconds(meta?.runtime), airedAt(meta, videoId), meta?.details?.originalLanguage);
  const ready = useReadiness(f.view.slice(0, Math.min(f.matched, READY_CHECKS)).map(({ r }) => r));
  const info = useSourceInfo(false);

  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const handlePick = useCallback((s: RankedStream) => onPickRef.current(s), []);
  const infoRef = useRef({ info, f });
  infoRef.current = { info, f };
  const showInfo = useCallback(
    (s: RankedStream, anchor: HTMLElement) =>
      infoRef.current.info.show(s, sourceRow(s).title, { filter: infoRef.current.f.filter, sort: infoRef.current.f.sort, match: infoRef.current.f.match(s) }, anchor),
    [],
  );

  const [visible, setVisible] = useState(INITIAL_SOURCES);
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const filterSig = `${videoId}|${f.sort}|${JSON.stringify(f.filter)}`;
  useEffect(() => {
    setVisible(INITIAL_SOURCES);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filterSig]);

  const totalCount = f.view.length;
  const remaining = Math.max(0, totalCount - visible);
  useEffect(() => {
    const node = moreRef.current;
    if (view !== "list" || !node || remaining <= 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((n) => Math.min(totalCount, n + SOURCES_STEP));
      },
      { root: scrollRef.current, rootMargin: "260px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [view, remaining, totalCount, visible]);

  // Keep the selected add-on in view when opening the Add-on chooser.
  const addonScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== "addon") return;
    addonScrollRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "center" });
  }, [view]);

  const hidden = data?.hidden ?? 0;
  const active = activeSourceFilters(f);
  const hasSecondaryFilters = active.length > 0 || f.sort !== "best";
  const selectedAddon = f.filter.addon ? f.facets.addons.find((a) => a.key === f.filter.addon)?.label ?? f.filter.addon : null;

  // --- Add-on sub-view (identical to Categories ListOverlay) ---
  if (view === "addon") {
    return (
      <>
        <header className="ph-src-head ph-src-subhead" key="addon-head">
          <h2 className="ph-src-title">Add-on</h2>
        </header>
        <div className="ph-src-scroll ph-src-picker" ref={addonScrollRef} key="addon-body">
          <ul className="ph-src-choices">
            <li>
              <button
                type="button"
                aria-current={!f.filter.addon}
                onClick={() => {
                  f.set({ addon: null });
                  setView("list");
                }}
              >
                All add-ons
              </button>
            </li>
            {f.facets.addons.map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  aria-current={f.filter.addon === a.key}
                  onClick={() => {
                    f.set({ addon: f.filter.addon === a.key ? null : a.key });
                    setView("list");
                  }}
                >
                  <span>{a.label}</span>
                  <span className="ph-src-choice-count tabular">{a.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className="ph-list-close" aria-label="Back to sources" onClick={() => setView("list")}>
          <IconClose size={28} stroke={2.2} />
        </button>
      </>
    );
  }

  // --- Filters sub-view (same borderless floating typography) ---
  if (view === "filters") {
    const filterSections = sourceFilterSections(f, false);
    const matchLabel =
      f.matched === 0 ? "No matching sources" : f.matched === 1 ? "1 matching source" : `${f.matched} matching sources`;
    return (
      <>
        <header className="ph-src-head ph-src-subhead" key="filters-head">
          <h2 className="ph-src-title">Filters</h2>
          <p className="ph-src-sub tabular">{matchLabel}</p>
          {hasSecondaryFilters && (
            <button
              type="button"
              className="ph-src-reset"
              onClick={() => {
                f.set({ lang: null, size: null, source: null, tags: [] });
                f.setSort("best");
              }}
            >
              Reset
            </button>
          )}
        </header>
        <div className="ph-src-scroll ph-src-filters-body" key="filters-body">
          <div className="ph-src-filter-sections">
            {filterSections.map((section) => (
              <OverlayFilterSection key={section.label} section={section} />
            ))}
            {hidden > 0 && <p className="ph-src-note">{hidden} more hidden by Settings → Sources</p>}
          </div>
        </div>
        <button type="button" className="ph-list-close" aria-label="Done" onClick={() => setView("list")}>
          <IconCheck size={28} stroke={2.2} />
        </button>
      </>
    );
  }

  // --- Main Sources list view ---
  const shown = f.view.slice(0, f.matched).map(({ r }) => r);
  const others = f.view.slice(f.matched, f.otherEpisodes).map(({ r }) => r);
  const otherEpisodes = f.view.slice(f.otherEpisodes).map(({ r }) => r);
  const grouped = f.sort === "best";
  const bestIndex = grouped ? shown.findIndex((s) => ready.get(streamKey(s))?.state !== "notReady") : -1;
  const pickAt = bestIndex >= 0 ? bestIndex : 0;
  const best = shown[pickAt];
  const rest = shown.filter((_, i) => i !== pickAt);
  const bestSummary = grouped && best ? featuredMatchSummary(f.match(best)) : null;

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

  const showQualities = f.total > 0 && f.facets.res.length > 1;
  const showAddon = f.total > 0 && f.facets.addons.length > 1;

  return (
    <>
      <header className="ph-src-head" key="list-head">
        <h2 className="ph-src-title">{title}</h2>
        {subtitle && <p className="ph-src-sub">{subtitle}</p>}

        {f.total > 0 && (
          <div className="ph-src-controls">
            {showQualities && (
              <div className="ph-src-qualities" role="radiogroup" aria-label="Picture quality">
                {[
                  { id: "all", label: "All" },
                  ...f.facets.res.map((r) => ({ id: r.key as string, label: r.key === "other" ? "SD" : r.label })),
                ].map((opt) => {
                  const selected = (f.filter.res ?? "all") === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className="ph-src-quality"
                      onClick={() => f.set({ res: opt.id === "all" ? null : (opt.id as typeof f.filter.res) })}
                    >
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="ph-src-bar" data-single={!showAddon || undefined}>
              {showAddon && (
                <button
                  type="button"
                  className="ph-src-pill ph-src-addon-btn"
                  aria-label="Add-on"
                  data-active={!!selectedAddon || undefined}
                  onClick={() => setView("addon")}
                >
                  <span className="ph-src-pill-text">{selectedAddon ?? "All add-ons"}</span>
                  <IconChevronDown size={13} stroke={2.2} />
                </button>
              )}
              <button
                type="button"
                className="ph-src-pill ph-src-filters-btn"
                aria-label={active.length ? `Filters, ${active.length} on` : "Filters"}
                data-active={hasSecondaryFilters || undefined}
                onClick={() => setView("filters")}
              >
                <Filters size={14} strokeWidth={2} />
                <span>Filters</span>
                {active.length > 0 && <span className="ph-src-pill-count tabular">{active.length}</span>}
              </button>
            </div>

            {active.length > 0 && (
              <div className="ph-src-active" role="group" aria-label="Filters on">
                {active.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className="ph-src-active-item"
                    onClick={a.clear}
                    aria-label={`Remove ${a.label}`}
                  >
                    <span>{a.label}</span>
                    <IconClose size={12} stroke={2.4} />
                  </button>
                ))}
                <button
                  type="button"
                  className="ph-src-active-clear"
                  onClick={() => f.set({ lang: null, size: null, source: null, tags: [] })}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="ph-src-scroll" ref={scrollRef} key="list-body">
        {isLoading ? (
          <div className="ph-src-loading" aria-busy="true" aria-label="Loading sources">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="ph-src-sk" data-featured={i === 0 || undefined} aria-hidden>
                <span className="ph-src-sk-lead" />
                <span className="ph-src-sk-text">
                  <span className="ph-src-sk-title" style={{ width: i === 0 ? "46%" : i % 2 === 0 ? "38%" : "32%" }} />
                  <span className="ph-src-sk-sub" style={{ width: i === 0 ? "78%" : i % 2 === 0 ? "68%" : "58%" }} />
                </span>
                <span className="ph-src-sk-size" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="ph-src-empty">
            <p>Couldn't load sources: {errorMessage(error)}</p>
            <button type="button" className="ph-src-empty-btn" onClick={() => void whole.refetch()}>
              <Reset size={16} />
              <span>Try Again</span>
            </button>
          </div>
        ) : !data ? null : !data.streams.length ? (
          <div className="ph-src-empty">
            <p>
              {hidden
                ? `All ${hidden} sources are hidden by your source filters.`
                : !hidden && data.failed.length > 0
                  ? "Your add-ons didn't respond in time."
                  : "No sources found."}
            </p>
            <div className="ph-src-empty-actions">
              {hidden ? (
                <button type="button" className="ph-src-empty-btn" onClick={() => showSettings("sources")}>
                  <Filters size={16} />
                  <span>Source Filters</span>
                </button>
              ) : data.failed.length > 0 ? (
                <>
                  <button type="button" className="ph-src-empty-btn" onClick={() => void whole.refetch()}>
                    <Reset size={16} />
                    <span>Try Again</span>
                  </button>
                  <button type="button" className="ph-src-empty-btn ph-src-empty-muted" onClick={() => showSettings("addons")}>
                    <Puzzle size={16} />
                    <span>Manage Add-ons</span>
                  </button>
                </>
              ) : (
                <button type="button" className="ph-src-empty-btn" onClick={() => showSettings("addons")}>
                  <Puzzle size={16} />
                  <span>Manage Add-ons</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="ph-src-list">
            {!shown.length && (
              <div className="ph-src-empty">
                <p>No sources match these filters.</p>
                <button type="button" className="ph-src-empty-btn" onClick={f.clear}>
                  <span>Clear Filters</span>
                </button>
              </div>
            )}

            {showBest && best && (
              <>
                <div className="ph-src-kicker">Best Match</div>
                <OverlayStreamRow
                  s={best}
                  featured
                  matchSummary={bestSummary}
                  current={currentKey === streamKey(best)}
                  readiness={ready.get(streamKey(best))}
                  onPick={handlePick}
                  onInfo={showInfo}
                />
                {visibleRest.length > 0 && <div className="ph-src-kicker">More Sources</div>}
                {visibleRest.map((s) => (
                  <OverlayStreamRow
                    key={streamKey(s)}
                    s={s}
                    current={currentKey === streamKey(s)}
                    readiness={ready.get(streamKey(s))}
                    onPick={handlePick}
                    onInfo={showInfo}
                  />
                ))}
              </>
            )}

            {!grouped &&
              visibleFlat.map((s) => (
                <OverlayStreamRow
                  key={streamKey(s)}
                  s={s}
                  current={currentKey === streamKey(s)}
                  readiness={ready.get(streamKey(s))}
                  onPick={handlePick}
                  onInfo={showInfo}
                />
              ))}

            {visibleOthers.length > 0 && (
              <>
                <div className="ph-src-kicker">Other Sources</div>
                {visibleOthers.map((s) => (
                  <OverlayStreamRow
                    key={streamKey(s)}
                    s={s}
                    current={currentKey === streamKey(s)}
                    readiness={ready.get(streamKey(s))}
                    onPick={handlePick}
                    onInfo={showInfo}
                  />
                ))}
              </>
            )}

            {visibleOtherEpisodes.length > 0 && (
              <>
                <div className="ph-src-kicker">Other Episodes</div>
                {visibleOtherEpisodes.map((s) => (
                  <OverlayStreamRow
                    key={streamKey(s)}
                    s={s}
                    current={currentKey === streamKey(s)}
                    readiness={ready.get(streamKey(s))}
                    onPick={handlePick}
                    onInfo={showInfo}
                  />
                ))}
              </>
            )}

            {remaining > 0 && (
              <div ref={moreRef} className="ph-src-more">
                <button type="button" onClick={() => setVisible((n) => Math.min(totalCount, n + SOURCES_STEP))}>
                  Show more ({remaining} left)
                </button>
              </div>
            )}

            <div className="ph-src-footer" aria-live="polite">
              {!!data.waiting?.length && (
                <p className="ph-src-status" role="status">
                  <span className="stream-status-dot" aria-hidden />
                  <span>Asking {data.waiting.join(", ")}…</span>
                </p>
              )}
              {hidden > 0 && <p className="ph-src-note">{hidden} more hidden by Settings → Sources</p>}
              {data.failed.length > 0 && (
                <p className="ph-src-note">
                  <AlertCircle size={12} /> No response from {data.failed.join(", ")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <button type="button" className="ph-list-close" aria-label="Close" onClick={onClose}>
        <IconClose size={28} stroke={2.2} />
      </button>

      {info.panel}
    </>
  );
}

const OverlayStreamRow = memo(function OverlayStreamRow({
  s,
  featured,
  matchSummary,
  current,
  readiness,
  onPick,
  onInfo,
}: {
  s: RankedStream;
  featured?: boolean;
  matchSummary?: string | null;
  current?: boolean;
  readiness?: Readiness;
  onPick: (s: RankedStream) => void;
  onInfo: (s: RankedStream, anchor: HTMLElement) => void;
}) {
  const row = sourceRow(s);
  const badges = sourceBadges(s);
  const unplayable = !!s.stream.infoHash && !torrentsPlayHere;
  const isReady = !unplayable && readiness?.state === "ready";
  const note = unplayable ? { short: "Can't play on this device", long: NO_TORRENT_ENGINE } : readiness && readinessNote(readiness);
  const release = s.stream.title ?? s.stream.description;
  const press = useSourceRowPress({ onPick: () => onPick(s), onInfo: (a) => onInfo(s, a) });

  const detail = [current ? "Playing" : note?.short, row.detail].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className="ph-src-row stream-row"
      data-featured={featured || undefined}
      data-current={current || undefined}
      data-ready={isReady ? "yes" : unplayable || readiness?.state === "notReady" ? "no" : undefined}
      onClick={() => onPick(s)}
      {...press}
      title={[note?.long, release].filter(Boolean).join("\n") || undefined}
    >
      <span className="ph-src-lead" aria-hidden>
        {current ? <Check size={15} strokeWidth={2.5} /> : isReady ? <Instant size={14} fill="currentColor" strokeWidth={0} /> : null}
      </span>

      <span className="ph-src-text">
        <span className="ph-src-main">
          <span className="ph-src-name">{row.title}</span>
          {badges.map((b) => (
            <span key={b.key} className="ph-src-tag" data-kind={b.kind}>
              {b.label}
            </span>
          ))}
          {s.quality.lowQualitySource && <span className="ph-src-tag ph-src-tag-bad">CAM</span>}
          {s.stream.infoHash && <span className="ph-src-tag">Torrent</span>}
        </span>

        {detail && <span className="ph-src-detail">{detail}</span>}

        {featured && matchSummary && <span className="ph-src-why">{matchSummary}</span>}
      </span>

      {row.size && <span className="ph-src-size tabular">{row.size}</span>}
    </button>
  );
});

function OverlayFilterSection({ section }: { section: SourceFilterSection }) {
  const [expanded, setExpanded] = useState(false);
  const folds = section.chips.length > FILTER_FOLD;
  const shown = expanded || !folds ? section.chips : section.chips.filter((c, i) => i < FILTER_FOLD || c.on);

  return (
    <section className="ph-src-fsec" role="group" aria-label={section.label}>
      <h3 className="ph-src-kicker">{section.label}</h3>
      <div className="ph-src-fopts">
        {shown.map((c) => (
          <button
            key={c.key}
            type="button"
            className="ph-src-fopt"
            aria-pressed={c.on}
            onClick={c.pick}
          >
            <span>{c.label}</span>
            {c.count != null && <span className="ph-src-fcount tabular">{c.count}</span>}
          </button>
        ))}
      </div>
      {folds && (
        <button
          type="button"
          className="ph-src-fmore"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show less" : `Show all ${section.chips.length}`}
        </button>
      )}
    </section>
  );
}
