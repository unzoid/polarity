import { useEffect, useRef } from "react";
import { recordPlayedThrough, recordStart, recordThroughput, type SourceKind } from "../../lib/playback";
import { isMpv, type MediaLike } from "./mpvMedia";

/**
 * What Best Match learns from playing (#230, lib/playback/sourceHistory.ts): how long
 * the source took to show a picture, and whether it played through. `resolving`
 * marks each new try; `started` the first picture; `finished` the end (or the
 * Up Next point).
 */
export function useSourceRecord(kind: SourceKind, resolving: boolean, started: boolean, finished: boolean) {
  const tried = useRef({ at: 0, started: false, through: false });
  const kindRef = useRef(kind);
  kindRef.current = kind;
  useEffect(() => {
    if (resolving) tried.current = { at: performance.now(), started: false, through: false };
  }, [resolving]);
  useEffect(() => {
    const t = tried.current;
    if (!started || t.started || !t.at) return;
    t.started = true;
    recordStart(kindRef.current, performance.now() - t.at);
  }, [started]);
  useEffect(() => {
    const t = tried.current;
    if (!finished || !t.started || t.through) return;
    t.through = true;
    recordPlayedThrough(kindRef.current);
  }, [finished]);
}

/** How often mpv's download speed is read while playing. */
const SAMPLE_MS = 5000;
/** Fewer readings than this say little about the connection. */
const MIN_SAMPLES = 3;

/**
 * What the connection carries while mpv plays a link (its `cache-speed`, read while the
 * cache fills), kept when the player moves on: the faster readings, as an idle cache
 * reads zero and a filling one reads what the link gives. The built-in player can't tell.
 */
export function useThroughput(media: MediaLike | null, playing: boolean, enabled: boolean) {
  const samples = useRef<number[]>([]);
  useEffect(() => {
    if (!media || !isMpv(media) || !playing || !enabled) return;
    const id = window.setInterval(() => {
      // Sample only while mpv's demuxer cache is actively filling (not idle/trickling at video bitrate, #533).
      void Promise.all([
        media.command("get_property", "cache-speed"),
        media.command("get_property", "demuxer-cache-idle").catch(() => false),
      ])
        .then(([v, idle]) => {
          if (idle !== true && typeof v === "number" && v > 0) samples.current.push((v * 8) / 1e6);
        })
        .catch(() => {});
    }, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [media, playing, enabled]);
  useEffect(
    () => () => {
      const s = samples.current.sort((a, b) => a - b);
      samples.current = [];
      if (s.length >= MIN_SAMPLES) recordThroughput(s[Math.floor(s.length * 0.75)]);
    },
    [media],
  );
}
