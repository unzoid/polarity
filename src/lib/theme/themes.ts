import type { CustomTheme, Settings } from "../types";

/**
 * The app's colours: one accent (Settings → Appearance → Accent colour) on a fixed near-black, or a
 * near-white in light mode. styles/tokens.css derives every surface from `--accent`, `--theme-base`
 * and `--theme-tint` (the `--tone-*` ramp); `applyAccent` writes them.
 *
 * There used to be themes (an accent, a base and a tint each, and ones the user made). Settings still
 * carry `theme` and `customThemes` from then, so a device that had a theme keeps its accent until
 * another is picked (`resolveAccent`).
 */

export const DARK_BASE = "#0a0a0a";
/** The near-white the app sits on in light mode. */
export const LIGHT_BASE = "#f4f4f6";

/** What `theme` holds once an accent has been picked here: `accentColor` is the one to use. */
export const ACCENT_THEME = "accent";

/** The accents offered; any other colour can be picked too. */
export const ACCENTS = [
  { value: "#5E5CE6", label: "Indigo" },
  { value: "#0A84FF", label: "Blue" },
  { value: "#64D2FF", label: "Teal" },
  { value: "#30D158", label: "Green" },
  { value: "#FFD60A", label: "Yellow" },
  { value: "#FF9F0A", label: "Orange" },
  { value: "#FF453A", label: "Red" },
  { value: "#FF375F", label: "Pink" },
  { value: "#BF5AF2", label: "Purple" },
  { value: "#8E8E93", label: "Graphite" },
] as const;

export const DEFAULT_ACCENT = ACCENTS[0].value;

/** The accents of the themes there were, by id, so a device that had one keeps its colour. */
const THEME_ACCENTS: Record<string, string> = {
  polar: "#5E5CE6",
  oled: "#5E5CE6",
  graphite: "#8E8E93",
  midnight: "#0A84FF",
  iris: "#BF5AF2",
  rose: "#FF375F",
  ember: "#FF9F0A",
  dune: "#E3B26A",
  grove: "#30D158",
  moss: "#A3C44A",
  tide: "#64D2FF",
  ink: "#FF6B5E",
};
/** Before themes, `theme` was "dark" or "black" and the accent was `accentColor`, blue until changed. */
const BEFORE_THEMES = new Set(["dark", "black"]);
const OLD_DEFAULT_ACCENT = "#0A84FF";

type AccentSettings = Pick<Settings, "theme" | "accentColor"> & { customThemes?: CustomTheme[] | null };

const HEX = /^#[0-9a-f]{6}$/i;
const valid = (hex: unknown): hex is string => typeof hex === "string" && HEX.test(hex);

/** The accent the settings choose. Settings sync brings them from other devices and builds, so nothing is trusted. */
export function resolveAccent(s: AccentSettings): string {
  if (s.theme === ACCENT_THEME) return valid(s.accentColor) ? s.accentColor.toUpperCase() : DEFAULT_ACCENT;
  if (Object.hasOwn(THEME_ACCENTS, s.theme)) return THEME_ACCENTS[s.theme];
  if (typeof s.theme === "string" && s.theme.startsWith("custom:")) {
    const mine = (s.customThemes ?? []).find((t) => `custom:${t?.id}` === s.theme);
    if (valid(mine?.accent)) return mine.accent.toUpperCase();
  }
  if (BEFORE_THEMES.has(s.theme) && valid(s.accentColor) && s.accentColor.toUpperCase() !== OLD_DEFAULT_ACCENT) return s.accentColor.toUpperCase();
  return DEFAULT_ACCENT;
}

/** The name of an accent for a row's value: its label, or "Custom". */
export const accentName = (accent: string) => ACCENTS.find((a) => a.value === accent.toUpperCase())?.label ?? "Custom";

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rec. 601 luma of `#RRGGBB`, 0–1. */
function luma(hex: string): number {
  const [r, g, b] = channels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Text on an accent fill: dark on light accents (yellow, teal), else white. */
export function accentForeground(accent: string): string {
  return luma(accent) > 0.62 ? "#0b0b0b" : "#fff";
}

/** Light or dark: what the app draws. */
export type ColorScheme = "dark" | "light";
/** What the setting holds: one of them, or whichever the system uses. */
export type ColorSchemeSetting = ColorScheme | "system";

/** The base in a scheme. */
export const baseFor = (scheme: ColorScheme) => (scheme === "dark" ? DARK_BASE : LIGHT_BASE);

/** The scheme to draw: the setting's, or the system's for "system" (and anything unknown: dark). */
export function resolveScheme(setting: string | undefined, systemPrefersLight: boolean): ColorScheme {
  if (setting === "light") return "light";
  if (setting === "system") return systemPrefersLight ? "light" : "dark";
  return "dark";
}
