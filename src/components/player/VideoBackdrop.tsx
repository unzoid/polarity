import { useEffect, useRef } from "react";
import { call } from "../../lib/platform";
import { isMpv, type MediaLike } from "./mpvMedia";

const W = 160;
const H = 90;
/** The crop's canvas: a small, tall pill-shaped window onto the frame (see `crop`). */
const CROP_W = 64;
const CROP_H = 256;
const FPS = 12;
/** A faded copy (`fade`): new frames this often, each blended in over the last. */
const FADE_FPS = 24;
/** mpv frames come from snapshots; refresh slowly — it's out of focus anyway. */
const SNAPSHOT_EVERY = 1500;

/**
 * A live, frosted copy of the video for overlays.
 *
 * `backdrop-filter` can't be trusted over video on Windows: Chromium hands
 * <video> to a hardware overlay plane, and mpv draws in a native window under
 * the page — either way the filter has nothing to sample. So we blur the
 * picture ourselves: draw it into a tiny 160×90 canvas with a canvas blur and
 * let the GPU scale it up. Blurring at thumbnail size is ~100× cheaper than
 * blurring the full frame, and the upscale makes it even softer.
 *
 *  - <video>: drawn directly, ~12 fps.
 *  - mpv: a JPEG snapshot of the current frame, every 1.5s.
 */
export function VideoBackdrop({
  media,
  className,
  crop = false,
  cropSize = [CROP_W, CROP_H],
  fade = false,
}: {
  media: MediaLike | null;
  className?: string;
  crop?: boolean;
  /** The crop canvas's size: about the element's own shape, so the blur is even both ways (the HUD's is a tall pill). */
  cropSize?: readonly [number, number];
  /**
   * Two canvases, each new frame painted into the hidden one and faded in over the last for as long as frames are
   * apart: the copy drifts with the picture instead of stepping from one frame to the next (a docked menu's frost,
   * which sits on the playing video for as long as the menu is open).
   */
  fade?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const twin = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const layers = fade && twin.current ? [el, twin.current] : [el];
    const ctxs = layers.map((c) => c?.getContext("2d") ?? null);
    if (!media || !el || ctxs.some((c) => !c)) return;
    // The overlay's copy is blurred once, here: at 160 px wide, 2px reads as about 18px on a 1440px window. The
    // CSS adds only a light smoothing of the upscale (player.css), and no saturation: the picture's own colour.
    for (const c of ctxs) c!.filter = crop ? "blur(8px) saturate(140%)" : "blur(2px)";
    const mark = box.current ?? el;
    // Faded frames can come oftener: each is a small GPU draw, blended into the last over the time between them.
    const fps = fade ? FADE_FPS : FPS;
    const every = isMpv(media) ? SNAPSHOT_EVERY : 1000 / fps;
    let front = 0;
    let painted = 0;
    // The first frame marks the canvas ready: the CSS fades it in over the live
    // video only then, so opening never shows an empty (black) backdrop.
    const paint = (src: CanvasImageSource, srcW: number, srcH: number) => {
      const i = layers.length > 1 && painted > 0 ? 1 - front : front;
      const target = layers[i]!;
      const ctx = ctxs[i]!;
      if (crop) paintCrop(target, ctx, src, srcW, srcH);
      // Overdraw by the blur radius so edges don't fade to transparent.
      else ctx.drawImage(src, -6, -6, W + 12, H + 12);
      if (layers.length > 1) {
        // The new frame goes on top and fades in over the last; the last stays whole under it until then.
        target.style.zIndex = "1";
        layers[1 - i]!.style.zIndex = "0";
        if (painted > 0) target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: every, easing: "linear" });
        front = i;
      }
      painted++;
      mark.dataset.ready = "";
    };

    if (isMpv(media)) {
      let stopped = false;
      const snap = async () => {
        try {
          const url = await call<string>("mpv_snapshot");
          const img = new Image();
          img.onload = () => !stopped && paint(img, img.naturalWidth, img.naturalHeight);
          img.src = url;
        } catch {
          /* nothing decoded yet — the shade alone still reads fine */
        }
      };
      void snap();
      const t = window.setInterval(snap, SNAPSHOT_EVERY);
      return () => {
        stopped = true;
        window.clearInterval(t);
        delete mark.dataset.ready;
      };
    }

    const video = media as HTMLVideoElement;
    let drawn = false;
    const draw = () => {
      if (video.readyState < 2) return;
      try {
        paint(video, video.videoWidth, video.videoHeight);
        drawn = true;
      } catch {
        /* decoder not ready — try next frame */
      }
    };

    // A paused or ended video produces no frame callbacks, and may not have a
    // decoded frame yet when the overlay opens — so also paint when one lands.
    const events = ["loadeddata", "seeked", "canplay"] as const;
    events.forEach((e) => video.addEventListener(e, draw));
    draw();
    let last = 0;
    let handle = 0;
    let rafMode = true;
    let stopped = false;
    const hasRvfc = "requestVideoFrameCallback" in video;
    const loop = (now: number) => {
      if (stopped) return;
      if (!drawn || now - last >= 1000 / fps) {
        last = now;
        draw();
      }
      // Until the first paint, poll per animation frame (paused video gives no callbacks).
      handle = hasRvfc && drawn ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
      rafMode = !(hasRvfc && drawn);
    };
    handle = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      events.forEach((e) => video.removeEventListener(e, draw));
      if (rafMode) cancelAnimationFrame(handle);
      else video.cancelVideoFrameCallback(handle);
      delete mark.dataset.ready;
    };
  }, [media, crop, fade]);

  const width = crop ? cropSize[0] : W;
  const height = crop ? cropSize[1] : H;
  const cls = className ? `video-backdrop ${className}` : "video-backdrop";
  if (fade)
    return (
      <span ref={box} className={`${cls} video-backdrop-pair`} aria-hidden>
        <canvas ref={canvas} width={width} height={height} />
        <canvas ref={twin} width={width} height={height} />
      </span>
    );
  return <canvas ref={canvas} className={cls} width={width} height={height} aria-hidden />;
}

