import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useSettings } from "../lib/net";
import { prefersReducedMotion } from "../lib/ui";
import { useFileTrailer } from "../lib/playback";

/** How long a title's page shows its art before the trailer takes over. */
const DELAY_MS = 4000;
/** Smooth audio fade on mute/unmute and scroll-pause instead of a 0ms hard cut. */
const AUDIO_RAMP_MS = 220;

export type BackdropTrailerState = "idle" | "playing" | "paused" | "ended";

export interface BackdropTrailerHandle {
  node: React.ReactNode;
  visible: boolean;
  state: BackdropTrailerState;
  muted: boolean;
  toggleMute: () => void;
  replay: () => void;
}

/**
 * A title's trailer playing behind its page. Only a trailer the app has as a
 * video file (IMDb's, up to 1080p, in a plain <video>): never a YouTube
 * embed, whose terms don't allow UI over the player. A title without one
 * keeps its art. After a few seconds on the page the art cross-fades into
 * the trailer (muted unless Settings say otherwise), and back to the art
 * when it ends. Settings → Browsing turns it off. It covers the backdrop
 * with a fixed 8% zoom (detail.css), enough for slim bars inside the picture.
 *
 * The video only shows once it's actually playing, so a slow start or an
 * error never shows a spinner or black over the art. `active` false (another
 * page on top, the player open) removes it; `paused` (scrolled down to the
 * episodes, a sheet open) pauses it behind the art.
 */
