import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { ContentType, SubtitleOption, VideoFile } from "../../lib/types";
import { ISO3, hashed, langMatches, languageName, matchTrack, recallTracks, rememberTracks, type TrackTraits } from "../../lib/playback";
import { setPrefs, usePrefs } from "../../lib/settings";
import { isMpv, type MediaLike, type MpvMedia, type MpvTrack } from "./mpvMedia";
import { OFF, isAddonTrack, mpvSelection, type AddonSubtitle } from "./trackChoice";
import { bestAudio, bestSubtitle, forcedSubtitle, kindTags, type KindSource } from "./trackKinds";
import { keys } from "../../lib/net";
import { warnFailed } from "../../lib/errors";

export interface TrackOption {
  id: string;
  label: string;
  /** Second line: the add-on a subtitle came from. */
  detail?: string;
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
  kind: string;
  enabled: boolean;
}
type AudioTrackListLike = ArrayLike<AudioTrackLike> & EventTarget;

/** An add-on's subtitle with its menu id. */
type AddonSub = SubtitleOption & AddonSubtitle;

/** How long a subtitle mpv was asked to add gets to show up in its track list. */
const ADD_WAIT_MS = 8000;

/**
 * Audio and subtitle tracks for the current video:
 *  - audio: the file's own tracks (when the engine exposes them);
 *  - subtitles: tracks embedded in the file (or loaded from this device), plus
 *    every file the subtitle add-ons offer, each its own entry, named by its
 *    add-on; the built-in player gets them converted to WebVTT in Rust.
 * Preferred languages (Settings) are applied automatically once the tracks are
 * known; choosing a track here updates that preference, so the next episode
 * starts the same way. Among tracks in the preferred language, a full subtitle
 * beats a signs-only (forced) one, SDH goes as Settings says, and the film's
 * own sound beats a description or commentary track (trackKinds.ts).
 *
 * With the mpv engine, tracks come from mpv's own track-list — so embedded
 * subtitles (SRT/ASS/PGS in MKV) and every audio track are real — and addon
 * subtitles are handed to mpv with `sub-add` (it fetches SRT itself). mpv can
 * also show a second subtitle at the top (`secondary-sid`), for two languages
 * at once.
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
  const { preferSdh, secondSubtitles, secondSubtitleLanguage } = usePrefs();
  const [mpvLoaded, setMpvLoaded] = useState(false);
  const [audio, setAudio] = useState<TrackOption[]>([]);
  const [audioId, setAudioId] = useState<string>();
  const [embedded, setEmbedded] = useState<TrackOption[]>([]);
  const [subId, setSubId] = useState<string>(OFF);
  const [secondId, setSecondId] = useState<string>(OFF);
  const userChose = useRef(false);
  const audioChose = useRef(false);
  const secondChose = useRef(false);
  const appliedAudio = useRef(false);
  const appliedSub = useRef(false);
  const appliedSecond = useRef(false);
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

  /** Every add-on subtitle once (by link), by language name; within a language, in the add-ons' own order. */
  const addonSubs = useMemo(() => {
    const seen = new Set<string>();
    const list: AddonSub[] = [];
    for (const s of external.data ?? []) {
      const key = `ext:${subtitleId(s)}`;
      if (seen.has(s.url) || seen.has(key)) continue;
      seen.add(s.url).add(key);
      list.push({ ...s, key });
    }
    const name = (s: AddonSub) => languageName(s.lang) ?? (s.lang || "~");
    return list.sort((a, b) => name(a).localeCompare(name(b)));
  }, [external.data]);
  const addonSubsRef = useRef(addonSubs);
  addonSubsRef.current = addonSubs;

  // mpv: mirror its track-list and the tracks it is actually playing (its own
  // pick at start included); again when add-on subtitles arrive, to name an
  // add-on subtitle that is already on.
  useEffect(() => {
    if (!mpv) return;
    const read = () => {
      const audioTracks = mpv.tracks.filter((t) => t.type === "audio");
      setAudio(audioTracks.map((t) => ({ id: String(t.id), label: mpvLabel(t) })));
      // The add-ons' subtitles are listed with them; one loaded from this device goes with the file's own.
      setEmbedded(
        mpv.tracks
          .filter((t) => t.type === "sub" && !isAddonTrack(t))
          .map((t) => ({ id: `emb:${t.id}`, label: mpvLabel(t), detail: t.external ? "From a file" : undefined })),
      );
      const now = mpvSelection(mpv.tracks, mpv.aid, mpv.sid, addonSubsRef.current);
      setAudioId(now.audioId);
      if (now.subId) setSubId(now.subId);
      if (now.secondId) setSecondId(now.secondId);
    };
    read();
    mpv.addEventListener("tracks", read);
    return () => mpv.removeEventListener("tracks", read);
  }, [mpv, addonSubs]);

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

  /** Audio tracks with what tells them apart and what they're for. */
  const audioCandidates = useCallback((): (TrackTraits & KindSource & { id: string })[] => {
    if (mpv) return mpv.tracks.filter((t) => t.type === "audio").map(mpvCandidate);
    const list = (video as unknown as { audioTracks?: AudioTrackListLike } | null)?.audioTracks;
    return Array.from((list ?? []) as ArrayLike<AudioTrackLike>).map((t, i) => ({ ...htmlTraits(t.id || String(i), t.language, t.label), kind: t.kind }));
  }, [mpv, video]);

  /** The file's own subtitles (and, with mpv, ones loaded from this device), the same way. */
  const subtitleCandidates = useCallback((): (TrackTraits & KindSource & { id: string })[] => {
    if (mpv) return mpv.tracks.filter((t) => t.type === "sub" && !isAddonTrack(t)).map(mpvCandidate);
    if (!video) return [];
    return Array.from(video.textTracks)
      .filter((t) => !t.id.startsWith("ext:"))
      .map((t, i) => ({ ...htmlTraits(String(i), t.language, t.label), kind: t.kind }));
  }, [mpv, video]);

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
      const sub = addonSubs.find((x) => x.key === id);
      if (sub) keep({ subtitle: { addon: { lang: sub.lang, id: subtitleId(sub) } } });
    },
    [addonSubs, keep],
  );

  const selectSubtitle = useCallback(
    async (id: string, remember = true) => {
      if (remember) userChose.current = true;
      if (mpv) {
        setSubId(id);
        if (id === OFF) void mpv.set("sid", "no");
        else if (id.startsWith("emb:")) void mpv.set("sid", Number(id.slice(4)));
        else {
          const sub = addonSubs.find((x) => x.key === id);
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
                : norm(addonSubs.find((x) => x.key === id)?.lang);
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
          const sub = addonSubs.find((s) => s.key === id);
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
        const addonLang = addonSubs.find((s) => s.key === id)?.lang;
        onPrefRef.current({ subtitleLanguage: id === OFF ? "" : norm(target?.language || addonLang) });
        if (id === OFF) keep({ subtitle: { off: true } });
        else if (id.startsWith("emb:") && target) keep({ subtitle: { embedded: htmlTraits(id.slice(4), target.language, target.label) } });
        else if (id.startsWith("ext:")) rememberAddon(id);
      }
    },
    [video, mpv, addonSubs, keep, rememberAddon],
  );

  /** mpv: the second subtitle, shown at the top; its language is put on by itself next time. */
  const selectSecond = useCallback(
    async (id: string, remember = true) => {
      if (!mpv) return;
      if (remember) secondChose.current = true;
      setSecondId(id);
      let lang = "";
      if (id === OFF) void mpv.set("secondary-sid", "no");
      else if (id.startsWith("emb:")) {
        const track = mpv.tracks.find((t) => t.type === "sub" && t.id === Number(id.slice(4)));
        lang = norm(track?.lang);
        void mpv.set("secondary-sid", Number(id.slice(4)));
      } else {
        const sub = addonSubs.find((x) => x.key === id);
        if (!sub) return;
        lang = norm(sub.lang);
        let track = mpv.tracks.find((t) => t.type === "sub" && t["external-filename"] === sub.url);
        if (!track) {
          // Added without taking the main subtitle's place, then shown as the second one.
          const added = await mpv.command("sub-add", sub.url, "auto", languageName(sub.lang) ?? sub.lang, ISO3[sub.lang] ?? sub.lang).then(
            () => true,
            (e: unknown) => (warnFailed("Adding the second subtitle")(e), false),
          );
          track = added ? await addedTrack(mpv, sub.url) : undefined;
        }
        if (track) void mpv.set("secondary-sid", track.id);
      }
      if (remember) setPrefs({ secondSubtitleLanguage: lang });
    },
    [mpv, addonSubs],
  );

  // Apply the track remembered for this source, else the preferred audio language, once, as soon as the
  // file's tracks are known (unless the user already picked one for this video).
  useEffect(() => {
    if (appliedAudio.current || audioChose.current || !(recalled?.audio || prefs.audio)) return;
    if (!(video || (mpv && mpvLoaded))) return;
    const tracks = audioCandidates();
    if (!tracks.length) return;
    appliedAudio.current = true;
    const match = (recalled?.audio && matchTrack(recalled.audio, tracks)) || (prefs.audio ? bestAudio(tracks.filter((t) => langMatches(t.lang, prefs.audio))) : undefined);
    if (match && match.id !== audioId) selectAudio(match.id, false);
  }, [recalled, prefs.audio, video, mpv, mpvLoaded, audio, audioId, selectAudio, audioCandidates]);

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
    const own = subtitleCandidates();
    if (want && "embedded" in want) {
      const match = matchTrack(want.embedded, own);
      if (match) {
        appliedSub.current = true;
        void selectSubtitle(`emb:${match.id}`, false);
        return;
      }
    }
    if (want && "addon" in want) {
      // Found again only when an add-on offers that same subtitle again.
      if (external.isLoading) return;
      const ext = addonSubs.find((x) => x.key === `ext:${want.addon.id}`);
      if (ext) {
        appliedSub.current = true;
        void selectSubtitle(ext.key, false);
        return;
      }
    }
    if (!prefs.subtitle) {
      appliedSub.current = true;
      return;
    }
    const inLanguage = own.filter((t) => langMatches(t.lang, prefs.subtitle));
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
      // Already in the subtitle language: only the signs and foreign lines, if the file has them. Unknown: show them.
      if (playing && langMatches(playing, prefs.subtitle)) {
        appliedSub.current = true;
        const forced = forcedSubtitle(inLanguage);
        if (forced) void selectSubtitle(`emb:${forced.id}`, false);
        return;
      }
    }
    const embeddedMatch = bestSubtitle(inLanguage, preferSdh);
    if (embeddedMatch) {
      appliedSub.current = true;
      void selectSubtitle(`emb:${embeddedMatch.id}`, false);
      return;
    }
    // External subtitles arrive asynchronously; wait for them before giving up.
    if (external.isLoading) return;
    appliedSub.current = true;
    const ext = addonSubs.find((x) => langMatches(x.lang, prefs.subtitle));
    if (ext) void selectSubtitle(ext.key, false);
  }, [recalled, prefs.subtitle, prefs.subtitleMode, prefs.audio, preferSdh, video, mpv, mpvLoaded, audio, embedded, addonSubs, external.isLoading, selectSubtitle, subtitleCandidates]);

  // mpv: the second subtitle in its language, once the first is settled, from the file first, else an add-on.
  useEffect(() => {
    if (!mpv || !mpvLoaded || !secondSubtitles || !secondSubtitleLanguage) return;
    if (appliedSecond.current || secondChose.current || !appliedSub.current) return;
    const main = mpv.playing("sub");
    const own = subtitleCandidates().filter((t) => langMatches(t.lang, secondSubtitleLanguage) && t.id !== String(main?.id));
    const match = bestSubtitle(own, preferSdh);
    if (match) {
      appliedSecond.current = true;
      void selectSecond(`emb:${match.id}`, false);
      return;
    }
    if (external.isLoading) return;
    appliedSecond.current = true;
    const ext = addonSubs.find((x) => langMatches(x.lang, secondSubtitleLanguage) && x.url !== main?.["external-filename"]);
    if (ext) void selectSecond(ext.key, false);
  }, [mpv, mpvLoaded, secondSubtitles, secondSubtitleLanguage, preferSdh, subId, embedded, addonSubs, external.isLoading, selectSecond, subtitleCandidates]);

  // Turned off in the player or Settings: the second subtitle goes.
  useEffect(() => {
    if (!mpv || secondSubtitles) return;
    if (secondaryOn(mpv)) void mpv.set("secondary-sid", "no");
    setSecondId(OFF);
  }, [mpv, secondSubtitles]);

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

  const subtitles: TrackOption[] = [{ id: OFF, label: "Off" }, ...embedded, ...addonOptions(addonSubs)];

  return {
    audio,
    audioId,
    selectAudio,
    subtitles,
    subId,
    selectSubtitle,
    /** mpv only: the second subtitle's entry (OFF when none), and choosing it. */
    secondId,
    selectSecond,
    subtitlesLoading: external.isLoading,
  };
}

