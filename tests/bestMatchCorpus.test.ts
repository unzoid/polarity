import { describe, expect, test } from "bun:test";
import corpus from "../contract/best_match_corpus.json";
import { NEUTRAL, scoreSources, type Device, type MatchContext } from "../src/lib/playback/bestMatch";
import { filterBoilerplateSteps, formatReport, nextAttemptId, type StartSpan, type StartStep } from "../src/lib/playback/startLog";
import { createOverride } from "../src/lib/testing/safeOverride";
import type { RankedStream, StreamQuality } from "../src/lib/types";

describe("bestMatch differential snapshot corpus (#426/#510)", () => {
  for (const scenario of corpus.scenarios) {
    test(scenario.name, () => {
      const candidates: RankedStream[] = scenario.candidates.map((c) => {
        expect(c.url).toContain("example.com");
        return {
          stream: { url: c.url, title: c.id },
          addon: "Open Films",
          label: c.id,
          quality: {
            hdr: false,
            dolbyVision: false,
            lowQualitySource: false,
            direct: true,
            languages: [],
            tags: [],
            ...(c.quality as Partial<StreamQuality>),
          },
        };
      });
      const ctx: MatchContext = {
        ...NEUTRAL,
        device: scenario.device as Device,
        runtimeSec: scenario.runtimeSec,
        connectionMbps: scenario.connectionMbps,
        now: 1e12,
      };
      const scores = scoreSources(candidates, ctx);
      const ranked = [...candidates].sort((a, b) => scores.get(b)!.score - scores.get(a)!.score);
      expect(ranked[0]?.label).toBe(scenario.expectedWinner);
    });
  }
});

describe("Correlated attemptId span waterfall & boilerplate filter (#441/#669)", () => {
  test("nextAttemptId produces monotonic zero-PII ids and collapses >30% repeated noise", () => {
    const a = nextAttemptId();
    const b = nextAttemptId();
    expect(a).toMatch(/^p-\d{4}$/);
    expect(b).toMatch(/^p-\d{4}$/);
    expect(a).not.toBe(b);

    const steps: StartStep[] = [
      { at: 10, text: "Contacting media.example.com", tone: "info", stage: "server" },
      { at: 100, text: "Buffering", tone: "info", stage: "player" },
      { at: 200, text: "Buffering", tone: "info", stage: "player" },
      { at: 300, text: "Buffering", tone: "info", stage: "player" },
      { at: 400, text: "Buffering", tone: "info", stage: "player" },
      { at: 500, text: "Failed to open https://secret-host.example.com/private/TOKEN/film.mkv from /Users/alice/video.mkv", tone: "fail", stage: "player" },
    ];
    const filtered = filterBoilerplateSteps(steps);
    expect(filtered).toHaveLength(4);
    expect(filtered[2]?.text).toContain("repeated 4× total");

    const spans: StartSpan[] = [
      { id: "s1", attemptId: a, stage: "server", label: "probe", startMs: 10, endMs: 95, outcome: "ok" },
      { id: "s2", attemptId: a, parentId: "s1", stage: "player", label: "mpv open", startMs: 100, endMs: 500, outcome: "fail" },
    ];
    const report = formatReport(steps, {
      app: "0.18.0",
      platform: "Windows",
      backend: "mpv",
      outcome: "Failed",
      stage: "player",
      attemptId: a,
      spans,
    });
    expect(report).toContain(`attempt: ${a}`);
    expect(report).toContain(`[${a}/s2<s1] player: mpv open (400ms, fail)`);
    // AGENTS.md redaction invariant: token path & user home path must never appear!
    expect(report).not.toContain("TOKEN");
    expect(report).not.toContain("alice");
    expect(report).toContain("<secret-host.example.com>");
  });
});

describe("SafeTest createOverride (#538)", () => {
  test("creates a typed React context override with defaultValue", () => {
    const ClockOverride = createOverride(() => 1000);
    expect(ClockOverride.defaultValue()).toBe(1000);
    expect(typeof ClockOverride.Provider).toBe("function");
    expect(typeof ClockOverride.use).toBe("function");
  });
});