export function useBackdropTrailer(
  imdbId: string | undefined,
  { active, paused = false, scroller }: { active: boolean; paused?: boolean; scroller?: RefObject<HTMLElement | null> },
): BackdropTrailerHandle {
  const { data: settings } = useSettings();
  const conn = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection : undefined;
  const meteredSlow = !!(conn && (conn.saveData || conn.effectiveType === "slow-2g" || conn.effectiveType === "2g" || conn.effectiveType === "3g"));
  const allowed = (settings?.trailerAutoplay ?? true) && !prefersReducedMotion() && !meteredSlow;
  const fileUrl = useFileTrailer(imdbId, allowed).data?.url;
  const enabled = !!fileUrl && allowed;
  const video = useRef<HTMLVideoElement | null>(null);
  const rampRaf = useRef<number | null>(null);
  const finishTimer = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [errored, setErrored] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [muted, setMuted] = useState(!(settings?.trailerSound ?? false));
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const stopRamp = useCallback(() => {
    if (rampRaf.current != null) {
      cancelAnimationFrame(rampRaf.current);
      rampRaf.current = null;
    }
  }, []);

  const clearFinishTimer = useCallback(() => {
    if (finishTimer.current != null) {
      window.clearTimeout(finishTimer.current);
      finishTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopRamp();
      clearFinishTimer();
    },
    [stopRamp, clearFinishTimer],
  );

  // A different title starts over.
  useEffect(() => {
    stopRamp();
    clearFinishTimer();
    setFinished(false);
    setErrored(false);
    setPlaying(false);
    setMounted(false);
    setScrolledAway(false);
  }, [fileUrl, stopRamp, clearFinishTimer]);

  // Only watch scroll position once a backdrop trailer is actually mounted, so scrolling Detail never re-renders the page.
  useEffect(() => {
    const el = scroller?.current;
    if (!mounted || !el) return;
    let last = el.scrollTop > el.clientHeight * 0.25;
    setScrolledAway(last);
    const onScroll = () => {
      const next = el.scrollTop > el.clientHeight * 0.25;
      if (next !== last) {
        last = next;
        setScrolledAway(next);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [mounted, scroller]);

  const effectivePaused = paused || scrolledAway;

  // Wait a moment on the page; leaving it removes the player (and its sound).
  useEffect(() => {
    if (!enabled || !active || errored) {
      setMounted(false);
      setPlaying(false);
      return;
    }
    if (finished || mounted) return;
    const t = window.setTimeout(() => setMounted(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, [enabled, active, errored, finished, mounted]);

  // Settings load asynchronously and can change while a preview is mounted.
  useEffect(() => {
    setMuted(!(settings?.trailerSound ?? false));
  }, [settings?.trailerSound]);

  // Ramp <video> volume smoothly over 220ms on mute/unmute and scroll-pause instead of hard-cutting in 0ms.
  useEffect(() => {
    stopRamp();
    const v = video.current;
    if (!mounted || !v) return;

    const rampVolume = (target: number, onDone?: () => void) => {
      const from = Math.max(0, Math.min(1, v.muted ? 0 : v.volume));
      const distance = Math.abs(target - from);
      if (distance < 0.01 || prefersReducedMotion()) {
        v.volume = target;
        onDone?.();
        return;
      }
      const duration = Math.max(40, distance * AUDIO_RAMP_MS);
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) * (1 - t);
        v.volume = Math.max(0, Math.min(1, from + (target - from) * eased));
        if (t < 1) {
          rampRaf.current = requestAnimationFrame(step);
        } else {
          rampRaf.current = null;
          onDone?.();
        }
      };
      rampRaf.current = requestAnimationFrame(step);
    };

    if (effectivePaused) {
      if (v.muted || v.volume === 0 || v.paused) {
        v.pause();
      } else {
        rampVolume(0, () => v.pause());
      }
      return stopRamp;
    }

    if (muted) {
      void v.play().catch(() => {});
      if (v.muted || v.volume === 0) {
        v.volume = 0;
        v.muted = true;
      } else {
        rampVolume(0, () => {
          v.muted = true;
        });
      }
      return stopRamp;
    }

    if (v.muted) {
      v.volume = 0;
      v.muted = false;
    }
    void v.play().catch(() => {});
    rampVolume(1);
    return stopRamp;
  }, [mounted, muted, effectivePaused, stopRamp]);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    video.current = node;
    if (!node) return;
    const initialMuted = mutedRef.current;
    node.defaultMuted = initialMuted;
    node.muted = initialMuted;
    node.volume = initialMuted ? 0 : 1;
  }, []);

  const finish = useCallback(() => {
    stopRamp();
    clearFinishTimer();
    setPlaying(false);
    setFinished(true);
    // Let the art fade back in before the player unmounts.
    finishTimer.current = window.setTimeout(() => {
      finishTimer.current = null;
      setMounted(false);
    }, 900);
  }, [stopRamp, clearFinishTimer]);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  const replay = useCallback(() => {
    if (!enabled || !active) return;
    stopRamp();
    clearFinishTimer();
    const el = scroller?.current;
    if (el && el.scrollTop > 0) {
      el.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    setScrolledAway(false);
    setErrored(false);
    setFinished(false);
    setPlaying(false);
    setMounted(true);
    const v = video.current;
    if (v) {
      v.currentTime = 0;
      void v.play().catch(() => {});
    }
  }, [enabled, active, scroller, stopRamp, clearFinishTimer]);

  const visible = mounted && playing && !effectivePaused && !finished;
  const state: BackdropTrailerState =
    !enabled || !active || errored
      ? "idle"
      : finished
        ? "ended"
        : mounted && playing
          ? effectivePaused
            ? "paused"
            : "playing"
          : "idle";

  const node =
    mounted && fileUrl ? (
      <div className="backdrop-trailer" data-visible={visible} aria-hidden>
        <video
          ref={attachVideo}
          src={fileUrl}
          autoPlay
          playsInline
          tabIndex={-1}
          // Only shows once it's actually playing: a slow start never covers the art with black.
          onPlaying={() => setPlaying(true)}
          onEnded={finish}
          onError={() => {
            stopRamp();
            clearFinishTimer();
            setPlaying(false);
            setMounted(false);
            setErrored(true);
          }}
        />
      </div>
    ) : null;

  return { node, visible, state, muted, toggleMute, replay };
}

/**
 * Whether the page holding `ref` is the one on top (`data-active` on its
 * `.page` / `.tv-page`), kept up to date as pages are pushed and popped.
 */
export function usePageOnTop(ref: RefObject<HTMLElement | null>) {
  const [onTop, setOnTop] = useState(true);
  useEffect(() => {
    const page = ref.current?.closest<HTMLElement>(".page, .tv-page");
    if (!page) return;
    const read = () => setOnTop(page.dataset.active !== "false");
    read();
    const mo = new MutationObserver(read);
    mo.observe(page, { attributes: true, attributeFilter: ["data-active"] });
    return () => mo.disconnect();
  }, [ref]);
  return onTop;
}
