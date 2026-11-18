import { useEffect, useRef, useState, type RefObject } from "react";
import { useSettings } from "../lib/net";
import { prefersReducedMotion } from "../lib/ui";
import { useFileTrailer } from "../lib/playback";

/** How long a title's page shows its art before the trailer takes over. */
const DELAY_MS = 4000;

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
) {
  const { data: settings } = useSettings();
  const allowed = (settings?.trailerAutoplay ?? true) && !prefersReducedMotion();
  const fileUrl = useFileTrailer(imdbId, allowed).data?.url;
  const enabled = !!fileUrl && allowed;
  const video = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [muted, setMuted] = useState(!(settings?.trailerSound ?? false));
  // A different title starts over.
  useEffect(() => {
    setEnded(false);
    setPlaying(false);
    setMounted(false);
    setScrolledAway(false);
  }, [fileUrl]);

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
    if (!enabled || !active || ended) {
      setMounted(false);
      setPlaying(false);
      return;
    }
    if (mounted) return;
    const t = window.setTimeout(() => setMounted(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, [enabled, active, ended, mounted]);

  // Settings load asynchronously and can change while a preview is mounted.
  useEffect(() => {
    setMuted(!(settings?.trailerSound ?? false));
  }, [settings?.trailerSound]);

  useEffect(() => {
    if (mounted && video.current) video.current.muted = muted;
  }, [mounted, muted]);

  useEffect(() => {
    const v = video.current;
    if (mounted && v) void (effectivePaused ? v.pause() : v.play().catch(() => {}));
  }, [effectivePaused, mounted]);

  const finish = () => {
    setPlaying(false);
    // Let the art fade back in before the player goes.
    window.setTimeout(() => setEnded(true), 900);
  };

  const toggleMute = () => {
    setMuted(!muted);
  };

  const visible = mounted && playing && !effectivePaused;
  const node =
    mounted && fileUrl ? (
      <div className="backdrop-trailer" data-visible={visible} aria-hidden>
        <video
          ref={video}
          src={fileUrl}
          autoPlay
          muted={muted}
          playsInline
          tabIndex={-1}
          // Only shows once it's actually playing: a slow start never covers the art with black.
          onPlaying={() => setPlaying(true)}
          onEnded={finish}
          onError={() => setEnded(true)}
        />
      </div>
    ) : null;

  return { node, visible, muted, toggleMute };
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
