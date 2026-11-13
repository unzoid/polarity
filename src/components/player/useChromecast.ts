import { useEffect, useRef, useState } from "react";
import { call, inShell, isDesktop, on } from "../../lib/platform";
import { errorMessage, warnFailed } from "../../lib/errors";
import { castableUrl } from "./airplay";
import { CastMedia, watchDevices, type CastDevice, type CastUpdate } from "./chromecast";
import type { MediaLike } from "./mpvMedia";

/**
 * Chromecast for the playing link (chromecast.ts). `media` is what plays in the app; while casting the
 * player drives the returned `media` (the TV) instead, and stopping hands back at the TV's position.
 * Off (no button) when `enabled` is false: in a watch party, or while AirPlay casts.
 */
export function useChromecast({
  media,
  url,
  headers,
  title,
  subtitle,
  artwork,
  enabled,
  onProblem,
}: {
  media: MediaLike | null;
  url?: string;
  headers?: Record<string, string> | null;
  title: string;
  subtitle?: string;
  artwork?: string;
  enabled: boolean;
  /** Why a cast didn't start or stopped with an error, for the player's notice. */
  onProblem: (text: string) => void;
}) {
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [cast, setCast] = useState<{ media: CastMedia; device: CastDevice } | null>(null);
  const live = useRef({ media, onProblem, cast });
  live.current = { media, onProblem, cast };
  const supported = isDesktop && inShell;

  useEffect(() => {
    if (!supported || !enabled) return;
    return watchDevices(setDevices);
  }, [supported, enabled]);

  /** Back to the app at the TV's position, playing unless the TV had finished or paused. */
  const handBack = (c: { media: CastMedia }, play: boolean) => {
    const base = live.current.media;
    setCast(null);
    if (!base) return;
    base.currentTime = c.media.currentTime;
    if (play) void base.play().catch(() => {});
  };

  // What the TV does; a failure or the end hands playback back.
  useEffect(() => {
    if (!cast) return;
    const off = on<CastUpdate>("cast://status", (u) => {
      cast.media.update(u);
      if (u.cast !== cast.media.id || u.kind === "status") return;
      if (u.kind === "failed") live.current.onProblem(`${u.reason} Playing here again.`);
      handBack(cast, u.kind === "failed");
    });
    return () => void off.then((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast]);

  // Leaving the player (or this link) ends the cast.
  useEffect(() => {
    if (!cast) return;
    return () => void call("cast_stop").catch(warnFailed("cast_stop"));
  }, [cast]);

  const available = supported && enabled && !!url && castableUrl(url, headers) && (devices.length > 0 || !!cast);

  const start = async (device: CastDevice) => {
    const base = live.current.media;
    if (!url || !base) return;
    const at = base.currentTime || 0;
    const wasPlaying = !base.paused;
    base.pause();
    const m = new CastMedia(at, base.volume);
    try {
      m.id = await call<number>("cast_play", { device: device.id, url, title, subtitle, artwork, start: at });
      setCast({ media: m, device });
    } catch (e) {
      live.current.onProblem(`Couldn't cast to ${device.name}: ${errorMessage(e)}`);
      if (wasPlaying) void base.play().catch(() => {});
    }
  };

  return {
    available,
    devices,
    casting: cast?.device ?? null,
    media: cast?.media ?? null,
    start: (device: CastDevice) => void start(device),
    stop: () => {
      const c = live.current.cast;
      if (!c) return;
      void call("cast_stop").catch(warnFailed("cast_stop"));
      handBack(c, !c.media.paused);
    },
  };
}
