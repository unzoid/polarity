/**
 * Torrent sources (#47): the user's limits as the backend takes them, and
 * the engine's steps (`polar_torrent::Step`) as lines for the loading screen.
 * The lines say nothing about what the torrent is: no names, no hash.
 */
import type { Prefs } from "../settings/prefs";
import type { StartStep } from "./startLog";
import { formatBytes, formatMs } from "./startLog";

/** Settings → Sources → Torrent Sources, as `torrent_open` and `torrent_close` take them. */
export interface TorrentLimits {
  cacheGb: number;
  downloadMbps: number;
  uploadMbps: number;
  keepSharing: boolean;
}

/** With battery saver on (Android, #207), nothing is kept for sharing after playback. */
export const torrentLimits = (
  p: Pick<Prefs, "torrentCacheGb" | "torrentSpeedMbps" | "torrentUploadMbps" | "torrentKeepSharing">,
  batterySaver = false,
): TorrentLimits => ({
  cacheGb: p.torrentCacheGb,
  downloadMbps: p.torrentSpeedMbps,
  uploadMbps: p.torrentUploadMbps,
  keepSharing: p.torrentKeepSharing && !batterySaver,
});

/** What a source list and the player say about a torrent on a device without the engine (iOS, #458). */
export const NO_TORRENT_ENGINE = "Torrent sources can't play on this device.";

/**
 * Why a torrent source won't start here, if it won't: no torrent engine on this device (#458), or mobile
 * data while the setting is off (#207). `settings`: whether a setting can change it.
 */
export function torrentBlocked(
  p: Pick<Prefs, "torrentMobileData">,
  onMobileData: boolean,
  playsHere = true,
): { reason: string; settings: boolean } | null {
  if (!playsHere) return { reason: NO_TORRENT_ENGINE, settings: false };
  return onMobileData && !p.torrentMobileData
    ? {
        reason: "Torrent sources don't play on mobile data. Connect to Wi-Fi, or turn on Play torrent streams on mobile data in Settings → Sources.",
        settings: true,
      }
    : null;
}

export type TorrentStep =
  | { kind: "searching"; trackers: number; dht: boolean }
  | { kind: "metadata"; files: number; chosen: number; ext?: string | null; size: number; ms: number }
  | { kind: "peers"; connected: number; connecting: number; downBps: number; have: number; size: number };

/** Peer lines replace each other while nothing else is logged in between. */
export const PEERS_KEY = "torrent-peers";

/** A line for one step; peer lines carry `key` so the next one replaces it. */
export function describeTorrent(step: TorrentStep): Omit<StartStep, "at"> & { key?: string } {
  switch (step.kind) {
    case "searching": {
      const where = [step.dht && "the DHT", step.trackers > 0 && `${step.trackers} tracker${step.trackers === 1 ? "" : "s"}`].filter(Boolean);
      return { text: `Looking for peers${where.length ? ` (${where.join(" and ")})` : ""}`, tone: "info", stage: "peers" };
    }
    case "metadata": {
      const file = [step.ext ? `.${step.ext}` : null, formatBytes(step.size)].filter(Boolean).join(", ");
      const which = step.files > 1 ? `file ${step.chosen} of ${step.files} (${file})` : file;
      return { text: `File list from peers${step.ms > 0 ? ` in ${formatMs(step.ms)}` : ""}: ${which}`, tone: "ok", stage: "peers" };
    }
    case "peers": {
      const parts = [`${step.connected} peer${step.connected === 1 ? "" : "s"} connected`];
      if (step.connecting > 0) parts.push(`${step.connecting} connecting`);
      parts.push(`${formatBytes(step.downBps)}/s`, `${formatBytes(step.have)} of ${formatBytes(step.size)}`);
      return { text: parts.join(" · "), tone: step.connected > 0 ? "info" : "warn", stage: "peers", key: PEERS_KEY };
    }
  }
}
