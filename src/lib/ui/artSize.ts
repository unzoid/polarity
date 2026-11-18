import { formFactor } from "../platform/formFactor";

export type TmdbSize = "w185" | "w300" | "w342" | "w500" | "w780" | "w1280" | "original";

const TMDB_WIDTH: Record<string, number> = {
  w45: 45,
  w92: 92,
  w154: 154,
  w185: 185,
  w300: 300,
  w342: 342,
  w500: 500,
  w780: 780,
  w1280: 1280,
  original: 3840,
};

/**
 * Caps a TMDB or Metahub artwork URL to `max` width without ever upscaling a smaller asset.
 * Non-matching hosts and data/blob URLs pass through untouched in O(1).
 */
export function sizedArt(src: string | null | undefined, max: TmdbSize): string | undefined {
  if (!src) return undefined;
  if (!src.includes("image.tmdb.org") && !src.includes("images.metahub.space")) return src;
  try {
    const u = new URL(src);
    const maxW = TMDB_WIDTH[max] ?? 3840;
    if (u.hostname === "image.tmdb.org") {
      const m = /^\/t\/p\/(w\d+|original)\//.exec(u.pathname);
      if (m) {
        const curW = TMDB_WIDTH[m[1]] ?? 3840;
        if (curW > maxW) {
          u.pathname = `/t/p/${max}/${u.pathname.slice(m[0].length)}`;
          return u.toString();
        }
      }
      return src;
    }
    if (u.hostname === "images.metahub.space" && maxW <= 780) {
      const next = u.pathname.replace(/^\/(background|poster|logo)\/large\//, "/$1/medium/");
      if (next !== u.pathname) {
        u.pathname = next;
        return u.toString();
      }
    }
    return src;
  } catch {
    return src;
  }
}

function isSlowConnection(): boolean {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }) : undefined;
  const c = nav?.connection;
  return !!c && (!!c.saveData || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g");
}

/** Right-sized poster (w342) or 16:9 card still/backdrop (w780; w300 on 2G/save-data). */
export function cardArtUrl(src: string | null | undefined, shape: "poster" | "landscape"): string | undefined {
  if (!src) return undefined;
  if (shape === "poster") return sizedArt(src, "w342");
  return sizedArt(src, isSlowConnection() ? "w300" : "w780");
}

/** Right-sized logo drawn inside a card lockup (~168px max CSS width). */
export function cardLogoUrl(src: string | null | undefined): string | undefined {
  return sizedArt(src, "w300");
}

function devicePxWidth(): number {
  if (typeof window === "undefined") return 1920;
  return window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
}

/** Right-sized Home/Anime hero carousel backdrop (w780 on phones / narrow viewports, w1280 on tablets/desktops). */
export function heroBackdropUrl(src: string | null | undefined, phone = formFactor().form === "phone"): string | undefined {
  return sizedArt(src, phone || devicePxWidth() <= 900 || isSlowConnection() ? "w780" : "w1280");
}

/**
 * Right-sized full-bleed Detail / TV Stage backdrop:
 * - Phone / narrow viewport (<= 900 device px): w780
 * - Desktop / 1080p TV (<= 2560 device px wide) or slow connection: w1280 (matches catalog preview URL, avoiding a second 4K re-download!)
 * - >2560px 4K display on a normal connection: original
 */
export function detailBackdropUrl(src: string | null | undefined, phone = formFactor().form === "phone"): string | undefined {
  if (!src) return undefined;
  const pxW = devicePxWidth();
  if (phone || pxW <= 900 || isSlowConnection()) return sizedArt(src, "w780");
  return sizedArt(src, pxW > 2560 ? "original" : "w1280");
}
