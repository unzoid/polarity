import { PlayIcon } from "@heroicons/react/24/solid";
import { useNavigation } from "../../../src/lib/router";
import { prefetchTitlePage } from "../../../src/lib/anime/titlePageQuery";
import type { MetaPreview, Progress } from "../../../src/lib/types";
import { Art } from "./Art";
import { RunLine } from "./RunLine";
import { episodeCode, formatLeft, yearOf } from "./time";

const factsOf = (item: MetaPreview) => [yearOf(item.releaseInfo), item.genres?.[0]].filter(Boolean).join(" · ");

/** A title in a rail or a grid: its poster, its name, and the year and first genre in small print. */
export function PosterCard({ item }: { item: MetaPreview }) {
  const { navigate } = useNavigation();
  const facts = factsOf(item);
  return (
    <button
      className="card"
      onClick={() => navigate({ name: "detail", type: item.type, id: item.id, preview: item })}
      onPointerEnter={() => prefetchTitlePage(item.type, item.id, item)}
      onFocus={() => prefetchTitlePage(item.type, item.id, item)}
    >
      <span className="frame frame-poster">
        <Art sources={[item.poster, item.background]} name={item.name} />
      </span>
      <span className="card-name">{item.name}</span>
      {facts && <span className="card-facts t-mono faint">{facts}</span>}
    </button>
  );
}

/** The same title on a wide still, for the rails Home draws wide. */
export function StillCard({ item }: { item: MetaPreview }) {
  const { navigate } = useNavigation();
  const facts = factsOf(item);
  return (
    <button
      className="card"
      onClick={() => navigate({ name: "detail", type: item.type, id: item.id, preview: item })}
      onPointerEnter={() => prefetchTitlePage(item.type, item.id, item)}
      onFocus={() => prefetchTitlePage(item.type, item.id, item)}
    >
      <span className="frame frame-still">
        <Art sources={[item.background, item.poster]} name={item.name} />
      </span>
      <span className="card-name">{item.name}</span>
      {facts && <span className="card-facts t-mono faint">{facts}</span>}
    </button>
  );
}

/**
 * Something you're part-way through: the still, its running time to scale with how far you got, and the time
 * left. The card opens the title; the play mark on the still goes straight back in.
 */
export function ResumeCard({ progress: p, name, opens }: { progress: Progress; name: string; opens: string }) {
  const { navigate } = useNavigation();
  const code = episodeCode(p.season, p.episode);
  const sub = code ? [code, p.episodeTitle].filter(Boolean).join(" · ") : "";
  return (
    <div className="card card-resume">
      <button
        className="card-open"
        onClick={() => navigate({ name: "detail", type: p.type, id: opens })}
        onPointerEnter={() => prefetchTitlePage(p.type, opens)}
        aria-label={`${name}${sub ? `, ${sub}` : ""}`}
      >
        <span className="frame frame-still">
          <Art sources={[p.background, p.poster]} name={name} />
        </span>
      </button>
      <button
        className="card-play"
        aria-label={`Resume ${name}`}
        onClick={() => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId })}
      >
        <PlayIcon aria-hidden />
      </button>
      <RunLine length={p.duration} watched={p.position} className="card-run" />
      <span className="card-row">
        <span className="card-name">{name}</span>
        <span className="t-mono faint">{formatLeft(p.position, p.duration)}</span>
      </span>
      {sub && <span className="card-facts t-meta clamp-1">{sub}</span>}
    </div>
  );
}
