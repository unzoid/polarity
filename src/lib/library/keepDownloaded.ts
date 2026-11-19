import { call } from "../platform/bridge";
import { onMobileData } from "../platform/device";
import { getPrefs } from "../settings/prefs";
import type { MetaPreview, Video } from "../types";
import { autoHold, episodeClosed, episodeWatched, type AutoDeps } from "./autoDownloads";
import { runBatch } from "./batchDownloads";
import { batchDeps, removeDownload, type Download, type DownloadsStorage } from "./downloads";

/** Keep the next episodes downloaded (autoDownloads.ts) with the app's prefs, sources and downloads. */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const deps: AutoDeps = {
  settings: () => ({ keep: getPrefs().autoDownloadNext, removeWatched: getPrefs().autoDownloadRemoveWatched }),
  downloaded: async (id) => (await call<Download[]>("downloads_list")).some((d) => d.id === id && d.state === "done"),
  run: (key, item, videos) =>
    runBatch(key, item, videos, {
      ...batchDeps(item),
      hold: async () => autoHold(onMobileData(), (await call<DownloadsStorage>("downloads_storage").catch(() => null))?.free),
    }),
  remove: removeDownload,
  sleep,
};

/** The player saw `videoId` of `item` watched to the end (useProgressSaver). */
export function keepNextDownloaded(item: MetaPreview, videos: Video[], videoId: string) {
  void episodeWatched(item, videos, videoId, deps);
}

/** The player closed `videoId` or moved on from it. */
export function watchedEpisodeClosed(videoId: string) {
  void episodeClosed(videoId, deps);
}
