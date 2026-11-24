import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cardMenu } from "../components/CardMenu";
import { Img } from "../components/Img";
import { useIntent } from "../components/PosterCard";
import { ArtTitle } from "../components/title/Card";
import { prefetchTitlePage, useEntryShown } from "../lib/anime";
import { api } from "../lib/api";
import { progressItem } from "../lib/catalog";
import { formatRemaining } from "../lib/format";
import { dismissUpNext, useUpNextContinueWatching, type ContinueEntry } from "../lib/library";
import { keys } from "../lib/net";
import { useNavigation } from "../lib/router";
import type { MetaPreview, Progress } from "../lib/types";
import { cardArtUrl } from "../lib/ui";
import { IconChevronRight, IconPlay } from "../phone/icons";

/**
 * A poster in a row or grid: the title's art and nothing else, 4 pt corners, as Netflix's iPad app draws it. A click
 * opens the title's dialog out of it (`data-origin`); a right click, its menu.
 */
export const Poster = memo(function Poster({ item: stored, entry, progress }: { item: MetaPreview; entry?: Progress; progress?: number }) {
  const { item, opens } = useEntryShown(stored, entry?.videoId);
  const { navigate } = useNavigation();
  const intent = useIntent(opens === item.id ? item : { ...item, id: opens });
  const [failed, setFailed] = useState(false);
  const art = cardArtUrl(item.poster, "poster");
  return (
    <button
      type="button"
      className="dk-poster scheme-dark"
      data-origin="4"
      aria-label={item.name}
      onClick={() => navigate({ name: "detail", type: item.type, id: opens, preview: opens === item.id ? item : undefined })}
      {...intent}
      {...cardMenu(stored, entry)}
    >
      {!failed && (art || item.background) ? (
        <Img
          src={art ?? cardArtUrl(item.background, "landscape")}
          fallbacks={art && item.background ? [cardArtUrl(item.background, "landscape")] : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onFail={() => setFailed(true)}
        />
      ) : (
        <span className="dk-poster-name">{item.name}</span>
      )}
      {progress != null && <ProgressLine fraction={progress} />}
    </button>
  );
});

export function ProgressLine({ fraction }: { fraction: number }) {
  return (
    <span className="dk-progress" aria-hidden>
      <i style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` }} />
    </span>
  );
}

/**
 * A wide 16:9 landscape card (for alternating horizontal shelves on Home, Anime, and Search):
 * backdrop artwork, soft bottom scrim, title logo or name, and subtle metadata line.
 */
export const LandscapeCard = memo(function LandscapeCard({
  item: stored,
  entry,
  kicker,
}: {
  item: MetaPreview;
  entry?: Progress;
  kicker?: string;
}) {
  const { item, opens } = useEntryShown(stored, entry?.videoId);
  const { navigate } = useNavigation();
  const intent = useIntent(opens === item.id ? item : { ...item, id: opens });
  const [failed, setFailed] = useState(false);
  const bg = cardArtUrl(item.background, "landscape");
  const poster = cardArtUrl(item.poster, "poster");
  const year = item.releaseInfo?.match(/\d{4}/)?.[0];
  const sub = kicker ?? [year, item.genres?.[0]].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className="dk-lc scheme-dark"
      data-origin="10"
      aria-label={item.name}
      onClick={() => navigate({ name: "detail", type: item.type, id: opens, preview: opens === item.id ? item : undefined })}
      {...intent}
      {...cardMenu(stored, entry)}
    >
      {!failed && (bg || poster) ? (
        <Img
          className="dk-lc-img"
          src={bg ?? poster}
          fallbacks={bg && poster ? [poster] : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onFail={() => setFailed(true)}
        />
      ) : (
        <span className="dk-poster-name">{item.name}</span>
      )}
      <span className="dk-lc-shade" aria-hidden />
      <span className="dk-lc-body" aria-hidden>
        <span className="dk-lc-brand">
          <ArtTitle name={item.name} logo={item.logo} logos={item.logos} decorative />
        </span>
        {sub && <span className="dk-lc-sub tabular">{sub}</span>}
      </span>
    </button>
  );
});

export function LandscapeSkeletons({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="dk-lc dk-skeleton" aria-hidden />
      ))}
    </>
  );
}

/**
 * A row: its name over a strip of posters or wide landscape cards that scrolls sideways. With a mouse, round arrows at
 * the strip's ends page it (a trackpad or Shift+wheel scrolls it as it is). A row that opens in full has a chevron.
 */
export const Row = memo(function Row({
  title,
  items,
  shape = "poster",
  className,
  onMore,
  count,
  action,
  children,
}: {
  title: ReactNode;
  items?: readonly MetaPreview[];
  shape?: "poster" | "landscape";
  className?: string;
  onMore?: () => void;
  count?: number;
  /** At the heading's far end (a `.dk-text-btn`). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  if (items && !items.length && !children) return null;
  const head = (
    <>
      <span className="dk-row-name">{title}</span>
      {count !== undefined && <span className="dk-row-count">{count}</span>}
      {onMore && <IconChevronRight size={18} stroke={2.6} className="dk-row-chev" />}
    </>
  );
  const wide = shape === "landscape";
  return (
    <section className={[wide ? "dk-row dk-row-wide" : "dk-row", className].filter(Boolean).join(" ")}>
      <h2 className="dk-row-title">
        {onMore ? (
          <button type="button" className="dk-row-more" onClick={onMore}>
            {head}
          </button>
        ) : (
          head
        )}
        {action}
      </h2>
      <Strip className={wide ? "dk-strip dk-strip-wide" : "dk-strip"} itemCount={items?.length}>
        {children ??
          (items
            ? items.map((item) =>
                wide ? <LandscapeCard key={`${item.type}:${item.id}`} item={item} /> : <Poster key={`${item.type}:${item.id}`} item={item} />,
              )
            : wide
              ? <LandscapeSkeletons />
              : <PosterSkeletons />)}
      </Strip>
    </section>
  );
});

/** The sideways strip, with its paging arrows shown only where there's more to go. */
export function Strip({ children, className = "dk-strip", itemCount }: { children: ReactNode; className?: string; itemCount?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const raf = useRef(0);
  const measure = useCallback(() => {
    const s = el.current;
    if (!s) return;
    const start = s.scrollLeft <= 2;
    const end = s.scrollLeft + s.clientWidth >= s.scrollWidth - 2;
    setEnds((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      measure();
    });
  }, [measure]);
  useEffect(() => {
    const s = el.current;
    if (!s) return;
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
    };
  }, [measure]);
  useEffect(() => {
    measure();
  }, [measure, itemCount]);
  const page = (dir: 1 | -1) => {
    const s = el.current;
    if (!s) return;
    s.scrollBy({ left: dir * (s.clientWidth - 120), behavior: "smooth" });
  };
  return (
    <div className="dk-strip-wrap">
      <div ref={el} className={className} onScroll={onScroll}>
        {children}
      </div>
      {!ends.start && (
        <button type="button" className="dk-pager dk-pager-back" aria-label="Scroll back" tabIndex={-1} onClick={() => page(-1)}>
          <IconChevronRight size={22} stroke={2.4} />
        </button>
      )}
      {!ends.end && (
        <button type="button" className="dk-pager" aria-label="Scroll on" tabIndex={-1} onClick={() => page(1)}>
          <IconChevronRight size={22} stroke={2.4} />
        </button>
      )}
    </div>
  );
}

export function PosterSkeletons({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="dk-poster dk-skeleton" aria-hidden />
      ))}
    </>
  );
}

/**
 * Continue Watching in the Apple TV wide 16:9 landscape style: backdrop artwork with title logo,
 * compact inline progress bar + episode/time remaining over a soft bottom scrim, hover play button,
 * and subtle hover top-right info/menu controls (no grey footer bar).
 */
export function ContinueRow() {
  const entries = useUpNextContinueWatching();
  if (!entries.length) return null;
  return (
    <section className="dk-row dk-row-cw">
      <h2 className="dk-row-title">
        <span className="dk-row-name">Continue Watching</span>
      </h2>
      <Strip className="dk-strip dk-strip-cw">
        {entries.map((e) => (
          <ContinueCard key={e.progress.videoId} entry={e} />
        ))}
      </Strip>
    </section>
  );
}

function shortLeft(position: number, duration: number): string {
  const raw = formatRemaining(position, duration);
  return raw ? raw.replace(/\s+left$/i, "") : "";
}

function ContinueCard({ entry: cw }: { entry: ContinueEntry }) {
  const { progress: p, upNext } = cw;
  const { navigate } = useNavigation();
  const stored = useMemo(() => progressItem(p), [p]);
  const { item, entry, opens } = useEntryShown(stored, p.videoId);
  useEffect(() => prefetchTitlePage(p.type, opens), [p.type, opens]);
  const meta = useQuery({ queryKey: keys.meta(p.type, p.metaId), queryFn: () => api.meta(p.type, p.metaId), staleTime: 60 * 60_000 });
  const logo = meta.data?.logo;
  const artChain = useMemo(
    () =>
      [p.background, meta.data?.background, item.background, p.poster, meta.data?.poster]
        .filter((u, i, a): u is string => !!u && a.indexOf(u) === i)
        .map((u) => cardArtUrl(u, "landscape") ?? u),
    [p.background, meta.data?.background, item.background, p.poster, meta.data?.poster],
  );
  const [failed, setFailed] = useState(false);
  const menu = cardMenu(stored, p, upNext ? { onRemoveContinue: () => dismissUpNext([cw]) } : undefined);
  const open = () => navigate({ name: "detail", type: p.type, id: opens, preview: opens === item.id ? item : undefined });
  const resume = () => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId });
  const fraction = p.duration ? Math.min(1, Math.max(0, p.position / p.duration)) : 0;
  const left = shortLeft(p.position, p.duration);
  const epLabel = entry
    ? `Episode ${entry.number}`
    : p.season != null && p.episode != null
      ? `S${p.season}, E${p.episode}`
      : undefined;
  const footText = upNext
    ? epLabel
      ? `Up Next · ${epLabel}`
      : "Up Next"
    : [epLabel, left].filter(Boolean).join(" · ");

  return (
    <div className="dk-cw scheme-dark" data-origin="12" {...menu}>
      <button
        type="button"
        className="dk-cw-art"
        aria-label={`About ${item.name}`}
        onClick={open}
      >
        {!failed && artChain.length > 0 ? (
          <Img
            className="dk-cw-img"
            src={artChain[0]}
            fallbacks={artChain.slice(1)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onFail={() => setFailed(true)}
          />
        ) : (
          <span className="dk-cw-fallback">{item.name}</span>
        )}
        <div className="dk-cw-shade" aria-hidden />
        <div className="dk-cw-brand" aria-hidden>
          <ArtTitle name={item.name} logo={entry ? undefined : logo} pending={!entry && meta.isLoading} />
        </div>
        <div className="dk-cw-foot" aria-hidden>
          {!upNext && p.duration > 0 && (
            <span className="dk-cw-track">
              <i style={{ width: `${Math.round(fraction * 100)}%` }} />
            </span>
          )}
          {footText && <span className="dk-cw-label tabular">{footText}</span>}
        </div>
      </button>
      {/* The card opens the title; only the play button in its middle plays. */}
      <span className="dk-cw-play">
        <button
          type="button"
          className="dk-cw-play-btn"
          aria-label={upNext ? `Play next episode of ${item.name}` : `Resume ${item.name}`}
          title={upNext ? "Play next episode" : "Resume"}
          onClick={resume}
        >
          <IconPlay size={22} />
        </button>
      </span>
      <div className="dk-cw-tools">
        <button
          type="button"
          className="dk-cw-tool"
          aria-label={`More for ${item.name}`}
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom + 4 }));
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
            <circle cx="5" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="12" r="2" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}
