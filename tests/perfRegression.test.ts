import { describe, expect, test } from "bun:test";
import { checkSigmaGate, detectChangepoint, evaluatePerfHistory, parseJsonlMetric } from "../scripts/perfRegression";
import { classifyRerunOutcome, extractPlaywrightFailures, planFlakeRerun } from "../scripts/flakeCheck";

describe("perfRegression statistical gates", () => {
  test("checkSigmaGate allows normal noise and flags 4-sigma spikes", () => {
    const baseline = Array.from({ length: 40 }, (_, i) => 10 + ((i % 3) - 1) * 0.6);
    const ok = checkSigmaGate([...baseline, 11.2]);
    expect(ok.anomaly).toBe(false);

    const spike = checkSigmaGate([...baseline, 18.5]);
    expect(spike.anomaly).toBe(true);
    expect(spike.latest).toBe(18.5);
    expect(spike.threshold).toBeLessThan(18.5);
  });

  test("detectChangepoint catches sustained step regressions that rolling sigma can miss", () => {
    const before = Array.from({ length: 50 }, (_, i) => 10 + (i % 2) * 0.4);
    const after = Array.from({ length: 20 }, (_, i) => 14.5 + (i % 2) * 0.4);
    const cp = detectChangepoint([...before, ...after]);
    expect(cp.detected).toBe(true);
    expect(cp.index).toBeGreaterThanOrEqual(48);
    expect(cp.index).toBeLessThanOrEqual(52);
    expect(cp.afterMean).toBeGreaterThan(cp.beforeMean);

    // Improvement (downward step) is not flagged as a regression.
    const improved = detectChangepoint([...after, ...before]);
    expect(improved.detected).toBe(false);
  });

  test("parseJsonlMetric and evaluatePerfHistory parse clean & malformed JSONL lines", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => JSON.stringify({ sha: `a${i}`, medianFrame: 8.0 + (i % 2) * 0.2 })),
      "not-valid-json",
      JSON.stringify({ sha: "bad", medianFrame: 22.0 }),
    ].join("\n");
    const values = parseJsonlMetric(rows, "medianFrame");
    expect(values).toHaveLength(21);
    const report = evaluatePerfHistory(values);
    expect(report.ok).toBe(false);
    expect(report.sigma.anomaly).toBe(true);
  });

  test("flakeCheck bounds base-branch reruns to <= 5 failures and classifies regressions vs flakes", () => {
    const sampleReport = {
      suites: [
        {
          file: "e2e/home.spec.ts",
          specs: [
            { title: "renders rows", tests: [{ status: "expected" }] },
            { title: "recovers after slow poster", tests: [{ status: "unexpected" }] },
          ],
        },
      ],
    };
    const failures = extractPlaywrightFailures(sampleReport);
    expect(failures).toEqual([{ file: "e2e/home.spec.ts", title: "recovers after slow poster" }]);
    expect(planFlakeRerun(failures).action).toBe("rerun");
    expect(planFlakeRerun(Array.from({ length: 6 }, (_, i) => ({ file: "e2e/a.spec.ts", title: `t${i}` }))).action).toBe("skip");
    expect(classifyRerunOutcome(true, false)).toBe("regression");
    expect(classifyRerunOutcome(true, true)).toBe("flake");
    expect(classifyRerunOutcome(false, false)).toBe("pass");
  });
});
