import { storeLocal } from "../errors";
import { nextVideo } from "../library/episodes";
import { storedJson } from "../parse";
import type { ContentType, Meta } from "../types";

/**
 * The rating card (components/player/RatingPrompt.tsx): a film, or a show's last released episode, has ended, and
 * the profile can rate it on a linked Trakt or Simkl and hasn't. Polarity keeps no rating of its own; the card only
 * sends one to those services (docs/data-sources.md).
 */

/** One linked service, as the card sees it. */
export interface RatingService {
  /** The profile has linked it and it can be told about this title. */
  linked: boolean;
  /** The profile's ratings were read from it, so `rating` is known. */
  known: boolean;
  /** The profile's rating of the title, 1–10, or null. */
  rating: number | null;
}

export interface RatingAskState {
  /** Settings → Services → "Ask for a rating after finishing". */
  enabled: boolean;
  /** The video played to its end. */
  ended: boolean;
  type: ContentType;
  /** A series: this is its last episode out (lastReleased). A film is always its own last. */
  lastReleased: boolean;
  /** The Up Next card is up (counting down to another episode, or asking whether anyone's still watching). */
  nextUp: boolean;
  /** Following someone else's watch party. */
  follower: boolean;
  /** A file on this device. */
  local: boolean;
  /** A link played in a watch party (a YouTube video, a trailer, a stream from the web): no title behind it. */
  link: boolean;
  /** An episode picked by shuffle. */
  shuffle: boolean;
  /** Dismissed for this title on this device before. */
  dismissed: boolean;
  services: RatingService[];
}

/** Whether the card shows: at least one linked service knows the profile hasn't rated the title, and none has a rating. */
export function shouldAskRating(s: RatingAskState): boolean {
  if (!s.enabled || !s.ended || s.nextUp || s.follower || s.local || s.link || s.shuffle || s.dismissed) return false;
  if (s.type === "series" && !s.lastReleased) return false;
  const linked = s.services.filter((v) => v.linked);
  if (!linked.length || linked.some((v) => v.rating !== null)) return false;
  return linked.some((v) => v.known);
}

/** Whether `videoId` is the last released episode of `meta` (specials are never the end of a show). */
export function lastReleased(meta: Meta | undefined, videoId: string): boolean {
  const current = meta?.videos.find((v) => v.id === videoId);
  return !!meta && !!current && current.season !== 0 && !nextVideo(meta, videoId);
}

const KEY = "polar.ratingDismissed";
/** The most dismissed titles kept; the oldest go first. */
const KEEP = 500;

type Store = Pick<Storage, "getItem" | "setItem">;

function dismissedIds(storage: Store): string[] {
  const v = storedJson(storage, KEY);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Whether the card was dismissed for the title `id` on this device. */
export function ratingDismissed(id: string, storage: Store = localStorage): boolean {
  return dismissedIds(storage).includes(id);
}

/** The card won't come back for the title `id` on this device. */
export function dismissRating(id: string, storage: Store = localStorage) {
  const ids = dismissedIds(storage).filter((x) => x !== id);
  ids.push(id);
  storeLocal(KEY, JSON.stringify(ids.slice(-KEEP)), storage);
}
