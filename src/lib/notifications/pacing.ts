import type { LibraryItem, Progress } from "../types";
import { newsBody, newsNotes, type Note } from "./messages";
import type { News } from "./whatsNew";

/**
 * "Thinking Fast & Slow" notification pacing & engagement ranking (Netflix #642).
 *
 * - Slow Layer (Pacing Budget): bounds individual OS notifications per day & week
 *   (`quiet` <=1/day, <=3/wk; `balanced` <=1/day, <=5/wk; `all` unlimited), and
 *   automatically throttles inactive profiles (>7 days since last open).
 * - Fast Layer (Engagement Ranking + Digest Overflow): promotes active Continue Watching
 *   and new seasons of watched shows ahead of old unstarted backlog, rolling any
 *   budget overflow into a single clean digest note.
 */

export type NotifyPacing = "quiet" | "balanced" | "all";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface PacingBudget {
  perDay: number;
  perWeek: number;
}

export function budgetFor(pacing: NotifyPacing, now: number, lastActiveAt?: number): PacingBudget {
  if (pacing === "all") return { perDay: Infinity, perWeek: Infinity };
  const inactive = lastActiveAt != null && now - lastActiveAt > WEEK_MS;
  if (inactive) return { perDay: 1, perWeek: 1 };
  return pacing === "quiet" ? { perDay: 1, perWeek: 3 } : { perDay: 1, perWeek: 5 };
}

export interface RankedNews {
  news: News;
  tier: 1 | 2 | 3;
  score: number;
}

/**
 * Rank incoming show alerts by local engagement:
 * - Tier 1: currently watching / watched within 30d, or new season of a previously started show.
 * - Tier 2: recently saved to Library (within 60d).
 * - Tier 3: older unstarted Library backlog.
 */
export function rankNewsByEngagement(
  all: readonly News[],
  started: readonly Progress[],
  library: readonly LibraryItem[],
  now = Date.now(),
): RankedNews[] {
  const latestProgress = new Map<string, number>();
  for (const p of started) {
    const prev = latestProgress.get(p.metaId) ?? 0;
    if (p.updatedAt > prev) latestProgress.set(p.metaId, p.updatedAt);
  }
  const libraryAdded = new Map<string, number>();
  for (const l of library) {
    libraryAdded.set(l.id, l.updatedAt ?? l.addedAt);
  }

  return all
    .map((news): RankedNews => {
      const id = news.show.id;
      const lastWatch = latestProgress.get(id);
      if (lastWatch != null) {
        const ageDays = Math.max(0, (now - lastWatch) / DAY_MS);
        const recency = Math.max(0, 30 - ageDays);
        const seasonBoost = news.kind === "season" ? 20 : 0;
        if (ageDays <= 30 || news.kind === "season") {
          return { news, tier: 1, score: 100 + recency + seasonBoost };
        }
        return { news, tier: 2, score: 70 + Math.max(0, 90 - ageDays) * 0.2 };
      }
      const added = libraryAdded.get(id);
      if (added != null) {
        const ageDays = Math.max(0, (now - added) / DAY_MS);
        if (ageDays <= 60) return { news, tier: 2, score: 50 + Math.max(0, 60 - ageDays) * 0.3 };
      }
      return { news, tier: 3, score: 10 };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Apply the pacing budget to engagement-ranked news: emit individual alerts up to the
 * remaining daily/weekly slots and fold overflow into a single digest note.
 */
export function paceNewsNotes(
  ranked: readonly RankedNews[],
  pacing: NotifyPacing,
  sentAt: readonly number[],
  now = Date.now(),
  lastActiveAt?: number,
): { notes: Note[]; nextSentAt: number[] } {
  const recent = sentAt.filter((t) => now - t < WEEK_MS);
  if (ranked.length === 0) return { notes: [], nextSentAt: recent };
  if (pacing === "all") {
    const notes = newsNotes(ranked.map((r) => r.news));
    return { notes, nextSentAt: [...recent, ...notes.map(() => now)] };
  }

  const budget = budgetFor(pacing, now, lastActiveAt);
  const sentToday = recent.filter((t) => now - t < DAY_MS).length;
  const sentWeek = recent.length;
  const remaining = Math.max(0, Math.min(budget.perDay - sentToday, budget.perWeek - sentWeek));

  if (remaining === 0) {
    // Daily or weekly budget already reached: defer individual pings (suppress spam).
    return { notes: [], nextSentAt: recent };
  }

  if (ranked.length <= remaining) {
    const notes = ranked.map(({ news }): Note => ({
      id: `news:${news.show.id}`,
      title: news.show.name,
      body: newsBody(news),
      route: { name: "detail", type: news.show.type, id: news.show.id },
    }));
    return { notes, nextSentAt: [...recent, ...notes.map(() => now)] };
  }

  // Emit top (remaining - 1) individually and fold the rest into one digest note so total <= remaining.
  const individualCount = Math.max(0, remaining - 1);
  const individual = ranked.slice(0, individualCount).map(({ news }): Note => ({
    id: `news:${news.show.id}`,
    title: news.show.name,
    body: newsBody(news),
    route: { name: "detail", type: news.show.type, id: news.show.id },
  }));
  const overflow = ranked.slice(individualCount).map((r) => r.news);
  const names = overflow.map((n) => n.show.name);
  const digest: Note = {
    id: "news:digest",
    title: `New episodes of ${overflow.length} shows`,
    body: overflow.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${overflow.length - 2} more`,
    route: { name: "library" },
  };
  const notes = [...individual, digest];
  return { notes, nextSentAt: [...recent, ...notes.map(() => now)] };
}
