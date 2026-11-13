import { useSyncExternalStore } from "react";
import { accentForeground, baseFor, themeBackground, type ColorScheme, type Theme } from "./themes";

/**
 * Puts a theme on the page: the three values styles/tokens.css builds every surface from, the text
 * colour on an accent fill, the scheme (`data-scheme`, which flips text, fills and lines) and the
 * browser's theme colour (a phone's status bar). Everything else follows through the tokens.
 * `--theme-base-dark` is for the parts that stay dark in light mode (the player, TV mode).
 */
export function applyTheme(t: Theme, scheme: ColorScheme, root: HTMLElement = document.documentElement): void {
  root.style.setProperty("--accent", t.accent);
  root.style.setProperty("--accent-fg", accentForeground(t.accent));
  root.style.setProperty("--theme-base", baseFor(t, scheme));
  root.style.setProperty("--theme-base-dark", t.base);
  root.style.setProperty("--theme-tint", `${t.tint}%`);
  root.dataset.scheme = scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeBackground(t, scheme));
}

/** Style for an element that shows a theme other than the page's (a theme's tile, the Create theme preview). */
export function themeStyle(t: Pick<Theme, "accent" | "base" | "tint">, scheme: ColorScheme): Record<string, string> {
  return {
    "--accent": t.accent,
    "--accent-fg": accentForeground(t.accent),
    "--theme-base": baseFor(t, scheme),
    "--theme-tint": `${t.tint}%`,
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
