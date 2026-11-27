import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { PlayerClock, type TimeDisplay } from "../components/player/PlayerClock";
import { Scrubber } from "../components/player/Scrubber";
import { SkipTransport } from "../components/player/SkipTransport";
import type { CastDevice } from "../components/player/chromecast";
import type { MediaLike } from "../components/player/mpvMedia";
import { Spinner } from "../components/Spinner";
import { SwapIcon } from "../components/SwapIcon";
import { MenuCheckItem, MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../components/ui/Menu";
import { WindowControls } from "../components/WindowControls";
import { WATCH_LOG } from "../lib/playback/watchLog";
import { sleepLabel } from "../lib/playback/sleepTimer";
import { cropModeLabel, shortcutText, withShortcut, type CropMode } from "../lib/settings";
import { useSimklTitle } from "../lib/simkl";
import { useTraktRating } from "../lib/trakt";
import type { ContentType, SeekTrack, SkipSegments, Video } from "../lib/types";
import {
  IconAirPlay,
  IconAudioSubs,
  IconCast,
  IconEpisodes,
  IconExitFullscreen,
  IconFullscreen,
  IconLock,
  IconMoon,
  IconMore,
  IconNextEpisode,
  IconParty,
  IconPauseSolid,
  IconPip,
  IconPlayerClose,
  IconPlaySolid,
  IconSources,
  IconSpeed,
  IconSun,
  IconThumbDown,
  IconThumbLove,
  IconThumbUp,
  IconVolume,
  IconVolumeMuted,
  IconWindowExitFullscreen,
  IconWindowFullscreen,
} from "./DeskPlayerIcons";
import type { DeskSheetKind } from "./DeskPlayerSheets";
import "./deskPlayer.css";

export interface DeskPlayerChromeProps {
  type: ContentType;
  metaId: string;
  title: string;
  current?: Video;
  local: boolean;
  link?: string;
  ytId?: string;
  pinned: boolean;
  fullscreen: boolean;
  isDesktop: boolean;
  ready: boolean;
  started: boolean;
  paused: boolean;
  spinner: boolean;
  chromeVisible: boolean;
  options: DeskSheetKind | null;
  // Navigation / transport
  onExit: () => void;
  onTogglePlay: () => void;
  seekStep: number;
  kicks: { back: number; forward: number };
  onSeekBack: () => void;
  onSeekForward: () => void;
  // Scrubber & clock
  media: MediaLike | null;
  seekTrack?: SeekTrack | null;
  segments?: SkipSegments | null;
  onSeekTo: (t: number) => void;
  onScrubChange: (scrubbing: boolean) => void;
  timeDisplay: TimeDisplay;
  playRate: number;
  onCycleClock: () => void;
  steppingFps: number | null;
  sleepLeft: number | null;
  // Volume
  systemVolume: boolean;
  volume: number;
  volumeTop: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  // Brightness (tablets / iPads)
  brightnessAvailable: boolean;
  brightnessLevel: number | null;
  onBrightness: (level: number) => void;
  // Cast / PiP / Lock / Fullscreen / More
  airplay: { available: boolean; casting: boolean; pick: () => void };
  chromecast: { available: boolean; casting: CastDevice | null; devices: CastDevice[]; start: (d: CastDevice) => void; stop: () => void };
  canMini: boolean;
  mini: boolean;
  onToggleMini: () => void;
  canPin: boolean;
  onTogglePin: () => void;
  showFill: boolean;
  crop: CropMode;
  onCycleCrop: () => void;
  touchLockAvailable: boolean;
  onTouchLock: () => void;
  onToggleFullscreen: () => void;
  canShoot: boolean;
  shotSaved: boolean;
  onScreenshot: () => void;
  onRevealScreenshot: () => void;
  canHandOff: boolean;
  otherPlayers: { id: string; name: string }[];
  onHandOff: (p: { id: string; name: string }) => void;
  watchLog: boolean;
  onCopyWatchLog: () => void;
  onMoreOpenChange: (open: boolean) => void;
  // Bottom bar actions
  rate: number;
  inParty: boolean;
  canParty: boolean;
  castingAway: boolean;
  partyMembers: number;
  partyBadge?: ReactNode;
  next?: Video;
  onPlayNext: () => void;
  onOpenSheet: (sheet: DeskSheetKind) => void;
  controlHover: { onPointerEnter: (e: { pointerType?: string }) => void; onPointerLeave: () => void };
}

/**
 * 1:1 Netflix iPad / desktop player HUD (IMG_3251):
 * - Top-left: crisp ✕ + single-line S1:E1 “Title”
 * - Top-center: circular rating pills (when Trakt/Simkl is linked)
 * - Top-right: minimal outline icon cluster (Volume, Cast, Sleep Timer, Watch Party, PiP, Lock, More)
 * - Left edge: slim vertical brightness bar (on devices that expose screen brightness)
 * - Center: widely spaced 10s-back, solid Play/Pause, 10s-forward
 * - Bottom: thin accent scrubber with permanent dot + remaining time, and centered outline icon+label actions
 */
export function DeskPlayerChrome(p: DeskPlayerChromeProps) {
  const episodeHeading =
    !p.local && p.current
      ? `S${p.current.season}:E${p.current.episode}${p.current.title?.trim() ? ` “${p.current.title.trim()}”` : ""}`
      : p.current?.title || p.title;

  const hasMoreItems = p.canPin || p.canShoot || p.canHandOff || p.watchLog;
  const activeScrubber = p.chromeVisible && (!p.options || p.options === "tracks" || p.options === "episodes");
  const cropActionLabel = p.crop === "fit" ? "Crop" : p.crop === "bars" ? "Crop (Bars)" : "Crop (Fill)";

  return (
    <>
      {/* Top bar: ✕ + single-line title left, optional ratings center, crisp outline actions right */}
      <div className="dk-pl-top" data-tauri-drag-region={p.pinned ? undefined : true} {...p.controlHover}>
        <div className="dk-pl-top-start" data-tauri-drag-region={p.pinned ? undefined : true}>
          <button
            type="button"
            className="dk-pl-icon dk-pl-close"
            onClick={p.onExit}
            aria-label="Back"
            title="Back (Esc)"
          >
            <IconPlayerClose size={24} stroke={1.85} />
          </button>
          <span className="dk-pl-title" data-tauri-drag-region={p.pinned ? undefined : true}>
            {episodeHeading}
          </span>
        </div>

        <div className="dk-pl-top-center">
          {!p.local && !p.link && <DeskRatingPills type={p.type} metaId={p.metaId} />}
        </div>

        <div className="dk-pl-top-end">
          {p.partyBadge}

          {!p.systemVolume && (
            <div className="dk-pl-vol">
              <button
                type="button"
                className="dk-pl-icon"
                onClick={p.onToggleMute}
                aria-label={p.muted ? "Unmute" : "Mute"}
                title={withShortcut(p.muted ? "Unmute" : "Mute", "mute")}
              >
                {p.muted || p.volume === 0 ? <IconVolumeMuted size={22} /> : <IconVolume size={22} />}
              </button>
              <span className="dk-pl-vol-pop">
                <input
                  type="range"
                  min={0}
                  max={p.volumeTop}
                  step={0.01}
                  value={p.muted ? 0 : Math.min(p.volume, p.volumeTop)}
                  onChange={(e) => p.onVolume(Number(e.target.value))}
                  aria-label="Volume"
                  aria-valuetext={`${Math.round((p.muted ? 0 : Math.min(p.volume, p.volumeTop)) * 100)}%`}
                  style={{ "--value": `${((p.muted ? 0 : Math.min(p.volume, p.volumeTop)) / p.volumeTop) * 100}%` } as CSSProperties}
                />
              </span>
            </div>
          )}

          <button
            type="button"
            className="dk-pl-icon"
            data-active={p.sleepLeft != null || undefined}
            onClick={() => p.onOpenSheet("sleep")}
            aria-label="Sleep Timer"
            title={p.sleepLeft != null ? `Sleep Timer (${sleepLabel(p.sleepLeft)})` : "Sleep Timer"}
          >
            <IconMoon size={20} />
          </button>

          {p.canParty && !p.castingAway && (
            <button
              type="button"
              className="dk-pl-icon"
              data-active={p.inParty || undefined}
              onClick={() => p.onOpenSheet("party")}
              aria-label={p.inParty ? `Watch Party (${p.partyMembers})` : "Watch Party"}
              title={p.inParty ? `Watch Party (${p.partyMembers})` : "Watch Party"}
            >
              <IconParty size={21} />
            </button>
          )}

          {p.airplay.available && (
            <button
              type="button"
              className="dk-pl-icon"
              aria-pressed={p.airplay.casting}
              onClick={p.airplay.pick}
              aria-label="AirPlay"
              title="AirPlay"
            >
              <IconAirPlay size={22} />
            </button>
          )}

          {p.chromecast.available && (
            <MenuRoot modal={false} onOpenChange={p.onMoreOpenChange}>
              <MenuTrigger className="dk-pl-icon" aria-label="Cast to a TV" title="Cast to a TV" aria-pressed={!!p.chromecast.casting}>
                <IconCast size={22} />
              </MenuTrigger>
              <MenuPopup sideOffset={8} align="end" collisionPadding={12} aria-label="Cast to a TV" className="scheme-dark dk-pl-menu">
                {p.chromecast.devices.map((d) => (
                  <MenuCheckItem
                    key={d.id}
                    checked={p.chromecast.casting?.id === d.id}
                    onCheckedChange={() => (p.chromecast.casting?.id === d.id ? p.chromecast.stop() : p.chromecast.start(d))}
                  >
                    {d.name}
                  </MenuCheckItem>
                ))}
                {p.chromecast.casting && <MenuItem onClick={p.chromecast.stop}>Stop Casting</MenuItem>}
              </MenuPopup>
            </MenuRoot>
          )}

          {p.canMini && (
            <button
              type="button"
              className="dk-pl-icon"
              aria-pressed={p.mini}
              onClick={p.onToggleMini}
              aria-label="Picture in Picture"
              title={withShortcut("Picture in Picture", "miniPlayer")}
            >
              <IconPip size={22} />
            </button>
          )}

          {p.touchLockAvailable && (
            <button type="button" className="dk-pl-icon" onClick={p.onTouchLock} aria-label="Lock screen" title="Lock screen">
              <IconLock size={21} />
            </button>
          )}

          {p.isDesktop && (
            <button
              type="button"
              className="dk-pl-icon"
              aria-pressed={p.fullscreen || undefined}
              onClick={p.onToggleFullscreen}
              aria-label={p.fullscreen ? "Exit Full Screen" : "Full Screen"}
              title={withShortcut(p.fullscreen ? "Exit Full Screen" : "Full Screen", "fullscreen")}
            >
              {p.fullscreen ? <IconWindowExitFullscreen size={21} /> : <IconWindowFullscreen size={21} />}
            </button>
          )}

          {hasMoreItems && (
            <MenuRoot modal={false} onOpenChange={p.onMoreOpenChange}>
              <MenuTrigger className="dk-pl-icon" aria-label="More" title="More">
                <IconMore size={22} />
              </MenuTrigger>
              <MenuPopup sideOffset={8} align="end" collisionPadding={12} aria-label="More" className="scheme-dark dk-pl-menu">
                {p.canPin && !p.fullscreen && (
                  <MenuCheckItem checked={p.pinned} onCheckedChange={p.onTogglePin} meta={shortcutText("pinWindow")}>
                    Pin window on top
                  </MenuCheckItem>
                )}
                <MenuItem onClick={() => p.onOpenSheet("sleep")} meta={p.sleepLeft != null ? sleepLabel(p.sleepLeft) : undefined}>
                  Sleep Timer
                </MenuItem>
                {p.canShoot && (
                  <MenuItem onClick={p.onScreenshot} meta={shortcutText("screenshot")}>
                    Save Screenshot
                  </MenuItem>
                )}
                {p.canShoot && p.shotSaved && <MenuItem onClick={p.onRevealScreenshot}>Show Last Screenshot</MenuItem>}
                {p.canHandOff &&
                  p.otherPlayers.map((pl) => (
                    <MenuItem key={pl.id} onClick={() => p.onHandOff(pl)}>
                      {`Play in ${pl.name}`}
                    </MenuItem>
                  ))}
                {WATCH_LOG && p.watchLog && <MenuItem onClick={p.onCopyWatchLog}>Copy Watch Log</MenuItem>}
              </MenuPopup>
            </MenuRoot>
          )}

          {!p.fullscreen && <WindowControls pinned={p.pinned} />}
        </div>
      </div>

      {/* Left-edge vertical brightness bar (IMG_3251), shown on devices with screen brightness control */}
      {p.brightnessAvailable && p.brightnessLevel != null && (
        <DeskBrightnessBar level={p.brightnessLevel} onChange={p.onBrightness} {...p.controlHover} />
      )}

      {/* Centre transport (IMG_3251): widely spaced 10s-back, crisp Play/Pause, 10s-forward */}
      {p.ready && p.started && (
        <div className="dk-pl-center">
          <SkipTransport
            direction="back"
            seconds={p.seekStep}
            kick={p.kicks.back}
            onSkip={p.onSeekBack}
            label={`Back ${p.seekStep} seconds`}
            title={withShortcut(`Back ${p.seekStep}s`, "seekBack")}
            {...p.controlHover}
          />
          <button
            type="button"
            className="dk-pl-play"
            onClick={p.onTogglePlay}
            aria-label={p.paused ? "Play" : "Pause"}
            title={withShortcut("Play/Pause", "playPause")}
            {...p.controlHover}
          >
            {p.spinner ? (
              <Spinner className="player-spinner" size="calc(48 * var(--pl-pt, 1px))" label="Buffering" />
            ) : (
              <SwapIcon state={p.paused ? "play" : "pause"}>
                {p.paused ? <IconPlaySolid size={52} className="dk-pl-play-tri" /> : <IconPauseSolid size={50} />}
              </SwapIcon>
            )}
          </button>
          <SkipTransport
            direction="forward"
            seconds={p.seekStep}
            kick={p.kicks.forward}
            onSkip={p.onSeekForward}
            label={`Forward ${p.seekStep} seconds`}
            title={withShortcut(`Forward ${p.seekStep}s`, "seekForward")}
            {...p.controlHover}
          />
        </div>
      )}

      {/* Bottom timeline + centered Netflix action row (IMG_3251) */}
      <div className="dk-pl-bottom" {...p.controlHover}>
        <div className="dk-pl-timeline" inert={!p.started || undefined}>
          <Scrubber
            media={p.media}
            previews={p.seekTrack}
            span={p.segments?.intro}
            segments={p.segments}
            active={activeScrubber}
            onSeek={p.onSeekTo}
            onScrubChange={p.onScrubChange}
          />
          {p.sleepLeft != null && (
            <button
              type="button"
              className="dk-pl-sleep-pill tabular"
              role="timer"
              aria-label={`Sleep timer: ${sleepLabel(p.sleepLeft)} left`}
              onClick={() => p.onOpenSheet("sleep")}
            >
              <IconMoon size={14} />
              <span>{sleepLabel(p.sleepLeft)}</span>
            </button>
          )}
          <PlayerClock
            media={p.media}
            display={p.timeDisplay}
            rate={p.inParty ? 1 : p.playRate}
            onCycle={p.onCycleClock}
            fps={p.steppingFps}
            active={activeScrubber}
          />
        </div>

        <div className="dk-pl-actions">
          {!p.inParty && (
            <DeskAction
              icon={<IconSpeed size={20} />}
              label={`Speed (${p.rate}x)`}
              active={p.options === "speed"}
              title={withShortcut(`Speed (${p.rate}x)`, "speed")}
              onClick={() => p.onOpenSheet("speed")}
            />
          )}
          {p.type === "series" && (
            <DeskAction
              icon={<IconEpisodes size={20} />}
              label={p.local ? "In this folder" : "Episodes"}
              active={p.options === "episodes"}
              title={withShortcut(p.local ? "In this folder" : "Episodes", "episodes")}
              onClick={() => p.onOpenSheet("episodes")}
            />
          )}
          {!p.ytId && (
            <DeskAction
              icon={<IconAudioSubs size={20} />}
              label="Audio & Subtitles"
              active={p.options === "tracks"}
              title={withShortcut("Audio & Subtitles", "tracks")}
              onClick={() => p.onOpenSheet("tracks")}
            />
          )}
          {!p.link && !p.local && (
            <DeskAction
              icon={<IconSources size={20} />}
              label="Sources"
              active={p.options === "sources"}
              title={withShortcut("Sources", "sources")}
              onClick={() => p.onOpenSheet("sources")}
            />
          )}
          {p.next && (
            <DeskAction
              icon={<IconNextEpisode size={20} />}
              label={p.local ? "Next video" : "Next Episode"}
              title={withShortcut(p.local ? "Next video" : "Next Episode", "nextEpisode")}
              onClick={p.onPlayNext}
            />
          )}
          {p.showFill && (
            <DeskAction
              icon={p.crop !== "fit" ? <IconExitFullscreen size={20} /> : <IconFullscreen size={20} />}
              label={cropActionLabel}
              active={p.crop !== "fit"}
              title={withShortcut(`Crop: ${cropModeLabel(p.crop)}`, "fill")}
              onClick={p.onCycleCrop}
            />
          )}
        </div>
      </div>
    </>
  );
}

function DeskAction({
  icon,
  label,
  active,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="dk-pl-action"
      aria-pressed={active || undefined}
      title={title ?? label}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** Top-center Netflix rating pills (IMG_3251), wired to linked Trakt / Simkl ratings when available. */
function DeskRatingPills({ type, metaId }: { type: ContentType; metaId: string }) {
  const item = { id: metaId, type };
  const trakt = useTraktRating(item);
  const simkl = useSimklTitle(item);
  if (!trakt && !simkl) return null;

  const current = trakt?.rating ?? simkl?.rating ?? null;
  const pick = (score: number) => {
    const next = current === score ? null : score;
    trakt?.rate(next);
    if (next !== null) simkl?.rate(next);
  };

  return (
    <div className="dk-pl-ratings" role="group" aria-label="Rate this title">
      <button
        type="button"
        className="dk-pl-rate"
        aria-label="Not for me"
        aria-pressed={current !== null && current <= 4}
        onClick={() => pick(3)}
      >
        <IconThumbDown size={18} />
      </button>
      <button
        type="button"
        className="dk-pl-rate"
        aria-label="I like this"
        aria-pressed={current !== null && current >= 5 && current <= 8}
        onClick={() => pick(8)}
      >
        <IconThumbUp size={18} />
      </button>
      <button
        type="button"
        className="dk-pl-rate"
        aria-label="Love this!"
        aria-pressed={current !== null && current >= 9}
        onClick={() => pick(10)}
      >
        <IconThumbLove size={19} />
      </button>
    </div>
  );
}

/** Left-edge vertical brightness bar (IMG_3251): sun icon above slim vertical track. */
function DeskBrightnessBar({
  level,
  onChange,
  onPointerEnter,
  onPointerLeave,
}: {
  level: number;
  onChange: (n: number) => void;
  onPointerEnter: (e: { pointerType?: string }) => void;
  onPointerLeave: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const pick = (clientY: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r || r.height <= 0) return;
    const next = Math.max(0.02, Math.min(1, 1 - (clientY - r.top) / r.height));
    onChange(next);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pick(e.clientY);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientY);
  };
  const pct = Math.max(0, Math.min(1, level));

  return (
    <div className="dk-pl-bright" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <IconSun size={21} className="dk-pl-bright-icon" />
      <div
        ref={rail}
        className="dk-pl-bright-rail"
        role="slider"
        tabIndex={0}
        aria-label="Brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <span className="dk-pl-bright-track">
          <span className="dk-pl-bright-fill" style={{ height: `${pct * 100}%` }} />
        </span>
      </div>
    </div>
  );
}
