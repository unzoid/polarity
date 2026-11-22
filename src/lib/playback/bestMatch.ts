import { langMatches, languageName } from "./languages";
import type { RankedStream, ScoreReason } from "../types";

/**
 * "Best Match" (#230): one score per source, relative to the other sources for the
 * title, this device, this connection and what played before, with every point
 * explained ("+35 1080p on a 1080p screen", "−10 2.1 Mbps is low for 1080p").
 * The add-on side only says what a file is (crates/addon's rank.rs); every weight
 * is here, in WEIGHTS.
 *
 * Factors follow a 3-tier precedence structure (Netflix Hendrix #426):
 *   Tier 1 — Safety & Compatibility Guardrails (`otherEpisode`, `cam`, `notOutYet`, `dolbyVisionUnsupported`)
 *   Tier 2 — User & Connection Constraints (audio language, burst-adjusted connection fit, screen fit, SW decode, reliability)
 *   Tier 3 — Quality Tie-Breakers (viewing-distance resolution, direct link, codec-normalized bitrate, dynamic HDR, HW decode, prefs)
 */

/** Every point the score gives or takes. */
export const WEIGHTS = {
  /** The picture's height (adjusted by Device.form viewing distance when known). */
  resolution: { 2160: 40, 1440: 37, 1080: 35, 720: 22, below: 10, unknown: 15 },
  /** Taller than this screen shows (with Settings → Sources' "prefer this screen"). */
  overScreen: -8,
  /** A link the player opens as is. */
  direct: 10,
  cam: -100,
  /** The file's name says it's another episode: never at the top. */
  otherEpisode: -200,
  /** A disc release (BD, Blu-ray) of an episode that aired within NEW_EPISODE_DAYS, or hasn't aired: unlikely to be what it says. */
  notOutYet: -40,

  // Bitrate: size ÷ runtime. Size alone never costs points.
  /** Below the least a file of its height needs to look right (codec-normalized against BITRATE_FLOOR). */
  bitrateLow: -10,
  /** Under half the middle effective bitrate of the other files of its height. */
  bitrateBelowOthers: -4,
  /** At least 1.3× that middle effective bitrate, and the connection carries it: a better picture. */
  bitrateAboveOthers: 3,
  /** Peak bitrate more than the connection has carried (≥ 90 % of it): it would stall. */
  connectionTooSlow: -15,
  /** Peak bitrate over 60 % of the connection: a slow start, stalls on a bad evening. */
  connectionTight: -5,

  // The device.
  hdr: 2,
  /** Dynamic HDR10+ metadata: higher than static HDR10 on HDR displays. */
  hdr10Plus: 2.5,
  dolbyVision: 3,
  /** Dolby Vision without an HDR10 / HDR10+ layer, on a device that can't show Dolby Vision: wrong colours. */
  dolbyVisionUnsupported: -10,
  /** HEVC or AV1 decoded by the hardware: smaller for the same picture. */
  efficientCodec: 1,
  /** HEVC or AV1 this device decodes in software: hot, and it may drop frames. 4K doubles it; desktop dav1d ≤1080p softens it. */
  softwareDecode: -6,

  // The user's preferences (Settings → Subtitles & Audio, Sources, Anime).
  audioLanguage: 8,
  /** Multi-audio: usually has it, but doesn't say. */
  audioMulti: 5,
  /** Says which audio it has, and that's only other languages (a dub): it would play in a language you don't want. */
  audioOtherLanguage: -15,
  /** Each preferred tag (Remux, Atmos, 10-bit…) it has. */
  preferredTag: 3,
  /** The first preferred release group, then each next one less, never below the last. */
  preferredGroup: [12, 9, 6, 3],

  // What happened before on this device (sourceHistory.ts), per add-on and per release group.
  /** Times the share of tries that failed, once it was tried MIN_TRIES times. */
  failRate: -12,
  /** Times the share of starts that played through. */
  playedThrough: 4,
  /** Failed just now, fading out over RECENT_FAIL_HOURS (boosted on rapid outage streaks). */
  recentFail: -15,
  /** Took longer than SLOW_START_MS to start, on average. */
  slowStart: -3,
} as const;

export type Factor = keyof typeof WEIGHTS;

