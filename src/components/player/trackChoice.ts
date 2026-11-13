import { langMatches } from "../../lib/playback";
import type { MpvTrack } from "./mpvMedia";

/** The menus' id for "no subtitles". */
export const OFF = "off";

/** An add-on's subtitle as the menus know it: `key` is its menu id ("ext:…"). */
export interface AddonSubtitle {
  key: string;
  lang: string;
  url: string;
}

/**
 * The audio or main subtitle track mpv is playing. `aid`/`sid` read back as
 * "auto" whenever mpv chose the track itself (the file's default, the preferred
 * language, a choice kept from the last file), so the track list's `selected`
 * flags come first; the id only stands in while the list carries no flags. A
 * subtitle with `main-selection` 1 is the secondary one.
 */
export function playingTrack(tracks: MpvTrack[], type: "audio" | "sub", id: number | string | null) {
  return tracks.some((t) => typeof t.selected === "boolean")
    ? tracks.find((t) => t.type === type && t.selected && !t["main-selection"])
    : tracks.find((t) => t.type === type && t.id === id);
}

/** The secondary subtitle mpv shows (at the top), if any. */
export const secondaryTrack = (tracks: MpvTrack[]) => tracks.find((t) => t.type === "sub" && t.selected && t["main-selection"] === 1);

/** A subtitle an add-on gave, as mpv lists it once added: an external track fetched from the web. */
export const isAddonTrack = (t: MpvTrack) => !!t.external && /^https?:\/\//i.test(t["external-filename"] ?? "");

/**
 * The menu id of a subtitle mpv has on: `emb:<id>` for one in the file or loaded from this device, the add-on's
 * entry for one it fetched. Undefined for an add-on subtitle that matches no entry in `addon`.
 */
export function subtitleMenuId(sub: MpvTrack | undefined, addon: readonly AddonSubtitle[]): string | undefined {
  if (!sub) return OFF;
  if (!isAddonTrack(sub)) return `emb:${sub.id}`;
  const ext = addon.find((x) => x.url === sub["external-filename"]) ?? addon.find((x) => langMatches(sub.lang, x.lang));
  return ext?.key;
}

/**
 * Which audio and subtitle entries the player menus mark as selected, from what
 * mpv is actually playing (see `playingTrack`), not from what the app last asked.
 *
 * `subId` and `secondId` are undefined for an add-on subtitle that matches no entry in `addon`:
 * the caller keeps what it shows.
 */
export function mpvSelection(
  tracks: MpvTrack[],
  aid: number | string | null,
  sid: number | string | null,
  addon: readonly AddonSubtitle[],
): { audioId?: string; subId?: string; secondId?: string } {
  const audio = playingTrack(tracks, "audio", aid);
  return {
    audioId: audio ? String(audio.id) : undefined,
    subId: subtitleMenuId(playingTrack(tracks, "sub", sid), addon),
    secondId: subtitleMenuId(secondaryTrack(tracks), addon),
  };
}
