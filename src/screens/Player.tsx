import "../styles/player.css";
import { useQuery } from "@tanstack/react-query";
import {
  Captions,
  Cast,
  Close,
  Episodes,
  ExitFullscreen,
  CropBars,
  CropFill,
  CropFit,
  LayoutList,
  LayoutRow,
  Fullscreen,
  Pause,
  Play,
  Reset,
  Settings as Cog,
  Shuffle,
  SkipForward,
  Sources,
  Speed,
  Tv,
  Volume,
  VolumeMuted,
} from "../components/icons";
import { AnimatePresence, motion } from "motion/react";
import { ease, useDismiss, useFormFactor, useLayer } from "../lib/ui";
import { anchorOf, appWindow, canEmbedOtherSites, isDesktop, isMac, isTvDevice, keepScreenOn, nativeDialogsAvailable, os, setImmersive, showNativeDialog } from "../lib/platform";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BackButton } from "../components/BackButton";
import { Img } from "../components/Img";
import { Spinner } from "../components/Spinner";
import { SwapIcon } from "../components/SwapIcon";
import { streamKey } from "../components/StreamList";
import { SourceFilterBar } from "../components/SourceFilters";
import { TvSourceMenu, useSourceInfo } from "../components/SourceInfo";
import { playingReport } from "../components/player/playingReport";
import {
  airedAt,
  autoPickOrder,
  autoplayStreak,
  warmLinks,
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
  MAX_VOLUMES,
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
  resumeFrom,
  startPosition,
} from "../lib/playback";
import { downloadedStream, episodeState, isLocalFile, nextVideo, previousVideo, progressMap, seasonsOf, useDownloads, watchedFraction } from "../lib/library";
import { nextInOrder, previousInOrder, shelfGroupOf, shelfGroups, useEpisodeOrders } from "../lib/library";
import { WindowControls } from "../components/WindowControls";
import { Scrubber } from "../components/player/Scrubber";
import { VideoBackdrop } from "../components/player/VideoBackdrop";
import { useSource } from "../components/player/useSource";
import { useSourceRecord, useThroughput } from "../components/player/useSourceRecord";
import { SkipButton, useSkipSegments } from "../components/player/SkipSegments";
import { OptionsOverlay, type OptionColumn, type OptionItem } from "../components/player/OptionsOverlay";
import { VolumeHud, type VolumePing } from "../components/player/VolumeHud";
import { EpisodeRail } from "../components/player/EpisodeRail";
import { EpisodeMenu } from "../components/player/EpisodeMenu";
import { SpeedLine } from "../components/player/SpeedLine";
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
  subtitleCueVars,
} from "../components/player/SubtitleSettings";
import { AudioSettings } from "../components/player/AudioSettings";
import { isMpv, MpvMedia, type MediaLike, type StepDetail } from "../components/player/mpvMedia";
import { createFrameStepper, DEFAULT_FPS, measureFps, stepFrame } from "../components/player/frameStep";
import { useStepping } from "../components/player/useStepping";
import { createWindowPin } from "../components/player/windowPin";
import { createMiniWindow } from "../components/player/miniWindow";
import { YouTubeMedia } from "../components/player/youtubeMedia";
import { useYouTubeSpeed } from "../components/player/useYouTubeSpeed";
import { useHoldSpeed } from "../components/player/useHoldSpeed";
import { useDockZoom } from "../components/player/useDockZoom";
import { useSwipeLevels } from "../components/player/useSwipeLevels";
import { useScreenBrightness } from "../components/player/useScreenBrightness";
import { BrightnessHud } from "../components/player/BrightnessHud";
import { TouchLockLayer, useTouchLock } from "../components/player/TouchLock";
import { Lock } from "../components/icons";
import { usePlayingFormat } from "../components/player/usePlayingFormat";
import { useMediaSession } from "../components/player/useMediaSession";
import { useChromecast } from "../components/player/useChromecast";
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
import { airLabel, episodeCode, formatRemaining, formatTime, runtimeSeconds } from "../lib/format";
import { cachedStreams, keys, prefetchStreams, useMeta, useProgress, useStreams, useUpdateSettings } from "../lib/net";
import { useNavigation } from "../lib/router";
import type { ContentType, Meta, Progress, RankedStream, Stream, Video } from "../lib/types";
import { playContext, stillFor } from "../lib/anime";
import { useMpvTune } from "../components/player/useMpvTune";
import { useTvMode } from "../tv/tvMode";
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
import { watchPage } from "../lib/deepLink";
import { setWatching } from "../lib/friends";
import { usePartySync } from "../components/player/usePartySync";
import { useDiscordPresence } from "../components/player/useDiscordPresence";
import { useNowPlaying } from "../components/player/useNowPlaying";
import { LinkForm, PartyBadge, PartyHold, partyHoldText, PartyNotes, PartyStart } from "../components/party/PartyUI";
import { PartyRoomPane, PartySettingsPane } from "../components/party/PartyMenu";
import { Moon, More, Pin, Pinned, WatchParty } from "../components/icons";
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
import { useSleepTimer } from "../components/player/useSleepTimer";
import { SLEEP_CHOICES, sleepLabel, type SleepChoice } from "../lib/playback/sleepTimer";
import { noteShuffled, shuffledNext, startShuffle } from "../lib/playback/shuffle";
import { useSimklScrobble } from "../components/player/useSimklScrobble";
import { useTraktScrobble } from "../components/player/useTraktScrobble";
import { useAirPlay } from "../components/player/useAirPlay";
import { PlayerPauseScreen } from "../components/player/PauseScreen";
import { PlayerRatingPrompt } from "../components/player/RatingPrompt";

