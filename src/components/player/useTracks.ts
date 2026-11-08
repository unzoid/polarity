import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { ContentType, SubtitleOption, VideoFile } from "../../lib/types";
import { ISO3, hashed, langMatches, languageName, matchTrack, recallTracks, rememberTracks, type TrackTraits } from "../../lib/playback";
import { isMpv, type MediaLike, type MpvTrack } from "./mpvMedia";
import { OFF, mpvSelection } from "./trackChoice";
import { keys } from "../../lib/net";
import { warnFailed } from "../../lib/errors";

export interface TrackOption {
  id: string;
  label: string;
}

export { languageName };

/** Normalised ISO 639-1 form of a track/addon language code, for saving as a preference. */
const norm = (code?: string) => (code ? (ISO3[code.toLowerCase()] ?? code) : "");

// HTMLMediaElement.audioTracks: enabled in WebView2 via
// `--enable-blink-features=AudioVideoTracks` (see tauri.conf.json).
interface AudioTrackLike {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}
type AudioTrackListLike = ArrayLike<AudioTrackLike> & EventTarget;

/**
 * Audio and subtitle tracks for the current video:
 *  - audio: the file's own tracks (when the engine exposes them);
 *  - subtitles: tracks embedded in the file, plus every subtitle addon's files
 *    (one per language), converted to WebVTT in Rust.
 * Preferred languages (Settings) are applied automatically once the tracks are
 * known; choosing a track here updates that preference, so the next episode
 * starts the same way.
 *
 * With the mpv engine, tracks come from mpv's own track-list — so embedded
 * subtitles (SRT/ASS/PGS in MKV) and every audio track are real — and addon
 * subtitles are handed to mpv with `sub-add` (it fetches SRT itself).
 *
 * What the user picks is also remembered for the playing source (`memoryKey`, #418, lib/playback/trackMemory.ts):
 * when that source of that episode plays again, the same tracks come back, before the preferred languages.
 */
export interface TrackPrefs {
  audio: string;
  subtitle: string;
  /** "foreign": only turn subtitles on when the audio isn't in their language. */
  subtitleMode?: "always" | "foreign";
}

