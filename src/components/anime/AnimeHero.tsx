import { useEffect, useMemo, useState } from "react";
import {
  type Anime,
  type AnimeCard,
  type FranchisePart,
  franchiseSummary,
  cleanDescription,
  countdown,
  FORMAT_LABEL,
  heroSubtitle,
  SEASON_LABEL,
  STATUS_LABEL,
  untilAiring,
  upNextLabel,
  useAnimeScore,
} from "../../lib/anime";
import { joinFacts } from "../../lib/format";
import { usePrefs } from "../../lib/settings";
import { Star, Volume, VolumeMuted } from "../icons";
import { IconButton } from "../ui/Button";
import { useArtGate } from "../../lib/ui";
import { SourcePicker, useSourcePicker } from "../title/SourcePicker";
import { TitleActions } from "../title/TitleActions";
import { SimklPanel } from "../title/SimklPanel";
import { TraktNotSent } from "../title/TraktRating";
import { TitleHeading } from "../title/TitleHeading";
import { openTrailer } from "../Trailer";
import { AnimeSeriesPick } from "./AnimeSeriesPick";
import { useAnimePlayback } from "./useAnimePlayback";
import { Skeleton } from "../ui/Skeleton";

/** A grouped page's franchise (#327): the top describes all of it, the same on every season tab. */
export interface HeroFranchise {
  /** Its parts in order, with their season tab labels. */
  parts: FranchisePart[];
  /** The part Play carries on with: the one played last, else the first. */
  play: AnimeCard;
  /** The part after it, which Play goes on to once `play` is all watched. */
  following?: AnimeCard;
}

/**
 * The top of an anime's page: its name (or logo), the facts line, the next
 * episode's airing time, the first paragraph of its story and the action row,
 * playing whatever is up next. On a grouped page (`franchise`) it's the base
 * title's (`item`, `anime`) with the franchise's facts, and Play carries on
 * wherever you left off in the franchise, whichever tab is picked (#327).
 */
