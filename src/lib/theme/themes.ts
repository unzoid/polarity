import type { CustomTheme, Settings } from "../types";

/**
 * Themes (Settings → Appearance → Theme). A theme is three values: an accent, the near-black it's
 * built on (`base`) and how much of the accent tints the greys (`tint`, a percent). styles/tokens.css
 * derives every surface of the app from those three (the `--tone-*` ramp), so a theme never lists
 * colours of its own and a new surface only has to use a token to follow it. `applyTheme` writes them.
 */
export interface Theme {
  /** A built-in theme's id, "custom:<id>" for the user's, or "dark" / "black" (see `legacyTheme`). */
  id: string;
  name: string;
  /** `#RRGGBB`, upper case. */
  accent: string;
  /** `#RRGGBB`, lower case: a near-black. */
  base: string;
  /** Percent of the accent mixed into the greys, 0–`MAX_TINT`. */
  tint: number;
  /** One the user made, so it can be edited and deleted. */
  custom: boolean;
}

/** The two bases the Create theme dialog offers besides a built-in theme's own. */
export const DARK_BASE = "#0a0a0a";
export const BLACK_BASE = "#000000";
export const MAX_TINT = 10;
export const MAX_THEME_NAME = 24;
/** Same as store.rs `Settings::MAX_CUSTOM_THEMES`. */
export const MAX_CUSTOM_THEMES = 24;

const preset = (id: string, name: string, accent: string, tint: number, base = DARK_BASE): Theme => ({
  id,
  name,
  accent,
  base,
  tint,
  custom: false,
});

export const PRESET_THEMES: readonly Theme[] = [
  preset("polar", "Polar", "#5E5CE6", 0),
  preset("oled", "OLED", "#5E5CE6", 0, BLACK_BASE),
  preset("graphite", "Graphite", "#8E8E93", 0),
  preset("midnight", "Midnight", "#0A84FF", 5),
  preset("iris", "Iris", "#BF5AF2", 4),
  preset("rose", "Rose", "#FF375F", 3.5),
  preset("ember", "Ember", "#FF9F0A", 3),
  preset("dune", "Dune", "#E3B26A", 2, "#14110c"),
  preset("grove", "Grove", "#30D158", 3.5),
  preset("moss", "Moss", "#A3C44A", 2.5, "#0e110b"),
  preset("tide", "Tide", "#64D2FF", 4),
  preset("ink", "Ink", "#FF6B5E", 1.5, "#0b0d13"),
];

export const DEFAULT_THEME = PRESET_THEMES[0];

/** The accents Create theme offers. */
export const THEME_ACCENTS = [
  { value: "#0A84FF", label: "Blue" },
  { value: "#5E5CE6", label: "Indigo" },
  { value: "#BF5AF2", label: "Purple" },
  { value: "#FF375F", label: "Pink" },
  { value: "#FF453A", label: "Red" },
  { value: "#FF9F0A", label: "Orange" },
  { value: "#FFD60A", label: "Yellow" },
  { value: "#30D158", label: "Green" },
  { value: "#64D2FF", label: "Teal" },
  { value: "#8E8E93", label: "Graphite" },
] as const;

type ThemeSettings = Pick<Settings, "theme" | "customThemes" | "accentColor">;

const HEX = /^#[0-9a-f]{6}$/i;

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

