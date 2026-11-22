import "../styles/anime.css";
import "../styles/title/episode-ratings.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimeCharacters } from "../components/anime/AnimeCharacters";
import { AnimeDetails } from "../components/anime/AnimeDetails";
import { AnimeSeriesPick } from "../components/anime/AnimeSeriesPick";
import { useAnimePlayback } from "../components/anime/useAnimePlayback";
import { useBackdropTrailer } from "../components/BackdropTrailer";
import { useBatchDownload } from "../components/BatchDownload";
import { cardMenu } from "../components/CardMenu";
import { DownloadButton } from "../components/DownloadButton";
import { Img } from "../components/Img";
import { TitleLogo } from "../components/TitleLogo";
import { useLibraryToggle } from "../components/title/LibraryButton";
import { SourcePicker, useSourcePicker } from "../components/title/SourcePicker";
import { ScoreRow } from "../components/title/TitleDetails";
import { openTrailer, useTrailerOpen } from "../components/Trailer";
import {
  type Anime,
  type AnimeCard,
  animeArt,
  animeEntries,
  animeImdbQuery,
  animeQuery,
  cleanDescription,
  comesOut,
  continuePart,
  countdown,
  distinctLabels,
  FORMAT_LABEL,
  franchiseArt,
  franchiseSummary,
  heroSubtitle,
  isSeason,
  LIKED_THIS_FILL,
  likedThis,
  noSeasonBefore,
  nothingKnownYet,
  pageArtSource,
  partDownloads,
  PENDING_EPISODE,
  playContext,
  relatedRows,
  shelfEpisodes,
  STATUS_LABEL,
  untilAiring,
  upNextLabel,
  useAnime,
  useAnimeScore,
  useAnimeSeasons,
  useAnimeTitle,
  useAniZip,
  useEpisodeFlags,
  useLinkedImdbs,
  useMoreRecommendations,
  usePlayedZip,
  type HeroImdb,
} from "../lib/anime";
import { LIMIT_NOTICE, useTitleVerdict } from "../lib/catalog";
import { formatRemaining } from "../lib/format";
import { episodeEntry } from "../lib/library";
import { useMeta, useProgressOf, useRatings } from "../lib/net";
import type { PlayRequest } from "../lib/playback";
import { useNavigation } from "../lib/router";
import { setPrefs, useEpisodeLayout, usePrefs } from "../lib/settings";
import type { Meta, Progress, Video } from "../lib/types";
import { cardArtUrl, detailBackdropUrl, sizedArt } from "../lib/ui";
import { IconCheck, IconChevronRight, IconMuted, IconPlay, IconPlayRing, IconPlus, IconSound, IconSources, IconTrailer } from "../phone/icons";
import { ListDialog } from "./ListDialog";
import { ProgressLine as ProgressBar } from "./Rows";
import { SeasonChooser, type SeasonOption } from "./SeasonChooser";

type AnimeTab = "episodes" | "more" | "details" | "trailers";

const PAGE = 100;

/**
 * Anime title inside the desk Netflix dialog: shares the exact same 16:9 media header, title + facts,
 * white Play + grey Download buttons, synopsis, credits, 4-icon action bar, and underlined tabs
 * (Episodes / More Like This / Characters & Details / Trailers) as NetflixTitle, while keeping full
 * AniList franchise seasons, ani.zip episode matching, filler indicators, and series picker support.
 */
