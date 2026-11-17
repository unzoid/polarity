import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PlayIcon } from "@heroicons/react/24/solid";
import { useMeta, useProgress } from "../../../src/lib/net";
import { useNavigation } from "../../../src/lib/router";
import { personIds, LIMIT_NOTICE, useTitleVerdict } from "../../../src/lib/catalog";
import { progressMap, seasonsOf, shelfGroupOf, shelfGroups, upNext, useEpisodeOrders } from "../../../src/lib/library";
import { watchedFraction } from "../../../src/lib/library/watched";
import { isReleased, runtimeSeconds } from "../../../src/lib/format";
import { usePlayLabel } from "../ui/playLabel";
import { errorMessage } from "../../../src/lib/errors";
import type { ContentType, Meta, MetaPreview, Progress, Video } from "../../../src/lib/types";
import { Art } from "../ui/Art";
import { Button } from "../ui/Button";
import { RunLine } from "../ui/RunLine";
import { SaveButton } from "../ui/SaveButton";
import { formatDay, formatLeft, formatRuntimeLong, yearOf } from "../ui/time";

/**
 * A title's page. The art fills the top, the same neutral page under it whatever the picture's colours. A show's
 * episodes follow as a programme sheet, one row each, its running time drawn to scale with what you've watched.
 */
export function Title({ type, id, preview, episode }: { type: ContentType; id: string; preview?: MetaPreview; episode?: string }) {
  const { data: meta, isError, error } = useMeta(type, id);
  const verdict = useTitleVerdict(meta ?? preview, !!meta || isError);
  const shown: MetaPreview | undefined = verdict === "show" ? (meta ?? preview) : undefined;

  if (verdict === "hide") return <Empty>{LIMIT_NOTICE}</Empty>;
  if (isError && !shown) return <Empty>Couldn't load this title: {errorMessage(error)}</Empty>;
  if (!shown) return <div className="title-page title-pending" aria-busy />;

  return (
    <div className="scroll title-page page-enter">
      <Hero item={shown} meta={meta} />
      {type === "series" && meta && <Episodes meta={meta} linked={episode} />}
      {meta && <About meta={meta} />}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <p className="muted">{children}</p>
    </div>
  );
}

// --- The top ---------------------------------------------------------------------