/**
 * Each factor's row in a source's info (#274), in WEIGHTS' order: every source gets every row,
 * "n/a" and 0 where the factor doesn't apply. The row's input is what scoreOne says about the
 * source ("1080p on a 1080p screen"), its points what it gave. tests/bestMatch.test.ts fails when
 * a factor here has no row.
 */
export const FACTOR_LABELS: Record<Factor, string> = {
  resolution: "Resolution",
  overScreen: "Bigger than the screen",
  direct: "Direct link",
  cam: "CAM or telesync",
  otherEpisode: "Another episode",
  notOutYet: "Disc release of a new episode",
  bitrateLow: "Bitrate for its resolution",
  bitrateBelowOthers: "Bitrate under the others",
  bitrateAboveOthers: "Bitrate above the others",
  connectionTooSlow: "More than the connection carries",
  connectionTight: "Close to the connection's limit",
  hdr: "HDR",
  hdr10Plus: "HDR10+",
  dolbyVision: "Dolby Vision",
  dolbyVisionUnsupported: "Dolby Vision this device can't show",
  efficientCodec: "Hardware decoding",
  softwareDecode: "Software decoding",
  audioLanguage: "Audio language",
  audioMulti: "Multi-audio",
  audioOtherLanguage: "Audio in another language",
  preferredTag: "Preferred tags",
  preferredGroup: "Preferred release group",
  failRate: "Failed here before",
  playedThrough: "Played through here before",
  recentFail: "Failed recently",
  slowStart: "Slow to start here",
};

/** H.264-equivalent Mbps below which a file of each height is squeezed too small. */
export const BITRATE_FLOOR: Record<number, number> = { 2160: 8, 1440: 4, 1080: 2.5, 720: 1.2, 0: 0.6 };
/** Perceptual compression efficiency relative to H.264 (Netflix AV1/HEVC VMAF studies #467/#590/#614). */
export const CODEC_EFFICIENCY: Record<string, number> = { "H.264": 1, HEVC: 1.35, AV1: 1.6, AV2: 1.8 };
/** Scene-cut VBR peak burst headroom over average bitrate (Netflix #533/#628). */
export const BURST_MULTIPLIER = { remux: 1.5, hdr4k: 1.3, default: 1 } as const;
export const MIN_TRIES = 2;
export const RECENT_FAIL_HOURS = 24;
export const SLOW_START_MS = 10_000;
/** How long after an episode airs a disc release of it can't be out yet. */
export const NEW_EPISODE_DAYS = 28;

/** Viewing distance / screen class (Netflix VMAF v1: Phone@5H, TV@3H, Desktop@1.5H). */
export type DeviceForm = "phone" | "tablet" | "desktop" | "tv";

/** What this device can show and decode; `null` = couldn't tell (no points either way). */
export interface Device {
  /** The display's height as a video resolution (sources.ts' screenResolution). */
  screen: number;
  /** Settings → Sources: no bigger picture than the screen first. */
  preferScreen: boolean;
  hdr: boolean | null;
  dolbyVision: boolean | null;
  hevc: boolean | null;
  av1: boolean | null;
  /** 10-bit 4K hardware decode capability when probed separately from 1080p. */
  hevc4k?: boolean | null;
  av14k?: boolean | null;
  /** Viewing form factor for resolution uplift scaling and desktop dav1d SW decode nuance. */
  form?: DeviceForm;
}

/** How a kind of source has done on this device (sourceHistory.ts). */
export interface SourceRecord {
  tries: number;
  starts: number;
  fails: number;
  /** Starts that played to the end (or near it). */
  through: number;
  /** Sum over `starts` of how long each took to show a picture. */
  startMs: number;
  /** When it last failed (ms since the epoch). */
  lastFail?: number;
  /** Consecutive failures within the fast 30-minute outage window, when ≥ 2. */
  recentFails?: number;
}

