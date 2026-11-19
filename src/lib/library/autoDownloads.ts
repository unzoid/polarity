import { useSyncExternalStore } from "react";
import type { MetaPreview, Video } from "../types";
import { downloadableEpisodes, type Batch, type Hold } from "./batchDownloads";

/**
 * Keep the next episodes downloaded: when a downloaded episode of a show is finished (the watched
 * threshold), the next N released episodes are downloaded through the batch runner (batchDownloads.ts:
 * the first source that can be downloaded, found when its turn comes, one run at a time per episode),
 * and, with "Remove downloaded episodes once watched" on, the finished episode's file is deleted once
 * the player lets go of it. One run per show; finishing another episode while it runs queues the
 * newer list after it. Runs only while the app does.
 */

export type AutoSettings = {
  /** How many episodes after the finished one stay downloaded; 0: off. */
  keep: number;
  removeWatched: boolean;
};

/** What the module needs from the app; tests pass their own. */
export interface AutoDeps {
  settings(): AutoSettings;
  /** True when `videoId` is downloaded and complete. */
  downloaded(videoId: string): Promise<boolean>;
  /** Downloads `videos` of `item` as the batch `key` (runBatch with the app's sources, downloads and holds). */
  run(key: string, item: MetaPreview, videos: Video[]): Promise<Batch>;
  remove(videoId: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

/** The choices of the setting. */
export const KEEP_CHOICES = [0, 1, 2, 3, 5] as const;

/** A closed player may hold its file a moment longer: the watched episode is deleted after this. */
export const REMOVE_AFTER_MS = 5000;

/** Below this much free room where downloads go, no further episode is started automatically. */
export const MIN_FREE_BYTES = 2_000_000_000;

/** Why an automatic download shouldn't start now: on mobile data (Android) it waits for Wi-Fi; with little room left it stops. */
export function autoHold(mobileData: boolean, free: number | null | undefined): Hold | null {
  if (mobileData) return { kind: "wait", reason: "Waiting for Wi-Fi" };
  if (free != null && free < MIN_FREE_BYTES) return { kind: "stop", reason: "Stopped: not enough free space" };
  return null;
}

/** The batch key of a show's automatic downloads. */
export const autoKey = (showId: string) => `auto:${showId}`;

/** The `n` released episodes after `videoId`, specials aside, crossing into the next season. */
export function nextEpisodes(videos: Video[], videoId: string, n: number): Video[] {
  if (n <= 0) return [];
  const list = downloadableEpisodes(videos);
  const i = list.findIndex((v) => v.id === videoId);
  return i < 0 ? [] : list.slice(i + 1, i + 1 + n);
}

// --- What the Downloads page shows: the episodes queued this way, and each show's run.

export type AutoRun = { showId: string; name: string; videos: Video[] };

const STORE_KEY = "polar.autoDownloaded";
/** Kept to this many ids; the oldest go first. */
const STORE_MAX = 500;

function readIds(storage: Pick<Storage, "getItem"> | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const storage = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

let queuedIds = new Set(readIds(storage()));
const runs = new Map<string, AutoRun>();
/** A newer list for a show whose run is busy: run after it. */
const pending = new Map<string, { item: MetaPreview; videos: Video[] }>();
/** Finished episodes to delete once the player lets go of them. */
const toRemove = new Set<string>();

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
let snapshot = { ids: queuedIds as ReadonlySet<string>, runs: [] as AutoRun[] };
const emit = () => {
  snapshot = { ids: new Set(queuedIds), runs: [...runs.values()] };
  for (const l of listeners) l();
};

function remember(ids: string[]) {
  const all = [...queuedIds].filter((id) => !ids.includes(id)).concat(ids).slice(-STORE_MAX);
  queuedIds = new Set(all);
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // Not kept past this session; still shown while it runs.
  }
}

/** Episodes queued by Keep the next episodes downloaded, and the shows whose run is going. */
export const useAutoDownloads = () => useSyncExternalStore(subscribe, () => snapshot);
export const autoDownloadsNow = () => snapshot;

async function runShow(item: MetaPreview, videos: Video[], deps: AutoDeps): Promise<void> {
  const key = autoKey(item.id);
  let next: { item: MetaPreview; videos: Video[] } | undefined = { item, videos };
  while (next) {
    pending.delete(item.id);
    runs.set(item.id, { showId: item.id, name: next.item.name, videos: next.videos });
    remember(next.videos.map((v) => v.id));
    emit();
    try {
      await deps.run(key, next.item, next.videos);
    } catch {
      // A failed run leaves its downloads as they are; the next finished episode tries again.
    }
    next = pending.get(item.id);
  }
  runs.delete(item.id);
  emit();
}

/**
 * The episode `videoId` of `item` was just watched to the end. When it is downloaded, the next
 * episodes are made sure of and (with the toggle on) it is marked for deletion once closed.
 * Resolves when what it started has run.
 */
export async function episodeWatched(item: MetaPreview, videos: Video[], videoId: string, deps: AutoDeps): Promise<void> {
  if (item.type !== "series") return;
  const { keep, removeWatched } = deps.settings();
  if (keep <= 0 && !removeWatched) return;
  if (!(await deps.downloaded(videoId).catch(() => false))) return;
  if (removeWatched) toRemove.add(videoId);
  const next = nextEpisodes(videos, videoId, keep);
  if (!next.length) return;
  if (runs.has(item.id)) {
    pending.set(item.id, { item, videos: next });
    return;
  }
  await runShow(item, next, deps);
}

/** The player closed `videoId` (or moved on from it): a watched episode marked for deletion goes now. */
export async function episodeClosed(videoId: string, deps: Pick<AutoDeps, "remove" | "sleep" | "settings">): Promise<void> {
  if (!toRemove.delete(videoId)) return;
  await deps.sleep(REMOVE_AFTER_MS);
  if (deps.settings().removeWatched) await deps.remove(videoId);
}

/** For tests: forget everything. */
export function resetAutoDownloads() {
  queuedIds = new Set();
  runs.clear();
  pending.clear();
  toRemove.clear();
  emit();
}
