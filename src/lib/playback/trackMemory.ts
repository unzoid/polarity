import { storeLocal } from "../errors";
import { isRecord, num, str, storedJson } from "../parse";
import type { Stream } from "../types";
import { ISO3, langMatches } from "./languages";
import { sourceKey } from "./savedSource";

/**
 * The audio track, subtitle and their delays picked for one source of one episode (#418): the same file (its link,
 * a torrent's file, or the download). Kept on this device only, never synced. Keys and subtitle ids are stored
 * hashed, so no link, token or title id sits in storage. The least recently played go first past `MAX`.
 */

const KEY = "polar.sourceTracks";
/** The most sources kept. */
export const MAX = 500;

/** What tells a track apart when the player numbers them differently next time. */
export interface TrackTraits {
  /** The player's id; the same file numbers its tracks the same way. */
  id?: string;
  lang?: string;
  title?: string;
  codec?: string;
  channels?: number;
}

export type RememberedSubtitle =
  | { off: true }
  | { embedded: TrackTraits }
  /** An add-on's subtitle: its language and its id (hashed), found again when the add-on offers it again. */
  | { addon: { lang: string; id: string } };

export interface RememberedTracks {
  audio?: TrackTraits;
  subtitle?: RememberedSubtitle;
  /** Subtitle delay in seconds. */
  delay?: number;
  /** Audio delay in seconds: positive plays the sound later. */
  audioDelay?: number;
}

interface Entry extends RememberedTracks {
  /** The episode (hashed), so resetting a title's progress forgets its sources. */
  video: string;
  used: number;
}

/** A short, stable hash (cyrb53) for keys: tells sources apart without keeping what they are. */
export function hashed(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The memory's key for this source of this episode; undefined for a stream with nothing to tell it apart. */
export function trackMemoryKey(videoId: string, stream: Stream | undefined): string | undefined {
  const source = stream && sourceKey(stream);
  return videoId && source ? hashed(`${videoId}\n${source}`) : undefined;
}

function traits(v: unknown): TrackTraits | undefined {
  if (!isRecord(v)) return undefined;
  const t: TrackTraits = { id: str(v.id), lang: str(v.lang), title: str(v.title), codec: str(v.codec), channels: num(v.channels) };
  return Object.values(t).some((x) => x !== undefined) ? t : undefined;
}

function subtitle(v: unknown): RememberedSubtitle | undefined {
  if (!isRecord(v)) return undefined;
  if (v.off === true) return { off: true };
  const embedded = traits(v.embedded);
  if (embedded) return { embedded };
  if (isRecord(v.addon)) {
    const lang = str(v.addon.lang);
    const id = str(v.addon.id);
    if (lang !== undefined && id) return { addon: { lang, id } };
  }
  return undefined;
}

function read(storage: Pick<Storage, "getItem"> | undefined): Record<string, Entry> {
  const v = storedJson(storage, KEY);
  const out: Record<string, Entry> = {};
  if (!isRecord(v)) return out;
  for (const [k, e] of Object.entries(v)) {
    if (!isRecord(e)) continue;
    const video = str(e.video);
    if (!video) continue;
    out[k] = {
      video,
      used: num(e.used) ?? 0,
      audio: traits(e.audio),
      subtitle: subtitle(e.subtitle),
      delay: num(e.delay),
      audioDelay: num(e.audioDelay),
    };
  }
  return out;
}

let storage: (Pick<Storage, "getItem"> & Pick<Storage, "setItem">) | undefined = globalThis.localStorage;
let entries = read(storage);

function save() {
  const list = Object.entries(entries);
  if (list.length > MAX) entries = Object.fromEntries(list.sort((a, b) => b[1].used - a[1].used).slice(0, MAX));
  storeLocal(KEY, JSON.stringify(entries), storage);
}

/** What was picked for this source, if anything. */
export function recallTracks(key: string | undefined): RememberedTracks | undefined {
  const e = key ? entries[key] : undefined;
  if (!e) return undefined;
  const { video: _, used: __, ...tracks } = e;
  return tracks;
}

/** The user picked something for this source: kept with what was picked before. */
export function rememberTracks(key: string | undefined, videoId: string, patch: RememberedTracks, now = Date.now()) {
  if (!key) return;
  entries[key] = { ...entries[key], ...patch, video: hashed(videoId), used: now };
  save();
}

/** How many sources have tracks remembered. */
export const rememberedSources = () => Object.keys(entries).length;

/** Forget the sources of these episodes, or of every episode when none are given. */
export function forgetTracks(videoIds?: readonly string[]) {
  if (!videoIds) entries = {};
  else {
    const gone = new Set(videoIds.map(hashed));
    entries = Object.fromEntries(Object.entries(entries).filter(([, e]) => !gone.has(e.video)));
  }
  save();
}

/** Start again from `from` (tests). */
export function resetTrackMemory(from: (Pick<Storage, "getItem"> & Pick<Storage, "setItem">) | undefined = undefined) {
  storage = from;
  entries = read(from);
}

/**
 * The track among `tracks` that is the remembered one. The same id wins while it still looks the same (the same
 * file numbers its tracks the same way); otherwise the closest by language, title, codec and channels. A track in
 * another language never matches one whose language was known.
 */
export function matchTrack<T extends TrackTraits>(want: TrackTraits, tracks: readonly T[]): T | undefined {
  const differs = (a?: string | number, b?: string | number) => a !== undefined && b !== undefined && a !== b;
  const wantLang = want.lang && (ISO3[want.lang.toLowerCase()] ?? want.lang);
  const sameLang = (t: TrackTraits) => !wantLang || !t.lang || langMatches(t.lang, wantLang);
  const byId = want.id !== undefined ? tracks.find((t) => t.id === want.id) : undefined;
  if (byId && sameLang(byId) && !differs(byId.codec, want.codec) && !differs(byId.title, want.title)) return byId;
  let best: T | undefined;
  let bestScore = 0;
  for (const t of tracks) {
    if (!sameLang(t)) continue;
    const score =
      (want.lang && t.lang ? 8 : 0) +
      (want.title !== undefined && t.title === want.title ? 4 : 0) +
      (want.codec !== undefined && t.codec === want.codec ? 2 : 0) +
      (want.channels !== undefined && t.channels === want.channels ? 1 : 0);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}
