import { call, inShell } from "./bridge";
import { os } from "./device";

/**
 * iOS can say where a picture's subject is (src-tauri/src/ios/focus.m: Vision's faces, else what draws the eye),
 * which a guess from the pixels often gets wrong (a face at the edge of a busy picture). Elsewhere the web app's
 * own estimate stands (lib/ui/artFocus.ts).
 */
export const nativeArtFocusAvailable = os === "ios" && inShell;

/**
 * The subject's place across `picture` (a JPEG data URL, small), 0 (left) to 1 (right); null when the system
 * finds nothing in it or can't be asked.
 */
export async function nativeArtFocus(picture: string): Promise<number | null> {
  if (!nativeArtFocusAvailable) return null;
  try {
    const x = await call<number | null>("art_focus", { picture: picture.slice(picture.indexOf(",") + 1) });
    return typeof x === "number" && x >= 0 && x <= 1 ? x : null;
  } catch {
    return null;
  }
}