export interface MatchContext {
  device: Device;
  /** What this connection has carried while playing, in Mbps. */
  connectionMbps: number | null;
  /** The title's (or episode's) length: bitrate = size ÷ runtime. */
  runtimeSec: number | null;
  /** Settings → Subtitles & Audio's audio language ("" = the file's own). */
  audioLanguage: string;
  /**
   * What "the file's own" (`audioLanguage` "") stands for: the language the title was made in when its details
   * say, else this device's. A file that's only a dub into another language isn't the file's own track.
   */
  ownLanguage?: { code: string; from: "title" | "device" };
  /** Settings → Sources' tags (sources.ts' TAG_LABELS keys). */
  preferredTags: string[];
  /** Settings → Anime's release groups, most preferred first. */
  preferredGroups: string[];
  history: (kind: "addon" | "group", name: string) => SourceRecord | undefined;
  now: number;
  /** When the episode aired (ms since the epoch), when known; null for a film or an unknown date. */
  aired?: number | null;
}

/** One row of a source's score table: `input` null where the factor doesn't apply. */
export interface FactorRow {
  factor: Factor;
  label: string;
  input: string | null;
  points: number;
}

export interface Match {
  score: number;
  reasons: ScoreReason[];
  /** Every factor in WEIGHTS, in order; their points add up to `score`. */
  factors: FactorRow[];
  /** Where the score puts it in the list it was scored with (ties share a place); only from scoreSources. */
  rank?: { position: number; of: number };
}

/** No device, connection, preferences or history known: only what the files say. */
export const NEUTRAL: MatchContext = {
  device: { screen: 2160, preferScreen: false, hdr: null, dolbyVision: null, hevc: null, av1: null },
  connectionMbps: null,
  runtimeSec: null,
  audioLanguage: "",
  preferredTags: [],
  preferredGroups: [],
  history: () => undefined,
  now: 0,
};

const resName = (r: number) => (r >= 2160 ? "4K" : `${r}p`);
const mbps = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} Mbps`;
/** The bucket a file's bitrate is compared in. */
const bucket = (r: RankedStream) => {
  const h = r.quality.resolution ?? 0;
  return h >= 2160 ? 2160 : h >= 1440 ? 1440 : h >= 1080 ? 1080 : h >= 720 ? 720 : 0;
};
/** Megabits per second, from the size and the runtime; null when either is unknown. */
export function bitrateMbps(r: RankedStream, runtimeSec: number | null): number | null {
  const size = r.quality.sizeBytes;
  if (!size || !runtimeSec || runtimeSec < 60) return null;
  return (size * 8) / runtimeSec / 1e6;
}
/** H.264-equivalent quality bitrate accounting for HEVC/AV1/AV2 coding efficiency. */
export function effectiveBitrateMbps(r: RankedStream, rawMbps: number): number {
  return rawMbps * (CODEC_EFFICIENCY[r.quality.codec ?? ""] ?? 1);
}
/** Peak burst factor over average bitrate for connection headroom checks. */
export function burstMultiplier(r: RankedStream): number {
  const q = r.quality;
  if ((q.tags ?? []).some((t) => t.toLowerCase() === "remux")) return BURST_MULTIPLIER.remux;
  if ((q.resolution ?? 0) >= 2160 && (q.hdr || q.hdr10Plus || q.dolbyVision)) return BURST_MULTIPLIER.hdr4k;
  return BURST_MULTIPLIER.default;
}
const hasHdr10Plus = (q: RankedStream["quality"]) =>
  Boolean(q.hdr10Plus || (q.tags ?? []).some((t) => /^hdr10(?:\+|plus)$/i.test(t)));

/** Resolution points scaled by viewing distance (Phone@5H flattens 4K uplift; TV@3H is modest; Desktop@1.5H is full). */
function resolutionPoints(h: number | undefined, form: DeviceForm | undefined): number {
  const W = WEIGHTS.resolution;
  if (h == null) return W.unknown;
  if (h >= 2160) return form === "phone" ? 36 : form === "tv" ? 38.5 : W[2160];
  if (h >= 1440) return form === "phone" ? 35.5 : form === "tv" ? 36.5 : W[1440];
  if (h >= 1080) return W[1080];
  if (h >= 720) return W[720];
  return W.below;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const groupKey = (g: string) => g.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const groupTags = (r: RankedStream) => {
  const q = r.quality;
  const t = (q.tags ?? []).map((x) => x.toLowerCase());
  if (q.dolbyVision) t.push("dv");
  if (q.hdr10Plus) t.push("hdr10+");
  if (q.hdr || q.hdr10Plus) t.push("hdr");
  if (q.codec) t.push(q.codec.toLowerCase());
  return t;
};
const TAG_NAMES: Record<string, string> = { dv: "Dolby Vision", hdr: "HDR", "hdr10+": "HDR10+", remux: "Remux", atmos: "Atmos", hevc: "HEVC", "10-bit": "10-bit" };

/** Each source's score and its reasons, the list taken together (codec-normalized bitrates compare within it). */
export function scoreSources(streams: RankedStream[], ctx: MatchContext = NEUTRAL): Map<RankedStream, Match> {
  const rates = new Map<number, number[]>();
  for (const r of streams) {
    const b = bitrateMbps(r, ctx.runtimeSec);
    if (b != null && !r.quality.lowQualitySource) {
      rates.set(bucket(r), [...(rates.get(bucket(r)) ?? []), effectiveBitrateMbps(r, b)]);
    }
  }
  // Fewer than three files of a height with a known size aren't much to compare with.
  const middle = new Map([...rates].filter(([, xs]) => xs.length >= 3).map(([k, xs]) => [k, median(xs)]));
  const scored = streams.map((r) => [r, scoreOne(r, ctx, middle.get(bucket(r)) ?? null)] as const);
  const of = scored.length;
  return new Map(scored.map(([r, m]) => [r, { ...m, rank: { position: 1 + scored.filter(([, o]) => o.score > m.score).length, of } }]));
}

/** Top deciding factor deltas explaining why `#1` (`best`) outscored `candidate` (Netflix #596). */
export interface FactorDelta {
  factor: Factor;
  label: string;
  /** Negative means `best` beat `candidate` by `|delta|` points on this factor. */
  delta: number;
  candidatePoints: number;
  bestPoints: number;
}

