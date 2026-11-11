import type { UiFont } from "../types";

const UI_FONTS: readonly UiFont[] = ["inter", "instrument", "hanken", "onest", "mona", "system", "opendyslexic"];

/** The app font a saved setting means. Anything else (the removed "netflix" test font, a newer build's) is Inter. */
export const uiFontOf = (saved: string | undefined): UiFont => (UI_FONTS.includes(saved as UiFont) ? (saved as UiFont) : "inter");

/** The family name subtitles use for OpenDyslexic: the bundled files' own, so mpv and the CSS preview agree. */
export const OPEN_DYSLEXIC = "OpenDyslexic";
