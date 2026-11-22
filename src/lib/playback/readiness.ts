import { useEffect, useState } from "react";
import { api } from "../api";
import { ExclusivePriorityQueue, loadCoordinator, TIER } from "../net/limiter";
import type { RankedStream, Readiness } from "../types";
import { requestHeaders } from "./headers";

/**
 * Which of the top sources would start now (#21): while a source list is open, the first few
 * links get the same first request pressing Play makes (`stream_ready`), two at a time,
 * scheduled via an `ExclusivePriorityQueue` keyed by host so one slow host never blocks
 * readiness checks for other hosts. Automatically yields during critical playback buffering.
 */

/** How many of a list's first sources are checked. */
export const READY_CHECKS = 4;
const KEEP_MS = 5 * 60_000;

const known = new Map<string, { readiness: Readiness; at: number }>();
const asking = new Map<string, Promise<Readiness>>();
/** How many open lists want each link checked: a queued check starts only while one still does. */
const wanting = new Map<string, number>();
const want = (url: string, by: number) => {
  const n = (wanting.get(url) ?? 0) + by;
  if (n > 0) wanting.set(url, n);
  else wanting.delete(url);
};
const queue = new ExclusivePriorityQueue<string>(2);

function hostKey(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
}

/** What's known about a link, when it was checked in the last few minutes. */
export function knownReadiness(url: string, now = Date.now()): Readiness | undefined {
  const k = known.get(url);
  if (k && now - k.at < KEEP_MS) return k.readiness;
  known.delete(url);
  return undefined;
}

/** On a metered connection (where the platform says so), links aren't checked ahead of time. */
function metered() {
  const c = (navigator as { connection?: { saveData?: boolean; type?: string } }).connection;
  return c?.saveData === true || c?.type === "cellular";
}

/** One link's check, shared by every list asking for it; it starts only while a list still wants it. */
export function checkReadiness(s: RankedStream, priority = 0): Promise<Readiness> {
  const url = s.stream.url;
  if (!url || !/^https?:\/\//i.test(url)) return Promise.resolve({ state: "unchecked" });
  const have = knownReadiness(url);
  if (have) return Promise.resolve(have);
  if (loadCoordinator.shouldShed(TIER.bestEffort)) return Promise.resolve({ state: "unchecked" });
  const pending = asking.get(url);
  if (pending) return pending;
  const job = queue
    .run(
      hostKey(url),
      async (): Promise<Readiness> => {
        if (!wanting.has(url) || loadCoordinator.shouldShed(TIER.bestEffort)) return { state: "unchecked" };
        const started = Date.now();
        const readiness = await api.streamReady(url, requestHeaders(s.stream)).catch((): Readiness => ({ state: "unchecked" }));
        loadCoordinator.recordLatency(Date.now() - started);
        if (readiness.state !== "unchecked") known.set(url, { readiness, at: Date.now() });
        return readiness;
      },
      priority,
    )
    .finally(() => asking.delete(url));
  asking.set(url, job);
  return job;
}

/**
 * Ask these links ahead of time, as the source list does, so the servers have the file ready by the time
 * Play asks: the next episode's first choices, near the end of this one. Not on a metered connection
 * or while critical playback/network degradation sheds background work.
 * Returns a function that stops the checks that haven't started.
 */
export function warmLinks(streams: RankedStream[]): () => void {
  if (metered() || loadCoordinator.shouldShed(TIER.bestEffort)) return () => {};
  const urls = streams.map((s) => s.stream.url ?? "").filter((u) => /^https?:\/\//i.test(u));
  for (const url of urls) want(url, 1);
  streams.forEach((s, i) => void checkReadiness(s, i));
  return () => urls.forEach((url) => want(url, -1));
}

/**
 * ANY-mode early-stop readiness helper: probes candidates concurrently (one per host via
 * `ExclusivePriorityQueue`) and resolves as soon as the first candidate answers `ready`,
 * cancelling remaining unstarted checks immediately.
 */
export async function firstReady(
  streams: RankedStream[],
  signal?: AbortSignal,
): Promise<{ stream: RankedStream; readiness: Extract<Readiness, { state: "ready" }> } | null> {
  const candidates = streams.filter((s) => !!s.stream.url && /^https?:\/\//i.test(s.stream.url));
  if (!candidates.length || signal?.aborted) return null;
  const urls = candidates.map((s) => s.stream.url!);
  for (const url of urls) want(url, 1);
  const cleanup = () => urls.forEach((url) => want(url, -1));

  return new Promise((resolve) => {
    let settled = false;
    let remaining = candidates.length;
    const finish = (result: { stream: RankedStream; readiness: Extract<Readiness, { state: "ready" }> } | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      cleanup();
      resolve(result);
    };
    const onAbort = () => finish(null);
    signal?.addEventListener("abort", onAbort, { once: true });

    candidates.forEach((s, idx) => {
      void checkReadiness(s, idx).then((r) => {
        if (settled) return;
        if (r.state === "ready") {
          finish({ stream: s, readiness: r });
          return;
        }
        remaining--;
        if (remaining <= 0) finish(null);
      });
    });
  });
}

/** The readiness of each of `streams` by link, filled in as checks answer; nothing while `enabled` is off. */
export function useReadiness(streams: RankedStream[], enabled = true): ReadonlyMap<string, Readiness> {
  const urls = streams.map((s) => s.stream.url ?? "").filter(Boolean);
  const wanted = urls.join("\n");
  const [found, setFound] = useState<ReadonlyMap<string, Readiness>>(() => new Map());
  useEffect(() => {
    if (!enabled || !wanted || metered()) return;
    let open = true;
    const mine = urls.slice();
    for (const url of mine) want(url, 1);
    for (const s of streams) {
      const url = s.stream.url;
      if (!url) continue;
      void checkReadiness(s).then((r) => {
        if (open && r.state !== "unchecked") setFound((m) => new Map(m).set(url, r));
      });
    }
    // Closing the list stops the checks that haven't started; the ones running end within seconds.
    return () => {
      open = false;
      for (const url of mine) want(url, -1);
    };
    // `wanted` names the links; `streams` itself is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, enabled]);
  return found;
}

/** "starts in 0.4 s" */
export const startsIn = (ms: number) => `starts in ${(Math.max(ms, 100) / 1000).toFixed(1)} s`;

/** What a source row says about its check: `short` in the detail line, `long` on hover. */
export function readinessNote(r: Readiness): { short: string; long: string } | undefined {
  if (r.state === "ready") return { short: `Ready · ${startsIn(r.ms)}`, long: `Ready to play: this link answered with the video in ${(Math.max(r.ms, 100) / 1000).toFixed(1)} s` };
  if (r.state === "notReady") return { short: r.reason, long: r.reason };
  if (r.state === "slow")
    return { short: "Slow to answer", long: `No answer within ${Math.round(r.ms / 1000)} s. Some servers take a while to open a file: this one may still play.` };
  return undefined;
}
