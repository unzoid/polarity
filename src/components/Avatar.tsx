import { useEffect, useState, type CSSProperties } from "react";
import { avatarDef } from "../lib/account";
import { GLASS_AVATARS } from "./glassAvatars";

/** Rendered SVGs by avatar id: cached in memory and localStorage so repeat launches skip DiceBear altogether. */
const STORAGE_PREFIX = "polar.avatar:v1:";
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
let art: Promise<typeof import("./avatarArt")> | undefined;

function readCachedAvatar(key: string): string | undefined {
  const pre = GLASS_AVATARS[key];
  if (pre) return pre;
  const mem = cache.get(key);
  if (mem) return mem;
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_PREFIX + key) : null;
    if (stored && stored.startsWith("data:image/svg+xml")) {
      cache.set(key, stored);
      return stored;
    }
  } catch {
    // Storage unavailable or blocked.
  }
  return undefined;
}

function writeCachedAvatar(key: string, uri: string) {
  cache.set(key, uri);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_PREFIX + key, uri);
  } catch {
    // Quota full or blocked: in-memory cache still holds it for this session.
  }
}

/** The art for `id`: at once when it's been drawn before, else once DiceBear's chunk has loaded. */
function useAvatarUri(id: string) {
  const key = avatarDef(id).id;
  const [uri, setUri] = useState(() => readCachedAvatar(key));
  useEffect(() => {
    const known = readCachedAvatar(key);
    if (known) return setUri(known);
    let live = true;
    let job = inFlight.get(key);
    if (!job) {
      job = (art ??= import("./avatarArt")).then(({ avatarArt }) => avatarArt(key)).then((rendered) => {
        writeCachedAvatar(key, rendered);
        inFlight.delete(key);
        return rendered;
      });
      inFlight.set(key, job);
    }
    job.then(
      (rendered) => {
        if (live) setUri(rendered);
      },
      // The chunk didn't load (offline, or the page is going away mid-load, which WebKit
      // reports as a failed import): the tile shows its colours only, and the next avatar tries again.
      () => {
        inFlight.delete(key);
        art = undefined;
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  return uri;
}

/** A profile avatar: a colour tile with DiceBear art. Scales with its box. */
export function Avatar({ id, className, style }: { id: string; className?: string; style?: CSSProperties }) {
  const a = avatarDef(id);
  const uri = useAvatarUri(id);
  return (
    <span
      className={className ? `avatar ${className}` : "avatar"}
      data-style={a.style}
      style={{ ...style, "--avatar-from": a.from, "--avatar-to": a.to } as CSSProperties}
      aria-hidden
    >
      {uri && <img src={uri} alt="" draggable={false} />}
    </span>
  );
}
