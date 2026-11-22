/**
 * Same-runner base-branch flake detector for Playwright E2E failures (Netflix CI flake-triage pattern).
 *
 * When a PR fails 1..=5 tests, re-running those exact failing tests against the base commit
 * on the same runner distinguishes real PR regressions (passes on base, fails on PR) from
 * pre-existing/runner flakes (fails on base too).
 */

export interface PlaywrightFailure {
  file: string;
  title: string;
}

export type FlakeDecision =
  | { action: "skip"; reason: string }
  | { action: "rerun"; failures: PlaywrightFailure[] };

/** Maximum failing tests to re-run against the base branch on the same runner. */
export const MAX_FLAKE_RERUNS = 5;

/** Extract leaf failing tests from Playwright's `--reporter=json` output. */
export function extractPlaywrightFailures(report: unknown): PlaywrightFailure[] {
  const failures: PlaywrightFailure[] = [];
  const walkSuite = (suite: Record<string, unknown>, parentFile = "") => {
    const file = typeof suite.file === "string" && suite.file ? suite.file : parentFile;
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!spec || typeof spec !== "object") continue;
        const s = spec as Record<string, unknown>;
        const title = typeof s.title === "string" ? s.title : "";
        const tests = Array.isArray(s.tests) ? s.tests : [];
        const failed = tests.some((t) => {
          if (!t || typeof t !== "object") return false;
          const status = (t as Record<string, unknown>).status;
          return status === "unexpected" || status === "failed";
        });
        if (failed && title) failures.push({ file, title });
      }
    }
    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) {
        if (child && typeof child === "object") walkSuite(child as Record<string, unknown>, file);
      }
    }
  };
  if (report && typeof report === "object") walkSuite(report as Record<string, unknown>);
  return failures;
}

/** Decide whether a PR failure set qualifies for a bounded same-runner base-branch re-run. */
export function planFlakeRerun(failures: readonly PlaywrightFailure[], maxReruns = MAX_FLAKE_RERUNS): FlakeDecision {
  if (failures.length === 0) return { action: "skip", reason: "No failing tests." };
  if (failures.length > maxReruns) {
    return { action: "skip", reason: `${failures.length} failures exceed max flake re-run budget (${maxReruns}); likely a real regression.` };
  }
  return { action: "rerun", failures: [...failures] };
}

/** Classify whether a test that failed on PR is a regression or a pre-existing flake based on its base-branch re-run. */
export function classifyRerunOutcome(failedOnPr: boolean, failedOnBase: boolean): "pass" | "regression" | "flake" {
  if (!failedOnPr) return "pass";
  return failedOnBase ? "flake" : "regression";
}
