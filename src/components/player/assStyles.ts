/**
 * Styled (ASS/SSA) subtitles, read from the track's header (mpv's
 * `sub-ass-extradata`): which styles carry the dialogue, and the
 * `sub-ass-style-overrides` that restyle only those, so typeset signs keep
 * the release's own look and font.
 */

export interface AssStyle {
  name: string;
  font: string;
  /** Numpad alignment (2 = bottom centre). */
  alignment: number;
}

export interface AssHeader {
  /** The script's canvas height: sizes in styles are in its units. */
  playResY: number;
  styles: AssStyle[];
}

/** libass's canvas when a script names none. */
const DEFAULT_PLAY_RES_Y = 288;

/** The [Script Info] canvas and the [V4+ Styles] lines of an ASS/SSA header. */
export function parseAssHeader(text: string): AssHeader {
  let playResY = 0;
  let format: string[] = [];
  const styles: AssStyle[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "playresy") playResY = Number(value) || 0;
    else if (key === "format") format = value.split(",").map((f) => f.trim().toLowerCase());
    else if (key === "style" && format.includes("name")) {
      const fields = value.split(",");
      const at = (field: string) => fields[format.indexOf(field)]?.trim() ?? "";
      const name = at("name");
      if (name) styles.push({ name, font: at("fontname"), alignment: Number(at("alignment")) || 2 });
    }
  }
  return { playResY: playResY > 0 ? playResY : DEFAULT_PLAY_RES_Y, styles };
}

/** Names releases give their dialogue styles. */
const DIALOGUE = /default|main|dialog|italic|^top|^alt|flashback|narrat|thought|overlap|internal|secondary/i;
/** Names of signs, songs and other typesetting. */
const TYPESET = /sign|title|typeset|^ts\b|kara|^op\b|^ed\b|song|lyric|note|screen|insert|eyecatch|logo/i;

/**
 * The styles that carry dialogue: those named like it, else the bottom-centred
 * ones not named like signs, else the first. Never empty while there are styles.
 */
export function dialogueStyles(styles: AssStyle[]): AssStyle[] {
  const named = styles.filter((s) => DIALOGUE.test(s.name) && !TYPESET.test(s.name));
  if (named.length) return named;
  const bottom = styles.filter((s) => s.alignment === 2 && !TYPESET.test(s.name));
  return bottom.length ? bottom : styles.slice(0, 1);
}

/** ASS colours are `&HAABBGGRR`, alpha 00 = opaque. */
export function assColor(hex: string, opacity = 100): string {
  const rgb = hex.replace("#", "").toUpperCase().padStart(6, "0");
  const alpha = Math.round(((100 - Math.max(0, Math.min(100, opacity))) / 100) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `&H${alpha}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`;
}

/** What the overrides change on the dialogue styles; anything left out stays as the release made it. */
export interface DialogueLook {
  /** A font to force; leave out to keep the release's. */
  font?: string;
  /** Text colour `#RRGGBB` and opacity percent. */
  text?: { color: string; opacity: number };
  /** Outline width on mpv's 720-line canvas, its colour and opacity. */
  outline?: { width: number; color: string; opacity: number };
  /** A dark box behind the text, opacity percent. */
  box?: number;
}

/** `sub-ass-style-overrides` entries giving the dialogue styles `look`. */
export function dialogueOverrides(header: AssHeader, look: DialogueLook): string[] {
  const toCanvas = header.playResY / 720;
  const fields: [string, string][] = [];
  if (look.font) fields.push(["Fontname", look.font], ["Bold", "0"]);
  if (look.text) fields.push(["PrimaryColour", assColor(look.text.color, look.text.opacity)]);
  if (look.box) {
    // An opaque box (BorderStyle 3) is drawn in the outline colour, padded by the outline width.
    fields.push(["BorderStyle", "3"], ["OutlineColour", assColor("#000000", look.box)], ["Outline", round(Math.max(look.outline?.width ?? 1.6, 1) * toCanvas)]);
    fields.push(["Shadow", "0"]);
  } else if (look.outline) {
    fields.push(["BorderStyle", "1"], ["Outline", round(look.outline.width * toCanvas)], ["OutlineColour", assColor(look.outline.color, look.outline.opacity)]);
    if (look.outline.width === 0) fields.push(["Shadow", "0"]);
  }
  const names = header.styles.length ? dialogueStyles(header.styles) : [{ name: "Default" }];
  return names.flatMap((s) => fields.map(([field, value]) => `${s.name}.${field}=${value}`));
}

const round = (n: number) => String(Math.round(n * 100) / 100);