export function AnimeTitleView({
  id,
  preview,
  episode,
  top = true,
}: {
  id: number;
  preview?: AnimeCard;
  episode?: string;
  top?: boolean;
}) {
  const { animeSeparateEntries: separate, animeTitles } = usePrefs();
  const [activeId, setActiveId] = useState(id);
  useEffect(() => setActiveId(id), [id]);

  const { data: opened } = useAnime(id);
  const { data: walk, isPending: walking } = useAnimeSeasons(separate ? undefined : opened);
  const chain = walk?.seasons;
  const found = !separate && chain && chain.length > 1 && chain.some((s) => s.card.id === id) ? chain : undefined;
  const linked = !!opened?.relations.edges.some((e) => (e.relationType === "PREQUEL" || e.relationType === "SEQUEL") && e.node.type !== "MANGA");
  const seasonsLoading = !separate && linked && (walking || walk?.complete === false);
  const title = useAnimeTitle();
  const ownTab = !!opened && isSeason(opened) && !nothingKnownYet(opened);
  const seasons = found ?? (seasonsLoading && opened && ownTab ? [{ card: opened, label: title(opened.title) }] : undefined);

  const { data: loaded, isError } = useAnime(activeId, { keepPrevious: true });
  const anime = loaded?.id === activeId ? loaded : undefined;
  const shown: AnimeCard | undefined = anime ?? seasons?.find((s) => s.card.id === activeId)?.card ?? (activeId === id ? preview : loaded);

  const linkedOf = useLinkedImdbs(found ? found.map((s) => s.card.id) : shown ? [shown.id] : []);
  const separateFirst = separate && opened ? noSeasonBefore(opened) : undefined;
  const sourceOf = (played: HeroImdb | undefined) =>
    pageArtSource({ separate, seasonsLoading, found: found?.map((s) => s.card), shown, active: activeId, separateFirst, linked: linkedOf, played });
  const artEntry = sourceOf(undefined).first;
  const asked = artEntry && "relations" in artEntry ? artEntry : undefined;
  const qc = useQueryClient();
  const { zip: artZip } = usePlayedZip(asked);
  const { data: plays, isError: noPlays } = useQuery(animeImdbQuery(qc, asked, artZip));
  const artPlays = artEntry && (noPlays || plays !== undefined) ? { of: artEntry.id, id: noPlays ? null : (plays?.id ?? null) } : undefined;
  const source = sourceOf(artPlays);
  const { base, first, known: firstKnown } = source;

  const { data: baseAnime } = useQuery({ ...animeQuery(base?.card.id ?? 0), enabled: !!base });
  const linkedIds = found ? found.map((s) => linkedOf(s.card.id)).filter((x): x is string => !!x?.startsWith("tt")) : [];
  const played = useProgressOf([...new Set(linkedIds)]);
  const franchiseParts = useMemo(() => {
    if (!found || !base) return undefined;
    const labels = distinctLabels(
      found.map((s) => [title(s.card.title), s.card.title.romaji, s.card.title.english]),
      found.map((s) => s.label),
    );
    const parts = found.map((s, i) => ({ card: s.card, label: labels[i] }));
    const play = continuePart(parts, played, (v) => animeEntries.entryAt(v)?.anilist, linkedOf) ?? base.card;
    const at = parts.findIndex((p) => p.card.id === play.id);
    return { parts, play, following: parts[at + 1]?.card };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, base?.card, played, animeTitles]);

  const { data: firstZip, isPending: firstZipPending } = useAniZip(first?.id ?? 0, !!first);
  const resolved = source.imdb;
  const kept = useRef<{ first: number; imdb: string | null }>(undefined);
  if (first && resolved !== undefined && kept.current?.first !== first.id) kept.current = { first: first.id, imdb: resolved };
  const franchiseImdb = first && kept.current?.first === first.id ? kept.current.imdb : resolved;
  const { data: meta, isLoading: metaLoading } = useMeta(
    first?.format === "MOVIE" ? "movie" : "series",
    franchiseImdb ?? "",
    !!franchiseImdb?.startsWith("tt"),
  );

  const limitSubject = useMemo(
    () =>
      meta ??
      (shown
        ? {
            id: franchiseImdb ?? `anilist:${shown.id}`,
            type: shown.format === "MOVIE" ? ("movie" as const) : ("series" as const),
            name: title(shown.title),
            certification: shown.genres?.some((g) => /^hentai$/i.test(g)) ? "NC-17" : undefined,
          }
        : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta, shown, franchiseImdb],
  );
  const verdict = useTitleVerdict(limitSubject, !!meta || (!metaLoading && franchiseImdb !== undefined) || isError);

  const [sheets, setSheets] = useState(0);
  const onSheet = useCallback((open: boolean) => setSheets((n) => Math.max(0, n + (open ? 1 : -1))), []);
  const bigTrailer = !!useTrailerOpen();
  const trailerId = firstKnown && franchiseImdb?.startsWith("tt") ? franchiseImdb : undefined;
  const trailer = useBackdropTrailer(trailerId, { active: top && verdict === "show", paused: sheets > 0 || bigTrailer });
  const picker = useSourcePicker(onSheet);

  // Playback target for the main Play/Resume button (franchise-wide when grouped).
  const headItem = franchiseParts && base ? base.card : shown;
  const headAnime = franchiseParts && base ? baseAnime : anime;
  const playingEntry = franchiseParts?.play ?? headAnime ?? headItem;
  const dummyCard = shown ?? ({ id, title: { romaji: "" }, coverImage: {} } as AnimeCard);
  const firstPb = useAnimePlayback(playingEntry ?? dummyCard);
  const afterPb = useAnimePlayback(franchiseParts?.following ?? playingEntry ?? dummyCard);
  const pb = franchiseParts?.following && firstPb.next.finished ? afterPb : firstPb;

  // Active season playback (for Episodes tab & season download).
  const activeEntry = loaded ?? shown ?? dummyCard;
  const activePb = useAnimePlayback(activeEntry);
  const { data: extRatings } = useRatings(pb.isMovie ? "movie" : "series", pb.metaId ?? "");

  const summary = useMemo(() => (franchiseParts ? franchiseSummary(franchiseParts.parts) : undefined), [franchiseParts]);
  const formatScore = useAnimeScore();

  const isMovieOnly = !seasons && shown?.format === "MOVIE";
  const hasTrailer = !!(headAnime?.trailer?.site === "youtube" || anime?.trailer?.site === "youtube" || meta?.trailerYtId);
  const tabs = useMemo((): { id: AnimeTab; label: string }[] => {
    const list: { id: AnimeTab; label: string }[] = [];
    if (!isMovieOnly) list.push({ id: "episodes", label: "Episodes" });
    list.push({ id: "more", label: "More Like This" });
    list.push({ id: "details", label: "Details" });
    if (hasTrailer) list.push({ id: "trailers", label: "Trailers" });
    return list;
  }, [isMovieOnly, hasTrailer]);
  const [tab, setTab] = useState<AnimeTab>(isMovieOnly ? "more" : "episodes");
  const shownTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  const [logoFailed, setLogoFailed] = useState(false);
  const logoSrc = pb.meta?.logo ? sizedArt(pb.meta.logo, "w500") : undefined;
  useEffect(() => setLogoFailed(false), [logoSrc]);

  if (verdict === "hide") return <p className="dk-t-note">{LIMIT_NOTICE}</p>;
  if (isError && !shown) return <p className="dk-t-note">Couldn't load this anime from AniList. Try again in a minute.</p>;
  if (!shown || verdict === "wait") {
    const skArt = preview?.bannerImage ?? preview?.coverImage.extraLarge ?? preview?.coverImage.large;
    return (
      <div className="dk-t" aria-busy>
        <div className="dk-t-media scheme-dark">{skArt && <Img className="dk-t-art" src={skArt} alt="" loading="eager" />}</div>
        <div className="dk-t-info">
          <span className="dk-sk dk-sk-title" />
          <span className="dk-sk dk-sk-line" />
          <span className="dk-sk dk-sk-btn" />
          <span className="dk-sk dk-sk-btn" />
          <span className="dk-sk dk-sk-text" />
          <span className="dk-sk dk-sk-text dk-sk-short" />
        </div>
      </div>
    );
  }

  const rawArt = franchiseArt({
    imdb: franchiseImdb,
    meta,
    metaLoading,
    first: animeArt(first ?? shown, firstZip),
    firstLoading: !!first && firstZipPending,
  });
  const artBg = detailBackdropUrl(rawArt.background) ?? rawArt.background;
  const coverFallbacks = [
    meta?.poster,
    first?.coverImage.extraLarge,
    first?.coverImage.large,
    shown.coverImage.extraLarge,
    shown.coverImage.large,
  ].filter((u): u is string => !!u);

  const displayName = title((headItem ?? shown).title);
  const subTitle = heroSubtitle((headItem ?? shown).title, animeTitles, false);
  const score = formatScore((headItem ?? shown).averageScore);
  const studios = (headAnime ?? anime)?.studios.edges.filter((e) => e.node.isAnimationStudio).map((e) => e.node.name) ?? [];
  const mainStudio = (headAnime ?? anime)?.studios.edges.find((e) => e.isMain && e.node.isAnimationStudio)?.node.name ?? studios[0];
  const factsSource = base?.card ?? shown;
  const nextAiring = summary ? summary.airing : (headItem ?? shown).nextAiringEpisode;
  const facts: string[] = summary
    ? [summary.years, summary.parts, summary.status, mainStudio].filter((x): x is string => !!x)
    : [
        factsSource.seasonYear ? String(factsSource.seasonYear) : undefined,
        factsSource.format && FORMAT_LABEL[factsSource.format],
        factsSource.format === "MOVIE"
          ? factsSource.duration
            ? `${factsSource.duration} min`
            : undefined
          : factsSource.episodes
            ? `${factsSource.episodes} Episode${factsSource.episodes === 1 ? "" : "s"}`
            : undefined,
        factsSource.status && STATUS_LABEL[factsSource.status],
        mainStudio,
      ].filter((x): x is string => !!x);

  const target = pb.isMovie ? pb.metaId : pb.next.ep?.video?.id;
  const request: PlayRequest | null =
    target && pb.metaId
      ? {
          type: pb.isMovie ? "movie" : "series",
          metaId: pb.metaId,
          videoId: target,
          resumable: !!pb.next.resumeAt,
          subtitle: pb.next.ep ? `Episode ${pb.next.ep.number}${pb.next.ep.title ? ` · ${pb.next.ep.title}` : ""}` : displayName,
        }
      : null;

  const playLabel = upNextLabel(pb.next, pb.isMovie);
  const playVideo = pb.next.ep?.video;
  const watched = target ? pb.byVideo.get(target) : undefined;
  const resuming = !!pb.next.resumeAt && !!watched?.duration;
  const paragraphs = cleanDescription((headAnime ?? anime)?.description);
  const synopsis = (resuming || pb.next.kind === "next") && pb.next.ep?.overview ? pb.next.ep.overview : paragraphs.join(" ");
  const ytTrailerId = (headAnime ?? anime)?.trailer?.site === "youtube" ? (headAnime ?? anime)!.trailer!.id : meta?.trailerYtId;

  const seasonChoices: SeasonOption[] = seasons
    ? distinctLabels(
        seasons.map((s) => [title(s.card.title), s.card.title.romaji, s.card.title.english]),
        seasons.map((s) => s.label),
      ).map((label, i) => ({ id: seasons[i].card.id, label, count: seasons[i].card.episodes ?? undefined }))
    : [];

  const unavailable =
    !pb.loading && !pb.metaId
      ? "Not linked to any sources yet"
      : !pb.metaLoading && pb.metaId && !target && !pb.isMovie
        ? "No episodes to play yet"
        : undefined;

  return (
    <div className="dk-t">
      <div className="dk-t-media scheme-dark">
        {(artBg || coverFallbacks[0]) && (
          <Img className="dk-t-art" src={artBg ?? coverFallbacks[0]} fallbacks={coverFallbacks} alt="" loading="eager" fetchPriority="high" />
        )}
        {trailer.node}
        {logoSrc && !logoFailed && (
          <TitleLogo
            key={logoSrc}
            className="dk-t-logo"
            src={logoSrc}
            logos={pb.meta?.logos?.map((u) => sizedArt(u, "w500") ?? u)}
            backdrop={artBg ?? coverFallbacks[0]}
            alt=""
            loading="eager"
            draggable={false}
            onFail={() => setLogoFailed(true)}
          />
        )}
        {trailer.state !== "idle" && (
          <button
            type="button"
            className="dk-round dk-t-mute"
            aria-label={trailer.state === "ended" ? "Replay trailer" : trailer.muted ? "Turn trailer sound on" : "Mute trailer"}
            onClick={trailer.state === "ended" ? trailer.replay : trailer.toggleMute}
          >
            {trailer.muted || trailer.state === "ended" ? <IconMuted size={18} /> : <IconSound size={18} />}
          </button>
        )}
      </div>

      <div className="dk-t-info">
        <h1 className="dk-t-name">{displayName}</h1>
        {subTitle && <p className="dk-t-subname">{subTitle}</p>}
        <p className="dk-t-facts">
          {score && <span className="dk-t-score">★ {score}</span>}
          {facts.map((f, i) => (
            <span key={`${f}-${i}`}>{f}</span>
          ))}
        </p>
        {extRatings && (
          <div className="dk-t-scores">
            <ScoreRow ratings={extRatings} />
          </div>
        )}
        {nextAiring && (
          <p className="dk-t-airing tabular" title={new Date(nextAiring.airingAt * 1000).toLocaleString()}>
            <strong>{summary?.airing ? `${summary.airing.label} · ` : ""}Episode {nextAiring.episode}</strong>{" "}
            {new Date(nextAiring.airingAt * 1000).toLocaleDateString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })}
            {" · in "}
            {countdown(untilAiring(nextAiring.airingAt))}
          </p>
        )}

        <div className="dk-t-action-row">
          <div className="dk-t-buttons">
            <button type="button" className="dk-t-btn dk-t-btn-white" disabled={!request} onClick={() => request && picker.play(request)}>
              <IconPlay size={24} />
              {playLabel}
            </button>
            {pb.meta && (pb.isMovie || playVideo) && (
              <DownloadButton
                item={pb.meta}
                video={pb.isMovie ? undefined : playVideo}
                className="dk-t-btn dk-t-btn-grey"
                size={22}
                text={pb.isMovie ? "Download" : `Download Ep ${pb.next.ep?.number ?? playVideo?.episode ?? 1}`}
              />
            )}
          </div>
          <AnimeActionBar
            meta={pb.meta}
            name={displayName}
            imdbId={pb.metaId?.startsWith("tt") ? pb.metaId : undefined}
            ytTrailerId={ytTrailerId}
            request={request}
            onSources={() => request && picker.choose(request)}
            activeAnime={loaded}
            activePb={activePb}
          />
        </div>

        <div className="dk-t-meta-grid">
          <div className="dk-t-meta-main">
            {resuming && watched && (
              <div className="dk-t-resume">
                {pb.next.ep && (
                  <p className="dk-t-ep">
                    Episode {pb.next.ep.number}
                    {pb.next.ep.title ? ` · ${pb.next.ep.title}` : ""}
                  </p>
                )}
                <div className="dk-t-resume-bar">
                  <ProgressBar fraction={watched.position / watched.duration} />
                  <span>{formatRemaining(watched.position, watched.duration)}</span>
                </div>
              </div>
            )}
            {!resuming && !pb.isMovie && pb.next.ep && (
              <p className="dk-t-ep">
                Episode {pb.next.ep.number}
                {pb.next.ep.title ? ` · ${pb.next.ep.title}` : ""}
              </p>
            )}

            {synopsis && <AnimeSynopsis text={synopsis} />}
          </div>
          <div className="dk-t-meta-side">
            <div className="dk-t-credits">
              {studios.length > 0 && (
                <p>
                  <span className="dk-t-credit-label">Studio: </span>
                  {studios.slice(0, 3).join(", ")}
                </p>
              )}
              {!!(headItem ?? shown).genres?.length && (
                <p>
                  <span className="dk-t-credit-label">Genres: </span>
                  {(headItem ?? shown).genres!.slice(0, 5).join(", ")}
                </p>
              )}
              {(unavailable || pb.pickable) && (
                <p className="dk-t-anime-link">
                  {unavailable && <span>{unavailable}</span>}
                  {pb.pickable && (
                    <AnimeSeriesPick
                      anime={playingEntry ?? shown}
                      isMovie={pb.isMovie}
                      current={pb.metaId}
                      mal={pb.malId}
                      kitsu={pb.kitsu}
                    />
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <Tabs className="dk-t-tabs" value={shownTab} onValueChange={(v) => v && setTab(v as AnimeTab)}>
        <TabsList className="dk-t-tablist" aria-label="More about this title">
          <TabsIndicator className="dk-t-tab-mark" />
          {tabs.map((t) => (
            <TabsTab key={t.id} value={t.id} className="dk-t-tab">
              {t.label}
            </TabsTab>
          ))}
        </TabsList>

        {tabs.map((t) => (
          <TabsPanel key={t.id} value={t.id} className="dk-t-panel">
            {t.id === "episodes" && loaded && (
              <DeskAnimeEpisodes
                anime={loaded}
                pb={activePb}
                seasonChoices={seasonChoices}
                activeSeasonId={activeId}
                onSelectSeason={setActiveId}
                seasonsLoading={seasonsLoading}
                episode={episode}
                onSheet={onSheet}
                fallbackBg={artBg ?? coverFallbacks[0]}
              />
            )}
            {t.id === "more" && loaded && (
              <DeskAnimeMore anime={loaded} franchiseCards={seasons?.map((s) => s.card)} />
            )}
            {t.id === "details" && loaded && (
              <div className="dk-t-anime-details">
                {(loaded.characters.edges.length > 0 || loaded.staff.edges.length > 0) && <AnimeCharacters anime={loaded} />}
                <AnimeDetails anime={loaded} />
              </div>
            )}
            {t.id === "trailers" && ytTrailerId && (
              <div className="dk-t-trailers">
                <button
                  type="button"
                  className="dk-t-trailer"
                  onClick={() => openTrailer({ name: displayName, imdbId: pb.metaId?.startsWith("tt") ? pb.metaId : undefined, ytId: ytTrailerId, ytFrom: "AniList" })}
                >
                  <span className="dk-t-trailer-still scheme-dark">
                    <Img src={artBg ?? coverFallbacks[0]} alt="" loading="lazy" />
                    <span className="dk-ep-play" aria-hidden>
                      <IconPlayRing size={44} />
                    </span>
                  </span>
                  <span className="dk-t-trailer-name">Trailer: {displayName}</span>
                </button>
              </div>
            )}
          </TabsPanel>
        ))}
      </Tabs>

      <SourcePicker picker={picker} />
    </div>
  );
}

function AnimeSynopsis({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <p className="dk-t-synopsis" data-open={open || undefined} onClick={() => setOpen(true)}>
      {text}
    </p>
  );
}

function AnimeActionBar({
  meta,
  name,
  imdbId,
  ytTrailerId,
  request,
  onSources,
  activeAnime,
  activePb,
}: {
  meta?: Meta;
  name: string;
  imdbId?: string;
  ytTrailerId?: string;
  request: PlayRequest | null;
  onSources: () => void;
  activeAnime?: Anime;
  activePb: ReturnType<typeof useAnimePlayback>;
}) {
  const { animeHideRecaps } = usePrefs();
  const { data: flags } = useEpisodeFlags(activePb.malId, activeAnime ? [activeAnime.title.english, activeAnime.title.romaji] : []);
  const list = useMemo(() => shelfEpisodes(activePb.episodes, flags, animeHideRecaps), [activePb.episodes, flags, animeHideRecaps]);
  const downloads = useMemo(() => partDownloads(list), [list]);

  return (
    <div className="dk-t-actions">
      {meta && <AnimeLibraryAction item={meta} />}
      {ytTrailerId && (
        <DeskActionBtn label="Trailer" onClick={() => openTrailer({ name, imdbId, ytId: ytTrailerId, ytFrom: "AniList" })}>
          <IconTrailer size={27} />
        </DeskActionBtn>
      )}
      <DeskActionBtn label="Sources" disabled={!request} onClick={onSources}>
        <IconSources size={27} />
      </DeskActionBtn>
      {meta && !activePb.isMovie && downloads.length > 0 && (
        <AnimeSeasonDownload item={meta} videos={downloads} />
      )}
    </div>
  );
}

function AnimeLibraryAction({ item }: { item: Meta }) {
  const { inLibrary, toggle } = useLibraryToggle(item);
  return (
    <DeskActionBtn label="My List" pressed={inLibrary} onClick={toggle}>
      {inLibrary ? <IconCheck size={28} stroke={1.6} /> : <IconPlus size={28} stroke={1.5} />}
    </DeskActionBtn>
  );
}

function AnimeSeasonDownload({ item, videos }: { item: Meta; videos: Video[] }) {
  const d = useBatchDownload({ item, videos, season: 1 });
  return (
    <DeskActionBtn
      label={
        d.running ? (
          "Downloading"
        ) : (
          <>
            Download
            <br />
            Season
          </>
        )
      }
      disabled={d.disabled && !d.running}
      onClick={d.start}
    >
      <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3.5v10.5M7.5 9.5l4.5 4.5 4.5-4.5M4 17.5h16M6.5 20.5h11" />
      </svg>
    </DeskActionBtn>
  );
}

function DeskActionBtn({ label, onClick, pressed, disabled, children }: { label: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="dk-t-action" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <span className="dk-t-action-glyph">{children}</span>
      <span className="dk-t-action-label">{label}</span>
    </button>
  );
}

function DeskAnimeEpisodes({
  anime,
  pb,
  seasonChoices,
  activeSeasonId,
  onSelectSeason,
  seasonsLoading,
  episode,
  onSheet,
  fallbackBg,
}: {
  anime: Anime;
  pb: ReturnType<typeof useAnimePlayback>;
  seasonChoices: SeasonOption[];
  activeSeasonId: number;
  onSelectSeason: (id: number) => void;
  seasonsLoading: boolean;
  episode?: string;
  onSheet: (open: boolean) => void;
  fallbackBg?: string;
}) {
  const prefs = usePrefs();
  const [layout, setLayout] = useEpisodeLayout();
  const [choosingRange, setChoosingRange] = useState(false);
  const picker = useSourcePicker(onSheet);
  const { data: flags } = useEpisodeFlags(pb.malId, [anime.title.english, anime.title.romaji]);
  const hasFiller = !!flags && [...flags.values()].some((f) => f.filler);
  const list = useMemo(() => shelfEpisodes(pb.episodes, flags, prefs.animeHideRecaps), [pb.episodes, flags, prefs.animeHideRecaps]);

  useEffect(() => {
    if (flags && pb.metaId)
      playContext.filler(
        pb.metaId,
        pb.episodes.flatMap((e) => (e.video ? [e.video.id] : [])),
        pb.episodes.flatMap((e) => (e.video && flags.get(e.number)?.filler ? [e.video.id] : [])),
      );
  }, [flags, pb.episodes, pb.metaId]);

  const pages = Math.ceil(list.length / PAGE);
  const [page, setPage] = useState<number | null>(null);
  useEffect(() => setPage(null), [anime.id]);
  const upNextId = pb.next.kind !== "start" ? pb.next.ep?.video?.id : undefined;
  const upTo = Math.max(0, list.findIndex((v) => v.id === (pb.next.ep?.video?.id ?? "")));
  const currentPage = Math.min(Math.max(0, pages - 1), page ?? Math.floor(upTo / PAGE));
  const visible = pages > 1 ? list.slice(currentPage * PAGE, currentPage * PAGE + PAGE) : list;

  const request = (v: Video): PlayRequest | undefined =>
    v.id.startsWith(PENDING_EPISODE) || !pb.metaId
      ? undefined
      : {
          type: "series",
          metaId: pb.metaId,
          videoId: v.id,
          resumable: pb.byVideo.has(v.id),
          subtitle: `Episode ${v.episode}${v.title ? ` · ${v.title}` : ""}`,
        };

  const offered = useRef(false);
  useEffect(() => {
    if (!episode || offered.current || !pb.metaId) return;
    const linked = list.find((v) => v.id === episode);
    const req = linked ? request(linked) : undefined;
    if (!req) return;
    offered.current = true;
    picker.choose(req);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, list, pb.metaId]);

  const currentSeasonLabel = seasonChoices.find((s) => s.id === activeSeasonId)?.label ?? anime.title.english ?? anime.title.romaji ?? "Episodes";
  const rangeOptions = Array.from({ length: pages }, (_, i) => ({
    id: i,
    label: `Episodes ${list[i * PAGE]?.episode}–${list[Math.min(list.length, (i + 1) * PAGE) - 1]?.episode}`,
  }));

  const isMoviePart = anime.format === "MOVIE";
  const movieReq: PlayRequest | undefined =
    isMoviePart && pb.metaId
      ? { type: "movie", metaId: pb.metaId, videoId: pb.metaId, resumable: !!pb.next.resumeAt, subtitle: currentSeasonLabel }
      : undefined;

  return (
    <section className="dk-eps" data-layout={layout}>
      <div className="dk-eps-bar">
        {seasonChoices.length > 1 ? (
          <SeasonChooser
            options={seasonChoices}
            value={activeSeasonId}
            currentLabel={currentSeasonLabel}
            onPick={onSelectSeason}
            resetKey={anime.id}
          />
        ) : (
          <span className="dk-season-name">
            {seasonsLoading ? `${currentSeasonLabel}…` : currentSeasonLabel}
            {!seasonsLoading && list.length > 0 && <span className="dk-season-inline-count tabular"> ({list.length} {list.length === 1 ? "Episode" : "Episodes"})</span>}
          </span>
        )}
        {pages > 1 && (
          <button type="button" className="dk-season dk-season-range" onClick={() => setChoosingRange(true)}>
            {rangeOptions[currentPage]?.label}
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M2.5 5l4.5 4.5L11.5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {hasFiller && (
          <button
            type="button"
            className="dk-season dk-season-range"
            aria-pressed={prefs.animeHideRecaps}
            onClick={() => setPrefs({ animeHideRecaps: !prefs.animeHideRecaps })}
          >
            {prefs.animeHideRecaps ? "Recaps hidden" : "Hide recaps"}
          </button>
        )}
        <span className="dk-flex" />
        {!isMoviePart && (
          <div className="dk-eps-layout" role="radiogroup" aria-label="Episode layout">
            <button type="button" role="radio" aria-checked={layout === "row"} aria-label="Side by side" onClick={() => setLayout("row")}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <rect x="2" y="5" width="7" height="10" rx="2" fill="currentColor" />
                <rect x="11" y="5" width="7" height="10" rx="2" fill="currentColor" opacity="0.55" />
              </svg>
            </button>
            <button type="button" role="radio" aria-checked={layout === "list"} aria-label="Listed" onClick={() => setLayout("list")}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <rect x="2" y="3.5" width="16" height="5.5" rx="1.8" fill="currentColor" />
                <rect x="2" y="11" width="16" height="5.5" rx="1.8" fill="currentColor" opacity="0.55" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {isMoviePart ? (
        <ol className="dk-ep-list">
          <li className="dk-ep">
            <button
              type="button"
              className="dk-ep-row-still scheme-dark"
              aria-label={`Play ${currentSeasonLabel}`}
              disabled={!movieReq}
              onClick={() => movieReq && picker.play(movieReq)}
            >
              <Img src={anime.bannerImage ?? fallbackBg} fallbacks={[anime.coverImage.extraLarge ?? ""].filter(Boolean)} alt="" loading="lazy" />
              {movieReq && (
                <span className="dk-ep-play" aria-hidden>
                  <IconPlayRing size={36} />
                </span>
              )}
            </button>
            <div className="dk-ep-body">
              <div className="dk-ep-name">
                <strong>{currentSeasonLabel}</strong>
                <span>{[anime.seasonYear, anime.duration && `${anime.duration} min`].filter(Boolean).join(" · ")}</span>
              </div>
              {anime.description && <p className="dk-ep-text">{cleanDescription(anime.description)[0]}</p>}
            </div>
          </li>
        </ol>
      ) : !visible.length ? (
        <p className="dk-t-empty">{comesOut(anime) ? `${comesOut(anime)}.` : pb.loading || pb.metaLoading ? "Loading episodes…" : "No episodes to play yet."}</p>
      ) : layout === "row" ? (
        <AnimeEpStrip
          meta={pb.meta}
          episodes={visible}
          progress={pb.byVideo}
          flags={flags}
          upNextId={upNextId}
          fallbackBg={fallbackBg}
          runtime={anime.duration ? `${anime.duration} min` : undefined}
          onPlay={(v) => {
            const req = request(v);
            if (req) picker.play(req);
          }}
        />
      ) : (
        <ol className="dk-ep-list">
          {visible.map((v) => {
            const req = request(v);
            const p = pb.byVideo.get(v.id);
            const flag = flags?.get(v.episode);
            const pending = v.id.startsWith(PENDING_EPISODE);
            const menuProps = pb.meta && !pending ? cardMenu(pb.meta, episodeEntry(pb.meta, v, p), { episode: true }) : {};
            return (
              <li key={v.id} className="dk-ep" {...menuProps}>
                <button
                  type="button"
                  className="dk-ep-row-still scheme-dark"
                  aria-label={`Play episode ${v.episode}`}
                  disabled={!req}
                  onClick={() => req && picker.play(req)}
                >
                  <Img
                    src={v.thumbnail ? sizedArt(v.thumbnail, "w300") : fallbackBg}
                    fallbacks={fallbackBg ? [fallbackBg] : undefined}
                    alt=""
                    loading="lazy"
                  />
                  {req && (
                    <span className="dk-ep-play" aria-hidden>
                      <IconPlayRing size={36} />
                    </span>
                  )}
                  {p && p.duration > 0 && <ProgressBar fraction={p.position / p.duration} />}
                </button>
                <div className="dk-ep-body">
                  <div className="dk-ep-name">
                    <strong>
                      {v.episode}. {v.title?.trim() || `Episode ${v.episode}`}
                      {flag?.filler && <span className="dk-ep-badge">Filler</span>}
                      {flag?.recap && <span className="dk-ep-badge">Recap</span>}
                    </strong>
                    <span>
                      {[
                        anime.duration && `${anime.duration} min`,
                        v.released && !pending ? new Date(v.released).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {v.overview && <p className="dk-ep-text">{v.overview}</p>}
                </div>
                {req && pb.meta && (
                  <span className="dk-ep-dl-slot">
                    <DownloadButton item={pb.meta} video={v} className="dk-ep-dl" size={22} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {pages > 1 && (
        <ListDialog
          open={choosingRange}
          label="Episode range"
          options={rangeOptions}
          value={currentPage}
          onPick={(idx) => {
            setPage(idx);
            setChoosingRange(false);
          }}
          onClose={() => setChoosingRange(false)}
        />
      )}
      <SourcePicker picker={picker} />
    </section>
  );
}

function AnimeEpStrip({
  meta,
  episodes,
  progress,
  flags,
  upNextId,
  fallbackBg,
  runtime,
  onPlay,
}: {
  meta?: Meta;
  episodes: Video[];
  progress: Map<string, Progress>;
  flags?: Map<number, { filler?: boolean; recap?: boolean }>;
  upNextId?: string;
  fallbackBg?: string;
  runtime?: string;
  onPlay: (v: Video) => void;
}) {
  const strip = useRef<HTMLOListElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const s = strip.current;
    if (!s) return;
    const start = s.scrollLeft <= 2;
    const end = s.scrollLeft + s.clientWidth >= s.scrollWidth - 2;
    setEnds((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  useLayoutEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>("[data-up-next]");
    if (el && strip.current) strip.current.scrollLeft = el.offsetLeft - 28;
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const s = strip.current;
    if (!s) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    return () => ro.disconnect();
  }, [measure, episodes]);
  const page = (dir: 1 | -1) => {
    const s = strip.current;
    if (!s) return;
    s.scrollBy({ left: dir * Math.max(240, s.clientWidth - 96), behavior: "smooth" });
  };

  return (
    <div className="dk-strip-wrap dk-ep-strip-wrap">
      <ol className="dk-ep-strip" ref={strip} onScroll={measure}>
        {episodes.map((v) => {
          const p = progress.get(v.id);
          const pending = v.id.startsWith(PENDING_EPISODE);
          const on = !pending && !!meta;
          const flag = flags?.get(v.episode);
          const menuProps = meta && on ? cardMenu(meta, episodeEntry(meta, v, p), { episode: true }) : {};
          return (
            <li key={v.id} className="dk-ep-card" data-up-next={v.id === upNextId || undefined} {...menuProps}>
              <button type="button" className="dk-ep-still scheme-dark" aria-label={`Play episode ${v.episode}`} disabled={!on} onClick={() => onPlay(v)}>
                <Img
                  src={v.thumbnail ? sizedArt(v.thumbnail, "w500") : fallbackBg}
                  fallbacks={fallbackBg ? [fallbackBg] : undefined}
                  alt=""
                  loading="lazy"
                />
                {on ? (
                  <span className="dk-ep-play" aria-hidden>
                    <IconPlayRing size={40} />
                  </span>
                ) : (
                  <span className="dk-ep-soon">{v.released ? new Date(v.released).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Soon"}</span>
                )}
                {p && p.duration > 0 && <ProgressBar fraction={p.position / p.duration} />}
              </button>
              <div className="dk-ep-head">
                <strong>
                  <span className="dk-ep-num">{v.episode}</span>
                  {v.title?.trim() || `Episode ${v.episode}`}
                  {flag?.filler && <span className="dk-ep-badge">Filler</span>}
                  {flag?.recap && <span className="dk-ep-badge">Recap</span>}
                </strong>
                {on && meta && (
                  <span className="dk-ep-dl-slot">
                    <DownloadButton item={meta} video={v} className="dk-ep-dl" size={20} />
                  </span>
                )}
              </div>
              <span className="dk-ep-meta">
                {[runtime, v.released && !pending ? new Date(v.released).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : undefined]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {v.overview && <p className="dk-ep-text">{v.overview}</p>}
            </li>
          );
        })}
      </ol>
      {!ends.start && (
        <button type="button" className="dk-pager dk-pager-back" aria-label="Scroll episodes back" tabIndex={-1} onClick={() => page(-1)}>
          <IconChevronRight size={22} stroke={2.4} />
        </button>
      )}
      {!ends.end && (
        <button type="button" className="dk-pager" aria-label="Scroll episodes forward" tabIndex={-1} onClick={() => page(1)}>
          <IconChevronRight size={22} stroke={2.4} />
        </button>
      )}
    </div>
  );
}

function DeskAnimeMore({ anime, franchiseCards }: { anime: Anime; franchiseCards?: AnimeCard[] }) {
  const { animeSeparateEntries: separate } = usePrefs();
  const title = useAnimeTitle();
  const { navigate } = useNavigation();
  const own = franchiseCards ?? [];
  const first = likedThis(anime, anime.recommendations.nodes, own, separate);
  const { data: more } = useMoreRecommendations(anime.id, first.length < LIKED_THIS_FILL && !!anime.recommendations.hasNextPage);
  const recs = more ? likedThis(anime, [...anime.recommendations.nodes, ...more.nodes], own, separate) : first;
  const { watchOrder, also } = relatedRows(anime, franchiseCards ? { seasons: franchiseCards.map((c) => ({ card: c, label: title(c.title) })), active: anime.id, loading: false } : undefined);
  const related = [...watchOrder, ...also].filter((c) => c.card.type !== "MANGA").map((c) => c.card);
  const combined = [...related, ...recs].filter((c, i, all) => c.id !== anime.id && all.findIndex((x) => x.id === c.id) === i);

  if (!combined.length) return <p className="dk-t-empty">Nothing similar found yet.</p>;
  return (
    <div className="dk-t-grid">
      {combined.map((m) => {
        const name = title(m.title);
        const art = cardArtUrl(m.coverImage.extraLarge ?? m.coverImage.large, "poster");
        return (
          <button
            key={m.id}
            type="button"
            className="dk-poster scheme-dark"
            data-origin="4"
            aria-label={name}
            onClick={() => navigate({ name: "anime-detail", id: m.id, preview: m })}
          >
            {art ? <Img src={art} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="dk-poster-name">{name}</span>}
          </button>
        );
      })}
    </div>
  );
}
