import { type Anime, cleanDescription, useAnimeScore, useAnimeTitle } from "../../lib/anime";
import { formatRemaining, joinFacts, shortRuntime } from "../../lib/format";
import { watchedFraction } from "../../lib/library";
import { prefetchStreams } from "../../lib/net";
import type { PlayRequest } from "../../lib/playback";
import { useCardIntent } from "../../lib/ui";
import { DownloadButton } from "../DownloadButton";
import { Check, Play, Reset, Sources, Star } from "../icons";
import { StillPlaceholder } from "../StillPlaceholder";
import { CardArt, ProgressBar } from "../title/Card";
import { SourcePicker, useSourcePicker } from "../title/SourcePicker";
import { Button } from "../ui/Button";
import { PartPick } from "./AnimeEpisodes";
import { useAnimePlayback } from "./useAnimePlayback";

/**
 * A film's season tab on a grouped anime page (#352), in place of an episode list: the film as one wide
 * card, its backdrop with what's left to watch and its progress, as an episode card has, and its name,
 * year, length, score and story beside it (under it on a phone). Pressing it plays the film, or resumes
 * it; Sources and Download sit under its details, Download the same as a film page's Download Movie.
 */
export function FilmCard({ anime }: { anime: Anime }) {
  const pb = useAnimePlayback(anime);
  const picker = useSourcePicker();
  const name = useAnimeTitle()(anime.title);
  const score = useAnimeScore()(anime.averageScore);

  const p = pb.metaId ? pb.byVideo.get(pb.metaId) : undefined;
  const fraction = p && p.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
  const watched = fraction >= watchedFraction();
  const resume = !!pb.next.resumeAt;
  const runtime = anime.duration ? `${anime.duration} min` : pb.meta?.runtime;
  const left = resume && p ? formatRemaining(p.position, p.duration) : shortRuntime(runtime);
  const request: PlayRequest | undefined = pb.metaId ? { type: "movie", metaId: pb.metaId, videoId: pb.metaId, resumable: resume, subtitle: name } : undefined;
  // Resting on it is intent to watch it: warm its sources.
  const intent = useCardIntent(() => !!pb.metaId && prefetchStreams("movie", pb.metaId), 150);
  const why = pb.loading || pb.metaLoading ? "Loading…" : !pb.metaId ? "Not linked to any sources yet" : undefined;

  return (
    <>
      <div className="film-card" data-film={anime.id}>
        <button
          className="card card-landscape film-card-main"
          disabled={!request}
          onClick={() => request && picker.play(request)}
          aria-label={`${resume ? "Resume" : "Play"} ${name}`}
          title={why}
          {...intent}
        >
          <div className="card-frame">
            <CardArt src={pb.meta?.background ?? anime.bannerImage ?? anime.coverImage.extraLarge ?? undefined} fallback={<StillPlaceholder />} />
            <div className="card-art-scrim" />
            {left && (
              <span className="episode-runtime t-callout">
                {resume ? <Reset size={13} strokeWidth={2.5} /> : <Play size={13} fill="currentColor" />} {left}
              </span>
            )}
            {watched && (
              <span className="episode-watched" aria-label="Watched">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
            {resume && <ProgressBar fraction={fraction} />}
          </div>
          <div className="film-card-text">
            <span className="t-micro episode-kicker">Film</span>
            <span className="t-title2 film-card-title">{name}</span>
            <span className="t-callout film-card-facts tabular">
              {score && (
                <span className="anime-score" title="AniList score">
                  <Star size={13} /> {score}
                </span>
              )}
              {joinFacts([anime.seasonYear ?? anime.startDate?.year, shortRuntime(runtime)])}
            </span>
            {cleanDescription(anime.description)[0] && <p className="t-callout film-card-overview">{cleanDescription(anime.description)[0]}</p>}
          </div>
        </button>
        <div className="film-card-actions">
          <Button variant="glass" size="sm" disabled={!request} onClick={() => request && picker.choose(request)} title="Choose source">
            <Sources size={16} />
            Sources
          </Button>
          {/* The film's download, as its own page's (keyed by the id it plays from). */}
          {request && pb.meta && <DownloadButton item={pb.meta} labelled />}
        </div>
      </div>
      <PartPick anime={anime} pb={pb} />
      <SourcePicker picker={picker} />
    </>
  );
}
