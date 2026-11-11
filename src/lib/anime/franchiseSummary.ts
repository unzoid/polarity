/**
 * The top of a grouped anime page (#327): one summary of the whole franchise, the same on every season
 * tab. Pure; type-only imports, so tests check made-up franchises.
 */
import type { AnimeCard } from "./anilist";
import type { Progress } from "../types";

export interface FranchisePart {
  card: AnimeCard;
  /** Its season tab's label ("Season 2", "Movie", an arc's name). */
  label: string;
}

export interface FranchiseSummary {
  /** "2017 to now", "2017 to 2021", or one year. */
  years?: string;
  /** "4 seasons, 2 films, 182 episodes". */
  parts?: string;
  /** "Season 2 releasing", "Season 3 coming" or "Finished". */
  status: string;
  /** The part whose next episode is scheduled: the releasing one, else the announced one. */
  airing?: { label: string; episode: number; airingAt: number };
}

const yearOf = (c: AnimeCard) => c.startDate?.year ?? c.seasonYear ?? undefined;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ONGOING = new Set(["RELEASING", "NOT_YET_RELEASED", "HIATUS"]);

/**
 * The franchise's span of years (to the year its last part started: cards carry no end date), its parts
 * and total episodes (a part still airing counts what has aired), and its status by the part that's
 * releasing, else the one that's announced.
 */
export function franchiseSummary(parts: FranchisePart[]): FranchiseSummary {
  const years = parts.map((p) => yearOf(p.card)).filter((y): y is number => y !== undefined);
  const ongoing = parts.some((p) => p.card.status && ONGOING.has(p.card.status));
  const first = years.length ? Math.min(...years) : undefined;
  const last = years.length ? Math.max(...years) : undefined;
  const span = first === undefined ? undefined : ongoing ? `${first} to now` : first === last ? String(first) : `${first} to ${last}`;

  const series = parts.filter((p) => p.card.format !== "MOVIE");
  const films = parts.length - series.length;
  const aired = (c: AnimeCard) => c.episodes ?? (c.nextAiringEpisode ? c.nextAiringEpisode.episode - 1 : 0);
  const episodes = series.reduce((n, p) => n + aired(p.card), 0);
  const counts = [series.length && plural(series.length, "season", "seasons"), films && plural(films, "film", "films"), episodes && plural(episodes, "episode", "episodes")];
  const partsText = counts.filter(Boolean).join(", ") || undefined;

  const releasing = parts.find((p) => p.card.status === "RELEASING");
  const coming = parts.find((p) => p.card.status === "NOT_YET_RELEASED");
  const paused = parts.find((p) => p.card.status === "HIATUS");
  const status = releasing ? `${releasing.label} releasing` : coming ? `${coming.label} coming` : paused ? `${paused.label} on hiatus` : "Finished";

  const scheduled = [releasing, coming].find((p) => p?.card.nextAiringEpisode);
  const next = scheduled?.card.nextAiringEpisode;
  return {
    years: span,
    parts: partsText,
    status,
    airing: scheduled && next ? { label: scheduled.label, episode: next.episode, airingAt: next.airingAt } : undefined,
  };
}

/**
 * The part Play carries on with (#327): the one holding the episode (or film) you touched last, by the
 * entries each video was lined up with (`entryOf`, lib/anime/entries.ts) or a film's own linked id.
 * Undefined when nothing of the franchise has been played: Play starts its first part.
 */
export function continuePart(
  parts: FranchisePart[],
  progress: Progress[],
  entryOf: (videoId: string) => number | undefined,
  linked: (anilistId: number) => string | null | undefined,
): AnimeCard | undefined {
  const touched = [...progress].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const p of touched) {
    const film = parts.find((x) => x.card.format === "MOVIE" && linked(x.card.id) === p.videoId);
    if (film) return film.card;
    const id = entryOf(p.videoId);
    const part = id === undefined ? undefined : parts.find((x) => x.card.id === id);
    if (part) return part.card;
  }
  return undefined;
}
