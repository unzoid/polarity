/**
 * Every length the app's CSS writes in px is drawn in points instead: `13px` becomes
 * `calc(13 * var(--ui-pt, 1px))`. The desktop shell sets `--ui-pt` from the window's width (desk.css: the page's
 * --pt; deskPlayer.css: the player's), so a rule written in px grows and shrinks with the window like the rest of
 * the page, and nobody has to remember to write `calc(n * var(--pt))` by hand. Where --ui-pt isn't set (the phone
 * and TV layouts, or before the desk mounts) the fallback keeps every length at exactly its px.
 *
 * Left alone:
 *  - 1px and less: hairlines and nudges stay crisp at every size.
 *  - Media and container queries: they're at-rules, and they measure the window, not the page.
 *  - The point variables themselves (`--pt`, `--pl-pt`, `--ui-pt`), which a point can't be defined in.
 *  - url(...) and quoted strings.
 *  - The phone and TV stylesheets, which never run in the desktop shell and whose values code also reads.
 */

const PX = /(?<![\w.#-])(-?(?:\d+\.?\d*|\.\d+))px\b/g;
/** url(...) and quoted strings, kept out of the rewrite. */
const OPAQUE = /url\([^)]*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/** Rewrite one declaration value's px lengths into points. */
export function scaleValue(value: string): string {
  if (!value.includes("px")) return value;
  let out = "";
  let last = 0;
  for (const m of value.matchAll(OPAQUE)) {
    out += scalePlain(value.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + scalePlain(value.slice(last));
}

function scalePlain(text: string): string {
  return text.replace(PX, (whole, n: string) => (Math.abs(Number(n)) <= 1 ? whole : `calc(${n} * var(--ui-pt, 1px))`));
}

/** Declarations whose value stays as written. */
export const keepsPx = (prop: string) => /^--(?:ui-|pl-)?pt$/.test(prop);

/** Stylesheets never loaded by the desktop shell. */
const SKIPPED_FILES = /[\\/]src[\\/]styles[\\/](phone|tv)\.css$/;

type Decl = { prop: string; value: string };
type Root = { source?: { input?: { file?: string } }; walkDecls: (fn: (d: Decl) => void) => void };

/** The PostCSS plugin (vite.config.ts → css.postcss.plugins), for the app's own stylesheets under src/. */
export function pointScale() {
  return {
    postcssPlugin: "polarity-point-scale",
    Once(root: Root) {
      const file = root.source?.input?.file ?? "";
      if (!/[\\/]src[\\/]/.test(file) || /node_modules/.test(file) || SKIPPED_FILES.test(file)) return;
      root.walkDecls((decl) => {
        if (keepsPx(decl.prop)) return;
        const next = scaleValue(decl.value);
        if (next !== decl.value) decl.value = next;
      });
    },
  };
}
