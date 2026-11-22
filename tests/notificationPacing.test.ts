import { describe, expect, test } from "bun:test";
import { budgetFor, paceNewsNotes, rankNewsByEngagement } from "../src/lib/notifications/pacing";
import type { News } from "../src/lib/notifications/whatsNew";

const NOW = Date.UTC(2026, 10, 22);
const DAY = 86_400_000;

const makeNews = (id: string, name: string, kind: "episode" | "season" = "episode"): News => ({
  kind,
  season: 2,
  show: { id, type: "series", name },
  videos: [{ id: `${id}:2:1`, season: 2, episode: 1, title: "Premiere" }],
});

describe("Thinking Fast & Slow Notifications (#642)", () => {
  test("ranks active Continue Watching ahead of recent library and old unstarted backlog", () => {
    const news = [
      makeNews("tt0000001", "Old Backlog"),
      makeNews("tt0000002", "Recent Library"),
      makeNews("tt0000003", "Active Show"),
    ];
    const started = [
      { metaId: "tt0000003", videoId: "tt0000003:1:8", type: "series" as const, name: "Active Show", position: 1000, duration: 2400, updatedAt: NOW - 2 * DAY },
    ];
    const library = [
      { id: "tt0000001", type: "series" as const, name: "Old Backlog", addedAt: NOW - 180 * DAY },
      { id: "tt0000002", type: "series" as const, name: "Recent Library", addedAt: NOW - 10 * DAY },
    ];

    const ranked = rankNewsByEngagement(news, started, library, NOW);
    expect(ranked.map((r) => r.news.show.id)).toEqual(["tt0000003", "tt0000002", "tt0000001"]);
    expect(ranked.map((r) => r.tier)).toEqual([1, 2, 3]);
  });

  test("applies daily/weekly pacing budgets, folds overflow into a single digest, and throttles inactive profiles", () => {
    const ranked = rankNewsByEngagement(
      [makeNews("tt0000001", "Show A"), makeNews("tt0000002", "Show B"), makeNews("tt0000003", "Show C")],
      [],
      [],
      NOW,
    );

    // Balanced: 1/day -> 3 shows fold into 1 digest note.
    const day1 = paceNewsNotes(ranked, "balanced", [], NOW, NOW - DAY);
    expect(day1.notes).toHaveLength(1);
    expect(day1.notes[0]?.id).toBe("news:digest");

    // Second check same day: daily budget already spent -> suppressed.
    const sameDay = paceNewsNotes(ranked, "balanced", day1.nextSentAt, NOW + 60_000, NOW - DAY);
    expect(sameDay.notes).toHaveLength(0);

    // Inactive profile (>7 days since last open): downgraded to 1/week.
    expect(budgetFor("balanced", NOW, NOW - 10 * DAY)).toEqual({ perDay: 1, perWeek: 1 });
    expect(budgetFor("quiet", NOW, NOW - DAY)).toEqual({ perDay: 1, perWeek: 3 });
  });
});
