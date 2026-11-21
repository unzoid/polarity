import { useEffect, useState, useSyncExternalStore } from "react";
import { Img, type ImgProps } from "./Img";
import { api } from "../lib/api";
import {
  backdropLuminance,
  chooseLogo,
  clearShare,
  currentLogoScheme,
  imageBroken,
  imageLoaded,
  measureInk,
  pageLuminance,
  scrimLevel,
  type Ink,
  type LogoLook,
  type LogoScheme,
  type LogoShape,
  type LogoSpot,
} from "../lib/ui";

type TitleLogoProps = ImgProps & {
  src?: string;
  /** All of the title's logos, the metadata language first (`MetaPreview.logos`); used only when it holds `src`. */
  logos?: string[];
  /** The picture behind the logo, and where the logo sits on it (`LOGO_SPOTS`). Without them the page is taken as dark. */
  backdrop?: string;
  spot?: LogoSpot;
};

/**
 * A title treatment (logo) that stays readable on the picture behind it (#215). The logo's ink and the backdrop
 * where it sits (after the page's gradient) are measured off separate CORS requests, so the visible <img> never
 * waits for them; a host that sends no CORS headers is read through the app instead (#354). Then the first of
 * the title's logos that reads there is shown, or, when none does, the first drawn as a white silhouette (one
 * dark ink) or with a halo (`lib/ui/logoContrast.ts`). A picture that isn't shaped like a logo (a cover handed
 * over as one, #371) is never shown: the next is tried. Until that's measured
 * the logo keeps its place unseen. When no logo is left, or neither the logos nor the backdrop can be measured
 * (not even through the app), `onFail` is called so the caller shows the name. A picture that couldn't be
 * measured is named in the console by its host.
 */
