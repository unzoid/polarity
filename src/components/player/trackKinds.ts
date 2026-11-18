/**
 * What a track is for, beyond its language: a subtitle with only the signs and foreign lines (forced), one for
 * the deaf and hard of hearing (SDH), an audio track that describes the picture or a commentary. From mpv's
 * flags where the file sets them, else from the track's title, which most releases use instead.
 */
export interface TrackKind {
  forced: boolean;
  sdh: boolean;
  /** Audio description: a voice telling what's on screen. */
  description: boolean;
  commentary: boolean;
}

/** What the kind is read from: mpv's track fields, or a `<track>`'s kind and label. */
export interface KindSource {
  title?: string;
  forced?: boolean;
  "hearing-impaired"?: boolean;
  "visual-impaired"?: boolean;
  /** A `<track>`'s or audio track's kind: "captions" are SDH, "descriptions" and "commentary" what they say. */
  kind?: string;
}

const FORCED = /\b(forced|signs?(\s*(&|and)\s*songs?)?|foreign)\b/i;
const SDH = /\b(sdh|cc|hearing[\s-]*impaired|deaf|closed[\s-]*captions?)\b/i;
const DESCRIPTION = /\b(audio[\s-]*description|described|descriptive|visually[\s-]*impaired|ad)\b/i;
const COMMENTARY = /\bcommentary\b/i;

export function trackKind(t: KindSource): TrackKind {
  const title = t.title ?? "";
  return {
    forced: !!t.forced || FORCED.test(title),
    sdh: !!t["hearing-impaired"] || t.kind === "captions" || SDH.test(title),
    description: !!t["visual-impaired"] || t.kind === "descriptions" || t.kind === "description" || DESCRIPTION.test(title),
    commentary: t.kind === "commentary" || COMMENTARY.test(title),
  };
}

/** The tags a track's label adds when its title doesn't already say: "SDH", "Forced", "Audio description". */
export function kindTags(t: KindSource): string[] {
  const k = trackKind(t);
  const title = t.title ?? "";
  return [
    k.forced && !FORCED.test(title) ? "Forced" : "",
    k.sdh && !SDH.test(title) ? "SDH" : "",
    k.description && !DESCRIPTION.test(title) ? "Audio description" : "",
  ].filter(Boolean);
}

/**
 * The subtitle to show among tracks already in the wanted language: a full one (not only the signs), SDH or not
 * as preferred, the file's order deciding the rest. Forced tracks are taken only when there's nothing else.
 */
export function bestSubtitle<T extends KindSource>(tracks: readonly T[], preferSdh: boolean): T | undefined {
  const full = tracks.filter((t) => !trackKind(t).forced);
  const pool = full.length ? full : tracks;
  return pool.find((t) => trackKind(t).sdh === preferSdh) ?? pool[0];
}

/** The forced (signs and foreign lines) subtitle among these: what to show when the speech is already understood. */
export function forcedSubtitle<T extends KindSource>(tracks: readonly T[]): T | undefined {
  return tracks.find((t) => trackKind(t).forced);
}

/** The audio track to play among tracks in the wanted language: the film's own sound, not a description or commentary. */
export function bestAudio<T extends KindSource>(tracks: readonly T[]): T | undefined {
  return tracks.find((t) => {
    const k = trackKind(t);
    return !k.description && !k.commentary;
  }) ?? tracks[0];
}
