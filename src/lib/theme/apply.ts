import { useSyncExternalStore } from "react";
import { accentForeground, baseFor, DARK_BASE, type ColorScheme } from "./themes";

/**
 * Puts the accent and scheme on the page: the values styles/tokens.css builds every surface from, the
 * text colour on an accent fill, the scheme (`data-scheme`, which flips text, fills and lines) and the
 * browser's theme colour (a phone's status bar). `--theme-base-dark` is for the parts that stay dark in
 * light mode (the player, TV mode).
 */
export function applyAccent(accent: string, scheme: ColorScheme, root: HTMLElement = document.documentElement): void {
  const apply = () => {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-fg", accentForeground(accent));
    root.style.setProperty("--theme-base", baseFor(scheme));
    root.style.setProperty("--theme-base-dark", DARK_BASE);
    root.style.setProperty("--theme-tint", "0%");
    root.dataset.scheme = scheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", baseFor(scheme));
  };
  // Light ↔ dark cross-fades the whole screen (a view transition; styles/base.css sets its length) instead of
  // snapping. The first paint, an accent change, and Reduce motion apply at once.
  const switching = !!root.dataset.scheme && root.dataset.scheme !== scheme && root === document.documentElement;
  const start = (document as Document & { startViewTransition?: (update: () => void) => unknown }).startViewTransition;
  if (switching && start && !reducedMotion(root)) start.call(document, apply);
  else apply();
}

function reducedMotion(root: HTMLElement) {
  const setting = root.dataset.reduceMotion;
  if (setting === "on") return true;
  if (setting === "off") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Style for an element drawn in a scheme other than the page's (Appearance's Light / Dark tiles). */
export function schemeStyle(accent: string, scheme: ColorScheme): Record<string, string> {
  return {
    "--accent": accent,
    "--accent-fg": accentForeground(accent),
    "--theme-base": baseFor(scheme),
    "--theme-tint": "0%",
  };
}

const LIGHT_QUERY = "(prefers-color-scheme: light)";
const media = () => (typeof matchMedia === "function" ? matchMedia(LIGHT_QUERY) : null);

/** Whether the system is in light mode, kept up to date (for the "System" colour scheme). */
export function useSystemPrefersLight(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const m = media();
      m?.addEventListener("change", changed);
      return () => m?.removeEventListener("change", changed);
    },
    () => media()?.matches ?? false,
    () => false,
  );
}