const win = appWindow;
/** In a watch party, how long a source gets to start before the next one is tried. */
const PARTY_START_MS = 20_000;
/** Solo playback: how long a direct link (or torrent) gets to render frame 1 before auto-failing over. */
const SOLO_START_MS = 15_000;
const TORRENT_START_MS = 45_000;
/** Continuous mid-playback buffering before offering a one-click switch to the next source. */
const STALL_PROMPT_MS = 12_000;
/** Short delay on desktop mouse click so double-click to fullscreen never pauses and unpauses the video. */
const CLICK_PAUSE_DELAY_MS = 200;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** What Subtitles & Audio and Speed say for a YouTube video outside TV mode: they're YouTube's own controls there (#384). TV mode has menus for them (#434). */
const YT_CAPTIONS = "Captions for a YouTube video are in YouTube's player: its CC button and settings.";
const YT_SPEED = "Speed for a YouTube video is in YouTube's player settings.";
/** How long the party's hold lasts before YouTube's bar comes out to say so: longer than over a picture (400 ms), as the bar moves YouTube's. */
const HOLD_SHOWS_MS = 1200;
/** With "Up next" set to the very end, it appears this many seconds before. */
const NEXT_UP_AT_END = 12;
/** A media key's Previous this early in an episode goes to the one before; later it starts this one again. */
const PREVIOUS_RESTARTS_S = 5;
/** The subtitle list's "Add from a File…" entry. */
const PICK_SUBTITLE = "pick-file";


export function Player({
  type,
  metaId,
  videoId,
  stream,
  shuffle = false,
  startParty: autoParty = false,
  leaving = false,
}: {
  type: ContentType;
  metaId: string;
  videoId: string;
  stream?: Stream;
  /** The show's episodes in random order; nothing is saved or scrobbled (lib/playback/shuffle.ts). */
  shuffle?: boolean;
  /** Automatically open a Watch Party room once playback starts (one-click "Watch Together" from Detail). */
  startParty?: boolean;
  /** Route already popped; only the exit fade is left. Ignore input. */
  leaving?: boolean;
}) {
  const { back, navigate, replace, tab } = useNavigation();
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
  // An episode shuffle picked leaves progress, Continue Watching and the scrobbles as they were: a random
  // episode isn't where you are in the show. The one shuffle was turned on in keeps its own.
  const shuffled = shuffle && type === "series";
  const [shuffling, setShuffling] = useState(shuffled);
  useEffect(() => setShuffling(shuffled), [shuffled, videoId]);
  const { save, saveIfDue } = useProgressSaver({ media: videoRef, meta, type, metaId, videoId, current, state: source.state, keep: !shuffled });
  useTraktScrobble({ media: videoRef, videoId, type, playing: started && !paused, enabled: !local && !shuffled });
  useSimklScrobble({ media: videoRef, videoId, type, playing: started && !paused, enabled: !local && !shuffled });
  // A phone or tablet doesn't dim and lock while the video plays; paused, it does in its own time.
  const playingNow = started && !paused;
  useEffect(() => {
    if (!playingNow) return;
    keepScreenOn(true);
    return () => keepScreenOn(false);
  }, [playingNow]);

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
  // --- Chromecast (#443): the same link on a TV, this player its remote -------------------------
  const chromecast = useChromecast({
    media: baseMedia,
    url: playingUrl?.url,
    headers: playingUrl ? requestHeaders(playingUrl.stream) : null,
    title: current ? `${episodeCode(current.season, current.episode)} · ${current.title}` : (meta?.name ?? stream?.name ?? ""),
    subtitle: current ? meta?.name : undefined,
    artwork: meta?.background ?? meta?.poster,
    // Never with a watch party or AirPlay; YouTube's player has its own.
    enabled: !party && engine !== "youtube" && !airplay.casting,
    onProblem: (text) => flashNotice(text, 5000),
  });
  /** The video plays on a TV (AirPlay or Chromecast): this player is its remote. */
  const castingAway = airplay.casting || !!chromecast.casting;
  const media: MediaLike | null = airplay.media ?? chromecast.media ?? baseMedia;
  // What the player did while it played, for "Copy Watch Log" (dev builds only, #424).
  useWatchLog(media, videoId);
  videoRef.current = media;
  // Sleep timer (#270): off at every start; run out, this player alone pauses, progress saved where it stopped.
  const sleep = useSleepTimer(media);
  useEffect(() => {
    if (!sleep.asleep) return;
    videoRef.current?.pause();
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleep.asleep]);
  /** Why the link check turned the built-in player's source down (mpv reports its own). */
  const linkError = useRef<string | null>(null);
  const [volume, setVolume] = useState(savedVolume);
  // Past 100% only mpv can play (Settings → Subtitles & Audio): a <video>, AirPlay's included, stops at 100%.
  const { maxVolume, holdSpeed, pauseShowsControls, showPlayingFormat, secondSubtitles } = usePrefs();
  const volumeTop = engine === "mpv" && !castingAway ? maxVolume : 1;
  /** The volume up or down a step, kept within what this player can play. */
  const stepVolume = (by: number) => setVolume((v) => Math.min(volumeTop, Math.max(0, +(Math.min(v, volumeTop) + by).toFixed(2))));
  // TV mode: each volume press from the controller or remote shows the volume HUD.
  const [volumePing, setVolumePing] = useState<VolumePing>({ n: 0, dir: "up" });
  const pingVolume = (dir: VolumePing["dir"]) => tv && setVolumePing((p) => ({ n: p.n + 1, dir }));
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, flashNotice] = useNotice();
  const [ended, setEnded] = useState(false);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [options, setOptions] = useState<"speed" | "sleep" | "tracks" | "episodes" | "sources" | "party" | null>(null);
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
  // The system's file dialog hands mpv the file: desktop, not while another screen plays.
  const canPickSubtitle = isDesktop && engine === "mpv" && !castingAway;
  // mpv: the line heard before (-1) or after (1) shows now; the delay that makes it is this source's, like any other.
  const stepLine = async (by: 1 | -1) => {
    if (engine !== "mpv") return;
    await mpv.command("sub-step", by).catch(warnFailed("sub-step"));
    const delay = await mpv.command("get_property", "sub-delay").catch(() => null);
    if (typeof delay === "number") changeSubDelay(Math.round(delay * 100) / 100);
  };
  // Sound ahead of or behind the picture, remembered for this source like the subtitle delay (mpv only).
  const [audioDelay, setAudioDelay] = useState(0);
  useEffect(() => setAudioDelay(recallTracks(memoryKey)?.audioDelay ?? 0), [memoryKey]);
  const changeAudioDelay = (seconds: number) => {
    setAudioDelay(seconds);
    rememberTracks(memoryKey, videoId, { audioDelay: seconds });
  };
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  useEffect(() => {
    if (engine !== "mpv") return;
    // An mpv option: it outlives the file, so each load gets this source's own (0 for most).
    const apply = () => void mpv.set("audio-delay", audioDelay);
    apply();
    mpv.addEventListener("loadedmetadata", apply);
    return () => mpv.removeEventListener("loadedmetadata", apply);
  }, [engine, mpv, audioDelay]);

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
    // The track list (and which subtitle is on) arrives after the file opens:
    // an ASS track is only known to need its styling overridden once it's in.
    // Don't forget overrides on loadedmetadata — re-sending sub-ass-override stalls mpv ~1s+.
    const onTracks = () => applySubtitleStyleToMpv(mpv, subStyle, subDelay);
    mpv.addEventListener("loadedmetadata", onTracks);
    mpv.addEventListener("tracks", onTracks);
    return () => {
      mpv.removeEventListener("loadedmetadata", onTracks);
      mpv.removeEventListener("tracks", onTracks);
    };
  }, [engine, mpv, subStyle, subDelay, tracks.subId]); // ASS tracks are restyled differently from plain text

  // Optional seek-bar thumbnails (Seekr). Keyed to whole seconds of duration:
  // the API aligns cues to the length of the release being played.
  // Stabilize live/HLS growing durations so Seekr isn't re-queried every second on minor drifts.
  const rawDurationS = useMediaTime(media, (t) => (Number.isFinite(t.duration) && t.duration > 0 ? Math.round(t.duration) : 0));
  const [durationS, setDurationS] = useState(0);
  useEffect(() => {
    setDurationS(0);
  }, [videoId]);
  useEffect(() => {
    if (rawDurationS <= 0) return;
    setDurationS((prev) => (prev === 0 || Math.abs(rawDurationS - prev) >= 15 ? rawDurationS : prev));
  }, [rawDurationS]);
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
  // Settings → Playback can leave the picture clear on pause: the controls then come only with input.
  const { chrome, poke, hide: hideChrome, controlHover } = usePlayerChrome(hideAfter, paused && pauseShowsControls && !frameSteps.stepping && !ytFramed);
  // A watch party plays at 1x for everyone (its sync nudges the rate itself).
  const inParty = !!party;
  // Press and hold on the picture: faster until let go (Settings → Playback). Not in a party, nor on YouTube's own player.
  // Hides chrome immediately when 2x kicks in so the bars and touch's 45% dim never obscure the sped-up video.
  const hold = useHoldSpeed(holdSpeed > 0 && !inParty && !ytFramed && started, started && !paused, () => hideChrome("hold speed"));
  const playRate = hold.held ? holdSpeed : rate;
  const [scrubbing, setScrubbing] = useState(false);
  const onScrubChange = useCallback(
    (active: boolean) => {
      setScrubbing(active);
      if (!active) poke(false, "scrub");
    },
    [poke],
  );
  // The focus ring shows only for focus moved by the keyboard, never after a click (#329).
  const keyFocus = useKeyboardFocus();
  const ready = source.state.status === "ready" && !error;
  // The top bar's "More" menu (#396) keeps the controls up while it's open.
  const [moreOpen, setMoreOpen] = useState(false);
  // Playing on a TV, nobody watches this screen: the controls that drive the TV stay up.
  // Phones and tablets: locked against touches (TouchLock.tsx), the controls stay hidden.
  const touchLock = useTouchLock(touch && !tv);
  const chromeVisible =
    !touchLock.locked &&
    !hold.held &&
    (chrome.visible || scrubbing || !!options || nativeMenu || moreOpen || !ready || !started || airplay.casting || !!chromecast.casting);
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
  const chromeBeforeTap = useRef(false);
  const touchChain = useRef<{ side: "back" | "forward"; until: number } | null>(null);

  // --- Current / next episode ---------------------------------------------
  const { animeSkipFiller } = usePrefs();
  // The episode order chosen for the show on its page (lib/library/episodeOrder.ts): Up Next, autoplay and the
  // Episodes panel follow it; undefined: as aired.
  const order = useEpisodeOrders(local ? undefined : meta).view;
  // With "Skip filler" on, the next episode that isn't filler; `skipped` says how many were passed over.
  const { next, skipped } = useMemo(() => {
    // Shuffling: one not played yet in this run, picked once per episode so Up Next doesn't change under you.
    if (shuffling && meta) {
      noteShuffled(metaId, videoId);
      return { next: shuffledNext(meta, videoId), skipped: [] as Video[] };
    }
    const after = (m: Meta, id: string) => (order ? nextInOrder(order, id) : nextVideo(m, id));
    let n = meta && type === "series" ? after(meta, videoId) : undefined;
    const skipped: Video[] = [];
    while (n && animeSkipFiller && playContext.isFiller(n.id) && meta) {
      skipped.push(n);
      n = after(meta, n.id);
    }
    return { next: n, skipped };
  }, [meta, type, videoId, animeSkipFiller, shuffling, metaId, order]);
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
  usePartySync({ media, current: partyMedia, started, buffering, hint, leaving, asleep: sleep.asleep });
  const startHere = () => {
    const v = videoRef.current;
    if (!party && profile && v) startParty({ ...partyMedia, hint }, v.currentTime, v.paused, profile);
  };
  const autoPartyStarted = useRef(false);
  useEffect(() => {
    if (!autoParty || autoPartyStarted.current || !ready || !started || !profile || party || !videoRef.current) return;
    autoPartyStarted.current = true;
    const v = videoRef.current;
    startParty({ ...partyMedia, hint }, v.currentTime, v.paused, profile);
    setOptions("party");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoParty, ready, started, profile, party]);

  // --- mpv lifecycle ----------------------------------------------------------
  useEffect(() => {
    if (engine !== "mpv") return;
    let alive = true;
    let dispose: (() => void) | undefined;
    // Start libmpv immediately in parallel with stream discovery & torrent_open.
    mpv.warm();
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
  const resumePoint = (r?: Pick<Progress, "position" | "duration">) =>
    resumeFrom(r, { resume: settings?.resumePlayback !== false, rewind: settings?.resumeRewind ?? 0, watchedFraction: watchedFraction() });
  const resumed = useRef(false);
  /** Where a source that failed had got to: the next one carries on from there (not from where the episode was opened). */
  const reached = useRef<number | undefined>(undefined);
  useEffect(() => {
    // Always the app's own player: handing over to AirPlay and back isn't a new source.
    const v = baseRef.current;
    if (!v || source.state.status !== "ready") return;
    resumed.current = false;
    setError(null);
    setBuffering(true);
    watch(`source: ${describeStream(source.state.stream, source.state.url)}, ${engine}`);
    v.volume = sliderAmplitude(volume, volumeTop);
    if (v instanceof MpvMedia) {
      // Start at the resume point (or where the watch party is) directly: no
      // fetching the opening of a network stream only to seek away from it.
      const start = startPosition(partyPosition(videoId), reached.current, resumePoint(source.resume ?? (local ? recentPosition(videoId) : undefined)));
      resumed.current = true;
      v.load(source.state.url, start, requestHeaders(source.state.stream), !!link);
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
        .streamProbe(url, id, requestHeaders(source.state.stream), !!link)
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
    // The sleep timer fades the sound out over its last 30 s; the stored level stays the viewer's.
    v.volume = sliderAmplitude(volume, volumeTop) * sleep.gain;
    v.muted = muted;
    if (!systemVolume) storeLocal("polar.volume", String(volume));
  }, [volume, muted, media, sleep.gain, volumeTop]);

  // Phones and tablets: a finger up or down the right half sets the volume, the left the screen's brightness
  // (useSwipeLevels; Settings → Controls & TV turns it off). Not in TV mode, while locked or held, nor on YouTube's player.
  const { swipeGestures } = usePrefs();
  const brightness = useScreenBrightness(touch && !tv);
  const swipe = useSwipeLevels({
    enabled: touch && !tv && swipeGestures && !touchLock.locked && started && !ytFramed,
    begin: (side) => {
      if (hold.held) return null;
      if (side === "left") {
        const cur = brightness.getLevel();
        return cur == null ? null : { level: cur, max: 1 };
      }
      // When the OS handles volume (iOS/Android phones), volume UI is hidden: don't silently attenuate software volume.
      if (systemVolume) return null;
      return { level: muted ? 0 : Math.min(volume, volumeTop), max: volumeTop };
    },
    change: (side, level) => {
      if (side === "left") return brightness.set(level);
      const before = muted ? 0 : Math.min(volume, volumeTop);
      if (level === before) return;
      setMuted(false);
      setVolume(level);
      setVolumePing((p) => ({ n: p.n + 1, dir: level > before ? "up" : "down" }));
    },
  });
  const sleepTickVisible = chromeVisible || moreOpen || options === "sleep";
  useEffect(() => {
    sleep.setTickActive(sleepTickVisible);
  }, [sleep.setTickActive, sleepTickVisible]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = inParty ? 1 : playRate;
  }, [playRate, source.state, media, inParty]);

  // A source that hangs before showing frame 1 shouldn't trap the viewer (party OR solo): move on to the next candidate.
  const sourceNext = source.next;
  useEffect(() => {
    if (started || source.state.status !== "ready" || local || link) return;
    const isTorrent = !!source.state.stream.infoHash;
    const limit = inParty ? PARTY_START_MS : isTorrent ? TORRENT_START_MS : SOLO_START_MS;
    const t = window.setTimeout(() => {
      logStep(
        inParty ? `Not playing after ${limit / 1000} s; the watch party is waiting` : `No picture after ${limit / 1000} s; trying another source`,
        "warn",
        "player",
      );
      if (sourceNext()) flashNotice("That source was slow to start. Trying the next best one.", 3500);
    }, limit);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new attempt is a new source.state
  }, [inParty, started, source.state, local, link]);

  // Mid-playback stall recovery: if buffering runs continuously for 12s, offer a non-blocking source switch.
  const [stallPrompt, setStallPrompt] = useState(false);
  const [stallDismissed, setStallDismissed] = useState(false);
  useEffect(() => {
    setStallDismissed(false);
    setStallPrompt(false);
  }, [source.state]);
  useEffect(() => {
    if (!started || paused || ended || !buffering || castingAway || local || link || !!options || stallDismissed) {
      setStallPrompt(false);
      return;
    }
    const t = window.setTimeout(() => setStallPrompt(true), STALL_PROMPT_MS);
    return () => window.clearTimeout(t);
  }, [started, paused, ended, buffering, castingAway, local, link, options, stallDismissed]);

  const switchStalledSource = useCallback(() => {
    setStallPrompt(false);
    const at = videoRef.current?.currentTime;
    if (at != null && Number.isFinite(at) && at > 0) reached.current = at;
    recordFail(source.kind);
    if (sourceNext()) {
      logStep("Switched source after stall", "warn", "player");
      flashNotice("Switching to the next best source…", 3000);
    } else {
      setOptions("sources");
    }
  }, [source.kind, sourceNext, logStep, flashNotice]);

  // Debounce single-click play/pause on desktop mouse so double-click fullscreen never stutters.
  const clickTimer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);

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
  const { pauseOnMinimize, discordPresence, discordJoin } = usePrefs();
  // A file on this device stays private: its name isn't shown on Discord.
  // The button (#153): this title in the viewer's own Polarity (only where the title is shown); in a party joinable
  // from Discord, Discord's own Join instead (#357).
  const { token: joinToken, party: joinParty } = useJoinDesk();
  const partyMembers = party?.members.length ?? 0;
  const presenceLinks = useMemo(
    () => ({
      watch: (discordPresence === "title" && watchPage(type, metaId)) || undefined,
      join: joinToken && joinParty ? { party: joinParty, secret: joinToken, members: Math.max(1, partyMembers), ask: discordJoin !== "anyone" } : undefined,
    }),
    [discordPresence, type, metaId, joinToken, joinParty, partyMembers, discordJoin],
  );
  useDiscordPresence(media, meta, videoId, local ? "off" : discordPresence, presenceLinks);
  // The lock screen and media controls on phones, which keep the sound playing in the background (#461).
  useNowPlaying(media, meta, videoId);
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
      const start = startPosition(partyPosition(videoId), reached.current, resumePoint(source.resume ?? (local ? recentPosition(videoId) : undefined)));
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
    seeking: () => {
      // Gone back from the end to watch again: the "up next" countdown must not go on behind it.
      const v = videoRef.current;
      if (v && Number.isFinite(v.duration) && v.currentTime < v.duration - 1) setEnded(false);
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
      // Only once a picture was up, and never 0: a source that fails before it starts leaves the last place alone.
      const at = videoRef.current?.currentTime;
      if (startedRef.current && at != null && Number.isFinite(at) && at > 0) reached.current = at;
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

  // --- Picture in Picture on desktop: the window as a small player in a corner, on top of the others ---
  const canMini = canPin && !tv;
  const [mini, setMini] = useState(false);
  const miniPlayer = useMemo(() => createMiniWindow(win, setMini), []);
  // Leaving the player, or TV mode, puts the window back as it was.
  useEffect(() => {
    if (tv) void miniPlayer.leave();
  }, [tv, miniPlayer]);
  useEffect(() => () => void miniPlayer.leave(), [miniPlayer]);
  // Pin locks the window's size and place: never both at once.
  const toggleMini = useCallback(() => void pinner.unpin().then(() => miniPlayer.toggle()), [pinner, miniPlayer]);

  const toggleFullscreen = useCallback(async () => {
    if (tv) return;
    // From Picture in Picture, its own size first (fullscreen again if it was), then fullscreen.
    if (miniPlayer.mini) await miniPlayer.leave();
    const next = !(await win.isFullscreen());
    // Going fullscreen unpins first.
    await pinner.setFullscreen(next);
    setFullscreen(next);
  }, [tv, pinner, miniPlayer]);

  // Fade back to the page first, *then* leave fullscreen: resizing the window
  // while mpv's native picture is up is what flickers, so do it once the page
  // is opaque on top.
  const exit = useCallback(async () => {
    // Picture in Picture: the window's own size and place again (and fullscreen if it was, left below).
    if (miniPlayer.mini) await miniPlayer.leave();
    const fs = !tv && (await win.isFullscreen());
    back();
    if (fs) window.setTimeout(() => void win.setFullscreen(false), PLAYER_EXIT_MS);
  }, [back, tv, miniPlayer]);

  /**
   * The Settings page a playback problem names. In TV mode (#435): both Sources and Add-ons stay in TV's own
   * Settings so remote/controller users are never booted into pointer-only desktop UI.
   */
  const openSettingsPage = useCallback(
    (page: "sources" | "addons") => {
      if (tv) return tab({ name: "settings", page });
      void exit();
      openSettings(page);
    },
    [tv, tab, exit],
  );

  const playVideo = useCallback(
    (id: string, s?: Stream, keepShuffle = true) => {
      save();
      // A shuffle carries on (Next, autoplay, another source) until the viewer picks an episode themselves.
      replace({ name: "player", type, metaId, videoId: id, stream: s, shuffle: (shuffling && keepShuffle) || undefined });
    },
    [save, replace, type, metaId, shuffling],
  );
  /** An episode the viewer picked from the list: in the show's order again. */
  const pickEpisode = (id: string) => playVideo(id, undefined, false);
  /** Shuffle on (a run starting from this episode) or off; this episode plays on either way. */
  const toggleShuffle = useCallback(() => {
    if (!shuffling) startShuffle(metaId, videoId);
    setShuffling(!shuffling);
    flashNotice(shuffling ? "Shuffle off" : "Shuffle on: episodes in random order, your progress left as it is", 3000);
  }, [shuffling, metaId, videoId, flashNotice]);

  // --- Episodes & sources pickers -------------------------------------------
  const { data: progress } = useProgress(metaId);
  const progressById = useMemo(() => progressMap(progress), [progress]);
  const seasons = useMemo(() => (meta ? seasonsOf(meta) : []), [meta]);
  // The seasons, or a chosen order's groups (ids: season numbers, or group ids).
  const seasonGroups = useMemo(() => (meta ? shelfGroups(meta.videos, seasons, order) : []), [meta, seasons, order]);
  const [pickSeason, setPickSeason] = useState<number>();
  const shownSeason =
    (seasonGroups.some((g) => g.id === pickSeason) ? pickSeason : undefined) ?? (current && shelfGroupOf(current, order)) ?? seasonGroups[0]?.id;
  const shownEpisodes = seasonGroups.find((g) => g.id === shownSeason)?.videos ?? [];
  // Side by side or a list: the same choice as the title page's switch (#226).
  const [episodeLayout, setEpisodeLayout] = useEpisodeLayout();
  // Beside the layout switch: the show's episodes in random order from here (lib/playback/shuffle.ts).
  const shuffleButton = type === "series" && !local && (
    <IconButton
      variant="panel"
      aria-pressed={shuffling}
      label="Shuffle"
      title={shuffling ? "Shuffle is on: episodes in random order. Your progress is left as it is" : "Shuffle episodes"}
      onClick={toggleShuffle}
    >
      <Shuffle size={19} strokeWidth={2.1} />
    </IconButton>
  );
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
      shownEpisodes.map((v) => {
          const p = progressById.get(v.id);
          const { released, openable, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
          return {
            id: v.id,
            label: `${order?.number.get(v.id) ?? v.episode}. ${v.title}`,
            detail: released && inProgress && p ? formatRemaining(p.position, p.duration) : airLabel(v),
            thumbnail: stillFor(v.id) ?? v.thumbnail ?? "",
            unwatched: !watched,
            progress: watched ? undefined : fraction,
            badge: watched ? { text: "Watched" } : undefined,
            disabled: !openable,
          };
        }),
    [shownEpisodes, order, progressById],
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
  const sourceFilters = useSourceFilters(streams.data?.streams, settings, metaId, runtimeSeconds(meta?.runtime), airedAt(meta, videoId), meta?.details?.originalLanguage);
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
          stepVolume(0.1);
          pingVolume("up");
          setMuted(false);
          return true;
        case "volumeDown":
          if (systemVolume) return false;
          stepVolume(-0.1);
          pingVolume("down");
          return true;
        case "mute":
          if (systemVolume) return false;
          setMuted((m) => !m);
          pingVolume("mute");
          return true;
        case "fullscreen":
          void toggleFullscreen();
          return true;
        case "pinWindow":
          if (!canPin || mini) return false;
          togglePin();
          return true;
        case "miniPlayer":
          if (!canMini) return false;
          toggleMini();
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
        case "screenshot":
          if (!canShoot) return false;
          takeScreenshot();
          return true;
        case "escape":
          if (tv) {
            void exit();
            return true;
          }
          // Picture in Picture goes back to the full window first.
          if (miniPlayer.mini) {
            void miniPlayer.leave();
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

  // Media keys, headset buttons and the system's now-playing controls (Windows' media overlay, macOS's
  // Now Playing, the iPhone's Lock Screen). Previous goes back to the start, or within its first seconds
  // to the episode before, as music players do. Not for YouTube's player, which has its own.
  const previous =
    meta && type === "series" && !local ? (order ? previousInOrder(order, videoId) : previousVideo(meta, videoId)) : undefined;
  useMediaSession(
    started && !ytId && !castingAway ? media : null,
    meta || title
      ? {
          title: heading || title,
          subtitle: current ? title : undefined,
          artwork: meta?.poster ?? meta?.background,
          canNext: !!next,
          canPrevious: true,
        }
      : null,
    (key, position) => {
      const v = videoRef.current;
      if (!v) return;
      if (key === "play") void v.play().catch(() => {});
      else if (key === "pause") v.pause();
      else if (key === "toggle") togglePlay();
      else if (key === "next" && next) playVideo(next.id);
      else if (key === "seek" && position != null) seekTo(position, "the system's controls");
      else if (key === "previous") {
        if (v.currentTime < PREVIOUS_RESTARTS_S && previous) playVideo(previous.id);
        else seekTo(0, "the system's controls");
      }
    },
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

  // With IntroDB / chapter credit timings, "Up next" arrives as soon as credits
  // roll (Netflix-style) and counts down immediately unless there's a post-credits
  // scene or the user prefers waiting until the very end.
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
  const creditsRoll = creditsStart != null && !postCredits && !atEnd && nearEnd === "yes";

  // Autoplay countdown once credits start (when known) or once the episode ends,
  // unless it's time to ask whether anyone's still watching (Settings → Playback).
  // Pauses while playback is paused before EOF or while a picker/menu is open.
  const askAfter = settings?.stillWatchingAfter ?? 0;
  const stillWatching = askAfter > 0 && autoplayStreak() >= askAfter;
  // A sleep timer set to the end of this episode (or run out) stops here: no next one (#270).
  const willAutoplay = !!settings?.autoplayNext && !stillWatching && sleep.choice !== "episode" && !sleep.asleep;
  const autoAdvancing = showNextUp && willAutoplay && (ended || creditsRoll);
  const countdownPaused = (paused && !ended) || !!options || moreOpen || !!sourceMenu;
  const autoplayLeft = useRef(countdown * 1000);
  useEffect(() => {
    autoplayLeft.current = countdown * 1000;
  }, [autoAdvancing, videoId, countdown]);
  useEffect(() => {
    if (!autoAdvancing || !next || countdownPaused) return;
    const startedAt = performance.now();
    const wait = autoplayLeft.current;
    const t = window.setTimeout(() => {
      autoplayLeft.current = 0;
      countAutoplay();
      playVideo(next.id);
    }, wait);
    return () => {
      window.clearTimeout(t);
      autoplayLeft.current = Math.max(0, wait - (performance.now() - startedAt));
    };
  }, [autoAdvancing, next, countdownPaused, playVideo]);

  const sleepEndedRef = useRef<HTMLDivElement>(null);
  useDismiss(showNextUp && !!next && !options, () => setNextDismissed(true));
  useDismiss(sleep.warning && !sleep.asleep && !options, () => sleep.cancel());
  useLayer(sleepEndedRef, sleep.asleep && !options, () => sleep.wake());
  // As Up Next comes: the next episode's first two picks get the request pressing Play makes, so their
  // servers have the file open by the time it starts (its sources were fetched at three quarters).
  const nextId = next?.id;
  useEffect(() => {
    if (!nextId || local || link || nearEnd !== "yes") return;
    const streams = cachedStreams(type, nextId);
    if (!streams?.length) return;
    return warmLinks(autoPickOrder(streams, settings, metaId, source.match.current).slice(0, 2));
    // The settings at that moment: a change later doesn't need another look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId, nearEnd, local, link, type, metaId]);
  // What Best Match learns from this try (#230): how long it took to start, whether it played through, and
  // what the connection carried (links only: not a file here or the torrent engine's own link on this machine).
  useSourceRecord(source.kind, source.state.status === "resolving", started, ended || nearEnd === "yes");
  const remoteLink = !!playingUrl && /^https?:\/\//i.test(playingUrl.url) && !/^https?:\/\/(127\.|localhost[:/]|\[::1\])/i.test(playingUrl.url);
  useThroughput(media, started && !paused, remoteLink);

  const cycleClock = () =>
    updateSettings.mutate({ timeDisplay: TIME_DISPLAYS[(TIME_DISPLAYS.indexOf(timeDisplay) + 1) % TIME_DISPLAYS.length] });

  const VolumeIcon = muted || volume === 0 ? VolumeMuted : Volume;

  // Screenshots (desktop, mpv): the picture as it is, subtitles included, to Pictures/Polarity.
  const canShoot = isDesktop && engine === "mpv" && started && !castingAway;
  const [shotSaved, setShotSaved] = useState(false);
  const takeScreenshot = () =>
    void api.screenshot(heading || title, videoRef.current?.currentTime ?? 0).then(
      (name) => {
        setShotSaved(true);
        flashNotice(`Screenshot saved to Pictures › Polarity › ${name}`, 3500);
      },
      (e) => flashNotice(`Couldn't save the screenshot: ${errorMessage(e)}`, 4000),
    );

  // "4K · Dolby Vision · Dolby Atmos · English 5.1" under the title, once it plays (Settings → Playback).
  const playingFormat = usePlayingFormat(started && !castingAway ? media : null, showPlayingFormat && !ytFramed);

  // Play in another player installed here (desktop): this one pauses and keeps the place.
  const { data: otherPlayers = [] } = useQuery({
    queryKey: keys.externalPlayers,
    queryFn: async () => (await api.externalPlayers()) ?? [],
    enabled: isDesktop && !tv,
    staleTime: Infinity,
  });
  const canHandOff = isDesktop && !tv && !ytId && source.state.status === "ready" && otherPlayers.length > 0;
  const handOff = (player: { id: string; name: string }) => {
    if (source.state.status !== "ready") return;
    const v = videoRef.current;
    v?.pause();
    void api
      .externalPlay(player.id, source.state.url, heading || title, v?.currentTime ?? 0, requestHeaders(source.state.stream))
      .then(
        () => flashNotice(`Playing in ${player.name}. Your place here is kept.`, 4000),
        (e) => flashNotice(errorMessage(e), 4000),
      );
  };

  /** On a phone, secondary actions (Sleep Timer, Watch Party) live in the top-right "…" menu so the bottom bar never clips. */
  const phoneMore = !tv && form === "phone";
  /** "More" has items of its own (screenshots, Picture in Picture, other players, phone overflow), so it shows whatever fits. */
  const moreItems = canShoot || canMini || canHandOff || phoneMore;

  // A narrow window (#396): the bars give way in steps (useBarFit). Pin and fill are the top controls "More" takes.
  const topBar = useRef<HTMLDivElement>(null);
  const actionRow = useRef<HTMLDivElement>(null);
  const showPin = canPin && !fullscreen && !mini;
  const showFill = !tv && isDesktop;
  // A desktop window (not a phone, a compact window, TV or Picture in Picture): one row of controls under the
  // timeline, and each panel a small menu above its button instead of a layer over the whole picture.
  const dock = !tv && form === "desktop" && !mini;
  const dockZoom = useDockZoom(dock);
  // The dock's popup menus (Cast, More) share its panels' look and scale (player.css `.menu-dock`).
  // Zoomed only past 1× (player.css data-zoomed): at 1× nothing carries a zoom, which WebKit doesn't treat as a no-op.
  const zoomed = dock && dockZoom > 1;
  const dockMenu = dock
    ? {
        className: zoomed ? "scheme-dark menu-dock menu-dock-zoomed" : "scheme-dark menu-dock",
        style: zoomed ? ({ "--pz": dockZoom } as React.CSSProperties) : undefined,
        // The same smoked glass as the dock's panels: a frosted copy of the picture behind the menu.
        backdrop: <VideoBackdrop media={media} className="options-frost" crop cropSize={[192, 168]} fade />,
      }
    : { className: "scheme-dark" };
  const barFit = useBarFit(
    topBar,
    actionRow,
    Number(showPin) + Number(showFill),
    !tv && form !== "phone" && !compact && !dock,
    [heading, title, rate, party?.members.length, next?.id, airplay.available, chromecast.available, showPin, showFill, fullscreen, canParty, ytId, link, local, moreItems, phoneMore].join(
      "|",
    ),
    !!watchLog || moreItems,
    !tv && !dock,
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
          : [
              {
                // One column, headed by the pane itself: its own heading says what it is.
                title: "Watch Party",
                titleHidden: true,
                size: "medium" as const,
                options: [],
                onSelect: () => {},
                content: (
                  <PartyStart
                    me={profile!}
                    onStart={local ? undefined : startHere}
                    // Not in a party yet: a link can start one. TV mode: no pasting on a remote.
                    link={tv ? undefined : <LinkForm me={profile!} onDone={() => setOptions(null)} />}
                  />
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
        data-nav-scope=""
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
            {...controlHover}
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

  const currentUnwatched = !!current && !local && !episodeState(current, progressById.get(current.id), watchedFraction()).watched;
  const nextUnwatched = !!next && !local && !episodeState(next, progressById.get(next.id), watchedFraction()).watched;
  const statusEpisode = current && !local ? `${episodeCode(current.season, current.episode)}${current.title ? ` · ${current.title}` : ""}` : undefined;

  // The window-level controls: in the top bar, or in the desktop dock under the timeline.
  const volumeControl = !systemVolume && (
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
      <span className="player-volume-slider">
        <input
          type="range"
          min={0}
          max={volumeTop}
          step={0.01}
          value={muted ? 0 : Math.min(volume, volumeTop)}
          data-boost={volumeTop > 1 || undefined}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            setMuted(false);
          }}
          aria-label="Volume"
          aria-valuetext={`${Math.round((muted ? 0 : Math.min(volume, volumeTop)) * 100)}%`}
          style={
            {
              "--value": `${((muted ? 0 : Math.min(volume, volumeTop)) / volumeTop) * 100}%`,
              "--unity-frac": volumeTop > 1 ? 1 / volumeTop : undefined,
            } as React.CSSProperties
          }
        />
      </span>
    </div>
  );
  const castControls = (
    <>
      {airplay.available && (
        <IconButton variant="player" onClick={airplay.pick} label="AirPlay" title="AirPlay" aria-pressed={airplay.casting}>
          <Tv size={22} />
        </IconButton>
      )}
      {/* Chromecast (#443): the TVs on the network, and back to this computer. */}
      {chromecast.available && (
        <MenuRoot
          modal={false}
          onOpenChange={(next) => {
            setMoreOpen(next);
            if (next) setOptions(null);
          }}
        >
          <MenuTrigger
            className={iconButtonClass("player")}
            aria-label="Cast to a TV"
            title="Cast to a TV"
            aria-pressed={!!chromecast.casting}
          >
            <Cast size={22} />
          </MenuTrigger>
          <MenuPopup sideOffset={dock ? 12 : 6} align="end" collisionPadding={12} aria-label="Cast to a TV" {...dockMenu}>
            {chromecast.devices.map((d) => (
              <MenuCheckItem
                key={d.id}
                checked={chromecast.casting?.id === d.id}
                onCheckedChange={() => (chromecast.casting?.id === d.id ? chromecast.stop() : chromecast.start(d))}
              >
                {d.name}
              </MenuCheckItem>
            ))}
            {chromecast.casting && <MenuItem onClick={chromecast.stop}>Stop Casting</MenuItem>}
          </MenuPopup>
        </MenuRoot>
      )}
    </>
  );
  const moreMenu = (more || dock || watchLog || moreItems) && (
    <MenuRoot
      modal={false}
      onOpenChange={(next) => {
        setMoreOpen(next);
        if (next) setOptions(null);
      }}
    >
      <MenuTrigger className={iconButtonClass("player", "player-more")} aria-label="More" title="More" data-panel="more">
        <More size={22} />
      </MenuTrigger>
      <MenuPopup
        sideOffset={dock ? 12 : 6}
        align="end"
        collisionPadding={12}
        aria-label="More"
        {...dockMenu}
      >
        {(more || dock) && showPin && (
          <MenuCheckItem checked={pinned} onCheckedChange={togglePin} meta={shortcutText("pinWindow")}>
            Pin window on top
          </MenuCheckItem>
        )}
        {(more || dock) && showFill && (
          <MenuCheckItem checked={crop !== "fit"} onCheckedChange={cycleCrop} meta={shortcutText("fill")}>
            {`Crop: ${cropModeLabel(crop)}`}
          </MenuCheckItem>
        )}
        {(dock || phoneMore) && (
          <MenuItem onClick={() => setOptions("sleep")} meta={sleep.left != null ? sleepLabel(sleep.left) : undefined}>
            Sleep Timer
          </MenuItem>
        )}
        {phoneMore && canParty && !castingAway && (
          <MenuItem onClick={() => setOptions("party")} meta={party ? `${party.members.length}` : undefined}>
            Watch Party
          </MenuItem>
        )}
        {canMini && (
          <MenuCheckItem checked={mini} onCheckedChange={toggleMini} meta={shortcutText("miniPlayer")}>
            Picture in Picture
          </MenuCheckItem>
        )}
        {canShoot && (
          <MenuItem onClick={takeScreenshot} meta={shortcutText("screenshot")}>
            Save Screenshot
          </MenuItem>
        )}
        {canShoot && shotSaved && (
          <MenuItem onClick={() => void api.revealScreenshot().catch(warnFailed("reveal screenshot"))}>
            Show Last Screenshot
          </MenuItem>
        )}
        {canHandOff &&
          otherPlayers.map((p) => (
            <MenuItem key={p.id} onClick={() => handOff(p)}>
              {`Play in ${p.name}`}
            </MenuItem>
          ))}
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
  );
  const fullscreenButton = !tv && isDesktop && (
    <IconButton variant="player" onClick={() => void toggleFullscreen()} label="Fullscreen" title={withShortcut("Fullscreen", "fullscreen")}>
      {fullscreen ? <ExitFullscreen size={22} /> : <Fullscreen size={22} />}
    </IconButton>
  );

  return (
    <div
      className="player"
      data-nav-scope=""
      data-engine={engine ?? undefined}
      data-fill={fill || undefined}
      data-fullscreen={fullscreen || tv || undefined}
      data-mini={mini || undefined}
      data-buffering={frameSteps.spinner && ready}
      data-chrome={chromeVisible}
      data-instant={chrome.instant}
      data-key-focus={keyFocus || undefined}
      data-options={!!options}
      data-options-instant={optionsByKey}
      data-dock={dock || undefined}
      data-zoomed={zoomed || undefined}
      style={zoomed ? ({ "--pz": dockZoom } as React.CSSProperties) : undefined}
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
        // Held down, it plays faster until let go (useHoldSpeed). A finger up or down sets volume or brightness (useSwipeLevels).
        onPointerDown={(e) => {
          chromeAtPress.current = chrome.visible;
          pinch.onPointerDown(e);
          hold.handlers.onPointerDown(e);
          swipe.handlers.onPointerDown(e);
        }}
        onPointerMove={(e) => {
          pinch.onPointerMove(e);
          hold.handlers.onPointerMove(e);
          swipe.handlers.onPointerMove(e);
        }}
        onPointerUp={(e) => {
          pinch.onPointerUp(e);
          hold.handlers.onPointerUp();
          swipe.handlers.onPointerUp(e);
        }}
        onPointerCancel={(e) => {
          pinch.onPointerCancel(e);
          hold.handlers.onPointerCancel();
          swipe.handlers.onPointerCancel(e);
        }}
        onPointerLeave={hold.handlers.onPointerLeave}
        onClick={(e) => {
          // The release of a hold that sped up, or of a swipe: play/pause and the controls stay as they were.
          const held = hold.swallowClick();
          if (swipe.swallowClick() || held) return;
          if (touch) {
            const third = e.currentTarget.clientWidth / 3;
            const x = e.nativeEvent.offsetX;
            const side: "back" | "forward" | null = x < third ? "back" : x > third * 2 ? "forward" : null;
            const now = performance.now();
            const activeChain = touchChain.current && now < touchChain.current.until ? touchChain.current : null;
            if (side && activeChain?.side === side) {
              seekBy((side === "back" ? -1 : 1) * seekStep);
              kick(side);
              touchChain.current = { side, until: now + 900 };
              return;
            }
            if (side && e.detail >= 2) {
              seekBy((side === "back" ? -1 : 1) * seekStep);
              kick(side);
              touchChain.current = { side, until: now + 900 };
              if (chromeBeforeTap.current) poke(true, "double tap");
              else hideChrome("double tap");
              return;
            }
            touchChain.current = null;
            if (e.detail <= 1) chromeBeforeTap.current = chromeAtPress.current;
          }
          if (!touch && settings?.clickAction !== "controls") {
            window.clearTimeout(clickTimer.current);
            clickTimer.current = window.setTimeout(() => {
              clickTimer.current = undefined;
              togglePlay();
            }, CLICK_PAUSE_DELAY_MS);
            return;
          }
          if (chromeAtPress.current) hideChrome("tap");
          else poke(false, "tap");
        }}
        // A finger double-taps the left or right third to skip back or ahead, as phone players do;
        // the middle (and a mouse anywhere) toggles fullscreen without first pausing on click 1.
        onDoubleClick={(e) => {
          window.clearTimeout(clickTimer.current);
          clickTimer.current = undefined;
          const third = e.currentTarget.clientWidth / 3;
          const x = e.nativeEvent.offsetX;
          if (touch && (x < third || x > third * 2)) {
            const side = x < third ? "back" : "forward";
            const now = performance.now();
            if (touchChain.current && now < touchChain.current.until && touchChain.current.side === side) return;
            seekBy((side === "back" ? -1 : 1) * seekStep);
            kick(side);
            touchChain.current = { side, until: now + 900 };
            return;
          }
          if (!isDesktop) return cycleCrop();
          // Pinned, the window stays as it is (#266).
          if (pinner.pinned) return;
          // Picture in Picture: back to the full window, as the mini players of phones and browsers do.
          if (miniPlayer.mini) return void miniPlayer.leave();
          void toggleFullscreen();
        }}
        onWheel={(e) => {
          const wheel = settings?.wheelAction ?? "volume";
          if (wheel === "none" || (wheel === "volume" && systemVolume)) return;
          if (wheel === "seek") seekBy(-Math.sign(e.deltaY) * seekStep);
          else {
            stepVolume(-Math.sign(e.deltaY) * 0.05);
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
            episode={statusEpisode}
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
        <CastingPanel
          art={meta?.background}
          icon={<Tv size={40} />}
          title="Playing on AirPlay"
          hint="To watch here again, choose this computer in the AirPlay list."
          action={
            <Button variant="glass" onClick={airplay.pick}>
              AirPlay
            </Button>
          }
        />
      )}
      {chromecast.casting && (
        <CastingPanel
          art={meta?.background}
          icon={<Cast size={40} />}
          title={`Playing on ${chromecast.casting.name}`}
          hint="The controls here play, pause and skip on the TV."
          action={
            <Button variant="glass" onClick={chromecast.stop}>
              Stop Casting
            </Button>
          }
        />
      )}
      <div className="player-top-stack">
        {hold.held && (
          <div className="player-hold-speed t-callout tabular" role="status">
            <HoldChevrons /> {holdSpeed}x
          </div>
        )}
        {party && ready && started && <PartyHold party={party} videoId={videoId} />}
        {notice && <div className="player-notice t-callout">{notice}</div>}
      </div>
      {stallPrompt && !notice && (
        <div className="stall-prompt" role="status">
          <span className="stall-prompt-text t-callout">Stream is buffering</span>
          <Button size="sm" variant="primary" onClick={switchStalledSource}>
            Try Next Source
          </Button>
          <Button size="sm" variant="glass" onClick={() => setOptions("sources")}>
            Sources
          </Button>
          <IconButton
            variant="plain"
            className="stall-prompt-dismiss"
            onClick={() => {
              setStallDismissed(true);
              setStallPrompt(false);
            }}
            label="Dismiss"
          >
            <Close size={15} />
          </IconButton>
        </div>
      )}
      {party && <PartyNotes party={party} />}

      {/* Top: back, what's playing, window-level controls. Drag lives here. */}
      {/* Pinned (#266), nothing moves the window. */}
      <div ref={topBar} className="player-top" data-tauri-drag-region={pinned ? undefined : true} {...controlHover}>
        <BackButton className="player-back" onClick={() => void exit()} />
        {/* Between Back and the controls: centred while it fits, off-centre when it would meet them, then cut short (#396). */}
        {/* The desktop dock names what's playing above the timeline instead. */}
        <div className="player-heading" data-tauri-drag-region={pinned ? undefined : true}>
          {!dock && (
            <>
              <span className="player-heading-title">{heading}</span>
              {current && <span className="player-heading-show">{title}</span>}
              {playingFormat && <span className="player-heading-format">{playingFormat}</span>}
            </>
          )}
        </div>
        <div className="player-top-end">
          <div className="player-top-actions">
            {party && <PartyBadge party={party} onOpen={() => setOptions("party")} />}
            {!dock && volumeControl}
            {!dock && castControls}
            {showPin && !more && !dock && (
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
            {showFill && !more && !dock && (
              <IconButton
                variant="player"
                onClick={cycleCrop}
                label={`Crop: ${cropModeLabel(crop)}`}
                data-crop={crop}
                title={withShortcut(`${cropModeLabel(crop)} (next: ${cropModeLabel(nextCrop)})`, "fill")}
              >
                {crop === "fit" ? <CropFit size={22} /> : crop === "bars" ? <CropBars size={22} /> : <CropFill size={22} />}
              </IconButton>
            )}
            {!dock && moreMenu}
            {!dock && fullscreenButton}
            {touchLock.available && (
              <IconButton variant="player" onClick={touchLock.lock} label="Lock screen" title="Lock screen">
                <Lock size={22} />
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

      {/* Centre transport, Netflix-style: bare glyphs, no button chrome. The desktop dock has Play/Pause in its row
          and the arrow keys for skipping, so only the buffering spinner stays in the middle there. */}
      {ready && started && dock && (
        <div className="player-center">
          {/* Shown only while a jump from the keys shows its "+10" (player.css); clicked then, it adds to it. */}
          <SkipTransport
            direction="back"
            seconds={seekStep}
            kick={kicks.back}
            onSkip={() => (seekBy(-seekStep), kick("back"))}
            label={`Back ${seekStep} seconds`}
            title={withShortcut(`Back ${seekStep}s`, "seekBack")}
          />
          <span className="player-center-gap">{frameSteps.spinner && <Spinner className="player-spinner" size="52px" label="Buffering" />}</span>
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
      {ready && started && !dock && (
        <div className="player-center">
          <SkipTransport
            direction="back"
            seconds={seekStep}
            kick={kicks.back}
            onSkip={() => (seekBy(-seekStep), kick("back"))}
            label={`Back ${seekStep} seconds`}
            title={withShortcut(`Back ${seekStep}s`, "seekBack")}
            {...controlHover}
          />
          <IconButton
            variant="transport"
            className="player-transport-main"
            onClick={togglePlay}
            label={paused ? "Play" : "Pause"}
            title={withShortcut("Play/Pause", "playPause")}
            {...controlHover}
          >
            {/* In px like the circle (player.css), not the rem a number gives. */}
            {frameSteps.spinner ? (
              <Spinner className="player-spinner" size="52px" label="Buffering" />
            ) : (
              <SwapIcon state={paused ? "play" : "pause"}>
                {paused ? (
                  <Play className="player-play-glyph" size="64px" fill="currentColor" strokeWidth={0} />
                ) : (
                  <Pause size="64px" fill="currentColor" strokeWidth={0} />
                )}
              </SwapIcon>
            )}
          </IconButton>
          <SkipTransport
            direction="forward"
            seconds={seekStep}
            kick={kicks.forward}
            onSkip={() => (seekBy(seekStep), kick("forward"))}
            label={`Forward ${seekStep} seconds`}
            title={withShortcut(`Forward ${seekStep}s`, "seekForward")}
            {...controlHover}
          />
        </div>
      )}

      {/* Paused on a stepped frame: once the controls hide, its number stays where the clock was (#346). */}
      {frameSteps.stepping && <FrameLabel media={media} fps={fps ?? DEFAULT_FPS} />}

      {/* Bottom: timeline with time left, then labelled text actions. The desktop dock puts what's playing above
          the timeline and every control in one row under it. */}
      <div className="player-bottom" {...controlHover}>
        {dock && (
          <div className="player-title">
            {/* Just the episode and the title: the picture and sound format isn't repeated here. */}
            {current && <span className="player-title-episode">{heading}</span>}
            <span className="player-title-name">{current ? title : heading}</span>
          </div>
        )}
        <div className="player-timeline" inert={!started || undefined}>
          <Scrubber
            media={media}
            previews={seekTrack}
            span={skip.segments?.intro}
            segments={skip.segments}
            active={chromeVisible && (!options || dock)}
            onSeek={seekTo}
            onScrubChange={onScrubChange}
          />
          {sleep.left != null && (
            <span className="player-sleep tabular" role="timer" aria-label={`Sleep timer: ${sleepLabel(sleep.left)} left`}>
              <Moon size={16} />
              {sleepLabel(sleep.left)}
            </span>
          )}
          <PlayerClock media={media} display={timeDisplay} rate={inParty ? 1 : playRate} onCycle={cycleClock} fps={frameSteps.stepping ? (fps ?? DEFAULT_FPS) : null} active={chromeVisible && (!options || dock)} />
        </div>
        {dock ? (
          <div ref={actionRow} className="player-dock">
            <div className="player-dock-group">
              <IconButton variant="player" onClick={togglePlay} label={paused ? "Play" : "Pause"} title={withShortcut(paused ? "Play" : "Pause", "playPause")}>
                <SwapIcon state={paused ? "play" : "pause"}>
                  {paused ? <Play size={24} fill="currentColor" strokeWidth={0} /> : <Pause size={24} fill="currentColor" strokeWidth={0} />}
                </SwapIcon>
              </IconButton>
              {volumeControl}
            </div>
            <div className="player-dock-group">
              {next && (
                <IconButton
                  variant="player"
                  onClick={() => playVideo(next.id)}
                  label={local ? "Next video" : "Next Episode"}
                  title={withShortcut(local ? "Next video" : "Next episode", "nextEpisode")}
                >
                  <SkipForward size={22} fill="currentColor" />
                </IconButton>
              )}
              {type === "series" && (
                <DockPanelButton panel="episodes" open={options} label={local ? "In this folder" : "Episodes"} title={withShortcut(local ? "In this folder" : "Episodes", "episodes")} onOpen={() => setOptions("episodes")} onClose={() => setOptions(null)}>
                  <Episodes size={22} />
                </DockPanelButton>
              )}
              {!ytId && (
                <DockPanelButton panel="tracks" open={options} label="Subtitles & Audio" title={withShortcut("Subtitles & audio", "tracks")} onOpen={(el) => openOptions("tracks", el)} onClose={() => setOptions(null)}>
                  <Captions size={22} />
                </DockPanelButton>
              )}
              {!party && (
                <DockPanelButton panel="speed" open={options} label={`Speed (${rate}x)`} title={withShortcut(`Speed (${rate}x)`, "speed")} onOpen={(el) => openOptions("speed", el)} onClose={() => setOptions(null)}>
                  <Speed size={22} />
                </DockPanelButton>
              )}
              {!link && !local && (
                <DockPanelButton panel="sources" open={options} label="Sources" title={withShortcut("Sources", "sources")} onOpen={() => setOptions("sources")} onClose={() => setOptions(null)}>
                  <Sources size={22} />
                </DockPanelButton>
              )}
              {canParty && !castingAway && (
                <DockPanelButton
                  panel="party"
                  open={options}
                  label={party ? `Watch Party (${party.members.length})` : "Watch Party"}
                  title={party ? `Watch Party (${party.members.length})` : "Watch Party"}
                  onOpen={() => setOptions("party")}
                  onClose={() => setOptions(null)}
                >
                  <WatchParty size={22} />
                </DockPanelButton>
              )}
              {castControls}
              {moreMenu}
              {fullscreenButton}
            </div>
          </div>
        ) : (
          <div ref={actionRow} className="player-actions" data-labels={barFit.labels}>
            {!party && (
              <ActionButton icon={<Speed size={22} />} label={`Speed (${rate}x)`} glyph={pad("speed")} onClick={(el) => openOptions("speed", el)} />
            )}
            {!phoneMore && <ActionButton icon={<Moon size={22} />} label="Sleep Timer" onClick={() => setOptions("sleep")} />}
            {type === "series" && (
              <ActionButton icon={<Episodes size={22} />} label={local ? "In this folder" : "Episodes"} glyph={pad("episodes")} onClick={() => setOptions("episodes")} />
            )}
            {/* YouTube's player keeps its own captions and audio. */}
            {!ytId && <ActionButton icon={<Captions size={22} />} label="Subtitles & Audio" glyph={pad("tracks")} onClick={(el) => openOptions("tracks", el)} />}
            {!link && !local && <ActionButton icon={<Sources size={22} />} label="Sources" glyph={pad("sources")} onClick={() => setOptions("sources")} />}
            {!phoneMore && canParty && !castingAway && (
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
        )}
      </div>

      {/* The sleep timer's last minute: more time, or no timer (#270). */}
      {sleep.warning && !sleep.asleep && (
        <div className="sleep-prompt" role="alertdialog" aria-label="Sleep timer">
          <span className="sleep-prompt-text">
            <Moon size={18} /> Stopping in {sleepLabel(sleep.left ?? 0)}
          </span>
          <Button size="sm" variant="primary" onClick={sleep.extend}>
            +15 min
          </Button>
          <Button size="sm" variant="glass" onClick={sleep.cancel}>
            Cancel
          </Button>
        </div>
      )}
      {sleep.asleep && (
        <div ref={sleepEndedRef} className="sleep-ended" role="dialog" aria-modal="true" aria-label="Sleep timer ended" tabIndex={-1} data-layer="">
          <Moon size={32} />
          <p className="sleep-ended-title">Sleep timer ended</p>
          <Button
            variant="primary"
            autoFocus
            onClick={() => {
              sleep.wake();
              void videoRef.current?.play();
            }}
          >
            <Play size={17} fill="currentColor" /> Resume
          </Button>
        </div>
      )}
      <OptionsOverlay
        open={options === "speed"}
        dockedTo={dock ? "speed" : undefined}
        onClose={() => setOptions(null)}
        media={media}
        columns={[
          {
            title: "Playback Speed",
            value: String(rate),
            options: SPEEDS.map((r) => ({ id: String(r), label: speedLabel(r) })),
            onSelect: (id: string) => {
              setRate(Number(id));
              if (!dock) setOptions(null);
            },
            // The dock: Netflix's line of speeds, the chosen one named beside the title.
            ...(dock
              ? {
                  header: <span className="options-value tabular">{speedLabel(rate)}</span>,
                  content: <SpeedLine speeds={SPEEDS} value={rate} onChange={setRate} label={speedLabel} />,
                }
              : {}),
          },
          // Desktop: keep the window on top of the others, locked in place (#266). The dock has it in More.
          ...(canPin && !dock
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
        open={options === "sleep"}
        dockedTo={dock ? "more" : undefined}
        onClose={() => setOptions(null)}
        media={media}
        columns={[
          {
            title: "Sleep Timer",
            value: sleep.choice,
            // A film or a single video stops at its own end.
            options: SLEEP_CHOICES.map((c) => (c.id === "episode" && type !== "series" ? { ...c, label: "When this video ends" } : c)),
            onSelect: (id: string) => {
              sleep.set(id as SleepChoice);
              setOptions(null);
            },
          },
        ]}
      />
      <OptionsOverlay
        open={options === "tracks"}
        dockedTo={dock ? "tracks" : undefined}
        live={form !== "phone" && (audioSettingsOpen || subSettingsOpen)}
        onClose={() => {
          setOptions(null);
          setSubSettingsOpen(false);
          setAudioSettingsOpen(false);
        }}
        foreground={subSettingsOpen ? <SubtitlePreview style={subStyle} media={media} /> : undefined}
        media={media}
        columns={[
          {
            title: "Audio",
            size: audioSettingsOpen ? "medium" : "narrow",
            // Delay and the sound options are mpv's.
            header:
              engine === "mpv" && !castingAway ? (
                dock ? (
                  // The dock: the list and its settings as two sides of one switch, either a click away.
                  <Segmented
                    label="Audio view"
                    value={audioSettingsOpen ? 1 : 0}
                    onChange={(v) => setAudioSettingsOpen(v === 1)}
                    options={[
                      { id: 0, label: "Tracks" },
                      { id: 1, label: "Sound" },
                    ]}
                  />
                ) : (
                  <IconButton variant="panel" aria-pressed={audioSettingsOpen} label="Audio settings" title="Audio settings" onClick={() => setAudioSettingsOpen((v) => !v)}>
                    <Cog size={19} strokeWidth={2.1} />
                  </IconButton>
                )
              ) : undefined,
            content: audioSettingsOpen ? <AudioSettings delay={audioDelay} onDelay={changeAudioDelay} /> : undefined,
            value: tracks.audio.length ? tracks.audioId : "default",
            options: tracks.audio.length ? tracks.audio : [{ id: "default", label: "Default" }],
            onSelect: tracks.selectAudio,
          },
          {
            title: "Subtitles",
            size: subSettingsOpen ? "medium" : "narrow",
            header: dock ? (
              <Segmented
                label="Subtitles view"
                value={subSettingsOpen ? 1 : 0}
                onChange={(v) => setSubSettingsOpen(v === 1)}
                options={[
                  { id: 0, label: "Tracks" },
                  { id: 1, label: "Style" },
                ]}
              />
            ) : (
              <IconButton variant="panel" aria-pressed={subSettingsOpen} label="Subtitle settings" title="Subtitle settings" onClick={() => setSubSettingsOpen((v) => !v)}>
                <Cog size={19} strokeWidth={2.1} />
              </IconButton>
            ),
            content: subSettingsOpen ? (
              <SubtitleSettings
                style={subStyle}
                onChange={(patch) => updateSettings.mutate({ subtitleStyle: { ...subStyle, ...patch } })}
                delay={subDelay}
                onDelay={changeSubDelay}
                onStepLine={engine === "mpv" && !castingAway ? (by) => void stepLine(by) : undefined}
                second={engine === "mpv" && !castingAway ? { on: secondSubtitles, onChange: (on) => setPrefs({ secondSubtitles: on }) } : undefined}
                canPosition={engine === "mpv"}
                look={dock ? "studio" : "rows"}
              />
            ) : undefined,
            value: tracks.subId,
            // Desktop with mpv: a subtitle file from this computer too.
            options: canPickSubtitle ? [...tracks.subtitles, { id: PICK_SUBTITLE, label: "Add from a File…", heading: "On This Computer" }] : tracks.subtitles,
            onSelect: (id) =>
              id === PICK_SUBTITLE
                ? void api.pickSubtitleFile().catch((e: unknown) => flashNotice(`Couldn't add the subtitle: ${errorMessage(e)}`, 4000))
                : void tracks.selectSubtitle(id),
            empty: tracks.subtitlesLoading ? "Loading…" : undefined,
          },
          // mpv: another language at the top (Settings → Subtitles & Audio, or the cog above).
          ...(engine === "mpv" && secondSubtitles && !castingAway
            ? [
                {
                  title: "Second Subtitles",
                  size: "narrow" as const,
                  value: tracks.secondId,
                  options: tracks.subtitles,
                  onSelect: (id: string) => void tracks.selectSecond(id),
                  empty: tracks.subtitlesLoading ? "Loading…" : undefined,
                },
              ]
            : []),
        ]}
      />

      {tv && <VolumeHud volume={Math.min(volume, volumeTop)} max={volumeTop} muted={muted} ping={volumePing} media={media} />}
      {/* Phones and tablets: the swipes' levels, each at the edge of its half. */}
      {touch && !tv && !systemVolume && (
        <VolumeHud volume={Math.min(volume, volumeTop)} max={volumeTop} muted={muted} ping={volumePing} media={media} side="right" held={swipe.active === "right"} />
      )}
      {brightness.available && <BrightnessHud brightness={brightness} held={swipe.active === "left"} media={media} />}

      <SkipButton
        active={started ? skip.active : null}
        onSkip={skip.skipActive}
        onCancel={skip.cancelCountdown}
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
            <div className="next-up-still" data-unwatched={nextUnwatched || undefined}>
              <Img src={stillFor(next.id) ?? next.thumbnail ?? meta?.background} alt="" />
            </div>
            <div className="next-up-text">
              <span className="next-up-kicker">
                {(ended || creditsRoll) && stillWatching
                  ? "Are you still watching?"
                  : local
                    ? "Up Next"
                    : `Up Next · ${episodeCode(next.season, next.episode)}`}
              </span>
              {skipped.length > 0 && !((ended || creditsRoll) && stillWatching) && (
                <span className="next-up-skipping">
                  Skipping filler: {skipped.length === 1 ? `episode ${skipped[0].episode}` : `episodes ${skipped[0].episode}–${skipped[skipped.length - 1].episode}`}
                </span>
              )}
              <span className="next-up-title">{next.title}</span>
              <div className="next-up-actions">
                <Button
                  variant="primary"
                  className="next-up-play"
                  title={withShortcut("Play next episode", "nextEpisode")}
                  onClick={() => {
                    resetAutoplay();
                    playVideo(next.id);
                  }}
                >
                  {autoAdvancing && (
                    <span className="next-up-countdown" data-paused={countdownPaused} style={{ animationDuration: `${countdown}s` }} />
                  )}
                  {pad("skipOrNext", "nextEpisode") ?? <Play size={16} fill="currentColor" />}{" "}
                  {(ended || creditsRoll) && stillWatching ? "Keep Watching" : "Play Now"}
                </Button>
                <IconButton variant="glass" className="next-up-dismiss" onClick={() => setNextDismissed(true)} label="Dismiss">
                  <Close size={16} />
                </IconButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Finished a movie or series finale: offer Replay and Back to Title instead of freezing on a black frame. */}
      {ended && !showNextUp && !castingAway && !sleep.asleep && !ytFramed && (
        <div className="player-ended-card" role="region" aria-label="Playback finished">
          <span className="player-ended-kicker">Finished</span>
          <span className="player-ended-title">{heading || title}</span>
          <div className="player-ended-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEnded(false);
                seekTo(0);
                void videoRef.current?.play().catch(() => {});
              }}
            >
              <Reset size={15} /> Replay
            </Button>
            <Button variant="glass" size="sm" onClick={() => void exit()}>
              Back to Title
            </Button>
          </div>
        </div>
      )}

      <PlayerPauseScreen
        meta={meta}
        videoId={videoId}
        media={media}
        unwatched={currentUnwatched}
        onSelectPerson={(person) => {
          if (person.tmdbId == null) return;
          void exit().then(() => navigate({ name: "person", id: person.tmdbId!, title: person.name }));
        }}
        state={{
          engine,
          playing: ready && started,
          paused,
          ended,
          buffering,
          controls: chromeVisible,
          layer: !!options || moreOpen || nativeMenu || !!sourceMenu || torrentNotice || sleep.warning || sleep.asleep,
          nextUp: showNextUp,
          notice: !!notice || (!!party && (party.notes.length > 0 || party.knockers.length > 0 || !!partyHoldText(party, videoId))),
          casting: castingAway,
          stepping: frameSteps.stepping,
        }}
      />
      <PlayerRatingPrompt
        meta={meta}
        type={type}
        metaId={metaId}
        videoId={videoId}
        state={{ ended, nextUp: showNextUp, follower: !!party && party.hostId !== party.me, local, link: isLinkId(metaId), shuffle: shuffled || shuffling }}
      />

      {party && (party.reactions?.length ?? 0) > 0 && (
        <div className="party-reactions-stage" aria-live="polite" aria-label="Party reactions">
          {(party.reactions ?? []).map((r) => (
            <span key={r.id} className="party-reaction-float">
              <span className="party-reaction-emoji" aria-hidden>
                {r.emoji}
              </span>
              {r.who?.name && <span className="party-reaction-who">{r.who.name}</span>}
            </span>
          ))}
        </div>
      )}

      {canParty && (
        <OptionsOverlay
          open={options === "party"}
          dockedTo={dock ? "party" : undefined}
          onClose={() => setOptions(null)}
          media={media}
          columns={partyColumns}
        />
      )}

      <OptionsOverlay
        open={options === "episodes"}
        dockedTo={dock ? "episodes" : undefined}
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
            : // The desktop dock: one list, Netflix's way, the season named above it (EpisodeMenu).
              dock && meta
              ? [
                  {
                    title: "Episodes",
                    size: "wide",
                    titleHidden: true,
                    options: [],
                    onSelect: () => {},
                    content: (
                      <EpisodeMenu
                        meta={meta}
                        seasons={seasonGroups.map((g) => ({ id: g.id, label: g.label }))}
                        season={shownSeason}
                        onSeason={setPickSeason} // browse; playback continues
                        episodes={shownEpisodes}
                        numbers={order?.number}
                        playing={videoId}
                        progress={progressById}
                        still={(v) => stillFor(v.id) ?? v.thumbnail}
                        header={shuffleButton}
                        onPlay={(id) => {
                          setOptions(null);
                          pickEpisode(id);
                        }}
                      />
                    ),
                  },
                ]
            : episodeLayout === "list" || !meta
            ? [
                {
                  title: "Seasons",
                  value: String(shownSeason),
                  options: seasonGroups.map((g) => ({ id: String(g.id), label: g.label })),
                  onSelect: (id) => setPickSeason(Number(id)), // browse; playback continues
                },
                {
                  title: "Episodes",
                  size: "wide",
                  header: meta && (
                    <>
                      {layoutSwitch}
                      {shuffleButton}
                    </>
                  ),
                  value: videoId,
                  options: episodeItems,
                  onSelect: (id) => id !== videoId && pickEpisode(id),
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
                        options={seasonGroups.map((g) => ({ value: String(g.id), label: g.label }))}
                      />
                      {layoutSwitch}
                      {shuffleButton}
                    </div>
                  ),
                  options: [],
                  onSelect: () => {},
                  content: (
                    <EpisodeRail
                      meta={meta}
                      episodes={shownEpisodes}
                      numbers={order?.number}
                      playing={videoId}
                      progress={progressById}
                      still={(v) => stillFor(v.id) ?? v.thumbnail}
                      onPlay={(id) => {
                        setOptions(null);
                        pickEpisode(id);
                      }}
                    />
                  ),
                },
              ]
        }
      />
      <OptionsOverlay
        open={options === "sources"}
        dockedTo={dock ? "sources" : undefined}
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
      {/* Over everything while locked: touches go nowhere but its Unlock chip; playback carries on. */}
      {touchLock.locked && (
        <TouchLockLayer
          onUnlock={() => {
            touchLock.unlock();
            poke(false, "unlocked");
          }}
        />
      )}
    </div>
  );
}

/** The Sources row of this video's finished download (#23); the others are indexes into the ranked list. */
const DOWNLOADED = "downloaded";

/**
 * Playing on a TV (AirPlay, Chromecast): the show's art, what plays where above the centre controls, which drive
 * the TV, and the way back below them, so the two never overlap (player.css).
 */
function CastingPanel({ art, icon, title, hint, action }: { art?: string; icon: React.ReactNode; title: string; hint: string; action: React.ReactNode }) {
  return (
    <div className="player-casting">
      {art && <Img className="player-status-bg" src={art} alt="" />}
      <div className="player-casting-content">
        <div className="player-casting-head">
          {icon}
          <p className="t-title2">{title}</p>
          <p className="t-callout player-casting-hint">{hint}</p>
        </div>
        <div className="player-casting-gap" aria-hidden />
        <div className="player-casting-action">{action}</div>
      </div>
    </div>
  );
}

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

/**
 * A button in the desktop dock that opens one of the player's panels above itself (OptionsOverlay's `dockedTo`
 * finds it by `data-panel`). Pressed again, it closes the panel.
 */
function DockPanelButton({
  panel,
  open,
  label,
  title,
  onOpen,
  onClose,
  children,
}: {
  panel: string;
  /** The panel open now, if any. */
  open: string | null;
  label: string;
  title: string;
  onOpen: (el: HTMLButtonElement) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const isOpen = open === panel;
  return (
    <IconButton
      variant="player"
      data-panel={panel}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      label={label}
      title={title}
      onClick={(e) => (isOpen ? onClose() : onOpen(e.currentTarget))}
    >
      {children}
    </IconButton>
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
 * Android and iOS phones and tablets (#179, #460): their volume buttons and the system's volume
 * panel or Control Centre set the volume, so the player has no volume button or slider and plays
 * at full volume itself (a level or mute set before can't be left stuck with nothing to undo it).
 * Android TV keeps the remote's volume HUD.
 */
const systemVolume = (os === "android" || os === "ios") && !isTvDevice;

/** The volume last set, 0–1 (1 when none was, or it isn't a number; always 1 where the system sets it). */
function savedVolume() {
  if (systemVolume) return 1;
  const v = Number(localStorage.getItem("polar.volume") ?? 1);
  return Number.isFinite(v) ? Math.min(Math.max(...MAX_VOLUMES), Math.max(0, v)) : 1;
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

/** Crisp double fast-forward chevrons for the Hold-for-2x pill. */
function HoldChevrons() {
  return (
    <svg className="player-hold-chevrons" width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path className="player-hold-c1" d="M3.25 3.75 7.75 8l-4.5 4.25" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path className="player-hold-c2" d="M8.5 3.75 13 8l-4.5 4.25" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