export function AnimeHero({
  item,
  facts = item,
  anime,
  logo,
  logos,
  logoPending,
  background,
  name,
  onImdb,
  trailer,
  franchise,
  pickInTabs = !!franchise,
}: {
  item: AnimeCard;
  /** The entry the facts line (format, season, length, status) describes: a grouped page's base title (#246). */
  facts?: AnimeCard;
  anime?: Anime;
  /** The franchise's logo (`franchiseArt`), the same on every season tab: this entry's name shows under it. */
  logo?: string;
  /** Every logo to choose from, `logo` first (`franchiseArt`): the first shaped like a logo that reads shows (#371). */
  logos?: string[];
  /** The logo isn't known yet (`franchiseArt`): neither it nor the name shows for now (#343). */
  logoPending?: boolean;
  /** The page's backdrop: the logo or name waits for it (#173), and the logo is measured against it (#215). */
  background?: string;
  name: string;
  /** The id it plays from: undefined until known, null when there's none (the page's backdrop trailer is that title's). */
  onImdb?: (id: string | null | undefined) => void;
  trailer?: { visible: boolean; muted: boolean; toggleMute: () => void };
  franchise?: HeroFranchise;
  /** The series pick sits under the season tabs instead (a grouped page, #327). */
  pickInTabs?: boolean;
}) {
  const playing = franchise?.play ?? anime ?? item;
  const first = useAnimePlayback(playing);
  const after = useAnimePlayback(franchise?.following ?? playing);
  const pb = franchise?.following && first.next.finished ? after : first;
  const summary = useMemo(() => franchise && franchiseSummary(franchise.parts), [franchise]);
  useEffect(() => onImdb?.(pb.loading ? undefined : (pb.metaId ?? null)), [onImdb, pb.loading, pb.metaId]);
  const picker = useSourcePicker();
  const prefs = usePrefs();

  const target = pb.isMovie ? pb.metaId : pb.next.ep?.video?.id;
  const request = target &&
    pb.metaId && {
      type: pb.isMovie ? ("movie" as const) : ("series" as const),
      metaId: pb.metaId,
      videoId: target,
      resumable: !!pb.next.resumeAt,
      subtitle: pb.next.ep ? `Episode ${pb.next.ep.number}${pb.next.ep.title ? ` · ${pb.next.ep.title}` : ""}` : name,
    };

  const label = upNextLabel(pb.next, pb.isMovie);

  const unavailable =
    !pb.loading && !pb.metaId
      ? "Not linked to any sources yet"
      : !pb.metaLoading && pb.metaId && !target && !pb.isMovie
        ? "No episodes to play yet"
        : undefined;
  // A logo that won't show leaves the name as the heading: the line under it then names it in the other script.
  const [noLogo, setNoLogo] = useState<string>();
  const subtitle = heroSubtitle(item.title, prefs.animeTitles, !!logo && noLogo !== logo);
  const score = useAnimeScore()(item.averageScore);
  const studio = anime?.studios.edges.find((e) => e.isMain && e.node.isAnimationStudio)?.node.name;
  const next = summary ? summary.airing : item.nextAiringEpisode;
  const factsLine = summary
    ? [summary.years, summary.parts, summary.status, studio]
    : [
        facts.format && FORMAT_LABEL[facts.format],
        facts.season && facts.seasonYear ? `${SEASON_LABEL[facts.season]} ${facts.seasonYear}` : facts.seasonYear,
        facts.format === "MOVIE" ? facts.duration && `${facts.duration} min` : facts.episodes && `${facts.episodes} episodes`,
        facts.status && STATUS_LABEL[facts.status],
        studio,
      ];
  const paragraphs = cleanDescription(anime?.description);
  const gate = useArtGate(background);

  return (
    <section className="detail-hero anime-hero" {...gate}>
      <div className="detail-hero-main">
        <TitleHeading name={name} logo={logo} logos={logos} backdrop={background} look="detail" pending={logoPending} onLogoFail={() => setNoLogo(logo)} />
        {subtitle && <p className="anime-native t-callout">{subtitle}</p>}
        <p className="detail-facts anime-meta-line t-callout tabular">
          {score && (
            <span className="anime-score" title="AniList score">
              <Star size={13} /> {score}
            </span>
          )}
          {joinFacts(factsLine)}
        </p>
        {next && (
          <p className="anime-next t-callout tabular" title={new Date(next.airingAt * 1000).toLocaleString()}>
            <span className="anime-next-ep">
              {summary?.airing ? `${summary.airing.label} · ` : ""}Episode {next.episode}
            </span>{" "}
            {new Date(next.airingAt * 1000).toLocaleDateString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })}
            {" · in "}
            {countdown(untilAiring(next.airingAt))}
          </p>
        )}
        {item.genres?.length ? <p className="anime-genres t-caption">{item.genres.join("  ·  ")}</p> : null}
        {anime ? (
          paragraphs[0] && <p className="detail-description t-callout">{paragraphs[0]}</p>
        ) : (
          // The entry's details are still coming: lines where its description goes (re-test N4).
          <div className="detail-description detail-description-loading" aria-label="Loading">
            <Skeleton shape="line" width="100%" />
            <Skeleton shape="line" width="92%" />
            <Skeleton shape="line" width="64%" />
          </div>
        )}

        <TitleActions
          request={request}
          picker={picker}
          label={label}
          resume={!!pb.next.resumeAt}
          playTitle={unavailable}
          loading={!unavailable && (pb.loading || pb.metaLoading || !anime)}
          onTrailer={
            anime?.trailer?.site === "youtube"
              ? () => openTrailer({ name, imdbId: pb.metaId?.startsWith("tt") ? pb.metaId : undefined, ytId: anime.trailer!.id, ytFrom: "AniList" })
              : undefined
          }
          item={pb.meta}
        >
          {trailer?.visible && (
            <IconButton
              variant="glass"
              className="detail-mute"
              onClick={trailer.toggleMute}
              label={trailer.muted ? "Turn trailer sound on" : "Mute trailer"}
              title={trailer.muted ? "Sound on" : "Mute"}
            >
              {trailer.muted ? <VolumeMuted size={20} /> : <Volume size={20} />}
            </IconButton>
          )}
        </TitleActions>
        {/* A grouped page picks each part's series under its season tabs (AnimeEpisodes.tsx). */}
        {(unavailable || (pb.pickable && !pickInTabs)) && (
          <p className="anime-unavailable t-caption">
            {unavailable}
            {pb.pickable && !pickInTabs && <AnimeSeriesPick anime={item} isMovie={pb.isMovie} current={pb.metaId} mal={pb.malId} kitsu={pb.kitsu} />}
          </p>
        )}
        <TraktNotSent id={pb.metaId} />
        {pb.metaId && <SimklPanel item={{ id: pb.metaId, type: pb.isMovie ? "movie" : "series" }} />}
      </div>

      <SourcePicker picker={picker} />
    </section>
  );
}