export function useTracks(
  media: MediaLike | null,
  type: ContentType,
  videoId: string,
  prefs: TrackPrefs,
  onPrefChange: (patch: { audioLanguage?: string; subtitleLanguage?: string }) => void,
  /** The playing file's size and name, when its add-on said: subtitle add-ons match on them. */
  file: VideoFile = {},
  /** Ask subtitle add-ons; off for a file on this device. */
  online = true,
  /** The playing source's key in the track memory (`trackMemoryKey`); none = nothing remembered. */
  memoryKey?: string,
) {
  const video = media instanceof HTMLVideoElement ? media : null;
  const mpv = isMpv(media) ? media : null;
  const [mpvLoaded, setMpvLoaded] = useState(false);
  const [audio, setAudio] = useState<TrackOption[]>([]);
  const [audioId, setAudioId] = useState<string>();
  const [embedded, setEmbedded] = useState<TrackOption[]>([]);
  const [subId, setSubId] = useState<string>(OFF);
  const userChose = useRef(false);
  const audioChose = useRef(false);
  const appliedAudio = useRef(false);
  const appliedSub = useRef(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onPrefRef = useRef(onPrefChange);
  onPrefRef.current = onPrefChange;
  // What was picked for this source before; read once per source, so picks made now don't move it.
  const recalled = useMemo(() => recallTracks(memoryKey), [memoryKey]);
  const memoryRef = useRef({ memoryKey, videoId });
  memoryRef.current = { memoryKey, videoId };
  const keep = useCallback((patch: Parameters<typeof rememberTracks>[2]) => {
    const { memoryKey, videoId } = memoryRef.current;
    rememberTracks(memoryKey, videoId, patch);
  }, []);

  const external = useQuery({
    queryKey: keys.subtitles(type, videoId, file),
    queryFn: () => api.subtitles(type, videoId, file),
    staleTime: 30 * 60_000,
    enabled: online,
    // Another source of the same episode asks again; its list replaces this one when it comes.
    placeholderData: (previous, query) => (query?.queryKey[2] === videoId ? previous : undefined),
  });

  /** One entry per language, in a stable, readable order; the remembered one stands for its language. */
  const rememberedAddon = recalled?.subtitle && "addon" in recalled.subtitle ? recalled.subtitle.addon : undefined;
  const externalByLang = useMemo(() => {
    const seen = new Map<string, SubtitleOption>();
    const mine = rememberedAddon && external.data?.find((s) => s.lang === rememberedAddon.lang && subtitleId(s) === rememberedAddon.id);
    if (mine) seen.set(mine.lang, mine);
    for (const s of external.data ?? []) if (!seen.has(s.lang)) seen.set(s.lang, s);
    return [...seen.values()].sort((a, b) => (languageName(a.lang) ?? a.lang).localeCompare(languageName(b.lang) ?? b.lang));
  }, [external.data, rememberedAddon]);
  const externalByLangRef = useRef(externalByLang);
  externalByLangRef.current = externalByLang;

  // mpv: mirror its track-list and the tracks it is actually playing (its own
  // pick at start included); again when add-on subtitles arrive, to name an
  // add-on subtitle that is already on.
  useEffect(() => {
    if (!mpv) return;
    const read = () => {
      const audioTracks = mpv.tracks.filter((t) => t.type === "audio");
      setAudio(audioTracks.map((t) => ({ id: String(t.id), label: mpvLabel(t) })));
      setEmbedded(
        mpv.tracks
          .filter((t) => t.type === "sub" && !t.external)
          .map((t) => ({ id: `emb:${t.id}`, label: mpvLabel(t) })),
      );
      const now = mpvSelection(mpv.tracks, mpv.aid, mpv.sid, externalByLangRef.current);
      setAudioId(now.audioId);
      if (now.subId) setSubId(now.subId);
    };
    read();
    mpv.addEventListener("tracks", read);
    return () => mpv.removeEventListener("tracks", read);
  }, [mpv, externalByLang]);

  useEffect(() => {
    if (!mpv) return;
    const onLoaded = () => setMpvLoaded(true);
    mpv.addEventListener("loadedmetadata", onLoaded);
    return () => mpv.removeEventListener("loadedmetadata", onLoaded);
  }, [mpv]);

  // Track lists appear after metadata loads and can change; listen for both.
  useEffect(() => {
    if (!video) return;
    const read = () => {
      const list = (video as unknown as { audioTracks?: AudioTrackListLike }).audioTracks;
      if (list) {
        const items = Array.from(list);
        setAudio(
          items.map((t, i) => ({
            id: t.id || String(i),
            label: t.label || languageName(t.language) || `Track ${i + 1}`,
          })),
        );
        const on = items.findIndex((t) => t.enabled);
        if (on >= 0) setAudioId(items[on].id || String(on));
      }
      setEmbedded(
        Array.from(video.textTracks)
          .filter((t) => !t.id.startsWith("ext:"))
          .map((t, i) => ({ id: `emb:${i}`, label: t.label || languageName(t.language) || `Subtitle ${i + 1}` })),
      );
    };
    read();
    const audioList = (video as unknown as { audioTracks?: AudioTrackListLike }).audioTracks;
    video.addEventListener("loadedmetadata", read);
    video.textTracks.addEventListener("addtrack", read);
    audioList?.addEventListener("addtrack", read);
    audioList?.addEventListener("change", read);
    return () => {
      video.removeEventListener("loadedmetadata", read);
      video.textTracks.removeEventListener("addtrack", read);
      audioList?.removeEventListener("addtrack", read);
      audioList?.removeEventListener("change", read);
    };
  }, [video]);

  const selectAudio = useCallback(
    (id: string, remember = true) => {
      if (remember) audioChose.current = true;
      if (mpv) {
        if (id === "default") return;
        audioChose.current = true;
        void mpv.set("aid", Number(id));
        const track = mpv.tracks.find((t) => t.id === Number(id) && t.type === "audio");
        const lang = track?.lang;
        if (lang && remember) onPrefRef.current({ audioLanguage: norm(lang) });
        if (track && remember) keep({ audio: mpvTraits(track) });
        setAudioId(id);
        return;
      }
      const list = (video as unknown as { audioTracks?: AudioTrackListLike })?.audioTracks;
      if (!list) return;
      Array.from(list).forEach((t, i) => {
        const tid = t.id || String(i);
        t.enabled = tid === id;
        if (tid === id && t.language && remember) onPrefRef.current({ audioLanguage: norm(t.language) });
        if (tid === id && remember) keep({ audio: htmlTraits(tid, t.language, t.label) });
      });
      setAudioId(id);
    },
    [video, mpv, keep],
  );

  const rememberAddon = useCallback(
    (id: string) => {
      const sub = externalByLang.find((x) => `ext:${x.lang}` === id);
      if (sub) keep({ subtitle: { addon: { lang: sub.lang, id: subtitleId(sub) } } });
    },
    [externalByLang, keep],
  );

  const selectSubtitle = useCallback(
    async (id: string, remember = true) => {
      if (remember) userChose.current = true;
      if (mpv) {
        setSubId(id);
        if (id === OFF) void mpv.set("sid", "no");
        else if (id.startsWith("emb:")) void mpv.set("sid", Number(id.slice(4)));
        else {
          const sub = externalByLang.find((x) => `ext:${x.lang}` === id);
          if (!sub) return;
          const loaded = mpv.tracks.find((t) => t.type === "sub" && t["external-filename"] === sub.url);
          if (loaded) void mpv.set("sid", loaded.id);
          else await mpv.command("sub-add", sub.url, "select", languageName(sub.lang) ?? sub.lang, ISO3[sub.lang] ?? sub.lang).catch(warnFailed("Adding the subtitle"));
        }
        if (remember) {
          const lang =
            id === OFF
              ? ""
              : id.startsWith("emb:")
                ? norm(mpv.tracks.find((t) => t.type === "sub" && t.id === Number(id.slice(4)))?.lang)
                : norm(id.slice(4));
          onPrefRef.current({ subtitleLanguage: lang });
          if (id === OFF) keep({ subtitle: { off: true } });
          else if (id.startsWith("emb:")) {
            const track = mpv.tracks.find((t) => t.type === "sub" && t.id === Number(id.slice(4)));
            if (track) keep({ subtitle: { embedded: mpvTraits(track) } });
          } else rememberAddon(id);
        }
        return;
      }
      if (!video) return;
      setSubId(id);
      const tracks = Array.from(video.textTracks);
      let target: TextTrack | undefined;

      if (id.startsWith("ext:")) {
        target = tracks.find((t) => t.id === id);
        if (!target) {
          const sub = externalByLang.find((s) => `ext:${s.lang}` === id);
          if (!sub) return;
          const vtt = await api.subtitleVtt(sub.url);
          const el = document.createElement("track");
          el.kind = "subtitles";
          el.id = id;
          el.label = languageName(sub.lang) ?? sub.lang;
          el.srclang = ISO3[sub.lang] ?? sub.lang;
          el.src = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
          video.appendChild(el);
          target = el.track;
        }
      } else if (id.startsWith("emb:")) {
        target = tracks.filter((t) => !t.id.startsWith("ext:"))[Number(id.slice(4))];
      }

      for (const t of Array.from(video.textTracks)) t.mode = t === target ? "showing" : "disabled";
      if (remember) {
        onPrefRef.current({ subtitleLanguage: id === OFF ? "" : norm(target?.language || id.slice(4)) });
        if (id === OFF) keep({ subtitle: { off: true } });
        else if (id.startsWith("emb:") && target) keep({ subtitle: { embedded: htmlTraits(id.slice(4), target.language, target.label) } });
        else if (id.startsWith("ext:")) rememberAddon(id);
      }
    },
    [video, mpv, externalByLang, keep, rememberAddon],
  );

  // Apply the track remembered for this source, else the preferred audio language, once, as soon as the
  // file's tracks are known (unless the user already picked one for this video).
  useEffect(() => {
    if (appliedAudio.current || audioChose.current || !(recalled?.audio || prefs.audio)) return;
    if (!(video || (mpv && mpvLoaded))) return;
    const tracks: (TrackTraits & { id: string })[] = mpv
      ? mpv.tracks.filter((t) => t.type === "audio").map(mpvTraits)
      : Array.from(((video as unknown as { audioTracks?: AudioTrackListLike })?.audioTracks ?? []) as ArrayLike<AudioTrackLike>).map((t, i) =>
          htmlTraits(t.id || String(i), t.language, t.label),
        );
    if (!tracks.length) return;
    appliedAudio.current = true;
    const match = (recalled?.audio && matchTrack(recalled.audio, tracks)) || (prefs.audio ? tracks.find((t) => langMatches(t.lang, prefs.audio)) : undefined);
    if (match && match.id !== audioId) selectAudio(match.id, false);
  }, [recalled, prefs.audio, video, mpv, mpvLoaded, audio, audioId, selectAudio]);

  // Same for subtitles: a track inside the file wins (it's timed to this exact
  // release); otherwise an addon's subtitles in that language. Empty = off.
  // The subtitle remembered for this source comes first, Off included.
  useEffect(() => {
    if (appliedSub.current || userChose.current) return;
    const want = recalled?.subtitle;
    if (!want && !prefs.subtitle) return;
    if (!(video || (mpv && mpvLoaded))) return;
    if (want && "off" in want) {
      appliedSub.current = true;
      void selectSubtitle(OFF, false);
      return;
    }
    if (want && "embedded" in want) {
      const list = mpv
        ? mpv.tracks.filter((t) => t.type === "sub" && !t.external).map(mpvTraits)
        : Array.from(video!.textTracks)
            .filter((t) => !t.id.startsWith("ext:"))
            .map((t, i) => htmlTraits(String(i), t.language, t.label));
      const match = matchTrack(want.embedded, list);
      if (match) {
        appliedSub.current = true;
        void selectSubtitle(`emb:${match.id}`, false);
        return;
      }
    }
    if (want && "addon" in want) {
      // Found again only when an add-on offers that same subtitle again.
      if (external.isLoading) return;
      const ext = externalByLang.find((x) => x.lang === want.addon.lang && subtitleId(x) === want.addon.id);
      if (ext) {
        appliedSub.current = true;
        void selectSubtitle(`ext:${ext.lang}`, false);
        return;
      }
    }
    if (!prefs.subtitle) {
      appliedSub.current = true;
      return;
    }
    if (prefs.subtitleMode === "foreign") {
      // The language that will be playing: the preferred audio if the file
      // has it (applied above), else whatever track is on now.
      const audioTracks: { lang?: string; on: boolean }[] = mpv
        ? mpv.tracks.filter((t) => t.type === "audio").map((t) => ({ lang: t.lang, on: t === mpv.playing("audio") }))
        : Array.from(((video as unknown as { audioTracks?: AudioTrackListLike })?.audioTracks ?? []) as ArrayLike<AudioTrackLike>).map(
            (t) => ({ lang: t.language, on: t.enabled }),
          );
      const playing =
        (prefs.audio && audioTracks.find((t) => langMatches(t.lang, prefs.audio))?.lang) ||
        audioTracks.find((t) => t.on)?.lang ||
        (audioTracks.length === 1 ? audioTracks[0].lang : undefined);
      // Already in the subtitle language: nothing to read. Unknown: show them.
      if (playing && langMatches(playing, prefs.subtitle)) {
        appliedSub.current = true;
        return;
      }
    }
    const embeddedMatch = mpv
      ? mpv.tracks.find((t) => t.type === "sub" && !t.external && langMatches(t.lang, prefs.subtitle))
      : Array.from(video!.textTracks).find((t) => !t.id.startsWith("ext:") && langMatches(t.language, prefs.subtitle));
    if (embeddedMatch) {
      appliedSub.current = true;
      const idx = mpv ? (embeddedMatch as MpvTrack).id : Array.from(video!.textTracks).indexOf(embeddedMatch as TextTrack);
      void selectSubtitle(`emb:${idx}`, false);
      return;
    }
    // External subtitles arrive asynchronously; wait for them before giving up.
    if (external.isLoading) return;
    appliedSub.current = true;
    const ext = externalByLang.find((x) => langMatches(x.lang, prefs.subtitle));
    if (ext) void selectSubtitle(`ext:${ext.lang}`, false);
  }, [recalled, prefs.subtitle, prefs.subtitleMode, prefs.audio, video, mpv, mpvLoaded, audio, embedded, externalByLang, external.isLoading, selectSubtitle]);

  // Blob URLs belong to this video only.
  useEffect(
    () => () => {
      video?.querySelectorAll("track").forEach((t) => {
        URL.revokeObjectURL(t.src);
        t.remove();
      });
    },
    [video],
  );

  const subtitles: TrackOption[] = [
    { id: OFF, label: "Off" },
    ...embedded,
    ...externalByLang.map((s) => ({ id: `ext:${s.lang}`, label: languageName(s.lang) ?? (s.lang || "Unknown language") })),
  ];

  return {
    audio,
    audioId,
    selectAudio,
    subtitles,
    subId,
    selectSubtitle,
    subtitlesLoading: external.isLoading,
  };
}

/** "English · 5.1", "Commentary", "Japanese (Signs)". */
function mpvLabel(t: MpvTrack) {
  const name = t.title || languageName(t.lang) || `Track ${t.id}`;
  const ch = t["demux-channel-count"];
  const layout = ch === 6 ? "5.1" : ch === 8 ? "7.1" : ch === 2 ? "Stereo" : ch === 1 ? "Mono" : undefined;
  const lang = t.title && t.lang ? languageName(t.lang) : undefined;
  return [name, lang && lang !== name ? lang : undefined, layout].filter(Boolean).join(" · ");
}

/** What tells an mpv track apart in the track memory. */
function mpvTraits(t: MpvTrack): TrackTraits & { id: string } {
  return { id: String(t.id), lang: t.lang, title: t.title, codec: t.codec, channels: t["demux-channel-count"] };
}

/** The same for the built-in player's tracks, which carry less. */
function htmlTraits(id: string, lang: string, label: string): TrackTraits & { id: string } {
  return { id, lang: lang || undefined, title: label || undefined };
}

/** An add-on subtitle's identity in the track memory: hashed, since its link can carry a token. */
const subtitleId = (s: SubtitleOption) => hashed(`${s.addon}\n${s.id || s.url}`);
