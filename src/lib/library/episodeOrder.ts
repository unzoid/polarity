import { isReleased, seasonLabel } from "../format";
import type { Video } from "../types";

/**
 * Watching a show in another order than aired (DVD, absolute, story arcs…), from TMDB's episode groups
 * (crates/index/src/episode_order.rs). An order only changes how the episodes are grouped, numbered and
 * followed: every episode keeps its aired id, so sources, progress, watched marks and downloads are the same.
 */

/** TMDB's episode group types. */
export type EpisodeOrderKind = "original" | "absolute" | "dvd" | "digital" | "storyArc" | "production" | "tv" | "other";

/** One order TMDB lists for a show (`episode_orders`). */
export interface EpisodeOrderInfo {
  id: string;
  name: string;
  kind: EpisodeOrderKind;
  description?: string;
  episodeCount: number;
  groupCount: number;
}

export interface EpisodeOrderGroup {
  name: string;
  /** Ids of the show's episodes, in the order's order; may repeat one. */
  episodes: string[];
}

/** An order with its episodes as the show's own episode ids (`episode_order`). */
export interface EpisodeOrder {
  id: string;
  name: string;
  kind: EpisodeOrderKind;
  groups: EpisodeOrderGroup[];
}

/** One group of an order as the season picker lists it. */
export interface OrderedGroup {
  /** 1, 2, … in the order's order; the leftover group comes last. */
  id: number;
  label: string;
  videos: Video[];
  /** The aired episodes the order leaves out. */
  leftover?: boolean;
}

/** An order laid over a show's episode list. */
export interface OrderView {
  id: string;
  name: string;
  groups: OrderedGroup[];
  /** Every episode once, in the order's order, the left-out ones last. */
  sequence: Video[];
  /** An episode's number for display: its place in its group. */
  number: Map<string, number>;
  /** Which group an episode is in. */
  groupOf: Map<string, number>;
}

export const LEFTOVER_LABEL = "Not in This Order";

const KIND_LABELS: Record<EpisodeOrderKind, string> = {
  original: "Original Air Date",
  absolute: "Absolute",
  dvd: "DVD",
  digital: "Digital",
  storyArc: "Story Arc",
  production: "Production",
  tv: "TV",
  other: "Other",
};

/** "DVD Order · DVD": the order's name, and its type when the name doesn't already say it. */
export function orderLabel(o: Pick<EpisodeOrderInfo, "name" | "kind">): string {
  const kind = KIND_LABELS[o.kind] ?? KIND_LABELS.other;
  const name = o.name.trim() || kind;
  return name.toLowerCase().includes(kind.toLowerCase()) || o.kind === "other" ? name : `${name} · ${kind}`;
}

/**
 * `order` over `videos` (the show's aired list): each episode placed once, where the order first names it;
 * ids the list doesn't have are left out, as are groups left empty; the aired episodes the order leaves out
 * follow in a last group, so none becomes unreachable.
 */
export function orderView(order: EpisodeOrder, videos: Video[]): OrderView {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const placed = new Set<string>();
  const groups: OrderedGroup[] = [];
  order.groups.forEach((g, i) => {
    const list: Video[] = [];
    for (const id of g.episodes) {
      const v = byId.get(id);
      if (!v || placed.has(id)) continue;
      placed.add(id);
      list.push(v);
    }
    if (list.length) groups.push({ id: groups.length + 1, label: g.name.trim() || `Part ${i + 1}`, videos: list });
  });
  const rest = videos.filter((v) => !placed.has(v.id));
  if (rest.length) groups.push({ id: groups.length + 1, label: LEFTOVER_LABEL, videos: rest, leftover: true });

  const number = new Map<string, number>();
  const groupOf = new Map<string, number>();
  for (const g of groups) {
    g.videos.forEach((v, i) => {
      number.set(v.id, i + 1);
      groupOf.set(v.id, g.id);
    });
  }
  return { id: order.id, name: order.name, groups, sequence: groups.flatMap((g) => g.videos), number, groupOf };
}

const isLeftover = (view: OrderView, id: string) => view.groups.find((g) => g.id === view.groupOf.get(id))?.leftover === true;

/**
 * The released episode after `videoId` in the order, across groups. The left-out episodes are passed over
 * unless you're in them, as specials are in the aired order.
 */
export function nextInOrder(view: OrderView, videoId: string): Video | undefined {
  const i = view.sequence.findIndex((v) => v.id === videoId);
  if (i < 0) return undefined;
  const inLeftover = isLeftover(view, videoId);
  return view.sequence.slice(i + 1).find((v) => isLeftover(view, v.id) === inLeftover && isReleased(v));
}

/** The released episode before `videoId` in the order; the left-out episodes only from among them. */
export function previousInOrder(view: OrderView, videoId: string): Video | undefined {
  const i = view.sequence.findIndex((v) => v.id === videoId);
  if (i < 0) return undefined;
  const inLeftover = isLeftover(view, videoId);
  return view.sequence
    .slice(0, i)
    .reverse()
    .find((v) => isLeftover(view, v.id) === inLeftover && isReleased(v));
}

/** Where the order starts: its first released episode. */
export function firstInOrder(view: OrderView): Video | undefined {
  return view.sequence.find((v) => !isLeftover(view, v.id) && isReleased(v)) ?? view.sequence[0];
}

/**
 * What the season picker lists: the order's groups when one is chosen, else the seasons (`seasons`, in
 * seasonsOf's order) with their episodes. Ids are season numbers, or group ids in an order.
 */
export function shelfGroups(videos: Video[], seasons: number[], view?: OrderView): OrderedGroup[] {
  if (view) return view.groups;
  return seasons.map((s) => ({ id: s, label: seasonLabel(s), videos: videos.filter((v) => v.season === s) }));
}

/** The picker entry `v` is listed under: its group in an order, else its season. */
export function shelfGroupOf(v: Video, view?: OrderView): number | undefined {
  return view ? view.groupOf.get(v.id) : v.season;
}
