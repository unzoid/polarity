import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../components/ui/EmptyState";
import {
  ANIME_GENRES,
  SEASON_LABEL,
  animeItemToPreview,
  countdown,
  formatAnimeItemScore,
  nextSeason,
  seasonOf,
  untilAiring,
  useAnimeGenreShelf,
  useAnimeHomeCatalog,
  useAnimeToday,
  useShelfVisible,
} from "../lib/anime";
import type { Shape } from "../lib/catalog";
import { useMatureContent } from "../lib/catalog";
import { call } from "../lib/platform/bridge";
import { useNavigation } from "../lib/router";
import { usePrefs } from "../lib/settings";
import type { AnimeItem, AnimeSeasonMapping } from "../lib/types";
import { TvBrowse, TvCard, TvRail, TvSkeletonRail, type RailRow } from "./TvRails";
import { useStage } from "./TvStage";

const NO_SOURCE = "Not available from your sources yet";

/**
 * Show-first Anime on the 10-foot screen: powered by the Rust backend (zero per-card AniList calls).
 * Every card already carries its canonical show id, 16:9 fanart, logo, and optional season hint.
 */
export function TvAnime() {
  const { data, isError } = useAnimeHomeCatalog();
  const visible = useShelfVisible();
  const today = useAnimeToday(visible("today"));
  const now = seasonOf();
  const next = nextSeason(now);

  if (isError && !data) {
    return (
      <div className="tv-note">
        <h1 className="tv-heading">Anime</h1>
        <EmptyState variant="tv">Couldn't load anime right now. Check your connection and try again.</EmptyState>
      </div>
    );
  }

  const rail = (id: Parameters<typeof visible>[0], title: string, shape: Shape, items?: AnimeItem[]): RailRow[] =>
    visible(id) ? [{ key: id, render: () => <TvAnimeRail title={title} items={items} shape={shape} /> }] : [];

  const todayRows: RailRow[] = [
    ...(visible("today") && !today.isError
      ? [
          {
            key: "today",
            render: () => (
              <TvAnimeRail
                title="Airing Today"
                shape="landscape"
                items={today.data}
                chip={(a) =>
                  a.airing
                    ? new Date(a.airing.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                    : "Today"
                }
              />
            ),
          },
        ]
      : []),
  ];

  const rows: RailRow[] = [
    ...rail("season", `Airing This ${SEASON_LABEL[now.season]}`, "poster", data?.season),
    ...rail("trending", "Trending Now", "poster", data?.trending),
    ...todayRows,
    ...rail("upcoming", `Coming in ${SEASON_LABEL[next.season]} ${next.year}`, "poster", data?.upcoming),
    ...rail("top", "Highest Rated", "landscape", data?.top),
    ...rail("popular", "Most Popular", "poster", data?.popular),
    ...rail("movies", "Movies", "landscape", data?.movies),
    ...(visible("genres")
      ? ANIME_GENRES.map((g, i) => ({
          key: `genre/${g}`,
          render: (near: boolean) => <TvGenreRail genre={g} near={near} shape={i % 3 === 0 ? "landscape" : "poster"} />,
        }))
      : []),
  ];

  if (!rows.length) {
    return (
      <div className="tv-note">
        <h1 className="tv-heading">Anime</h1>
        <EmptyState variant="tv">Every shelf is turned off in Settings.</EmptyState>
      </div>
    );
  }
  return <TvBrowse rows={rows} />;
}

function TvGenreRail({ genre, near, shape }: { genre: string; near: boolean; shape: Shape }) {
  const { data } = useAnimeGenreShelf(genre, near);
  return <TvAnimeRail title={genre} items={data} shape={shape} />;
}

export function TvAnimeRail({
  title,
  items,
  shape,
  chip,
}: {
  title: string;
  items?: AnimeItem[];
  shape: Shape;
  chip?: (a: AnimeItem) => string | undefined;
}) {
  const matureContent = useMatureContent();
  if (!items) return <TvSkeletonRail title={title} shape={shape} />;
  const kept = matureContent === "show" ? items : items.filter((a) => !a.mature);
  if (!kept.length) return null;
  return (
    <TvRail title={title}>
      {kept.map((item) => (
        <TvAnimeCard key={item.id} item={item} shape={shape} chip={chip?.(item)} />
      ))}
    </TvRail>
  );
}

function TvAnimeCard({ item, shape, chip }: { item: AnimeItem; shape: Shape; chip?: string }) {
  const { navigate } = useNavigation();
  const stage = useStage();
  const prefs = usePrefs();
  const score = prefs.animeCardScores ? formatAnimeItemScore(item.score, prefs.animeScoreFormat) : undefined;
  const focused = useRef(false);

  const preview = useMemo(() => animeItemToPreview(item, prefs.animeTitles), [item, prefs.animeTitles]);
  const fallbacks = useMemo(
    () => (shape === "landscape" ? [item.poster].filter((u): u is string => !!u) : [item.background].filter((u): u is string => !!u)),
    [shape, item.poster, item.background],
  );
  const nextText = prefs.animeCardCountdown && item.airing ? `in ${countdown(untilAiring(item.airing.airingAt))}` : undefined;
  const kicker = [item.seasonLabel, score && `★ ${score}`, chip ?? nextText].filter(Boolean).join(" · ") || undefined;

  useEffect(() => {
    if (focused.current) stage({ item: preview, kicker });
  }, [preview, kicker, stage]);

  return (
    <TvCard
      item={preview}
      shape={shape}
      artFallbacks={fallbacks}
      kicker={kicker}
      localOnly
      staged={preview}
      onOpen={() => navigate({ name: "detail", type: item.type, id: item.id, preview, season: item.seasonHint })}
      onFocusChange={(f) => {
        focused.current = f;
        if (f) stage({ item: preview, kicker });
      }}
    />
  );
}

/** Compatibility redirect for legacy `anime-detail` links in TV mode: resolves via local Fribb in 0ms. */
export function TvAnimeDetail({ id }: { id: number }) {
  const { replace } = useNavigation();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    void call<AnimeSeasonMapping | null>("anime_ids", { key: "anilist_id", value: String(id) })
      .catch(() => null)
      .then((m) => {
        if (!live) return;
        const target = m?.imdb_id ?? (m?.kitsu_id ? `kitsu:${m.kitsu_id}` : m?.mal_id ? `mal:${m.mal_id}` : null);
        if (target) {
          const movie = m?.type?.toLowerCase() === "movie";
          replace({ name: "detail", type: movie ? "movie" : "series", id: target, season: m?.season?.tmdb ?? m?.season?.tvdb });
        } else {
          setMissing(true);
        }
      });
    return () => {
      live = false;
    };
  }, [id, replace]);
  if (!missing) return null;
  return (
    <div className="tv-note">
      <h1 className="tv-heading">Anime</h1>
      <EmptyState variant="tv">{NO_SOURCE}. Press Back to return.</EmptyState>
    </div>
  );
}
