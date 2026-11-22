import { storeLocal } from "../errors";
import { isRecord, num, storedJson } from "../parse";
import type { SourceRecord } from "./bestMatch";

/**
 * What worked before (#230): per add-on and per release group, how often a source
 * from it started and played through on this device, how long it took to start,
 * and when it last failed. Kept on this device only (nothing about which title,
 * no links), for Best Match (bestMatch.ts). Also what this connection carries
 * while playing, in Mbps.
 *
 * Uses EWMA exponential decay (7-day half-life) instead of unbounded lifetime sums
 * so a transient outage never permanently poisons an add-on or release group (#596),
 * tracks a fast 30-minute failure streak for immediate outage deprioritization (#662),
 * ignores failures while offline, and separates health failures from manual user overrides (#591).
 */

const KEY = "polar.sourceHistory";
/** The most kinds of source kept; the least recently used go first. */
const MAX = 200;
/** How much a new throughput sample moves the connection's figure. */
const SPEED_WEIGHT = 0.3;
/** Half-life for historical reliability counts (7 days). */
export const HISTORY_HALF_LIFE_MS = 7 * 86_400_000;
/** Fast outage detection window (30 minutes). */
export const FAST_OUTAGE_WINDOW_MS = 30 * 60_000;
/** Minimum elapsed gap before applying exponential decay (preserves exact counts for back-to-back events). */
const DECAY_MIN_GAP_MS = 60_000;

interface StoredRecord extends SourceRecord {
  used: number;
  /** Consecutive failures within FAST_OUTAGE_WINDOW_MS (reset on any successful start). */
  failStreak?: number;
}

interface Stored {
  records: Record<string, StoredRecord>;
  connectionMbps: number | null;
}

function read(storage: Pick<Storage, "getItem"> | undefined): Stored {
  const v = storedJson(storage, KEY);
  const out: Stored = { records: {}, connectionMbps: null };
  if (!isRecord(v)) return out;
  out.connectionMbps = num(v.connectionMbps) ?? null;
  if (isRecord(v.records)) {
    for (const [k, r] of Object.entries(v.records)) {
      if (!isRecord(r)) continue;
      const n = (x: unknown) => Math.max(0, num(x) ?? 0);
      const streak = num(r.failStreak);
      out.records[k] = {
        tries: n(r.tries),
        starts: n(r.starts),
        fails: n(r.fails),
        through: n(r.through),
        startMs: n(r.startMs),
        lastFail: num(r.lastFail),
        used: n(r.used),
        ...(streak != null && streak > 0 ? { failStreak: streak } : {}),
      };
    }
  }
  return out;
}

let state: Stored = read(globalThis.localStorage);

const keyOf = (kind: "addon" | "group", name: string) => `${kind}:${name.trim().toLowerCase()}`;

function save() {
  const entries = Object.entries(state.records);
  if (entries.length > MAX) state.records = Object.fromEntries(entries.sort((a, b) => b[1].used - a[1].used).slice(0, MAX));
  storeLocal(KEY, JSON.stringify(state));
}

/** The add-on and release group a source came from. */
export interface SourceKind {
  addon?: string;
  group?: string | null;
}

export interface FailOptions {
  /** Override online detection (primarily for tests). Defaults to `navigator.onLine === false`. */
  offline?: boolean;
  /** `"health"` = server/probe/playback failure; `"content"` = manual user override (doesn't poison reliability). */
  kind?: "health" | "content";
}

function decayRecord(r: StoredRecord, now: number) {
  if (!r.used || now <= r.used) return;
  const dt = now - r.used;
  if (dt < DECAY_MIN_GAP_MS) return;
  const factor = Math.pow(0.5, dt / HISTORY_HALF_LIFE_MS);
  const scale = (v: number) => Math.round(v * factor * 1000) / 1000;
  r.tries = scale(r.tries);
  r.starts = scale(r.starts);
  r.fails = scale(r.fails);
  r.through = scale(r.through);
  r.startMs = scale(r.startMs);
}

function update(kind: SourceKind, now: number, change: (r: StoredRecord) => void) {
  const keys = [kind.addon && keyOf("addon", kind.addon), kind.group && keyOf("group", kind.group)].filter((k): k is string => !!k);
  if (!keys.length) return;
  for (const k of keys) {
    const r: StoredRecord = state.records[k] ?? { tries: 0, starts: 0, fails: 0, through: 0, startMs: 0, used: 0 };
    decayRecord(r, now);
    change(r);
    r.used = now;
    state.records[k] = r;
  }
  save();
}

/** The player is opening a source of this kind. */
export const recordTry = (kind: SourceKind, now = Date.now()) => update(kind, now, (r) => r.tries++);

/** It showed a picture, `ms` after the player began on it. */
export const recordStart = (kind: SourceKind, ms: number, now = Date.now()) =>
  update(kind, now, (r) => {
    r.starts++;
    r.startMs += Math.max(0, Math.min(ms, 120_000));
    // Recovery clears any fast-window outage streak.
    delete r.failStreak;
  });

/** It didn't play. Suppressed while offline or when classified as a user/content override rather than a health failure. */
export function recordFail(kind: SourceKind, now = Date.now(), opts?: FailOptions) {
  const offline = opts?.offline ?? (typeof navigator !== "undefined" && navigator.onLine === false);
  if (offline || opts?.kind === "content") return;
  update(kind, now, (r) => {
    r.fails++;
    const withinWindow = r.lastFail != null && now >= r.lastFail && now - r.lastFail <= FAST_OUTAGE_WINDOW_MS;
    r.failStreak = withinWindow ? (r.failStreak ?? 1) + 1 : 1;
    r.lastFail = now;
  });
}

/** It played to the end (or near it). */
export const recordPlayedThrough = (kind: SourceKind, now = Date.now()) => update(kind, now, (r) => r.through++);

/** How sources from an add-on or a release group did on this device. */
export function sourceRecord(kind: "addon" | "group", name: string): SourceRecord | undefined {
  const r = state.records[keyOf(kind, name)];
  if (!r) return undefined;
  const { used: _, failStreak, ...rec } = r;
  if (failStreak != null && failStreak >= 2) rec.recentFails = failStreak;
  return rec;
}

/** What playback measured (megabits per second); joins the earlier figure gently. */
export function recordThroughput(mbps: number) {
  if (!Number.isFinite(mbps) || mbps <= 0) return;
  const was = state.connectionMbps;
  state.connectionMbps = was == null ? mbps : was + (mbps - was) * SPEED_WEIGHT;
  save();
}

/** What this connection carries while playing, as measured; null until it has been. */
export const connectionMbps = () => state.connectionMbps;

/** Forget everything (tests, and Settings' reset if it comes to that). */
export function resetSourceHistory(storage: Pick<Storage, "getItem"> | undefined = undefined) {
  state = read(storage);
}
