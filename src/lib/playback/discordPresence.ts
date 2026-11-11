/**
 * What Discord shows while something plays (#31), as Settings → Playback → Show on Discord has it:
 * nothing ("off"), only that Polarity is in use ("app", the default since #150), or the title with the season
 * and episode, the poster and the time left ("title"). The shell sends it to the Discord app on
 * this machine (src-tauri/src/discord.rs); without Discord, nothing happens.
 *
 * Others see a "Watch in Polarity" button on it (#153): the same title, in their own Polarity
 * ("title" only, since "app" doesn't say what plays), through the website's hand-over page. In a
 * party that can be joined from Discord (#154, #357) the activity carries the party and the join
 * token instead, and Discord shows its own Join (or Ask to Join, with "Ask me"), which opens
 * Polarity directly; Discord takes no buttons next to a join. Discord builds the heading itself
 * from the activity type and the application's name ("Watching Polarity"); the closest an
 * activity gets to "Watching on Polarity" is its first line.
 */

export type DiscordPresence = "off" | "app" | "title";

/** What the shell's `discord_presence` takes; null clears it. */
export interface DiscordActivity {
  details: string;
  state?: string;
  /** Unix ms. */
  start?: number;
  end?: number;
  image?: string;
  imageText?: string;
  buttons?: { label: string; url: string }[];
  /** Discord's own Join (#357): `size` members now and the most Discord shows room for. */
  join?: { party: string; secret: string; size: [number, number]; ask: boolean };
}

/** The party joinable from Discord: the desk's random party id and current token (lib/party/discordDesk.ts). */
export interface PresenceJoin {
  party: string;
  secret: string;
  members: number;
  /** "Ask me": Ask to Join. */
  ask: boolean;
}

/** The website page behind the button (see lib/deepLink), and the party to join. */
export interface PresenceLinks {
  watch?: string;
  join?: PresenceJoin;
}

/**
 * The room Discord shows a party to have. A watch party has no limit, but Discord hides Join from a
 * full party, so it shows this many, or one more than the members once there are as many.
 */
export const PARTY_ROOM = 10;

const joinOf = (j: PresenceJoin): NonNullable<DiscordActivity["join"]> => ({
  party: j.party,
  secret: j.secret,
  size: [j.members, Math.max(PARTY_ROOM, j.members + 1)],
  ask: j.ask,
});

export interface Playing {
  name: string;
  poster?: string;
  /** A show's episode. */
  episode?: { season: number; episode: number; title?: string };
  paused: boolean;
  ended: boolean;
  /** Seconds. */
  current: number;
  duration: number;
  rate: number;
}

/** "S1 E5 · The Long Night"; specials (season 0) as "Special 3". */
const episodeLine = (e: NonNullable<Playing["episode"]>) => {
  const code = e.season === 0 ? `Special ${e.episode}` : `S${e.season} E${e.episode}`;
  const title = e.title?.trim();
  return title && !/^episode \d+$/i.test(title) ? `${code} · ${title}` : code;
};

export function discordActivity(mode: DiscordPresence, p: Playing | null, now = Date.now(), links: PresenceLinks = {}): DiscordActivity | null {
  if (mode === "off" || !p || p.ended) return null;
  // While it plays: when it began (at this speed) and when it ends, so Discord counts down the time left.
  const rate = p.rate > 0 ? p.rate : 1;
  const times =
    !p.paused && p.duration > 0 && Number.isFinite(p.duration)
      ? { start: Math.round(now - (p.current * 1000) / rate), end: Math.round(now + ((p.duration - p.current) * 1000) / rate) }
      : {};
  // A join leaves the button out: Discord takes one or the other.
  const offer = links.join ? { join: joinOf(links.join) } : null;
  if (mode === "app") return { details: "Watching on Polarity", state: p.paused ? "Paused" : undefined, ...times, ...offer };
  const watch = links.watch ? [{ label: "Watch in Polarity", url: links.watch }] : [];
  const lines = [p.episode && episodeLine(p.episode), p.paused && "Paused"].filter(Boolean);
  return {
    details: p.name,
    state: lines.length ? lines.join(" · ") : undefined,
    ...times,
    ...(sharedPoster(p.poster) ? { image: p.poster, imageText: p.name } : {}),
    ...(offer ?? withButtons(watch)),
  };
}

/**
 * Where a poster may come from to be shown on Discord: the art services Polarity itself reads.
 * Anyone viewing the profile can open the picture's link, and an add-on's own picture links may
 * carry its configuration (keys included) in the path, so those stay on this device.
 */
const POSTER_HOSTS = new Set(["image.tmdb.org", "images.metahub.space", "media.kitsu.app", "s4.anilist.co", "cdn.myanimelist.net", "artworks.thetvdb.com"]);

function sharedPoster(poster: string | undefined): poster is string {
  if (!poster) return false;
  try {
    const u = new URL(poster);
    return u.protocol === "https:" && POSTER_HOSTS.has(u.hostname) && !u.port && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

const withButtons = (buttons: NonNullable<DiscordActivity["buttons"]>) => (buttons.length ? { buttons } : {});

/** How far the end time may drift (buffering, a speed mpv changed itself) before Discord is told again. */
const DRIFT_MS = 3000;

/** The same thing to Discord: the same lines and picture, and times within a few seconds. */
export function sameActivity(a: DiscordActivity | null, b: DiscordActivity | null) {
  if (!a || !b) return a === b;
  const near = (x?: number, y?: number) => (x === undefined || y === undefined ? x === y : Math.abs(x - y) < DRIFT_MS);
  const urls = (x: DiscordActivity) => (x.buttons ?? []).map((b) => b.url).join(" ");
  const join = (x: DiscordActivity) => (x.join ? [x.join.party, x.join.secret, ...x.join.size, x.join.ask].join(" ") : "");
  return (
    a.details === b.details &&
    a.state === b.state &&
    a.image === b.image &&
    urls(a) === urls(b) &&
    join(a) === join(b) &&
    near(a.start, b.start) &&
    near(a.end, b.end)
  );
}
