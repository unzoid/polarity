import { createAvatar, type Style } from "@dicebear/core";
import { avatarDef, type AvatarStyle } from "../lib/account";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const styles = new Map<AvatarStyle, Promise<Style<any>>>();

function loadStyle(style: AvatarStyle) {
  let pending = styles.get(style);
  if (!pending) {
    pending =
      style === "glass"
        ? import("@dicebear/glass")
        : style === "thumbs"
          ? import("@dicebear/thumbs")
          : import("@dicebear/notionists");
    styles.set(style, pending);
  }
  return pending.catch((err) => {
    styles.delete(style);
    throw err;
  });
}

/** An avatar's DiceBear art as a data URI. Each style is its own chunk so cold start only loads the style in use. */
export async function avatarArt(id: string) {
  const a = avatarDef(id);
  const mod = await loadStyle(a.style);
  return createAvatar(mod, {
    seed: a.seed,
    // The tile paints the background; the art sits on top of it.
    backgroundColor: ["transparent"],
    ...(a.style === "thumbs" ? { scale: 90, ...(a.ink ? { shapeColor: [a.ink] } : {}) } : {}),
  }).toDataUri();
}
