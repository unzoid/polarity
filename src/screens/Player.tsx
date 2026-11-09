import { useQuery } from "@tanstack/react-query";
import {
  Captions,
  Cast,
  Close,
  Episodes,
  ExitFullscreen,
  FillWindow,
  LayoutList,
  LayoutRow,
  Fullscreen,
  Pause,
  Play,
  Settings as Cog,
  SkipForward,
  Sources,
  Speed,
  Volume,
  VolumeMuted,
} from "../components/icons";
import { AnimatePresence, motion } from "motion/react";
import { ease, useFormFactor } from "../lib/ui";
import { anchorOf, appWindow, canEmbedOtherSites, isDesktop, isMac, isTvDevice, nativeDialogsAvailable, os, setImmersive, showNativeDialog } from "../lib/platform";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BackButton } from "../components/BackButton";
import { Img } from "../components/Img";
import { Spinner } from "../components/Spinner";
import { streamKey } from "../components/StreamList";
import { SourceFilterBar } from "../components/SourceFilters";
import { TvSourceMenu, useSourceInfo } from "../components/SourceInfo";
import { playingReport } from "../components/player/playingReport";
import {
  airedAt,
  autoplayStreak,
  countAutoplay,
  describeStream,
  requestHeaders,
  videoFile,
  READY_CHECKS,
  readinessNote,
  recordFail,
  recallTracks,
  rememberLanguage,
  rememberTracks,
  resetAutoplay,
  sliderAmplitude,
  sourceRow,
  trackMemoryKey,
  useReadiness,
  useResetAutoplayOnInput,
  useSourceFilters,
  useTitleSettings,
  CAPTIONS_NOTE,
  CAPTIONS_OFF,
  SPEED_ONE_NOTE,
  SPEED_PARTY_NOTE,
  captionChoices,
  speedChoices,
} from "../lib/playback";
import { downloadedStream, episodeState, isLocalFile, nextVideo, progressMap, seasonsOf, useDownloads, watchedFraction } from "../lib/library";
import { WindowControls } from "../components/WindowControls";
import { Scrubber } from "../components/player/Scrubber";
import { useSource } from "../components/player/useSource";
import { useSourceRecord, useThroughput } from "../components/player/useSourceRecord";
import { SkipButton, useSkipSegments } from "../components/player/SkipSegments";
import { OptionsOverlay, type OptionColumn, type OptionItem } from "../components/player/OptionsOverlay";
import { VolumeHud, type VolumePing } from "../components/player/VolumeHud";
import { EpisodeRail } from "../components/player/EpisodeRail";
import { Dropdown } from "../components/Dropdown";
import { SkipTransport } from "../components/player/SkipTransport";
import { useTracks } from "../components/player/useTracks";
import { useKeyboardFocus } from "../components/player/useKeyboardFocus";
import { usePinch } from "../components/player/usePinch";
import { pickedSpeed, speedLabel, speedMenu } from "../components/player/nativeMenus";
import {
  DEFAULT_SUBTITLE_STYLE,
  SubtitlePreview,
  SubtitleSettings,
  applySubtitleStyleToMpv,
  forgetAssOverride,
  subtitleCueVars,
} from "../components/player/SubtitleSettings";
import { isMpv, MpvMedia, type MediaLike, type StepDetail } from "../components/player/mpvMedia";
import { createFrameStepper, DEFAULT_FPS, measureFps, stepFrame } from "../components/player/frameStep";
import { useStepping } from "../components/player/useStepping";
import { createWindowPin } from "../components/player/windowPin";
import { YouTubeMedia } from "../components/player/youtubeMedia";
import { useYouTubeSpeed } from "../components/player/useYouTubeSpeed";
import { youtubeEmbed, youtubeUrl } from "../components/Trailer";
import { listenProbe, nextProbeId, probeStep, useStartLog } from "../components/player/useStartLog";
import {
  cropModeLabel,
  getPrefs,
  nextCropMode,
  openSettings,
  setPrefs,
  shortcutText,
  shownCropMode,
  useEpisodeLayout,
  usePrefs,
  withShortcut,
} from "../lib/settings";
import { Segmented } from "../components/Segmented";
import { api } from "../lib/api";
import { useAccount } from "../lib/account";
import { airLabel, episodeCode, formatRemaining, formatTime, runtimeSeconds, seasonLabel } from "../lib/format";
import { keys, prefetchStreams, useMeta, useProgress, useStreams, useUpdateSettings } from "../lib/net";
import { useRouter } from "../lib/router";
import type { ContentType, Progress, RankedStream, Stream, Video } from "../lib/types";
import { playContext, stillFor } from "../lib/anime";
import { useMpvTune } from "../components/player/useMpvTune";
import { setTvMode, useTvMode } from "../tv/tvMode";
import { usePadGlyph } from "../tv/TvChrome";
import { fileId, filePlace, fileStream, isFileId, recentPosition, useRecentFiles } from "../lib/localFiles";
import {
  closePartySurface,
  getParty,
  isLinkId,
  linkLabel,
  linkMedia,
  openPartySurface,
  partyAvailable,
  partyPosition,
  startParty,
  streamHint,
  useParty,
  usePartySurface,
  useJoinDesk,
  youtubeId,
} from "../lib/party";
import { partyPage, watchPage } from "../lib/deepLink";
import { setWatching } from "../lib/friends";
import { usePartySync } from "../components/player/usePartySync";
import { useDiscordPresence } from "../components/player/useDiscordPresence";
import { LinkForm, PartyBadge, PartyHold, partyHoldText, PartyNotes, PartyStart } from "../components/party/PartyUI";
import { PartyRoomPane, PartySettingsPane } from "../components/party/PartyMenu";
import { More, Pin, Pinned, WatchParty } from "../components/icons";
import { Button, IconButton, iconButtonClass } from "../components/ui/Button";
import { MenuCheckItem, MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../components/ui/Menu";
import { watch, watchLog } from "../lib/playback/watchLog";
import { useWatchLog, watchLogText } from "../components/player/useWatchLog";
import { useBarFit } from "../components/player/useBarFit";
import { errorMessage, storeLocal, warnFailed } from "../lib/errors";
import { PLAYER_EXIT_MS } from "../components/PlayerLayer";
import { PlayerStatus } from "../components/player/PlayerStatus";
import { useLoadingArt } from "../components/player/useLoadingArt";
import { TorrentNotice } from "../components/player/TorrentNotice";
import { FrameLabel, PlayerClock, TIME_DISPLAYS } from "../components/player/PlayerClock";
import { useMediaTime } from "../components/player/useMediaTime";
import { usePlayerChrome } from "../components/player/usePlayerChrome";
import { usePlayerKeyboard } from "../components/player/usePlayerKeyboard";
import { useProgressSaver } from "../components/player/useProgressSaver";
import { useSimklScrobble } from "../components/player/useSimklScrobble";
import { useTraktScrobble } from "../components/player/useTraktScrobble";
import { useAirPlay } from "../components/player/useAirPlay";

const win = appWindow;
/** In a watch party, how long a source gets to start before the next one is tried. */
const PARTY_START_MS = 20_000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** What Subtitles & Audio and Speed say for a YouTube video outside TV mode: they're YouTube's own controls there (#384). TV mode has menus for them (#434). */
const YT_CAPTIONS = "Captions for a YouTube video are in YouTube's player: its CC button and settings.";
const YT_SPEED = "Speed for a YouTube video is in YouTube's player settings.";
/** How long the party's hold lasts before YouTube's bar comes out to say so: longer than over a picture (400 ms), as the bar moves YouTube's. */
const HOLD_SHOWS_MS = 1200;
/** With "Up next" set to the very end, it appears this many seconds before. */
const NEXT_UP_AT_END = 12;


export function Player({
  type,
  metaId,
  videoId,
  stream,
  leaving = false,
}: {
  type: ContentType;
  metaId: string;
  videoId: string;
  stream?: Stream;
  /** Route already popped; only the exit fade is left. Ignore input. */
  leaving?: boolean;
}) {
  const { back, replace, tab } = useRouter();
  // TV mode keeps the window fullscreen: no fullscreen toggle, and Esc simply goes back.
  const tv = useTvMode();
  // With a controller in TV mode, controls show the button that triggers them.
  const pad = usePadGlyph(tv);
  // On Android the system bars hide while the player is open (#178), and come back when it closes.
  useEffect(() => {
    setImmersive(true);
    return () => setImmersive(false);
  }, []);
  // A link pasted into a watch party (#136): no title behind it, so no title page, episodes, sources,
  // progress or lookups by id; it plays the URL it came with.
  const link = isLinkId(metaId) ? stream?.url : undefined;
  // A YouTube video's link plays in YouTube's own embedded player (#201), never in mpv.
  const ytId = link ? youtubeId(link) : undefined;
  // On Android YouTube's player can't go in a frame (lib/platform canEmbedOtherSites): the video opens in YouTube.
  const ytOutside = ytId && !canEmbedOtherSites() ? ytId : undefined;
  // Otherwise it plays in the app with YouTube's own controls, and nothing of ours over it (#384: YouTube's
  // terms forbid drawing over any part of an embedded player): a bar above it, the party panel beside it.
  const ytFramed = !!ytId && !ytOutside;
  // A video file on this device (#204): its title is the file or its folder (lib/localFiles), its
  // source the file itself, and where it stopped is kept on this device; nothing is looked up online.
  const local = isFileId(metaId);
  const { data: meta, isPending: metaPending } = useMeta(type, metaId, !isLinkId(metaId) && !local);
  // The loading screen draws the title page's logo and backdrop (#391).
  const art = useLoadingArt(meta, metaPending && !isLinkId(metaId) && !local, videoId);
  // Its languages are Settings → Anime's for an anime (#235).
  const { settings, anime, original } = useTitleSettings(type, videoId);
  const { touch, form, compact } = useFormFactor();
  // Engine: embedded mpv when installed (plays every codec, AC3/DTS audio, every
  // subtitle format), else the WebView's own <video>.
  const engineQuery = useQuery({ queryKey: keys.mpv, queryFn: api.mpvAvailable, staleTime: Infinity });
  const engine: "mpv" | "html" | "youtube" | null = ytId ? "youtube" : engineQuery.isFetched ? (engineQuery.data ? "mpv" : "html") : null;
  const mpv = useMemo(() => new MpvMedia(), []);
  const yt = useMemo(() => new YouTubeMedia(), []);
  const [ytFrame, setYtFrame] = useState<HTMLIFrameElement | null>(null);
  useEffect(() => (ytFrame ? yt.attach(ytFrame) : undefined), [yt, ytFrame]);
  // TV's Captions menu (#434): the language YouTube's embed loads with captions on (null for its own default),
  // and whether it starts by itself: loaded again while paused, it stays paused.
  const [ytEmbed, setYtEmbed] = useState<{ captions: string | null; autoplay: boolean }>({ captions: null, autoplay: true });
  const ytSpeed = useYouTubeSpeed(yt);
  // Watch party: signed-in profiles only. Joining the room's video, look for the file it's on.
  const { profile } = useAccount();
  const canParty = partyAvailable() && !!profile;
  const [roomHint] = useState(() => {
    const p = getParty()?.playback;
    return p?.media.videoId === videoId ? p.media.hint : undefined;
  });
  // What the loading screen lists as it happens (and copies for a bug report).
  const { steps, add: logStep } = useStartLog();
  useEffect(() => {
    if (engine === "mpv") logStep("Player: mpv", "info", "player");
    else if (engine === "youtube") logStep("Player: YouTube's embedded player", "info", "player");
    // What the built-in player can't do depends on the file's codecs and the machine, not on MKV (test report 1, item 23).
    else if (engine === "html")
      logStep("Player: built-in (mpv isn't installed, so some files may not play: AC3/DTS audio, HEVC where the system can't decode it)", "info", "player");
  }, [engine, logStep]);
  const startedRef = useRef(false);
  const playStream = stream ?? (local ? fileStream(videoId) : undefined);
  const source = useSource(type, metaId, videoId, playStream, roomHint, logStep, () => startedRef.current);

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  /** What plays in the app; `media` is what the controls drive, an AirPlay receiver's element while casting with mpv. */
  const baseMedia: MediaLike | null = engine === "mpv" ? mpv : engine === "youtube" ? yt : videoEl;
  const baseRef = useRef<MediaLike | null>(null);
  baseRef.current = baseMedia;
  const videoRef = useRef<MediaLike | null>(null);
  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(true);
  // Until the first frame actually plays, the loading screen stays up.
  const [started, setStarted] = useState(false);
  startedRef.current = started;
  // Watch party state, needed this early by AirPlay (never both at once).
  const party = useParty();

  // --- Progress -------------------------------------------------------------
  // Before AirPlay: leaving the player saves the receiver's position before the cast ends.
  const current = meta?.videos.find((v) => v.id === videoId);
  const { save, saveIfDue } = useProgressSaver({ media: videoRef, meta, type, metaId, videoId, current, state: source.state });
  useTraktScrobble({ media: videoRef, videoId, type, playing: started && !paused, enabled: !local });
  useSimklScrobble({ media: videoRef, videoId, type, playing: started && !paused, enabled: !local });

  // --- AirPlay (#19) ----------------------------------------------------------
  const playingUrl = source.state.status === "ready" && started ? source.state : undefined;
  const airplay = useAirPlay({
    media: baseMedia,
    video: engine === "html" ? videoEl : null,
    url: playingUrl?.url,
    headers: playingUrl ? requestHeaders(playingUrl.stream) : null,
    // YouTube's player has no file to hand over.
    enabled: !party && engine !== "youtube",
  });
  const media: MediaLike | null = airplay.media ?? baseMedia;
  // What the player did while it played, for "Copy Watch Log" (dev builds only, #424).
  useWatchLog(media, videoId);
  videoRef.current = media;
  /** Why the link check turned the built-in player's source down (mpv reports its own). */
  const linkError = useRef<string | null>(null);
  const [volume, setVolume] = useState(savedVolume);
  // TV mode: each volume press from the controller or remote shows the volume HUD.
  const [volumePing, setVolumePing] = useState<VolumePing>({ n: 0, dir: "up" });
  const pingVolume = (dir: VolumePing["dir"]) => tv && setVolumePing((p) => ({ n: p.n + 1, dir }));
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, flashNotice] = useNotice();
  const [ended, setEnded] = useState(false);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [options, setOptions] = useState<"speed" | "tracks" | "episodes" | "sources" | "party" | null>(null);
  // The Watch Party panel is a party surface (lib/party/surface.ts, #247): another one coming up closes it.
  const partySurface = usePartySurface();
  useEffect(() => {
    if (options !== "party") return;
    openPartySurface("panel");
    return () => closePartySurface("panel");
  }, [options]);
  const lastSurface = useRef(partySurface);
  useEffect(() => {
    if (lastSurface.current === "panel" && partySurface !== "panel") setOptions((o) => (o === "party" ? null : o));
    lastSurface.current = partySurface;
  }, [partySurface]);
  // iOS's own menu is up (Speed, Subtitles & Audio): the controls stay while it is.
  const [nativeMenu, setNativeMenu] = useState(false);
  const updateSettings = useUpdateSettings();
  // Settings → Playback → "Remember playback speed" (settings may arrive after the player opens).
  const [picked, setPicked] = useState<number>();
  const rate = picked ?? (settings?.rememberSpeed && settings.playbackSpeed > 0 ? settings.playbackSpeed : 1);
  const setRate = (r: number) => {
    setPicked(r);
    if (settings?.rememberSpeed) updateSettings.mutate({ playbackSpeed: r });
  };
  const seekStep = settings?.seekStep ?? 10;
  // Each seek from the centre buttons, a double-tap, or the seek keys (and so the controller): SkipTransport shows the jump.
  const [kicks, setKicks] = useState({ back: 0, forward: 0 });
  const kick = (dir: "back" | "forward") => setKicks((k) => ({ ...k, [dir]: k[dir] + 1 }));
  const hideAfter = Math.max(1, settings?.controlsHideSecs ?? 2) * 1000;
  const countdown = Math.max(3, settings?.autoplayCountdown ?? 8);
  const timeDisplay = settings?.timeDisplay ?? "remaining";
  useMpvTune(engine === "mpv" ? mpv : null);
  // Subtitle look (saved) and timing offset (this source of this episode, remembered on this device, #418).
  const subStyle = settings?.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;
  const playingStream = source.state.status === "ready" ? source.state.stream : undefined;
  const memoryKey = trackMemoryKey(videoId, playingStream);
  const [subDelay, setSubDelay] = useState(0);
  useEffect(() => setSubDelay(recallTracks(memoryKey)?.delay ?? 0), [memoryKey]);
  const changeSubDelay = (delay: number) => {
    setSubDelay(delay);
    rememberTracks(memoryKey, videoId, { delay });
  };
  const [subSettingsOpen, setSubSettingsOpen] = useState(false);

  // Subtitle add-ons match on the file's size and name (React Query compares keys by value).
  const playingFile = videoFile(playingStream);
  const tracks = useTracks(
    media,
    type,
    videoId,
    {
      audio: settings?.audioLanguage ?? "",
      subtitle: settings?.subtitleLanguage ?? "",
      subtitleMode: settings?.subtitleMode ?? "always",
    },
    (patch) => updateSettings.mutate(rememberLanguage(settings, anime, original, patch)),
    playingFile,
    // Subtitles beside a file on this device load with it (mpv's sub-auto); add-ons aren't asked.
    !local,
    memoryKey,
  );
  useEffect(() => {
    if (engine !== "mpv") return;
    applySubtitleStyleToMpv(mpv, subStyle, subDelay);
    // mpv may (re)start with the file; apply again once it's loaded.
    const onTracks = () => applySubtitleStyleToMpv(mpv, subStyle, subDelay);
    const onLoaded = () => {
      forgetAssOverride(mpv);
      onTracks();
    };
    mpv.addEventListener("loadedmetadata", onLoaded);
    // The track list (and which subtitle is on) arrives after the file opens:
    // an ASS track is only known to need its styling overridden once it's in.
    mpv.addEventListener("tracks", onTracks);
    return () => {
      mpv.removeEventListener("loadedmetadata", onLoaded);
      mpv.removeEventListener("tracks", onTracks);
    };
  }, [engine, mpv, subStyle, subDelay, tracks.subId]); // ASS tracks are restyled differently from plain text

  // Optional seek-bar thumbnails (Seekr). Keyed to whole seconds of duration:
  // the API aligns cues to the length of the release being played.
  const durationS = useMediaTime(media, (t) => Math.round(t.duration));
  const { data: seekTrack } = useQuery({
    queryKey: keys.seekr(videoId, durationS),
    queryFn: () => api.seekPreviews(videoId, durationS * 1000),
    enabled: !!settings?.seekPreviews && !!settings?.seekrKey && durationS > 0 && !link && !local,
    staleTime: Infinity,
    retry: false,
  });

  // --- Chrome visibility --------------------------------------------------
  // Paused on a stepped frame, the controls hide after the set time, not the paused wait (#346).
  const frameSteps = useStepping(paused, buffering);
  // YouTube's bar stays out of the way while paused too: showing it moves the picture (#384).
  const { chrome, poke, hide: hideChrome, overControls } = usePlayerChrome(hideAfter, paused && !frameSteps.stepping && !ytFramed);
  // The focus ring shows only for focus moved by the keyboard, never after a click (#329).
  const keyFocus = useKeyboardFocus();
  const ready = source.state.status === "ready" && !error;
  // The top bar's "More" menu (#396) keeps the controls up while it's open.
  const [moreOpen, setMoreOpen] = useState(false);
  const chromeVisible = chrome.visible || !!options || nativeMenu || moreOpen || !ready;
  // YouTube's bar (#384) collapses once the video has played, and says what the party's hold says once it lasts.
  const [ytPlayed, setYtPlayed] = useState(false);
  useEffect(() => {
    if (ytFramed && started && !paused) setYtPlayed(true);
  }, [ytFramed, started, paused]);
  const partyHold = useLasting(ytFramed && party && ready && started ? partyHoldText(party, videoId) : null, HOLD_SHOWS_MS);
  // Whether the controls showed when the press on the picture began: the
  // player's own pointerdown shows them before the click, so a tap that should
  // bring them back would otherwise hide them again at once.
  const chromeAtPress = useRef(false);

  // --- Current / next episode ---------------------------------------------
  const { animeSkipFiller } = usePrefs();
  // With "Skip filler" on, the next episode that isn't filler; `skipped` says how many were passed over.
  const { next, skipped } = useMemo(() => {
    let n = meta && type === "series" ? nextVideo(meta, videoId) : undefined;
    const skipped: Video[] = [];
    while (n && animeSkipFiller && playContext.isFiller(n.id) && meta) {
      skipped.push(n);
      n = nextVideo(meta, n.id);
    }
    return { next: n, skipped };
  }, [meta, type, videoId, animeSkipFiller]);
  // A YouTube video is called by its own title once its player says it.
  const [ytTitle, setYtTitle] = useState<string | null>(null);
  // YouTube's player is up with its own controls (#384): the loading screen leaves them clear, even before it plays.
  const [ytShown, setYtShown] = useState(false);
  useEffect(() => {
    const onReady = () => setYtShown(true);
    yt.addEventListener("playerready", onReady);
    return () => yt.removeEventListener("playerready", onReady);
  }, [yt]);
  useEffect(() => {
    const onTitle = () => setYtTitle(yt.title);
    yt.addEventListener("titlechange", onTitle);
    return () => yt.removeEventListener("titlechange", onTitle);
  }, [yt]);
  const title = link ? ytTitle || stream?.name || linkLabel(link) : (meta?.name ?? "");
  const heading = local ? (current?.title ?? title) : current ? `${episodeCode(current.season, current.episode)} · ${current.title}` : title;

  // --- Watch party ------------------------------------------------------------
  // A link is its own file: no release name for others to look for.
  const hint = useMemo(() => (link ? undefined : streamHint(playingStream)), [link, playingStream]);
  const partyMedia = link ? linkMedia(link) : { type, metaId, videoId, label: heading || undefined };
  usePartySync({ media, current: partyMedia, started, buffering, hint, leaving });
  const startHere = () => {
    const v = videoRef.current;
    if (!party && profile && v) startParty({ ...partyMedia, hint }, v.currentTime, v.paused, profile);
  };

  // --- mpv lifecycle ----------------------------------------------------------
  useEffect(() => {
    if (engine !== "mpv") return;
    let alive = true;
    let dispose: (() => void) | undefined;
    void mpv.attach().then((d) => {
      if (alive) dispose = d;
      else d(); // this mount is already gone; drop only its own listeners
    });
    return () => {
      alive = false;
      dispose?.();
      mpv.stop();
    };
  }, [engine, mpv]);

  // mpv draws in the native window *under* the page, so the page must be
  // see-through — but only once mpv has a picture. Until then the player is
  // an opaque black layer, so neither the page nor mpv's idle window shows.
  // Layout effect: the page turns clear (and back) in the same frame the
  // player does, never one frame apart.
  const seeThrough = engine === "mpv" && started;
  useLayoutEffect(() => {
    if (!seeThrough) return;
    document.documentElement.dataset.player = "mpv";
    return () => {
      delete document.documentElement.dataset.player;
    };
  }, [seeThrough]);

  // --- Load source ----------------------------------------------------------
  /** Where to pick up (Settings → Playback: resume on/off, rewind), or undefined to start over. */
  const resumePoint = (r?: Pick<Progress, "position" | "duration">) => {
    if (settings?.resumePlayback === false || !r || r.position <= 30 || r.position / r.duration >= watchedFraction()) return undefined;
    return Math.max(0, r.position - (settings?.resumeRewind ?? 0));
  };
  const resumed = useRef(false);
  useEffect(() => {
    // Always the app's own player: handing over to AirPlay and back isn't a new source.
    const v = baseRef.current;
    if (!v || source.state.status !== "ready") return;
    resumed.current = false;
    setError(null);
    setBuffering(true);
    watch(`source: ${describeStream(source.state.stream, source.state.url)}, ${engine}`);
    v.volume = sliderAmplitude(volume);
    if (v instanceof MpvMedia) {
      // Start at the resume point (or where the watch party is) directly: no
      // fetching the opening of a network stream only to seek away from it.
      const start = partyPosition(videoId) ?? resumePoint(source.resume ?? (local ? recentPosition(videoId) : undefined));
      resumed.current = true;
      v.load(source.state.url, start, requestHeaders(source.state.stream));
    } else if (v instanceof YouTubeMedia) {
      resumed.current = true;
      v.load(partyPosition(videoId) ?? null);
    } else if (v instanceof HTMLVideoElement) {
      const url = source.state.url;
      const play = (src: string) => {
        v.src = src;
        v.play().catch(() => setPaused(true));
      };
      linkError.current = null;
      if (isLocalFile(url)) return play(url);
      // The same link check mpv_load runs, so this player gets the warmed link and the same steps.
      let cancelled = false;
      const id = nextProbeId();
      const unlisten = listenProbe(id, (e) => logStep(...probeStep(e)));
      api
        .streamProbe(url, id, requestHeaders(source.state.stream))
        .then(
          (final) => !cancelled && play(final),
          (e) => {
            if (cancelled) return;
            linkError.current = errorMessage(e);
            logStep(errorMessage(e), "fail", "server");
            v.dispatchEvent(new Event("error"));
          },
        )
        .finally(() => void unlisten.then((f) => f()));
      return () => {
        cancelled = true;
      };
    }
    // Volume is applied by its own effect; only a new source reloads.
  }, [source.state, baseMedia]);

  // Handing over to AirPlay or back: the controls show the new element's state at once.
  useEffect(() => {
    if (media) setPaused(media.paused);
  }, [media]);

  // mpv's own steps (link check, opening, buffering) go to the log until the picture starts.
  useEffect(() => {
    if (!media) return;
    const onStep = (e: Event) => {
      const d = (e as CustomEvent<StepDetail>).detail;
      if (!startedRef.current) logStep(d.text, d.tone, d.stage, d.key);
    };
    media.addEventListener("step", onStep);
    return () => media.removeEventListener("step", onStep);
  }, [media, logStep]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = sliderAmplitude(volume);
    v.muted = muted;
    if (!systemVolume) storeLocal("polar.volume", String(volume));
  }, [volume, muted, media]);

  // A watch party plays at 1x for everyone (its sync nudges the rate itself).
  const inParty = !!party;
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = inParty ? 1 : rate;
  }, [rate, source.state, media, inParty]);

  // In a party, a source that won't start keeps the whole room waiting: move
  // on to the next one, as picking another source by hand would.
  const sourceNext = source.next;
  useEffect(() => {
    if (!inParty || started || source.state.status !== "ready") return;
    const t = window.setTimeout(() => {
      logStep(`Not playing after ${PARTY_START_MS / 1000} s; the watch party is waiting`, "warn", "player");
      if (sourceNext()) flashNotice("That source was slow to start. Trying the next best one.", 3500);
    }, PARTY_START_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new attempt is a new source.state
  }, [inParty, started, source.state]);

  // Fullscreen carries over from the previous episode; Settings → Playback
  // can also start every video in it.
  const fullscreenApplied = useRef(false);
  useEffect(() => {
    if (!settings || fullscreenApplied.current) return;
    fullscreenApplied.current = true;
    void win.isFullscreen().then((fs) => {
      if (!fs && settings.startFullscreen && !tv) {
        void win.setFullscreen(true);
        setFullscreen(true);
      } else setFullscreen(fs);
    });
  }, [settings, tv]);

  // Settings → Playback → "Pause when minimized".
  const { pauseOnMinimize, discordPresence } = usePrefs();
  // A file on this device stays private: its name isn't shown on Discord.
  // Buttons (#153): this title in the viewer's own Polarity (only where the title is shown), and the party's join link.
  const joinToken = useJoinDesk().token;
  const presenceLinks = useMemo(
    () => ({ watch: (discordPresence === "title" && watchPage(type, metaId)) || undefined, party: joinToken ? partyPage(joinToken) : undefined }),
    [discordPresence, type, metaId, joinToken],
  );
  useDiscordPresence(media, meta, videoId, local ? "off" : discordPresence, presenceLinks);
  // What friends may see playing (#135); the same rule: never a file on this device.
  const playingVideo = meta?.videos?.find((v) => v.id === videoId);
  const friendsLabel = playingVideo?.season !== undefined && playingVideo.episode !== undefined ? `S${playingVideo.season}:E${playingVideo.episode}` : undefined;
  useEffect(() => {
    if (local || !meta?.name) return;
    setWatching({ type, metaId, title: meta.name, ...(friendsLabel ? { label: friendsLabel } : {}) });
    return () => setWatching(null);
  }, [local, type, metaId, meta?.name, friendsLabel]);
  useEffect(() => {
    if (!pauseOnMinimize) return;
    const unlisten = win.onResized(() => {
      void win.isMinimized().then((min) => {
        if (min && videoRef.current && !videoRef.current.paused) videoRef.current.pause();
      });
    });
    return () => void unlisten.then((f) => f());
  }, [pauseOnMinimize]);

  // Any deliberate input means someone's still there ("Still watching?").
  useResetAutoplayOnInput();

  // --- Media events (identical for <video> and mpv) ---------------------------
  const handlers = {
    play: () => {
      setPaused(false);
      setEnded(false);
      // YouTube's bar collapses once it plays, wherever the play came from (#384).
      if (!ytFramed) poke(false, "play");
    },
    pause: () => {
      setPaused(true);
      save();
    },
    waiting: () => {
      setBuffering(true);
      if (!startedRef.current) logStep("Buffering", "info", "player", "buffer");
    },
    playing: () => {
      setBuffering(false);
      if (!startedRef.current) logStep("Playing", "ok", "player");
      setStarted(true);
    },
    canplay: () => {
      setBuffering(false);
      // YouTube's player stopped with the video loaded (held by the party, or its autoplay refused) has its
      // picture up: the loading screen goes and the party can count it in. Its first frame may never "play" (#383).
      if (videoRef.current instanceof YouTubeMedia && videoRef.current.paused) {
        if (!startedRef.current) logStep("Ready, paused", "ok", "player");
        setStarted(true);
      }
    },
    loadedmetadata: () => {
      const v = videoRef.current!;
      const start = partyPosition(videoId) ?? resumePoint(source.resume ?? (local ? recentPosition(videoId) : undefined));
      if (!resumed.current && start != null) v.currentTime = start;
      resumed.current = true;
      if (!startedRef.current) {
        const length = Number.isFinite(v.duration) ? ` · ${formatTime(v.duration)} long` : " · live or unknown length";
        logStep(`File opened${length}${start != null ? `, starting at ${formatTime(start)}` : ""}`, "ok", "player");
      }
    },
    // The time itself is read where it's shown (useMediaTime), not stored here.
    timeupdate: () => {
      if (!videoRef.current!.paused) setStarted(true);
      saveIfDue();
    },
    ended: () => {
      setEnded(true);
      save();
    },
    error: () => {
      // The torrent engine was stopped in the background (#207): its reason stays on screen.
      if (source.halted()) return;
      // mpv exiting isn't this source's fault: moving on to the next source
      // would just start mpv again (and if it keeps exiting, loop through
      // every source).
      const exited = videoRef.current instanceof MpvMedia && videoRef.current.error?.playerExited;
      if (!exited) recordFail(source.kind);
      const el = videoRef.current;
      if (el instanceof HTMLVideoElement && el.error) {
        const kinds = ["", "loading was stopped", "network error", "couldn't decode it", "format not supported"];
        logStep(`Built-in player: ${kinds[el.error.code] ?? `error ${el.error.code}`}${el.error.message ? ` (${el.error.message})` : ""}`, "fail", "player");
      }
      if (!exited && source.next()) {
        logStep("Trying the next source", "warn");
        flashNotice("That source didn't load. Trying the next best one.", 3500);
      } else {
        const v = videoRef.current;
        setError(
          v instanceof MpvMedia || v instanceof YouTubeMedia
            ? (v.error?.message ?? "This file couldn't be played.")
            : linkError.current
              ? linkError.current
              : isMac
              ? "This file's format needs mpv. Install it (brew install mpv) and Polarity will play it."
              : "This file's format needs mpv. Install mpv and Polarity will play it.",
        );
      }
    },
  };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    if (!media) return;
    const names = Object.keys(handlersRef.current) as (keyof typeof handlers)[];
    const bound = names.map((n) => [n, () => handlersRef.current[n]()] as const);
    bound.forEach(([n, fn]) => media.addEventListener(n, fn));
    return () => bound.forEach(([n, fn]) => media.removeEventListener(n, fn));
  }, [media]);

  // --- Actions ----------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  // A seek leaves the stepped frame: the frame number goes with it.
  const { leave: leaveStep } = frameSteps;
  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      watch(`seek by the viewer: ${delta > 0 ? "+" : ""}${delta} s`);
      if (v?.duration) v.currentTime = Math.min(v.duration - 1, Math.max(0, v.currentTime + delta));
      leaveStep();
    },
    [leaveStep],
  );

  const seekTo = useCallback(
    (t: number, by = "the viewer") => {
      watch(`seek by ${by}: to ${formatTime(t)}`);
      if (videoRef.current) videoRef.current.currentTime = t;
      leaveStep();
    },
    [leaveStep],
  );

  // --- Frame stepping (#243, #273): desktop only, with the keys -----------------
  // The rate frames are counted in: what mpv reads in the file, or what the built-in player measures as it plays.
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    setFps(null);
    if (!isDesktop || !started || !media) return;
    if (isMpv(media)) {
      let live = true;
      void media.frameRate().then((f) => live && setFps(f));
      return () => void (live = false);
    }
    if (media === videoEl && videoEl) return measureFps(videoEl, setFps);
  }, [media, started, videoEl]);
  const fpsRef = useRef(DEFAULT_FPS);
  fpsRef.current = fps ?? DEFAULT_FPS;
  const { begin: beginStep, end: endStep } = frameSteps;
  const stepper = useMemo(
    () =>
      createFrameStepper(async (direction) => {
        const v = videoRef.current;
        // YouTube's player seeks to whole moments, not frames.
        if (!v?.duration || !startedRef.current || v instanceof YouTubeMedia) return;
        beginStep();
        try {
          await stepFrame(v, direction, fpsRef.current);
        } finally {
          endStep();
        }
      }),
    [beginStep, endStep],
  );

  const skipTo = useCallback((t: number) => seekTo(t, "a skip (intro, recap or credits)"), [seekTo]);
  const onAutoSkipped = useCallback((label: string) => flashNotice(label, 2500), [flashNotice]);
  const { preferFileChapters, autoSkipDelay } = usePrefs();
  const skip = useSkipSegments({
    videoId,
    started,
    autoSkip: { intro: !!settings?.autoSkip, recap: settings?.autoSkipRecaps ?? !!settings?.autoSkip },
    autoSkipDelay,
    media,
    preferFile: preferFileChapters,
    seekTo: skipTo,
    onAutoSkipped,
    online: !link && !local,
  });

  // Crop mode (#148, #149, #183, #330): Fit, Crop black bars or Fill window, one setting (lib/settings/cropMode.ts)
  // the button, its shortcut, TV's binding and Settings → Advanced share. A phone or tablet has no window to make
  // fullscreen, so its button there does this. Autocrop takes the bars in the video off; Fill then crops what's
  // left to the window's shape (mpv's panscan, which the autocrop loop reads). Without mpv there's no autocrop:
  // the button skips Crop black bars and Fill covers the window with the whole frame. Kept on this device.
  const { cropMode } = usePrefs();
  const canCrop = engine === "mpv";
  const crop = shownCropMode(cropMode, canCrop);
  const fill = crop === "fill";
  const nextCrop = nextCropMode(cropMode, canCrop);
  useEffect(() => {
    if (engine === "mpv") void mpv.set("panscan", fill ? 1 : 0);
  }, [engine, mpv, fill]);
  // Each press says which mode it is now: the picture alone doesn't always show it.
  const cycleCrop = useCallback(() => {
    const next = nextCropMode(getPrefs().cropMode, canCrop);
    setPrefs({ cropMode: next });
    flashNotice(cropModeLabel(next), 1500);
  }, [canCrop, flashNotice]);
  const pinch = usePinch((direction) => {
    if (!isDesktop) setPrefs({ cropMode: direction === "out" ? "fill" : "fit" });
  });

  // --- Pin window (#266): desktop only, where the system lets an app stay on top ---
  const [canPin, setCanPin] = useState(false);
  useEffect(() => {
    if (!isDesktop || tv) return setCanPin(false);
    let live = true;
    void win.canPin().then((ok) => live && setCanPin(ok));
    return () => void (live = false);
  }, [tv]);
  const [pinned, setPinned] = useState(false);
  const pinner = useMemo(() => createWindowPin(win, setPinned), []);
  // Leaving the player, or switching to TV mode, always unpins: the window is never left on top.
  useEffect(() => {
    if (tv) void pinner.unpin();
  }, [tv, pinner]);
  useEffect(() => () => void pinner.unpin(), [pinner]);
  const togglePin = useCallback(() => {
    const pinning = !pinner.pinned;
    void pinner.toggle().then(() => {
      // Said once, the first time: how to get out of it.
      if (!pinning || !pinner.pinned || pinHintSeen()) return;
      storeLocal(PIN_HINT, "1");
      const key = shortcutText("pinWindow");
      flashNotice(key ? `Window pinned, press ${key} to unpin` : "Window pinned", 3500);
    });
  }, [pinner, flashNotice]);

  const toggleFullscreen = useCallback(async () => {
    if (tv) return;
    const next = !(await win.isFullscreen());
    // Going fullscreen unpins first.
    await pinner.setFullscreen(next);
    setFullscreen(next);
  }, [tv, pinner]);

  // Fade back to the page first, *then* leave fullscreen: resizing the window
  // while mpv's native picture is up is what flickers, so do it once the page
  // is opaque on top.
  const exit = useCallback(async () => {
    const fs = !tv && (await win.isFullscreen());
    back();
    if (fs) window.setTimeout(() => void win.setFullscreen(false), PLAYER_EXIT_MS);
  }, [back, tv]);

  /**
   * The Settings page a playback problem names. In TV mode (#435): Sources is TV's own Sources settings; Add-ons, which
   * TV mode has no page for, is desktop mode's.
   */
  const openSettingsPage = useCallback(
    (page: "sources" | "addons") => {
      if (tv && page === "sources") return tab({ name: "settings", page: "sources" });
      void exit();
      if (tv) setTvMode(false);
      openSettings(page);
    },
    [tv, tab, exit],
  );

  const playVideo = useCallback(
    (id: string, s?: Stream) => {
      save();
      replace({ name: "player", type, metaId, videoId: id, stream: s });
    },
    [save, replace, type, metaId],
  );

  // --- Episodes & sources pickers -------------------------------------------
  const { data: progress } = useProgress(metaId);
  const progressById = useMemo(() => progressMap(progress), [progress]);
  const seasons = useMemo(() => (meta ? seasonsOf(meta) : []), [meta]);
  const [pickSeason, setPickSeason] = useState<number>();
  const shownSeason = pickSeason ?? current?.season ?? seasons[0];
  // Side by side or a list: the same choice as the title page's switch (#226).
  const [episodeLayout, setEpisodeLayout] = useEpisodeLayout();
  const layoutSwitch = (
    <Segmented
      label="Episode layout"
      value={episodeLayout}
      onChange={setEpisodeLayout}
      options={[
        { id: "row", label: "Row", icon: <LayoutRow size={18} /> },
        { id: "list", label: "List", icon: <LayoutList size={18} /> },
      ]}
    />
  );
  // Only fetched once the Sources picker is opened (and usually cached already).
  const streams = useStreams(type, options === "sources" ? videoId : undefined);

  const episodeItems = useMemo<OptionItem[]>(
    () =>
      (meta?.videos ?? [])
        .filter((v) => v.season === shownSeason)
        .map((v) => {
          const p = progressById.get(v.id);
          const { released, openable, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
          return {
            id: v.id,
            label: `${v.episode}. ${v.title}`,
            detail: released && inProgress && p ? formatRemaining(p.position, p.duration) : airLabel(v),
            thumbnail: stillFor(v.id) ?? v.thumbnail ?? "",
            progress: watched ? undefined : fraction,
            badge: watched ? { text: "Watched" } : undefined,
            disabled: !openable,
          };
        }),
    [meta, shownSeason, progressById],
  );
  // A file on this device (#242): the other videos in its folder, in order, with how long each is and
  // where it stopped as Recent files has them. The paths stay on this device (lib/localFiles).
  const { data: recentFiles } = useRecentFiles();
  const folderItems = useMemo<OptionItem[]>(() => {
    if (!local) return [];
    const recent = new Map((recentFiles ?? []).map((r) => [fileId(r.path), r]));
    return (meta?.videos ?? []).map((v) => {
      const { length, stopped } = filePlace(recent.get(v.id));
      return {
        id: v.id,
        label: v.title,
        detail: length === undefined ? undefined : stopped === undefined ? formatTime(length) : formatRemaining(stopped, length),
        progress: length && stopped !== undefined ? stopped / length : undefined,
      };
    });
  }, [local, meta, recentFiles]);

  const rankedStreams = useMemo(() => streams.data?.streams ?? [], [streams.data]);
  const currentKey = source.state.status === "ready" ? streamKey(source.state) : undefined;
  // A finished download of this video is listed first (#23): back to it after trying another source.
  const { data: downloads } = useDownloads();
  const downloaded = useMemo(() => downloadedStream(downloads, videoId), [downloads, videoId]);
  // Filter (add-on, resolution, language, size, tags) and sort, as on the
  // title page. Ids stay the index into the ranked list, so selection works
  // regardless of the view. Kept for this show while the player stays open,
  // through picking a source or moving to another episode (each rebuilds it).
  const sourceFilters = useSourceFilters(streams.data?.streams, settings, metaId, runtimeSeconds(meta?.runtime), airedAt(meta, videoId));
  const hiddenSources = streams.data?.hidden ?? 0;
  // The first few sources get a look ahead of time while the panel is open (#21).
  const readiness = useReadiness(
    sourceFilters.view.slice(0, Math.min(sourceFilters.matched, READY_CHECKS)).map(({ r }) => r),
    options === "sources",
  );
  // A source's "i" panel (#229); on TV, the row's menu that leads to it. The playing source adds what the player reports.
  const sourceInfo = useSourceInfo(tv);
  const [sourceMenu, setSourceMenu] = useState<{ r: RankedStream; anchor: HTMLElement } | null>(null);
  const showSourceInfoRef = useRef<(r: RankedStream, anchor: HTMLElement) => void>(() => {});
  showSourceInfoRef.current = (r, anchor) => {
    const playing = currentKey !== undefined && streamKey(r) === currentKey;
    void (playing ? playingReport(media) : Promise.resolve(undefined)).then((report) =>
      sourceInfo.show(
        r,
        sourceRow(r).title,
        { filter: sourceFilters.filter, sort: sourceFilters.sort, match: sourceFilters.match(r), playing: report },
        anchor,
      ),
    );
  };
  const sourceItems = useMemo<OptionItem[]>(() => {
    const rank = new Map(rankedStreams.map((r, i) => [r, i]));
    return sourceFilters.view.map(({ r, match }, n) => {
      const row = sourceRow(r);
      const ready = readiness.get(streamKey(r));
      const note = ready && readinessNote(ready);
      return {
        id: String(rank.get(r) ?? -1),
        label: n === 0 && match && !r.otherEpisode && sourceFilters.sort === "best" ? `${row.title} · Best Match` : row.title,
        // Filters that only order the list: what doesn't match follows under its own heading.
        heading:
          n === sourceFilters.otherEpisodes ? "Other episodes" : n === sourceFilters.matched && n < sourceFilters.otherEpisodes ? "Other sources" : undefined,
        detail: [note?.short, row.size, r.otherEpisode ? r.fileEpisode : null, row.detail].filter(Boolean).join(" · "),
        badge: r.quality.lowQualitySource ? { text: "CAM", tone: "bad" as const } : undefined,
        ready: ready?.state === "ready" ? "yes" : ready?.state === "notReady" ? "no" : undefined,
        note: note?.long,
        onInfo: (anchor: HTMLElement) => showSourceInfoRef.current(r, anchor),
        onMenu: tv ? (anchor: HTMLElement) => setSourceMenu({ r, anchor }) : undefined,
      };
      });
  }, [rankedStreams, sourceFilters.view, sourceFilters.matched, sourceFilters.otherEpisodes, sourceFilters.sort, readiness, tv]);
  const sourceOptions = useMemo<OptionItem[]>(
    () =>
      downloaded
        ? [
            { id: DOWNLOADED, label: "Downloaded copy", detail: [downloaded.title, "On this device"].filter(Boolean).join(" · "), badge: { text: "Downloaded", tone: "good" } },
            ...sourceItems,
          ]
        : sourceItems,
    [downloaded, sourceItems],
  );
  const currentSourceIndex = useMemo(() => rankedStreams.findIndex((r) => streamKey(r) === currentKey), [rankedStreams, currentKey]);
  const currentSource = downloaded && currentKey === downloaded.url ? DOWNLOADED : currentSourceIndex >= 0 ? String(currentSourceIndex) : undefined;

  // --- Keyboard: instant, never animated -------------------------------------
  // A panel opened from a key (or a pad button) is there at once; a click keeps the frosted materialize.
  const [optionsByKey, setOptionsByKey] = useState(false);
  useEffect(() => {
    if (!options) setOptionsByKey(false);
  }, [options]);
  const toggleOptions = (o: NonNullable<typeof options>) => {
    setOptionsByKey(true);
    setOptions((open) => (open === o ? null : o));
  };
  // A tap on Speed: on iOS the system's menu from the button (nativeMenus.ts), elsewhere the picker. Every other
  // button, Subtitles & Audio included (#465), opens the app's own panel everywhere.
  const openOptions = (o: NonNullable<typeof options>, from: Element) => {
    if (!nativeDialogsAvailable || o !== "speed") return setOptions(o);
    setNativeMenu(true);
    showNativeDialog({ ...speedMenu(SPEEDS, rate), anchor: anchorOf(from) })
      .then((id) => {
        const r = pickedSpeed(id);
        if (r != null && r !== rate) setRate(r);
      })
      .catch(warnFailed("menu"))
      .finally(() => setNativeMenu(false));
  };
  // The page underneath has the keyboard already while the player fades out; the torrent notice has it while it's up.
  const torrentNotice = source.state.status === "notice";
  usePlayerKeyboard(
    !leaving && !torrentNotice,
    (action) => {
      switch (action) {
        case "playPause":
          togglePlay();
          return true;
        case "seekBack":
          seekBy(-seekStep);
          kick("back");
          return true;
        case "seekForward":
          seekBy(seekStep);
          kick("forward");
          return true;
        case "frameBack":
        case "frameForward":
          if (!isDesktop || !started || ytId) return false;
          stepper.step(action === "frameBack" ? -1 : 1);
          return true;
        case "volumeUp":
          // Where the system sets the volume, its keys are the system's.
          if (systemVolume) return false;
          setVolume((v) => Math.min(1, +(v + 0.1).toFixed(2)));
          pingVolume("up");
          setMuted(false);
          return true;
        case "volumeDown":
          if (systemVolume) return false;
          setVolume((v) => Math.max(0, +(v - 0.1).toFixed(2)));
          pingVolume("down");
          return true;
        case "mute":
          setMuted((m) => !m);
          pingVolume("mute");
          return true;
        case "fullscreen":
          void toggleFullscreen();
          return true;
        case "pinWindow":
          if (!canPin) return false;
          togglePin();
          return true;
        case "fill":
          if (ytFramed) return false;
          cycleCrop();
          return true;
        case "skip":
          skip.skipActive();
          return true;
        case "nextEpisode":
          if (next) playVideo(next.id);
          return true;
        case "sources":
          if (link || local) return false;
          toggleOptions(action);
          return true;
        case "tracks":
        case "speed":
          // YouTube's player has them in its own controls, and nothing may open over it (#384). A remote
          // can't reach those: TV mode has its own menus, beside the player (#434).
          if (ytFramed && !tv) {
            flashNotice(action === "tracks" ? YT_CAPTIONS : YT_SPEED, 4000);
            return true;
          }
          toggleOptions(action);
          return true;
        case "episodes":
          if (type !== "series") return false;
          toggleOptions(action);
          return true;
        case "escape":
          if (tv) {
            void exit();
            return true;
          }
          // Leave fullscreen first; a second Esc backs out of the player.
          void win.isFullscreen().then((fs) => {
            if (fs) {
              void win.setFullscreen(false);
              setFullscreen(false);
            } else {
              void exit();
            }
          });
          return true;
      }
      return false;
    },
    // TV: volume keys show only the volume HUD, not the whole player.
    (action) => {
      // YouTube's bar comes back for any of them (#384): there's no HUD or skip button over its player.
      if (tv && !ytFramed && (action === "volumeUp" || action === "volumeDown" || action === "mute")) return;
      // A seek with the controls hidden shows just its skip button and the "+10" (SkipTransport), not the controls.
      if (!chromeVisible && !ytFramed && (action === "seekBack" || action === "seekForward")) return;
      poke(true, `key (${action})`);
    },
    // Any other key brings the controls back too, with the focus ring where the keyboard left it (#329).
    () => poke(true, "key"),
  );

  // Warm the next episode's sources well before the credits.
  const prefetchedNext = useRef(false);
  const pastThreeQuarters = useMediaTime(media, (t) => t.duration > 0 && t.current / t.duration > 0.75);
  useEffect(() => {
    if (next && !prefetchedNext.current && pastThreeQuarters) {
      prefetchedNext.current = true;
      prefetchStreams(type, next.id);
    }
  }, [next, pastThreeQuarters, type]);

  // Autoplay countdown once the episode ends, unless it's time to ask
  // whether anyone's still watching (Settings → Playback).
  const askAfter = settings?.stillWatchingAfter ?? 0;
  const stillWatching = askAfter > 0 && autoplayStreak() >= askAfter;
  const willAutoplay = !!settings?.autoplayNext && !stillWatching;
  useEffect(() => {
    if (!ended || !next || nextDismissed || !willAutoplay) return;
    const t = window.setTimeout(() => {
      countAutoplay();
      playVideo(next.id);
    }, countdown * 1000);
    return () => window.clearTimeout(t);
  }, [ended, next, nextDismissed, willAutoplay, countdown, playVideo]);

  // With IntroDB credit timings, "Up next" arrives exactly when the credits
  // roll (Netflix-style); without them, fall back to the last ~40s. Settings
  // can hold it back until the very end instead.
  const creditsStart = skip.segments?.outro?.start;
  const postCredits = !!skip.segments?.postCredits;
  const atEnd = settings?.nextUpTiming === "end";
  const nearEnd = useMediaTime(media, (t) => {
    if (!(t.duration > 0)) return "unknown";
    const remaining = t.duration - t.current;
    const inCredits = creditsStart != null && t.current >= creditsStart && !postCredits;
    return (atEnd ? remaining <= NEXT_UP_AT_END : inCredits || (creditsStart == null && remaining <= Math.max(40, t.duration * 0.04))) ? "yes" : "no";
  });
  const showNextUp = !!next && !nextDismissed && nearEnd !== "unknown" && (ended || nearEnd === "yes");
  // What Best Match learns from this try (#230): how long it took to start, whether it played through, and
  // what the connection carried (links only: not a file here or the torrent engine's own link on this machine).
  useSourceRecord(source.kind, source.state.status === "resolving", started, ended || nearEnd === "yes");
  const remoteLink = !!playingUrl && /^https?:\/\//i.test(playingUrl.url) && !/^https?:\/\/(127\.|localhost[:/]|\[::1\])/i.test(playingUrl.url);
  useThroughput(media, started && !paused, remoteLink);

  const cycleClock = () =>
    updateSettings.mutate({ timeDisplay: TIME_DISPLAYS[(TIME_DISPLAYS.indexOf(timeDisplay) + 1) % TIME_DISPLAYS.length] });

  const VolumeIcon = muted || volume === 0 ? VolumeMuted : Volume;

  // A narrow window (#396): the bars give way in steps (useBarFit). Pin and fill are the top controls "More" takes.
  const topBar = useRef<HTMLDivElement>(null);
  const actionRow = useRef<HTMLDivElement>(null);
  const showPin = canPin && !fullscreen;
  const showFill = !tv && isDesktop;
  const barFit = useBarFit(
    topBar,
    actionRow,
    Number(showPin) + Number(showFill),
    !tv && form !== "phone" && !compact,
    [heading, title, rate, party?.members.length, next?.id, airplay.available, showPin, showFill, fullscreen, canParty, ytId, link, local].join("|"),
    !!watchLog,
  );
  const more = barFit.more;
  // Folded, the slider opens below the volume icon: on hover or focus, and on a touch screen from a tap on the icon.
  const [volumeOpen, setVolumeOpen] = useState(false);
  const sliderFolded = !barFit.slider && !systemVolume;
  useEffect(() => {
    if (!chromeVisible || !sliderFolded) setVolumeOpen(false);
  }, [chromeVisible, sliderFolded]);

  // The Watch Party panel: over the picture, or beside YouTube's player (#384).
  const partyColumns: OptionColumn[] = canParty
    ? [
        ...(party
          ? [
              {
                title: "Watch Party",
                size: "medium" as const,
                options: [],
                onSelect: () => {},
                // Focus comes to Copy Invite when the party starts: what it replaces is gone (#247).
                content: <PartyRoomPane party={party} onGo={() => setOptions(null)} autoFocus />,
              },
              {
                title: "Settings",
                size: "medium" as const,
                options: [],
                onSelect: () => {},
                // TV mode: no pasting on a remote; links others put on still play there.
                content: (
                  <PartySettingsPane party={party} link={tv ? undefined : <LinkForm me={profile!} onDone={() => setOptions(null)} />} />
                ),
              },
            ]
          : [{ title: "Watch Party", size: "medium" as const, options: [], onSelect: () => {}, content: <PartyStart me={profile!} onStart={local ? undefined : startHere} /> }]),
        // Not in a party yet: a link can start one. TV mode: no pasting on a remote.
        ...(party || tv
          ? []
          : [
              {
                title: "Watch a Link",
                size: "medium" as const,
                options: [],
                onSelect: () => {},
                content: (
                  <div className="party-pane">
                    <p className="party-lede">
                      Start a party on a YouTube video, or a video file or stream from the web. Everyone's app opens the link itself, after seeing it.
                    </p>
                    <LinkForm me={profile!} onDone={() => setOptions(null)} />
                  </div>
                ),
              },
            ]),
      ]
    : [];

  // A YouTube video in the app (#384): YouTube's player with its own controls, a bar above it and the party panel
  // beside it. Nothing of ours is drawn over the frame; the loading screen only until YouTube's player is up.
  if (ytFramed) {
    // TV's Captions and Speed menus (#434), beside the player as the party's panel is.
    const ytMenu = tv && (options === "tracks" || options === "speed") ? options : null;
    const ytSpeeds = speedChoices(ytSpeed.speeds, SPEEDS);
    const ytMenuColumns: OptionColumn[] =
      ytMenu === "tracks"
        ? [
            // What stays in YouTube's player, above the long list where it's seen.
            { title: "What stays in YouTube's player", titleHidden: true, size: "medium", options: [], onSelect: () => {}, content: <p className="party-lede">{CAPTIONS_NOTE}</p> },
            {
              title: "Captions",
              value: ytEmbed.captions ?? CAPTIONS_OFF,
              options: captionChoices(settings?.subtitleLanguage),
              onSelect: (id) => {
                const captions = id === CAPTIONS_OFF ? null : id;
                if (captions === ytEmbed.captions) return;
                // The embed loads again with the new parameters, and goes on where it was.
                const autoplay = !yt.paused;
                yt.reload();
                setYtEmbed({ captions, autoplay });
              },
            },
          ]
        : [
            {
              title: "Playback Speed",
              value: String(ytSpeed.rate),
              options: party || ytSpeeds.length < 2 ? [] : ytSpeeds.map((r) => ({ id: String(r), label: speedLabel(r) })),
              empty: party ? SPEED_PARTY_NOTE : SPEED_ONE_NOTE,
              onSelect: (id) => setRate(Number(id)),
            },
          ];
    const latestNote = party?.notes.at(-1);
    const message =
      notice ??
      partyHold ??
      (latestNote ? (latestNote.system || !latestNote.who ? latestNote.text : `${latestNote.who.name} ${latestNote.text}`) : null);
    // Out until it plays; then it collapses to a strip along the top edge, and the pointer there, a key or a message brings it back.
    const barShown = !ytPlayed || chrome.visible || options === "party" || !!ytMenu || !!message;
    const failed = !ready && (!!error || source.state.status === "failed");
    return (
      <div
        className="player player-yt"
        data-engine="youtube"
        data-chrome={barShown}
        data-key-focus={keyFocus || undefined}
        data-options={options === "party" || !!ytMenu}
        data-started={started}
        data-buffering={frameSteps.spinner && ready}
        onPointerMove={() => poke()}
        onPointerDown={() => poke()}
      >
        <div className="player-yt-main">
          <div
            className="player-yt-bar"
            data-shown={barShown}
            data-tauri-drag-region={pinned ? undefined : true}
            onPointerEnter={() => (overControls.current = true)}
            onPointerLeave={() => (overControls.current = false)}
          >
            <BackButton className="player-back" onClick={() => void exit()} />
            <p className="player-yt-message t-callout" role="status" aria-live="polite" data-tauri-drag-region={pinned ? undefined : true}>
              {message}
            </p>
            {/* A remote reaches these, not YouTube's own controls (#434). */}
            {tv && (
              <>
                <IconButton variant="player" label="Captions" title="Captions" aria-pressed={ytMenu === "tracks"} onClick={() => toggleOptions("tracks")}>
                  <Captions size={22} />
                </IconButton>
                {!party && (
                  <IconButton variant="player" label={`Speed (${ytSpeed.rate}x)`} title="Speed" aria-pressed={ytMenu === "speed"} onClick={() => toggleOptions("speed")}>
                    <Speed size={22} />
                  </IconButton>
                )}
              </>
            )}
            {party && <PartyBadge party={party} onOpen={() => setOptions((o) => (o === "party" ? null : "party"))} />}
            {!fullscreen && !tv && <WindowControls pinned={pinned} />}
          </div>
          <iframe
            ref={setYtFrame}
            className="player-youtube"
            data-hidden={failed || undefined}
            src={youtubeEmbed(ytId, { api: true, ...ytEmbed })}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            // It runs its own page and nothing more: no popups, no taking the app's window elsewhere.
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <AnimatePresence>
            {!(ready && (started || ytShown)) && (
              <PlayerStatus
                key="status"
                state={source.state}
                error={error}
                name={title}
                steps={steps}
                backend="YouTube's embedded player"
                onSettings={openSettingsPage}
                onRetry={source.retry}
              />
            )}
          </AnimatePresence>
        </div>
        {canParty && <OptionsOverlay beside open={options === "party"} onClose={() => setOptions(null)} media={media} columns={partyColumns} />}
        {tv && <OptionsOverlay beside open={!!ytMenu} onClose={() => setOptions(null)} media={media} columns={ytMenuColumns} />}
      </div>
    );
  }

  return (
    <div
      className="player"
      data-engine={engine ?? undefined}
      data-fill={fill || undefined}
      data-buffering={frameSteps.spinner && ready}
      data-chrome={chromeVisible}
      data-instant={chrome.instant}
      data-key-focus={keyFocus || undefined}
      data-options={!!options}
      data-options-instant={optionsByKey}
      data-started={started}
      onPointerMove={() => poke()}
      onPointerDown={() => poke()}
    >
      {engine === "html" && (
        <video ref={setVideoEl} className="player-video" playsInline style={subtitleCueVars(subStyle)} />
      )}
      {/* Click target over either engine: tap to play/pause, double-click for
          fullscreen (on touch, a side's double-tap seeks), wheel for volume. */}
      <div
        className="player-surface"
        // Respond immediately; double-click adds fullscreen on top. Settings
        // can make a click only show/hide the controls instead; a tap always
        // does, as on every phone player (Play/Pause is in the controls).
        // A pinch out fills the screen and a pinch in fits the picture, as phone players do (#176).
        {...pinch}
        onPointerDown={(e) => {
          chromeAtPress.current = chrome.visible;
          pinch.onPointerDown(e);
        }}
        onClick={() => {
          if (!touch && settings?.clickAction !== "controls") return togglePlay();
          if (chromeAtPress.current) hideChrome("tap");
          else poke(false, "tap");
        }}
        // A finger double-taps the left or right third to skip back or ahead, as phone players do;
        // the middle (and a mouse anywhere) toggles fullscreen.
        onDoubleClick={(e) => {
          const third = e.currentTarget.clientWidth / 3;
          const x = e.nativeEvent.offsetX;
          if (touch && (x < third || x > third * 2)) {
            seekBy((x < third ? -1 : 1) * seekStep);
            kick(x < third ? "back" : "forward");
            return poke(true, "double tap");
          }
          if (!isDesktop) return cycleCrop();
          // Pinned, the window stays as it is (#266).
          if (pinner.pinned) return;
          void toggleFullscreen();
        }}
        onWheel={(e) => {
          const wheel = settings?.wheelAction ?? "volume";
          if (wheel === "none" || (wheel === "volume" && systemVolume)) return;
          if (wheel === "seek") seekBy(-Math.sign(e.deltaY) * seekStep);
          else {
            setVolume((v) => Math.min(1, Math.max(0, +(v - Math.sign(e.deltaY) * 0.05).toFixed(2))));
            setMuted(false);
          }
          poke(true, "wheel");
        }}
      />

      {/* Status: finding / loading / failed */}
      {/* Fades off the first frame instead of cutting to it. */}
      <AnimatePresence>
        {!(ready && started) && (
          <PlayerStatus
            key="status"
            state={source.state}
            error={ytOutside ? "On Android, YouTube videos play in YouTube." : error}
            logo={art.logo}
            logos={art.logos}
            artPending={art.pending}
            name={link ? title : meta?.name}
            background={art.background}
            steps={steps}
            backend={engine === "html" ? "built-in" : engine === "youtube" ? "YouTube's embedded player" : (engine ?? "not chosen yet")}
            onSources={link || local ? undefined : () => setOptions("sources")}
            onSettings={openSettingsPage}
            onRetry={source.retry}
            onYouTube={ytOutside ? () => void api.openExternal(youtubeUrl(ytOutside)) : undefined}
          />
        )}
      </AnimatePresence>

      {torrentNotice && !leaving && (
        <TorrentNotice
          onPlay={() => source.answerNotice(true)}
          onCancel={() => {
            source.answerNotice(false);
            void exit();
          }}
          onSettings={
            tv
              ? undefined
              : () => {
                  source.answerNotice(false);
                  openSettingsPage("sources");
                }
          }
        />
      )}

      {airplay.casting && (
        <div className="player-casting">
          {meta?.background && <Img className="player-status-bg" src={meta.background} alt="" />}
          <div className="player-status-content">
            <Cast size={40} />
            <p className="t-title2">Playing on AirPlay</p>
            <p className="t-callout player-casting-hint">To watch here again, choose this computer in the AirPlay list.</p>
            <Button variant="glass" onClick={airplay.pick}>
              AirPlay
            </Button>
          </div>
        </div>
      )}
      {notice && <div className="player-notice t-callout">{notice}</div>}
      {party && ready && started && <PartyHold party={party} videoId={videoId} />}
      {party && <PartyNotes party={party} />}

      {/* Top: back, what's playing, window-level controls. Drag lives here. */}
      {/* Pinned (#266), nothing moves the window. */}
      <div ref={topBar} className="player-top" data-tauri-drag-region={pinned ? undefined : true}>
        <BackButton className="player-back" onClick={() => void exit()} />
        {/* Between Back and the controls: centred while it fits, off-centre when it would meet them, then cut short (#396). */}
        <div className="player-heading" data-tauri-drag-region={pinned ? undefined : true}>
          <span className="player-heading-title">{heading}</span>
          {current && <span className="player-heading-show">{title}</span>}
        </div>
        <div className="player-top-end">
          <div className="player-top-actions">
            {party && <PartyBadge party={party} onOpen={() => setOptions("party")} />}
            <div className="player-volume" data-folded={sliderFolded || undefined} data-open={volumeOpen || undefined}>
              <IconButton
                variant="player"
                onClick={() => (sliderFolded && touch ? setVolumeOpen((o) => !o) : setMuted((m) => !m))}
                label={sliderFolded && touch ? "Volume" : muted ? "Unmute" : "Mute"}
                aria-expanded={sliderFolded && touch ? volumeOpen : undefined}
                title={withShortcut("Mute", "mute")}
              >
                <VolumeIcon size={22} />
              </IconButton>
              {!systemVolume && (
                <span className="player-volume-slider">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      setVolume(Number(e.target.value));
                      setMuted(false);
                    }}
                    aria-label="Volume"
                    style={{ "--value": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
                  />
                </span>
              )}
            </div>
            {airplay.available && (
              <IconButton variant="player" onClick={airplay.pick} label="AirPlay" title="AirPlay" aria-pressed={airplay.casting}>
                <Cast size={22} />
              </IconButton>
            )}
            {showPin && !more && (
              <IconButton
                variant="player"
                onClick={togglePin}
                label="Pin window"
                aria-pressed={pinned}
                title={withShortcut(pinned ? "Unpin window" : "Pin window on top", "pinWindow")}
              >
                {pinned ? <Pinned size={22} /> : <Pin size={22} />}
              </IconButton>
            )}
            {showFill && !more && (
              <IconButton
                variant="player"
                onClick={cycleCrop}
                label={`Crop: ${cropModeLabel(crop)}`}
                data-crop={crop}
                title={withShortcut(`${cropModeLabel(crop)} (next: ${cropModeLabel(nextCrop)})`, "fill")}
              >
                <FillWindow size={22} />
              </IconButton>
            )}
            {(more || watchLog) && (
              <MenuRoot modal={false} onOpenChange={setMoreOpen}>
                <MenuTrigger className={iconButtonClass("player", "player-more")} aria-label="More" title="More">
                  <More size={22} />
                </MenuTrigger>
                <MenuPopup sideOffset={6} align="end" collisionPadding={12} aria-label="More">
                  {more && showPin && (
                    <MenuCheckItem checked={pinned} onCheckedChange={togglePin} meta={shortcutText("pinWindow")}>
                      Pin window on top
                    </MenuCheckItem>
                  )}
                  {more && showFill && (
                    <MenuCheckItem checked={crop !== "fit"} onCheckedChange={cycleCrop} meta={shortcutText("fill")}>
                      {`Crop: ${cropModeLabel(crop)}`}
                    </MenuCheckItem>
                  )}
                  {watchLog && (
                    <MenuItem
                      onClick={() =>
                        void watchLogText(engine ?? "not chosen yet")
                          .then((text) => navigator.clipboard.writeText(text))
                          .then(
                            () => flashNotice("Watch log copied", 2000),
                            () => flashNotice("Couldn't copy the watch log", 2500),
                          )
                      }
                    >
                      Copy Watch Log
                    </MenuItem>
                  )}
                </MenuPopup>
              </MenuRoot>
            )}
            {!tv && isDesktop && (
              <IconButton variant="player" onClick={() => void toggleFullscreen()} label="Fullscreen" title={withShortcut("Fullscreen", "fullscreen")}>
                {fullscreen ? <ExitFullscreen size={22} /> : <Fullscreen size={22} />}
              </IconButton>
            )}
            {!tv && !isDesktop && (
              <IconButton
                variant="player"
                onClick={cycleCrop}
                label={`Crop: ${cropModeLabel(crop)}`}
                data-crop={crop}
                title={`${cropModeLabel(crop)} (next: ${cropModeLabel(nextCrop)})`}
              >
                {fill ? <ExitFullscreen size={22} /> : <Fullscreen size={22} />}
              </IconButton>
            )}
          </div>
          {!fullscreen && !tv && <WindowControls pinned={pinned} />}
        </div>
      </div>

      {/* Centre transport, Netflix-style: bare glyphs, no button chrome. */}
      {ready && started && (
        <div className="player-center">
          <SkipTransport
            direction="back"
            seconds={seekStep}
            kick={kicks.back}
            onSkip={() => (seekBy(-seekStep), kick("back"))}
            label={`Back ${seekStep} seconds`}
            title={withShortcut(`Back ${seekStep}s`, "seekBack")}
          />
          <IconButton variant="transport" className="player-transport-main" onClick={togglePlay} label={paused ? "Play" : "Pause"} title={withShortcut("Play/Pause", "playPause")}>
            {frameSteps.spinner ? (
              <Spinner className="player-spinner" size={52} label="Buffering" />
            ) : paused ? (
              <Play size={64} fill="currentColor" strokeWidth={0} />
            ) : (
              <Pause size={64} fill="currentColor" strokeWidth={0} />
            )}
          </IconButton>
          <SkipTransport
            direction="forward"
            seconds={seekStep}
            kick={kicks.forward}
            onSkip={() => (seekBy(seekStep), kick("forward"))}
            label={`Forward ${seekStep} seconds`}
            title={withShortcut(`Forward ${seekStep}s`, "seekForward")}
          />
        </div>
      )}

      {/* Paused on a stepped frame: once the controls hide, its number stays where the clock was (#346). */}
      {frameSteps.stepping && <FrameLabel media={media} fps={fps ?? DEFAULT_FPS} />}

      {/* Bottom: timeline with time left, then labelled text actions. */}
      <div
        className="player-bottom"
        onPointerEnter={() => (overControls.current = true)}
        onPointerLeave={() => (overControls.current = false)}
      >
        <div className="player-timeline">
          <Scrubber media={media} previews={seekTrack} span={skip.segments?.intro} onSeek={seekTo} />
          <PlayerClock media={media} display={timeDisplay} rate={rate} onCycle={cycleClock} fps={frameSteps.stepping ? (fps ?? DEFAULT_FPS) : null} />
        </div>
        <div ref={actionRow} className="player-actions" data-labels={barFit.labels}>
          {!party && (
            <ActionButton icon={<Speed size={22} />} label={`Speed (${rate}x)`} glyph={pad("speed")} onClick={(el) => openOptions("speed", el)} />
          )}
          {type === "series" && (
            <ActionButton icon={<Episodes size={22} />} label={local ? "In this folder" : "Episodes"} glyph={pad("episodes")} onClick={() => setOptions("episodes")} />
          )}
          {/* YouTube's player keeps its own captions and audio. */}
          {!ytId && <ActionButton icon={<Captions size={22} />} label="Subtitles & Audio" glyph={pad("tracks")} onClick={(el) => openOptions("tracks", el)} />}
          {!link && !local && <ActionButton icon={<Sources size={22} />} label="Sources" glyph={pad("sources")} onClick={() => setOptions("sources")} />}
          {canParty && !airplay.casting && (
            <ActionButton
              icon={<WatchParty size={22} />}
              label={party ? `Watch Party (${party.members.length})` : "Watch Party"}
              onClick={() => setOptions("party")}
            />
          )}
          {next && (
            <ActionButton
              icon={<SkipForward size={22} fill="currentColor" />}
              label={local ? "Next video" : "Next Episode"}
              glyph={skip.active ? null : pad("skipOrNext", "nextEpisode")}
              onClick={() => playVideo(next.id)}
            />
          )}
        </div>
      </div>

      <OptionsOverlay
        open={options === "speed"}
        onClose={() => setOptions(null)}
        media={media}
        columns={[
          {
            title: "Playback Speed",
            value: String(rate),
            options: SPEEDS.map((r) => ({ id: String(r), label: speedLabel(r) })),
            onSelect: (id: string) => setRate(Number(id)),
          },
          // Desktop: keep the window on top of the others, locked in place (#266).
          ...(canPin
            ? [
                {
                  title: "Window",
                  value: pinned ? "pinned" : "normal",
                  options: [
                    { id: "normal", label: "Normal" },
                    { id: "pinned", label: "Pinned on top" },
                  ],
                  onSelect: (id: string) => {
                    if ((id === "pinned") !== pinner.pinned) togglePin();
                  },
                },
              ]
            : []),
        ]}
      />
      <OptionsOverlay
        open={options === "tracks"}
        onClose={() => {
          setOptions(null);
          setSubSettingsOpen(false);
        }}
        foreground={subSettingsOpen ? <SubtitlePreview style={subStyle} media={media} /> : undefined}
        media={media}
        columns={[
          {
            title: "Audio",
            value: tracks.audio.length ? tracks.audioId : "default",
            options: tracks.audio.length ? tracks.audio : [{ id: "default", label: "Default" }],
            onSelect: tracks.selectAudio,
          },
          {
            title: "Subtitles",
            size: subSettingsOpen ? "medium" : "narrow",
            header: (
              <IconButton
                variant="panel"
                aria-pressed={subSettingsOpen}
                label="Subtitle settings"
                title="Subtitle settings"
                onClick={() => setSubSettingsOpen((v) => !v)}
              >
                <Cog size={19} strokeWidth={2.1} />
              </IconButton>
            ),
            content: subSettingsOpen ? (
              <SubtitleSettings
                style={subStyle}
                onChange={(patch) => updateSettings.mutate({ subtitleStyle: { ...subStyle, ...patch } })}
                delay={subDelay}
                onDelay={changeSubDelay}
                canPosition={engine === "mpv"}
              />
            ) : undefined,
            value: tracks.subId,
            options: tracks.subtitles,
            onSelect: (id) => void tracks.selectSubtitle(id),
            empty: tracks.subtitlesLoading ? "Loading…" : undefined,
          },
        ]}
      />

      {tv && <VolumeHud volume={volume} muted={muted} ping={volumePing} media={media} />}

      <SkipButton
        active={started ? skip.active : null}
        onSkip={skip.skipActive}
        chromeVisible={chromeVisible}
        countdown={skip.countdown}
        paused={paused}
        onCountdownEnd={skip.finishCountdown}
        glyph={showNextUp ? null : pad("skipOrNext", "nextEpisode")}
      />

      <AnimatePresence>
        {showNextUp && next && (
          <motion.div
            className="next-up"
            initial={{ opacity: 0, transform: "translateX(24px)" }}
            animate={{ opacity: 1, transform: "translateX(0px)" }}
            // Arrives at drawer pace; leaves faster — a dismissal shouldn't linger.
            exit={{ opacity: 0, transform: "translateX(24px)", transition: { duration: 0.18, ease: ease.out } }}
            transition={{ duration: 0.3, ease: ease.drawer }}
          >
            <div className="next-up-still">
              <Img src={stillFor(next.id) ?? next.thumbnail ?? meta?.background} alt="" />
            </div>
            <div className="next-up-text">
              <span className="next-up-kicker">
                {ended && stillWatching ? "Are you still watching?" : local ? "Up Next" : `Up Next · ${episodeCode(next.season, next.episode)}`}
              </span>
              {skipped.length > 0 && !(ended && stillWatching) && (
                <span className="next-up-skipping">
                  Skipping filler: {skipped.length === 1 ? `episode ${skipped[0].episode}` : `episodes ${skipped[0].episode}–${skipped[skipped.length - 1].episode}`}
                </span>
              )}
              <span className="next-up-title">{next.title}</span>
              <div className="next-up-actions">
                <Button
                  variant="primary"
                  className="next-up-play"
                  onClick={() => {
                    resetAutoplay();
                    playVideo(next.id);
                  }}
                >
                  {ended && willAutoplay && (
                    <span className="next-up-countdown" style={{ animationDuration: `${countdown}s` }} />
                  )}
                  {pad("skipOrNext", "nextEpisode") ?? <Play size={16} fill="currentColor" />} {ended && stillWatching ? "Keep Watching" : "Play Now"}
                </Button>
                <IconButton variant="glass" className="next-up-dismiss" onClick={() => setNextDismissed(true)} label="Dismiss">
                  <Close size={16} />
                </IconButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {canParty && (
        <OptionsOverlay
          open={options === "party"}
          onClose={() => setOptions(null)}
          media={media}
          columns={partyColumns}
        />
      )}

      <OptionsOverlay
        open={options === "episodes"}
        onClose={() => setOptions(null)}
        media={media}
        columns={
          local
            ? [
                {
                  title: "In this folder",
                  size: "wide",
                  value: videoId,
                  options: folderItems,
                  onSelect: (id) => {
                    if (id === videoId) return;
                    setOptions(null);
                    playVideo(id);
                  },
                },
              ]
            : episodeLayout === "list" || !meta
            ? [
                {
                  title: "Seasons",
                  value: String(shownSeason),
                  options: seasons.map((n) => ({ id: String(n), label: seasonLabel(n) })),
                  onSelect: (id) => setPickSeason(Number(id)), // browse; playback continues
                },
                {
                  title: "Episodes",
                  size: "wide",
                  header: meta && layoutSwitch,
                  value: videoId,
                  options: episodeItems,
                  onSelect: (id) => id !== videoId && playVideo(id),
                },
              ]
            : // The season to browse in a dropdown, its episodes side by side under it.
              [
                {
                  title: "Episodes",
                  size: "full",
                  titleHidden: true,
                  header: (
                    <div className="episode-rail-head">
                      <Dropdown
                        label="Season"
                        size="large"
                        value={String(shownSeason)}
                        onChange={(id) => setPickSeason(Number(id))} // browse; playback continues
                        options={seasons.map((n) => ({ value: String(n), label: seasonLabel(n) }))}
                      />
                      {layoutSwitch}
                    </div>
                  ),
                  options: [],
                  onSelect: () => {},
                  content: (
                    <EpisodeRail
                      meta={meta}
                      episodes={meta.videos.filter((v) => v.season === shownSeason)}
                      playing={videoId}
                      progress={progressById}
                      still={(v) => stillFor(v.id) ?? v.thumbnail}
                      onPlay={(id) => {
                        setOptions(null);
                        playVideo(id);
                      }}
                    />
                  ),
                },
              ]
        }
      />
      <OptionsOverlay
        open={options === "sources"}
        onClose={() => setOptions(null)}
        media={media}
        columns={[
          {
            title: "Sources",
            size: "wide",
            header: (
              <div className="source-controls">
                <SourceFilterBar
                  f={sourceFilters}
                  tv={tv}
                  note={hiddenSources > 0 ? `${hiddenSources} more hidden by Settings → Sources` : undefined}
                />
              </div>
            ),
            value: currentSource,
            options: sourceOptions,
            empty: streams.isLoading
              ? "Finding sources…"
              : streams.isError
                ? "Couldn't load sources."
                : sourceFilters.total > 0
                  ? "No sources match these filters."
                  : hiddenSources > 0
                    ? `All ${hiddenSources} sources are hidden by your filters in Settings → Sources.`
                    : "No sources found.",
            onSelect: (id) => {
              if (id === currentSource) return;
              if (id === DOWNLOADED) return downloaded && playVideo(videoId, downloaded);
              const pick = rankedStreams[Number(id)];
              if (pick) playVideo(videoId, pick.stream);
            },
          },
        ]}
      />
      {sourceMenu && (
        <TvSourceMenu
          anchor={sourceMenu.anchor}
          onClose={() => {
            setSourceMenu(null);
            sourceMenu.anchor.focus({ preventScroll: true });
          }}
          onInfo={() => {
            setSourceMenu(null);
            showSourceInfoRef.current(sourceMenu.r, sourceMenu.anchor);
          }}
          onPlay={() => {
            setSourceMenu(null);
            if (streamKey(sourceMenu.r) !== currentKey) playVideo(videoId, sourceMenu.r.stream);
          }}
        />
      )}
      {sourceInfo.panel}
    </div>
  );
}

/** The Sources row of this video's finished download (#23); the others are indexes into the ranked list. */
const DOWNLOADED = "downloaded";

function ActionButton({
  icon,
  label,
  glyph,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** The controller button that does the same (TV mode with a controller). */
  glyph?: React.ReactNode;
  /** Gets the button, for a menu that opens from it. */
  onClick: (el: HTMLButtonElement) => void;
}) {
  return (
    // Named by its label even where the label isn't drawn (a phone held upright shows the glyphs alone).
    <button className="player-action pressable" onClick={(e) => onClick(e.currentTarget)} aria-label={label} title={label}>
      {icon}
      <span aria-hidden>{label}</span>
      {glyph}
    </button>
  );
}

/** Whether "Window pinned, press P to unpin" (#266) has been shown on this device. */
const PIN_HINT = "polar.pinHint";
function pinHintSeen() {
  try {
    return !!localStorage.getItem(PIN_HINT);
  } catch {
    return false;
  }
}

/**
 * Android phones and tablets (#179): their volume buttons and the system's volume panel set the
 * volume, so the player has no slider and plays at full volume itself (a level set before can't
 * be left stuck low with nothing to raise it). Android TV keeps the remote's volume HUD.
 */
const systemVolume = os === "android" && !isTvDevice;

/** The volume last set, 0–1 (1 when none was, or it isn't a number; always 1 where the system sets it). */
function savedVolume() {
  if (systemVolume) return 1;
  const v = Number(localStorage.getItem("polar.volume") ?? 1);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/** `value` once it has stayed the same for `ms`, else null: a blip never shows. */
function useLasting<T>(value: T | null, ms: number): T | null {
  const [lasting, setLasting] = useState<T | null>(null);
  useEffect(() => {
    if (value == null) return setLasting(null);
    const t = window.setTimeout(() => setLasting(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return value == null ? null : lasting === value ? lasting : null;
}

/** A short message over the player (a source skipped, an intro skipped) that clears itself. */
function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  const flash = useCallback((text: string, ms: number) => {
    window.clearTimeout(timer.current);
    setNotice(text);
    timer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [notice, flash] as const;
}