export function explainDifference(candidate: Match, best: Match, maxReasons = 3): FactorDelta[] {
  const bestByFactor = new Map(best.factors.map((f) => [f.factor, f.points]));
  return candidate.factors
    .map((f) => {
      const bp = bestByFactor.get(f.factor) ?? 0;
      const delta = Math.round((f.points - bp) * 10) / 10;
      return { factor: f.factor, label: f.label, delta, candidatePoints: f.points, bestPoints: bp };
    })
    .filter((d) => d.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, maxReasons);
}

/** One source's score; `middle` is the middle codec-normalized bitrate of the other files of its height, when there are enough. */
export function scoreOne(r: RankedStream, ctx: MatchContext = NEUTRAL, middle: number | null = null): Match {
  const W = WEIGHTS;
  const q = r.quality;
  const d = ctx.device;
  const reasons: ScoreReason[] = [];
  const by = new Map<Factor, ScoreReason[]>();
  const add = (factor: Factor, reason: string, points: number) => {
    if (!points) return;
    const x = { reason, points: Math.round(points * 10) / 10 };
    reasons.push(x);
    by.set(factor, [...(by.get(factor) ?? []), x]);
  };

  // --- Tier 1: Safety & Compatibility Guardrails ---
  if (q.lowQualitySource) add("cam", "CAM or telesync", W.cam);
  if (r.otherEpisode) add("otherEpisode", `The file says ${r.fileEpisode ?? "another episode"}`, W.otherEpisode);
  const days = ctx.aired == null ? null : (ctx.now - ctx.aired) / 86_400_000;
  if (days != null && days < NEW_EPISODE_DAYS && (q.tags ?? []).includes("BluRay")) {
    const when = days < 0 ? "hasn't aired yet" : days < 1 ? "aired today" : `aired ${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} ago`;
    add("notOutYet", `A disc release, but the episode ${when}`, W.notOutYet);
  }
  const hdr10p = hasHdr10Plus(q);
  const hasHdrFallback = Boolean(q.hdr || hdr10p);
  if (q.dolbyVision && !hasHdrFallback && d.dolbyVision === false) {
    add("dolbyVisionUnsupported", "Dolby Vision only, which this device can't show", W.dolbyVisionUnsupported);
  }

  // --- Tier 2: User, Device & Connection Constraints ---
  const h = q.resolution;
  const onScreen = d.preferScreen ? ` on a ${resName(d.screen)} screen` : "";
  if (d.preferScreen && d.screen < 1300 && (h ?? 0) > Math.max(d.screen, 1080)) {
    add("overScreen", "Bigger than this screen shows", W.overScreen);
  }

  // Raw bitrate + burst multiplier against the connection; codec-normalized effective bitrate for quality.
  const rate = bitrateMbps(r, ctx.runtimeSec);
  if (rate != null && !q.lowQualitySource) {
    const b = bucket(r);
    const eff = effectiveBitrateMbps(r, rate);
    const burst = burstMultiplier(r);
    const peak = rate * burst;
    const fits = ctx.connectionMbps == null || peak < ctx.connectionMbps * 0.6;
    if (eff < BITRATE_FLOOR[b]) {
      add("bitrateLow", `${mbps(rate)} is low for ${b ? resName(b) : "its size"}`, W.bitrateLow);
    } else if (b >= 1440 && eff < BITRATE_FLOOR[b] * 1.25) {
      // AIM starvation penalty (#644): barely-above-floor 4K/1440p loses its uplift against a clean 1080p encode.
      add("bitrateLow", `${mbps(rate)} is thin for ${resName(b)}`, W.bitrateLow * 0.6);
    } else if (middle != null && eff < middle * 0.5) {
      add("bitrateBelowOthers", `${mbps(rate)}, under half the other ${b ? resName(b) : "small"} files' ${mbps(middle)}`, W.bitrateBelowOthers);
    } else if (middle != null && eff >= middle * 1.3 && fits) {
      add("bitrateAboveOthers", `${mbps(rate)}, more detail than the other ${b ? resName(b) : "small"} files' ${mbps(middle)}`, W.bitrateAboveOthers);
    }
    if (ctx.connectionMbps != null) {
      const rateLabel = burst > 1 ? `${mbps(rate)} (peaks ~${mbps(peak)})` : mbps(rate);
      if (peak >= ctx.connectionMbps * 0.9) {
        add("connectionTooSlow", `${rateLabel} is more than this connection carries (${mbps(ctx.connectionMbps)})`, W.connectionTooSlow);
      } else if (peak >= ctx.connectionMbps * 0.6) {
        add("connectionTight", `${rateLabel} is close to this connection's ${mbps(ctx.connectionMbps)}`, W.connectionTight);
      }
    }
  }

  // Codec hardware vs. software decode (uses 4K 10-bit probe when available; softens desktop dav1d ≤1080p).
  const is4k = (h ?? 0) >= 2160;
  const codecCap =
    q.codec === "HEVC"
      ? (is4k && d.hevc4k !== undefined ? d.hevc4k : d.hevc)
      : q.codec === "AV1"
        ? (is4k && d.av14k !== undefined ? d.av14k : d.av1)
        : undefined;
  if (codecCap === true) {
    add("efficientCodec", `${q.codec}, decoded by this device's hardware`, W.efficientCodec);
  } else if (codecCap === false) {
    const penalty = is4k ? W.softwareDecode * 2 : q.codec === "AV1" && d.form === "desktop" ? -2 : W.softwareDecode;
    add("softwareDecode", `${q.codec} without hardware decoding here`, penalty);
  }

  // Audio language constraint.
  const own = ctx.audioLanguage ? null : ctx.ownLanguage;
  const pref = ctx.audioLanguage || own?.code;
  if (pref) {
    const langs = q.languages ?? [];
    const name = languageName(pref) ?? pref;
    const whose = !own ? "your language" : own.from === "title" ? "the title's own" : "this device's language";
    if (langs.some((l) => langMatches(l, pref))) add("audioLanguage", `Audio in ${name}, ${whose}`, W.audioLanguage);
    else if (langs.includes("multi")) add("audioMulti", `Multi-audio, may have ${own ? name : "your language"}`, W.audioMulti);
    else if (langs.length) {
      const other = langs.map((l) => languageName(l) ?? l).join(", ");
      add("audioOtherLanguage", `Audio in ${other}, not ${name}`, W.audioOtherLanguage);
    }
  }

  // Historical reliability (EWMA-decayed in sourceHistory.ts + fast outage streak).
  const seen: [string, SourceRecord | undefined][] = [
    ["Add-on", ctx.history("addon", r.addon)],
    ["Release group", q.source ? ctx.history("group", q.source) : undefined],
  ];
  let lastFail = 0;
  let burstFails = 0;
  for (const [who, rec] of seen) {
    if (!rec) continue;
    if (rec.tries >= MIN_TRIES && rec.fails) {
      const failsLabel = Number.isInteger(rec.fails) ? rec.fails : Math.round(rec.fails * 10) / 10;
      const triesLabel = Number.isInteger(rec.tries) ? rec.tries : Math.round(rec.tries * 10) / 10;
      add("failRate", `${who} failed ${failsLabel} of ${triesLabel} times here`, W.failRate * (rec.fails / rec.tries));
    }
    if (rec.starts >= MIN_TRIES && rec.through) {
      const throughLabel = Number.isInteger(rec.through) ? rec.through : Math.round(rec.through * 10) / 10;
      const startsLabel = Number.isInteger(rec.starts) ? rec.starts : Math.round(rec.starts * 10) / 10;
      add("playedThrough", `${who} played through ${throughLabel} of ${startsLabel} times here`, W.playedThrough * (rec.through / rec.starts));
    }
    if (rec.starts >= MIN_TRIES && rec.startMs / rec.starts > SLOW_START_MS) {
      add("slowStart", `${who} takes ${Math.round(rec.startMs / rec.starts / 1000)} s to start here`, W.slowStart);
    }
    lastFail = Math.max(lastFail, rec.lastFail ?? 0);
    burstFails = Math.max(burstFails, rec.recentFails ?? 0);
  }
  const hours = (ctx.now - lastFail) / 3_600_000;
  if (lastFail && hours >= 0 && hours < RECENT_FAIL_HOURS) {
    const burstScale = burstFails >= 2 && hours < 0.5 ? Math.min(1.5, 1 + 0.25 * (burstFails - 1)) : 1;
    const when = hours < 1 ? "within the hour" : `${Math.floor(hours)} h ago`;
    const suffix = burstScale > 1 ? ` (${burstFails}× in a row)` : "";
    add("recentFail", `Failed here ${when}${suffix}`, W.recentFail * (1 - hours / RECENT_FAIL_HOURS) * burstScale);
  }

  // --- Tier 3: Quality Tie-Breakers & Preferences ---
  const resPts = resolutionPoints(h, d.form);
  if (h == null) add("resolution", "Unknown resolution", resPts);
  else if (h >= 2160) add("resolution", `4K${onScreen}`, resPts);
  else if (h >= 1440) add("resolution", `1440p${onScreen}`, resPts);
  else if (h >= 1080) add("resolution", `1080p${onScreen}`, resPts);
  else if (h >= 720) add("resolution", `720p${onScreen}`, resPts);
  else add("resolution", "Below 720p", resPts);
  if (q.direct) add("direct", "Direct link", W.direct);

  // Dynamic HDR hierarchy: Dolby Vision (+3) > HDR10+ (+2.5) > static HDR10 (+2).
  if (q.dolbyVision && d.hdr && d.dolbyVision) add("dolbyVision", "Dolby Vision on an HDR screen", W.dolbyVision);
  else if (hdr10p && d.hdr) add("hdr10Plus", "HDR10+ on an HDR screen", W.hdr10Plus);
  else if ((q.hdr || q.dolbyVision) && d.hdr) add("hdr", "HDR on an HDR screen", W.hdr);

  const tags = groupTags(r);
  for (const t of ctx.preferredTags) if (tags.includes(t)) add("preferredTag", `${TAG_NAMES[t] ?? t}, which you prefer`, W.preferredTag);
  const group = q.source ? ctx.preferredGroups.findIndex((g) => groupKey(g) === groupKey(q.source!)) : -1;
  if (group >= 0) add("preferredGroup", `${q.source}, a release group you prefer`, W.preferredGroup[Math.min(group, W.preferredGroup.length - 1)]);

  const total = (xs: ScoreReason[]) => Math.round(xs.reduce((n, x) => n + x.points, 0) * 10) / 10;
  const factors = (Object.keys(W) as Factor[]).map((factor) => {
    const xs = by.get(factor) ?? [];
    return { factor, label: FACTOR_LABELS[factor], input: xs.length ? xs.map((x) => x.reason).join("; ") : null, points: total(xs) };
  });
  return { score: total(reasons), reasons, factors };
}