function Hero({ item, meta }: { item: MetaPreview; meta?: Meta }) {
  const { navigate } = useNavigation();
  const { videoId, label } = usePlayLabel(item, meta);
  const isSeries = item.type === "series";
  const length = runtimeSeconds(meta?.runtime);
  const certification = meta?.certification ?? item.certification;
  const facts = [isSeries ? "Series" : "Film", yearOf(item.releaseInfo), certification, ...(item.genres ?? []).slice(0, 2)].filter(Boolean);

  const ids = personIds(meta);
  const credit = (names: string[] | undefined) =>
    names?.map((n, i) => {
      const person = ids.get(n);
      return (
        <span key={n}>
          {i > 0 && ", "}
          {person != null ? (
            <button className="link" onClick={() => navigate({ name: "person", id: person, title: n })}>
              {n}
            </button>
          ) : (
            n
          )}
        </span>
      );
    });

  return (
    <section className="title-hero">
      <div className="feature-art">
        <Art sources={[item.background, item.poster]} loading="eager" />
      </div>
      <div className="feature-scrim" />
      <div className="feature-text on-art">
        <p className="t-mono feature-facts">{facts.join(" · ")}</p>
        <h1 className="t-display" data-long={item.name.length > 36 || undefined} title={item.name}>
          {item.name}
        </h1>
        {length > 0 && (
          <div className="feature-run">
            <RunLine length={length} />
            <span className="t-mono">{isSeries ? `${formatRuntimeLong(length)} an episode` : formatRuntimeLong(length)}</span>
          </div>
        )}
        {item.description && <p className="feature-description clamp-3">{item.description}</p>}
        <div className="feature-actions">
          <Button
            kind="primary"
            size="large"
            icon={PlayIcon}
            disabled={!videoId}
            onClick={() => videoId && navigate({ name: "player", type: item.type, metaId: item.id, videoId })}
          >
            {label}
          </Button>
          <SaveButton item={item} size="large" />
        </div>
      </div>
      {(meta?.cast?.length || meta?.director?.length) ? (
        <dl className="title-credits">
          {meta.cast?.length ? (
            <div>
              <dt>Starring</dt>
              <dd>{credit(meta.cast.slice(0, 3))}</dd>
            </div>
          ) : null}
          {meta.director?.length ? (
            <div>
              <dt>{isSeries ? "Created by" : "Directed by"}</dt>
              <dd>{credit(meta.director.slice(0, 2))}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

// --- Episodes --------------------------------------------------------------------

function Episodes({ meta, linked }: { meta: Meta; linked?: string }) {
  const { data: progress } = useProgress(meta.id);
  const { view } = useEpisodeOrders(meta);
  const seasons = useMemo(() => seasonsOf(meta), [meta]);
  const groups = useMemo(() => shelfGroups(meta.videos, seasons, view), [meta.videos, seasons, view]);
  const next = useMemo(() => upNext(meta, progress ?? [], view), [meta, progress, view]);
  const linkedVideo = linked ? meta.videos.find((v) => v.id === linked) : undefined;
  const [group, setGroup] = useState<number | undefined>(linkedVideo && shelfGroupOf(linkedVideo, view));

  // Open on the season you're in, once progress is known.
  useEffect(() => {
    if (group === undefined && progress !== undefined && next.video) setGroup(shelfGroupOf(next.video, view));
  }, [next.video, group, progress, view]);

  const current = groups.some((g) => g.id === group) ? group! : (groups[0]?.id ?? seasons[0]);
  const episodes = groups.find((g) => g.id === current)?.videos ?? [];
  const map = useMemo(() => progressMap(progress), [progress]);
  const length = runtimeSeconds(meta.runtime);
  const upNextId = next.kind !== "start" ? next.video?.id : undefined;

  return (
    <section className="section episodes" aria-label="Episodes">
      <div className="episodes-head">
        <div className="season-tabs" role="tablist" aria-label="Seasons">
          {groups.map((g) => (
            <button key={g.id} role="tab" aria-selected={g.id === current} className="season-tab" onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <span className="t-mono faint">
          {episodes.length} {episodes.length === 1 ? "episode" : "episodes"}
        </span>
      </div>
      <ol className="episode-list">
        {episodes.map((v, i) => (
          <EpisodeRow
            key={v.id}
            meta={meta}
            video={v}
            number={view?.number?.get(v.id) ?? v.episode ?? i + 1}
            progress={map.get(v.id)}
            length={length}
            upNext={v.id === upNextId}
          />
        ))}
      </ol>
    </section>
  );
}

function EpisodeRow({
  meta,
  video: v,
  number,
  progress: p,
  length,
  upNext,
}: {
  meta: Meta;
  video: Video;
  number: number;
  progress?: Progress;
  length: number;
  upNext: boolean;
}) {
  const { navigate } = useNavigation();
  const released = isReleased(v);
  const runLength = p?.duration || length;
  const watched = !!p && p.duration > 0 && p.position / p.duration >= watchedFraction();
  const status = !released
    ? formatDay(v.released)
    : watched
      ? "Watched"
      : p && p.duration
        ? formatLeft(p.position, p.duration)
        : runLength
          ? formatRuntimeLong(runLength)
          : "";
  const facts = [released ? formatDay(v.released) : "Not out yet", v.rating && `${v.rating} on IMDb`, v.tag].filter(Boolean).join(" · ");

  return (
    <li>
      <button
        className="episode"
        data-upnext={upNext || undefined}
        disabled={!released}
        onClick={() => navigate({ name: "player", type: "series", metaId: meta.id, videoId: v.id })}
      >
        <span className="episode-number t-mono">{String(number).padStart(2, "0")}</span>
        <span className="frame frame-still episode-still">
          <Art sources={[v.thumbnail, meta.background]} />
          <span className="episode-play" aria-hidden>
            <PlayIcon />
          </span>
        </span>
        <span className="episode-body">
          <span className="episode-title">
            {upNext && <span className="episode-next t-mono">Up next</span>}
            {v.title || `Episode ${number}`}
          </span>
          <span className="t-mono faint">{facts}</span>
          {v.overview && <span className="episode-overview clamp-2">{v.overview}</span>}
        </span>
        <span className="episode-run">
          {released && <RunLine length={runLength} watched={watched ? runLength : (p?.position ?? 0)} />}
          <span className="t-mono faint">{status}</span>
        </span>
      </button>
    </li>
  );
}

// --- About -----------------------------------------------------------------------

function About({ meta }: { meta: Meta }) {
  const { navigate } = useNavigation();
  const d = meta.details;
  const rows: [string, string | undefined][] = [
    ["Genres", meta.genres?.join(", ")],
    ["Released", d?.released ? formatDay(d.released) : meta.releaseInfo],
    ["Running time", meta.runtime ? formatRuntimeLong(runtimeSeconds(meta.runtime)) : undefined],
    ["Rated", meta.certification],
    [meta.type === "series" ? "Network" : "Studio", d?.studios?.slice(0, 3).join(", ")],
    ["Written by", d?.writers?.slice(0, 3).join(", ")],
    ["Country", d?.countries?.join(", ")],
    ["Status", d?.status],
  ];
  const people = (meta.people ?? []).slice(0, 12);
  return (
    <section className="section about" aria-label="About">
      <h2 className="t-section">About</h2>
      {d?.tagline && <p className="about-tagline">{d.tagline}</p>}
      <dl className="about-grid">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt className="faint">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {people.length > 0 && (
        <>
          <h3 className="about-cast-head">Cast</h3>
          <ul className="cast">
            {people.map((p) => (
              <li key={`${p.name}-${p.character ?? ""}`}>
                <button
                  className="person"
                  disabled={p.tmdbId == null}
                  onClick={() => p.tmdbId != null && navigate({ name: "person", id: p.tmdbId, title: p.name })}
                >
                  <span className="person-photo">
                    <Art sources={[p.photo]} />
                    {!p.photo && <span aria-hidden>{p.name.slice(0, 1)}</span>}
                  </span>
                  <span className="person-name">{p.name}</span>
                  {p.character && <span className="t-meta clamp-1">{p.character}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
