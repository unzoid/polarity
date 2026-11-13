/**
 * Chromecast from the desktop app (#443, phase 1). The receivers and the cast itself are src-tauri's
 * (cast.rs, crates/cast); here a CastMedia stands in for the <video> while the TV plays, as AirPlay's
 * hidden element does (airplay.ts): the player's controls, progress saving and sleep timer drive it like
 * any other player. The TV fetches the link itself, so only links castableUrl allows go to it.
 */
import { call, on, type Unlisten } from "../../lib/platform";
import { warnFailed } from "../../lib/errors";
import type { MediaLike } from "./mpvMedia";

export interface CastDevice {
  id: string;
  name: string;
  model: string;
}

type PlayState = "loading" | "playing" | "paused" | "buffering" | "idle";

/** What src-tauri's cast.rs sends as `cast://status`. */
export type CastUpdate =
  | { kind: "status"; cast: number; state: PlayState; position: number; duration: number | null; volume: number | null; muted: boolean | null }
  | { kind: "failed"; cast: number; reason: string }
  | { kind: "ended"; cast: number; reason: "finished" | "stopped" };

/** The TV's volume (0–1) for a player amplitude, and back: the slider's loudness curve (lib/playback/volume.ts). */
const toTv = (amplitude: number) => Math.min(1, Math.max(0, amplitude) ** 0.6);
const fromTv = (level: number) => Math.max(0, level) ** (1 / 0.6);

export class CastMedia extends EventTarget implements MediaLike {
  /** The cast's number, once cast_play has answered: updates for other casts are ignored. */
  id: number | null = null;
  private time: number;
  private stamp = performance.now();
  private dur = NaN;
  private state: PlayState = "loading";
  private vol = 1;
  private isMuted = false;
  private isEnded = false;
  playbackRate = 1;

  /** `start` and `volume` as the app's player had them; the TV reports its own once it plays. */
  constructor(start: number, volume = 1) {
    super();
    this.time = start;
    this.vol = volume;
  }

  /** An update from the TV; `onOver` hears a failure or the end. */
  update(u: CastUpdate) {
    if (u.cast !== this.id) return;
    if (u.kind !== "status") {
      if (u.kind === "ended" && u.reason === "finished") {
        this.isEnded = true;
        this.emit("ended");
      }
      return;
    }
    const was = this.state;
    this.time = u.position;
    this.stamp = performance.now();
    this.state = u.state;
    if (u.duration && u.duration !== this.dur) {
      const first = !Number.isFinite(this.dur);
      this.dur = u.duration;
      this.emit(first ? "loadedmetadata" : "durationchange");
    }
    if (u.volume != null) this.vol = fromTv(u.volume);
    if (u.muted != null) this.isMuted = u.muted;
    if (u.state !== was) {
      if (u.state === "playing") {
        this.emit("play");
        this.emit("playing");
      } else if (u.state === "paused") this.emit("pause");
      else if (u.state === "buffering" || u.state === "loading") this.emit("waiting");
    }
    this.emit("timeupdate");
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type));
  }

  private control(action: string, value?: number) {
    void call("cast_control", { action, value }).catch(warnFailed("cast_control"));
  }

  get currentTime() {
    if (this.state !== "playing") return this.time;
    const t = this.time + (performance.now() - this.stamp) / 1000;
    return Number.isFinite(this.dur) ? Math.min(t, this.dur) : t;
  }
  set currentTime(t: number) {
    this.time = t;
    this.stamp = performance.now();
    this.isEnded = false;
    this.control("seek", t);
    this.emit("seeking");
    this.emit("timeupdate");
  }
  get duration() {
    return this.dur;
  }
  get paused() {
    return this.state !== "playing" && this.state !== "buffering" && this.state !== "loading";
  }
  get ended() {
    return this.isEnded;
  }
  get readyState() {
    return Number.isFinite(this.dur) ? 4 : 0;
  }
  get buffered(): TimeRanges {
    const end = this.currentTime;
    return { length: 1, start: () => 0, end: () => end } as TimeRanges;
  }
  get volume() {
    return this.vol;
  }
  set volume(v: number) {
    if (Math.abs(v - this.vol) < 0.005) return;
    this.vol = v;
    this.control("volume", toTv(v));
  }
  get muted() {
    return this.isMuted;
  }
  set muted(m: boolean) {
    if (m === this.isMuted) return;
    this.isMuted = m;
    this.control(m ? "mute" : "unmute");
  }
  play() {
    this.control("play");
    return Promise.resolve();
  }
  pause() {
    this.control("pause");
  }
}

/** The receivers on the network, kept up to date; starts looking on first use. */
export function watchDevices(onChange: (devices: CastDevice[]) => void): () => void {
  let off: Promise<Unlisten> | undefined = on<CastDevice[]>("cast://devices", onChange);
  void call<CastDevice[]>("cast_devices").then(onChange, warnFailed("cast_devices"));
  return () => {
    void off?.then((f) => f());
    off = undefined;
  };
}