/**
 * Draw just the part of the frame that sits behind `el`, so a small frosted
 * panel shows what is really under it. The picture is placed as the player
 * places it (centred, whole, `contain`) inside the player, and `el`'s layout
 * position there picks the crop. Layout offsets, not bounding rects: they ignore
 * the panel's slide-in transform and any interface zoom.
 */
function paintCrop(el: HTMLCanvasElement, ctx: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number) {
  // A menu in a portal (the dock's More and Cast) isn't inside the player: placed by where both are on screen.
  const host = el.closest<HTMLElement>(".player");
  const player = host ?? document.querySelector<HTMLElement>(".player");
  if (!player || !srcW || !srcH) return;
  let x = 0;
  let y = 0;
  let w = el.offsetWidth;
  let h = el.offsetHeight;
  if (host) {
    for (let n: HTMLElement | null = el; n && n !== player; n = n.offsetParent as HTMLElement | null) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
  } else {
    const p = player.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    x = r.left - p.left;
    y = r.top - p.top;
    w = r.width;
    h = r.height;
  }
  if (!w || !h) return;
  const fill = player.dataset.fill === "true";
  const scale = (fill ? Math.max : Math.min)(player.offsetWidth / srcW, player.offsetHeight / srcH);
  const ox = (player.offsetWidth - srcW * scale) / 2;
  const oy = (player.offsetHeight - srcH * scale) / 2;
  // Overdraw by a few blur radii (in the panel's own px) so the edges stay opaque.
  const k = el.width / w;
  const m = 28 / k;
  ctx.clearRect(0, 0, el.width, el.height);
  ctx.drawImage(
    src,
    (x - m - ox) / scale,
    (y - m - oy) / scale,
    (w + 2 * m) / scale,
    (h + 2 * m) / scale,
    -28,
    -28,
    el.width + 56,
    el.height + 56,
  );
}