export function TitleLogo({ logos, backdrop, spot, onReady, ...props }: TitleLogoProps & { onReady?: () => void }) {
  const { src, onFail, onLoad } = props;
  const choice = useLogoChoice(src, logos, backdrop, spot);
  const named = choice === "unsure" || choice === "none";
  useEffect(() => {
    if (named) onFail?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [named]);
  // Ready once the chosen logo is measured and its picture is in: the page around it may show (useReadyTogether).
  const [, loadedOne] = useState(0);
  const ready = !!src && logoReady(src, logos, backdrop, spot);
  useEffect(() => {
    if (ready) onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  if (named) return null;
  const look = choice?.look ?? "as-is";
  return (
    <Img
      {...props}
      src={choice?.src ?? src}
      onLoad={(e) => {
        loadedOne((n) => n + 1);
        onLoad?.(e);
      }}
      data-logo-look={look === "as-is" ? undefined : look}
      data-logo-pending={choice ? undefined : ""}
    />
  );
}

// One shared MutationObserver on `<html>` across every mounted TitleLogo instead of one per card.
const schemeListeners = new Set<() => void>();
let schemeObserver: MutationObserver | null = null;

function subscribeScheme(onChange: () => void) {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
  schemeListeners.add(onChange);
  if (!schemeObserver) {
    schemeObserver = new MutationObserver(() => {
      for (const fn of schemeListeners) fn();
    });
    schemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
  }
  return () => {
    schemeListeners.delete(onChange);
    if (schemeListeners.size === 0 && schemeObserver) {
      schemeObserver.disconnect();
      schemeObserver = null;
    }
  };
}

function useLogoScheme(): LogoScheme {
  return useSyncExternalStore(subscribeScheme, currentLogoScheme, (): LogoScheme => "dark");
}

/** The cache key of a logo's choice: its candidates, the active scheme (for `onPage` spots) and the spot on the backdrop. */
function choiceId(src: string, logos?: string[], backdrop?: string, spot?: LogoSpot, scheme: LogoScheme = currentLogoScheme()) {
  const candidates = logos?.includes(src) ? logos.slice(0, MAX_CANDIDATES) : [src];
  const level = spot ? scrimLevel(spot, scheme) : undefined;
  const lightPage = !!(spot?.onPage && scheme === "light");
  const behindKey = backdrop && spot ? `${backdrop} ${spot.x0} ${spot.y0} ${spot.x1} ${spot.y1} ${spot.scrim} ${level}` : lightPage ? "light" : "dark";
  return { candidates, lightPage, id: `${candidates.join(" ")}|${behindKey}` };
}

/**
 * Whether {@link TitleLogo} is done for these arguments: its choice is made and the chosen picture loaded (or
 * failed), or no logo will show (the name does). Synchronous, so a page whose logo is in already shows at once.
 */
export function logoReady(src: string, logos?: string[], backdrop?: string, spot?: LogoSpot) {
  const choice = lruGet(choices, choiceId(src, logos, backdrop, spot).id);
  if (choice === undefined) return false;
  if (typeof choice === "string") return true;
  return imageLoaded(choice.src) || imageBroken(choice.src);
}

/**
 * {@link TitleLogo}'s choice for a screen that draws the logo itself (the player's loading screen, #391): the
 * logo to show and how, "none" or "unsure" when the name shows instead, undefined while it's being measured.
 */
export function useLogoChoice(src: string | undefined, logos?: string[], backdrop?: string, spot?: LogoSpot): Choice | undefined {
  const scheme = useLogoScheme();
  const { candidates, lightPage, id } = src ? choiceId(src, logos, backdrop, spot, scheme) : { candidates: [] as string[], lightPage: false, id: "" };
  // The choice lives in the module's cache, so a new title never shows the last one's for a frame.
  const choice = id ? lruGet(choices, id) : undefined;
  const [, setMeasured] = useState(0);
  useEffect(() => {
    if (!candidates.length || choices.has(id)) return;
    let live = true;
    const behind = backdrop && spot ? measureBackdrop(backdrop, spot, scheme) : Promise.resolve(pageLuminance(spot, scheme));
    (async () => {
      const [lum, first] = await Promise.all([behind, measureLogo(candidates[0])]);
      if (candidates.length === 1) return chooseLogo(candidates, [first.ink], lum, [first.shape], lightPage);
      // Fast-path: when the primary logo already reads cleanly as-is on the measured backdrop, skip downloading & scanning fallback logos 1..5.
      if (lum !== null) {
        const fast = chooseLogo([candidates[0]], [first.ink], lum, [first.shape], lightPage);
        if (typeof fast === "object" && fast.look === "as-is") return fast;
      }
      const rest = await Promise.all(candidates.slice(1).map(measureLogo));
      const measured = [first, ...rest];
      return chooseLogo(
        candidates,
        measured.map((m) => m.ink),
        lum,
        measured.map((m) => m.shape),
        lightPage,
      );
    })()
      // Whatever goes wrong measuring, the name shows rather than an error escaping.
      .catch((): Choice => "unsure")
      .then((c) => {
        lruSet(choices, id, c);
        if (live) setMeasured((n) => n + 1);
      });
    return () => {
      live = false;
    };
    // `candidates` and `spot` are new each render; `id` says when they (or `scheme` for onPage spots) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return candidates.length ? choice : undefined;
}

/** The logo to show and how, "none" when no candidate is shaped like a logo, or "unsure" when nothing could be measured. */
export type Choice = { src: string; look: LogoLook } | "unsure" | "none";

/** More logos than this aren't measured (each is a request). */
const MAX_CANDIDATES = 6;

const MAX = 300;
const choices = new Map<string, Choice>();
const logos = new Map<string, Promise<MeasuredLogo>>();
const behinds = new Map<string, Promise<number | null>>();
const readables = new Map<string, Promise<HTMLImageElement | null>>();

function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key)!;
  map.delete(key);
  map.set(key, value);
  return value;
}

function lruSet<K, V>(map: Map<K, V>, key: K, value: V, limit = MAX): void {
  if (map.has(key)) map.delete(key);
  else if (map.size >= limit) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

/** How long a picture may take to load for measuring before it counts as not loading. */
const LOAD_TIMEOUT = 8000;

/**
 * Loads a picture for measuring, so its pixels can be read: by a CORS request, or when the host refuses that
 * (no CORS headers), through the app (#354). Null when neither gets it. Coalesces concurrent callers in flight
 * and releases the decoded HTMLImageElement once settled so bitmaps are not pinned in RAM.
 */
export function loadReadable(src: string): Promise<HTMLImageElement | null> {
  const key = toneUrl(src);
  let pending = readables.get(key);
  if (!pending) {
    pending = (async () => (await load(src)) ?? (await loadThroughApp(src)))().finally(() => {
      // Keep only in-flight deduplication; callers extract tiny stats/histograms immediately so the decoded bitmap can be GC'd.
      if (readables.get(key) === pending) readables.delete(key);
    });
    readables.set(key, pending);
  }
  return pending;
}

/**
 * The picture's bytes fetched by the app, which CORS doesn't apply to, and loaded from memory; null when that
 * fails in any way (no app, no bytes, an answer that isn't bytes), never an error.
 */
async function loadThroughApp(src: string): Promise<HTMLImageElement | null> {
  try {
    const bytes: unknown = await api.pictureBytes(toneUrl(src));
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return null;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    try {
      return await load(url, true);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/** Says in the console that a picture couldn't be measured, by its host alone (the rest may name the title). */
function noteUnmeasured(what: string, src: string) {
  let host = "";
  try {
    host = new URL(src).hostname;
  } catch {
    // Not a link: no host to name.
  }
  console.warn(`TitleLogo: couldn't measure the ${what} from ${host || "an unknown host"}; it's drawn without the contrast check`);
}

/**
 * Loads a picture; null when it doesn't load (with CORS, also when the host refuses it). `plain` loads it
 * without CORS, as shown: a remote picture's pixels then can't be read, but its size can.
 */
function load(src: string, plain = false): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), LOAD_TIMEOUT);
    if (!plain) img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = plain ? src : toneUrl(src);
  });
}

let scratchCanvas: HTMLCanvasElement | null = null;

/** Draws `img` (or the part of it in `spot`) `w` px wide and reads its pixels; null when the canvas is tainted. */
export function pixelsOf(img: HTMLImageElement, w: number, spot?: LogoSpot) {
  try {
    const sx = spot ? spot.x0 * img.naturalWidth : 0;
    const sy = spot ? spot.y0 * img.naturalHeight : 0;
    const sw = spot ? (spot.x1 - spot.x0) * img.naturalWidth : img.naturalWidth;
    const sh = spot ? (spot.y1 - spot.y0) * img.naturalHeight : img.naturalHeight;
    const h = Math.max(1, Math.round((sh / sw) * w)) || 32;
    const canvas = (scratchCanvas ??= document.createElement("canvas"));
    // Setting `canvas.width` resets and clears the backing store by HTML Canvas spec (no clearRect needed).
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
}

/** A logo's ink and shape; each null when it can't be measured. */
interface MeasuredLogo {
  ink: Ink | null;
  shape: LogoShape | null;
}

/**
 * A logo's ink and shape, measured once per picture. A host that refuses answers the same every time; when
 * even the app can't read it, the picture is loaded as shown, for its size alone.
 */
function measureLogo(src: string) {
  let measured = lruGet(logos, src);
  // Wide enough that thin bright detail (a ring, small letters, an outline) survives the downscale (#11).
  if (!measured) {
    measured = loadReadable(src).then(async (img) => {
      const px = img && pixelsOf(img, 128);
      if (!px) noteUnmeasured("logo", src);
      const sized = img ?? (await load(src, true));
      const shape = sized && sized.naturalWidth ? { width: sized.naturalWidth, height: sized.naturalHeight, clear: px ? clearShare(px) : null } : null;
      return { ink: px ? measureInk(px) : null, shape };
    }).catch(() => ({ ink: null, shape: null }));
    lruSet(logos, src, measured);
  }
  return measured;
}

/** The luminance behind the logo, measured once per backdrop, spot and scheme; null when it can't be. */
function measureBackdrop(src: string, spot: LogoSpot, scheme: LogoScheme = currentLogoScheme()) {
  const level = scrimLevel(spot, scheme);
  const key = `${src} ${spot.x0} ${spot.y0} ${spot.x1} ${spot.y1} ${spot.scrim} ${level}`;
  let lum = lruGet(behinds, key);
  if (!lum) {
    lum = loadReadable(src).then((img) => {
      const px = img && pixelsOf(img, 48, spot);
      if (!px) noteUnmeasured("backdrop", src);
      return px ? backdropLuminance(px, spot.scrim, level) : null;
    }).catch(() => null);
    lruSet(behinds, key, lum);
  }
  return lum;
}

/**
 * Where to fetch a picture for measuring (test report 1, item 24). metahub's `images.` host redirects to
 * `live.` without allowing CORS, so it goes to `live.` directly. And the URL differs from the visible
 * picture's: TMDB allows CORS only to requests that carry an Origin and doesn't say it varies by it, so a
 * cached answer to the plain <img> would fail this request. TMDB's are fetched small (185 px wide is plenty).
 */
export function toneUrl(src: string): string {
  try {
    const u = new URL(src);
    if (u.protocol !== "http:" && u.protocol !== "https:") return src;
    if (u.hostname === "images.metahub.space") u.hostname = "live.metahub.space";
    if (u.hostname === "image.tmdb.org") u.pathname = u.pathname.replace(/^\/t\/p\/[^/]+\//, "/t/p/w185/");
    u.searchParams.set("tone", "1");
    return u.toString();
  } catch {
    return src;
  }
}