/** `a` mixed into `b` by `percent`, in sRGB: close to what tokens.css mixes (in oklab), for places outside CSS. */
export function mixHex(a: string, b: string, percent: number): string {
  const p = percent / 100;
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const c = (x: number, y: number) => Math.round(x * p + y * (1 - p)).toString(16).padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/** Light or dark: what the app draws. */
export type ColorScheme = "dark" | "light";
/** What the setting holds: one of them, or whichever the system uses. */
export type ColorSchemeSetting = ColorScheme | "system";

/** The near-white every theme sits on in light mode (its tint gives it its colour). */
export const LIGHT_BASE = "#f4f4f6";

/**
 * A theme's base in a scheme. Light mode keeps the accent and tint and swaps the near-black for a
 * near-white; a black-based theme (OLED) goes to pure white, its opposite.
 */
export function baseFor(t: Pick<Theme, "base">, scheme: ColorScheme): string {
  if (scheme === "dark") return t.base;
  return t.base === BLACK_BASE ? "#ffffff" : LIGHT_BASE;
}

/** The scheme to draw: the setting's, or the system's for "system" (and anything unknown: dark). */
export function resolveScheme(setting: string | undefined, systemPrefersLight: boolean): ColorScheme {
  if (setting === "light") return "light";
  if (setting === "system") return systemPrefersLight ? "light" : "dark";
  return "dark";
}

/** The page's background colour under a theme (tokens.css `--tone-0`), for the browser's theme colour. */
export function themeBackground(t: Pick<Theme, "accent" | "base" | "tint">, scheme: ColorScheme = "dark"): string {
  return mixHex(t.accent, baseFor(t, scheme), t.tint);
}

export const customThemeId = (id: string) => `custom:${id}`;

/**
 * A stored custom theme as one to draw, or null when it can't be used: settings sync brings them from
 * other devices and builds, so nothing here is trusted. The base has to stay dark, or the app's light
 * text would stop reading on it.
 */
export function fromCustom(t: CustomTheme | null | undefined): Theme | null {
  if (!t || typeof t.id !== "string" || !t.id || typeof t.name !== "string") return null;
  const name = t.name.trim().slice(0, MAX_THEME_NAME);
  if (!name || typeof t.accent !== "string" || typeof t.base !== "string") return null;
  if (!HEX.test(t.accent) || !HEX.test(t.base) || luma(t.base) > 0.1) return null;
  const tint = typeof t.tint === "number" && Number.isFinite(t.tint) ? Math.min(MAX_TINT, Math.max(0, t.tint)) : 0;
  return { id: customThemeId(t.id), name, accent: t.accent.toUpperCase(), base: t.base.toLowerCase(), tint, custom: true };
}

/** The theme values from before themes, and the built-in theme each became. */
const BEFORE_THEMES: Record<string, string> = { dark: "polar", black: "oled" };
/** The accent everyone had until they picked one, before themes. */
const OLD_DEFAULT_ACCENT = "#0A84FF";

/**
 * Settings from before themes that picked an accent of their own: that accent on Polar or OLED, shown
 * as its own tile ("Your colours") so the grid matches what's on screen. It goes once another is chosen.
 */
function legacyTheme(s: ThemeSettings): Theme | null {
  const became = Object.hasOwn(BEFORE_THEMES, s.theme) ? PRESET_THEMES.find((t) => t.id === BEFORE_THEMES[s.theme]) : undefined;
  const accent = (s.accentColor ?? "").toUpperCase();
  if (!became || !HEX.test(accent) || accent === OLD_DEFAULT_ACCENT || accent === became.accent) return null;
  return { ...became, id: s.theme, name: "Your colours", accent };
}

/** Every theme to choose from: the one from before themes (if any), the built-in ones, then the user's. */
export function themeList(s: ThemeSettings): Theme[] {
  const legacy = legacyTheme(s);
  const mine = (s.customThemes ?? []).map(fromCustom).filter((t): t is Theme => t !== null);
  return [...(legacy ? [legacy] : []), ...PRESET_THEMES, ...mine];
}

/** The theme the settings choose. One that's gone (deleted on another device) or unknown falls back to Polar. */
export function resolveTheme(s: ThemeSettings): Theme {
  const list = themeList(s);
  const id = list.some((t) => t.id === s.theme) ? s.theme : (BEFORE_THEMES[s.theme] ?? s.theme);
  return list.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** "Polar copy", then "Polar copy 2", …: the first that no theme has. */
export function copyName(name: string, themes: readonly Theme[]): string {
  const stem = `${name.replace(/ copy( \d+)?$/, "")} copy`.slice(0, MAX_THEME_NAME);
  let candidate = stem;
  for (let i = 2; themes.some((t) => t.name === candidate); i++) candidate = `${stem} ${i}`;
  return candidate;
}

/** An id for a new custom theme, unused by the others. */
export function newCustomThemeId(existing: readonly CustomTheme[]): string {
  let id: string;
  do id = Math.random().toString(36).slice(2, 10);
  while (existing.some((t) => t.id === id));
  return id;
}
