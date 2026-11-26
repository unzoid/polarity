import type { UiFont } from "../types";

const UI_FONTS: readonly UiFont[] = ["polarity", "inter", "system", "testsans"];

/** The app font a saved setting means. Anything else (a removed font or a newer build's) falls back to Polarity Sans. */
export const uiFontOf = (saved: string | undefined): UiFont => (UI_FONTS.includes(saved as UiFont) ? (saved as UiFont) : "polarity");

/** The family name subtitles use for OpenDyslexic: the bundled files' own, so mpv and the CSS preview agree. */
export const OPEN_DYSLEXIC = "OpenDyslexic";