/** One menu entry per add-on file: its language, and the add-on (numbered when it offers several in that language). */
function addonOptions(subs: readonly AddonSub[]): TrackOption[] {
  const total = new Map<string, number>();
  for (const s of subs) total.set(`${s.lang}\n${s.addon}`, (total.get(`${s.lang}\n${s.addon}`) ?? 0) + 1);
  const seen = new Map<string, number>();
  return subs.map((s) => {
    const k = `${s.lang}\n${s.addon}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return {
      id: s.key,
      label: languageName(s.lang) ?? (s.lang || "Unknown language"),
      detail: (total.get(k) ?? 1) > 1 ? `${s.addon} · ${n}` : s.addon,
    };
  });
}

/** Whether mpv shows a second subtitle now. */
const secondaryOn = (mpv: MpvMedia) => mpv.tracks.some((t) => t.type === "sub" && t.selected && t["main-selection"] === 1);

/** The track mpv lists for a subtitle just added from `url`, once it shows up (undefined if it never does). */
function addedTrack(mpv: MpvMedia, url: string): Promise<MpvTrack | undefined> {
  const find = () => mpv.tracks.find((t) => t.type === "sub" && t["external-filename"] === url);
  return new Promise((resolve) => {
    if (find()) return resolve(find());
    const done = () => {
      mpv.removeEventListener("tracks", onTracks);
      window.clearTimeout(timer);
      resolve(find());
    };
    const onTracks = () => {
      if (find()) done();
    };
    const timer = window.setTimeout(done, ADD_WAIT_MS);
    mpv.addEventListener("tracks", onTracks);
  });
}

/** "English · 5.1", "Commentary", "Japanese (Signs)", "English · SDH". */
function mpvLabel(t: MpvTrack) {
  const name = t.title || languageName(t.lang) || `Track ${t.id}`;
  const ch = t["demux-channel-count"];
  const layout = t.type === "audio" ? (ch === 6 ? "5.1" : ch === 8 ? "7.1" : ch === 2 ? "Stereo" : ch === 1 ? "Mono" : undefined) : undefined;
  const lang = t.title && t.lang ? languageName(t.lang) : undefined;
  return [name, lang && lang !== name ? lang : undefined, layout, ...kindTags(t)].filter(Boolean).join(" · ");
}

/** What tells an mpv track apart in the track memory. */
function mpvTraits(t: MpvTrack): TrackTraits & { id: string } {
  return { id: String(t.id), lang: t.lang, title: t.title, codec: t.codec, channels: t["demux-channel-count"] };
}

/** The same with what the track is for, to choose among tracks in one language. */
function mpvCandidate(t: MpvTrack): TrackTraits & KindSource & { id: string } {
  return { ...mpvTraits(t), forced: t.forced, "hearing-impaired": t["hearing-impaired"], "visual-impaired": t["visual-impaired"] };
}

/** The same for the built-in player's tracks, which carry less. */
function htmlTraits(id: string, lang: string, label: string): TrackTraits & { id: string } {
  return { id, lang: lang || undefined, title: label || undefined };
}

/** An add-on subtitle's identity in the track memory: hashed, since its link can carry a token. */
const subtitleId = (s: SubtitleOption) => hashed(`${s.addon}\n${s.id || s.url}`);
