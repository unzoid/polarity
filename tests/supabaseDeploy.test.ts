import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changesOf, dbUrl, deployArgs, missing, missingMessage, NEEDS, pendingOf, versionOf } from "../scripts/supabaseDeploy";

const SCRIPT = join(import.meta.dir, "../scripts/supabaseDeploy.ts");

/** Runs the script as the workflow does, with only `env` set (and PATH, for git and bun). */
function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  return { status: r.status, out: r.stdout + r.stderr };
}

test("a missing secret or variable stops the step and names it, with where to set it", () => {
  for (const step of ["migrations", "functions"] as const) {
    const r = run([step, ...(step === "functions" ? ["tv-sign-in"] : [])], { SUPABASE_ENVIRONMENT: "supabase-dev", SUPABASE_PROJECT_REF: "abcdefghijklmnop" });
    expect(r.status).toBe(1);
    const gone = NEEDS[step].filter((n) => n !== "SUPABASE_PROJECT_REF");
    expect(r.out).toContain(`::error::${missingMessage([...gone], "supabase-dev")}`);
  }
  expect(missing({ A: "x", B: " ", C: undefined }, ["A", "B", "C"])).toEqual(["B", "C"]);
  expect(missingMessage(["SUPABASE_DB_PASSWORD"], "supabase-production")).toContain('environment "supabase-production": SUPABASE_DB_PASSWORD');
});

test("nothing to deploy needs no secrets", () => {
  const r = run(["functions"]);
  expect(r.status).toBe(0);
  expect(r.out).toContain("No functions to deploy.");
});

test("a push's changed paths say whether migrations run and which functions deploy", () => {
  expect(
    changesOf([
      "supabase/migrations/20261112000000_example.sql",
      "supabase/functions/tv-sign-in/handler.ts",
      "supabase/functions/tv-sign-in/index.ts",
      "supabase/functions/other/index.ts",
    ]),
  ).toEqual({ migrations: true, functions: ["other", "tv-sign-in"] });
  // Only the two folders count: optional, admin and checks stay manual.
  expect(changesOf(["supabase/optional/per_episode_progress.sql", "supabase/admin/delete_account.sql", "supabase/checks/x.sql"])).toEqual({
    migrations: false,
    functions: [],
  });
});

test("the script's change list for a run with nothing to compare with is everything", () => {
  const r = run(["changes", "0000000000000000000000000000000000000000", "HEAD"]);
  expect(r.status).toBe(0);
  const functions = readdirSync(join(import.meta.dir, "../supabase/functions"))
    .filter((f) => !f.startsWith("_"))
    .sort();
  expect(r.out).toContain("migrations=true");
  expect(r.out).toContain(`functions=${functions.join(" ")}`);
});

test("a pull request's migrations: listed in order, refused when older than the base's newest or a version twice", () => {
  const base = ["20261101000000_accounts.sql", "20261110000000_limits.sql"];
  expect(pendingOf(base, [...base, "20261112000000_b.sql", "20261111000000_a.sql"])).toEqual({
    added: ["20261111000000_a.sql", "20261112000000_b.sql"],
    problems: [],
  });
  const late = pendingOf(base, [...base, "20261105000000_late.sql"]);
  expect(late.problems).toEqual(["20261105000000_late.sql: older than 20261110000000, the newest already in the base; give it a later version"]);
  const twice = pendingOf(base, [...base, "20261110000000_again.sql"]);
  expect(twice.problems.some((p) => p.includes("version 20261110000000 is also"))).toBe(true);
  expect(pendingOf(base, [...base, "notes.sql"]).problems).toEqual(["notes.sql: not named <14-digit version>_<name>.sql"]);
  expect(versionOf("20261109120000_friend_tries.sql")).toBe("20261109120000");
});

test("the repository's own migrations have unique versions in order", () => {
  const files = readdirSync(join(import.meta.dir, "../supabase/migrations"));
  expect(pendingOf([], files).problems).toEqual([]);
});

test("the database address goes through the session pooler with the password encoded", () => {
  expect(dbUrl("abcdefghijklmnop", "aws-0-eu-west-1.pooler.supabase.com", "p@ss/w:rd")).toBe(
    "postgresql://postgres.abcdefghijklmnop:p%40ss%2Fw%3Ard@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  );
});

test("TV sign-in deploys without JWT checks, as docs/supabase-storage.md §9 says; others with them", () => {
  expect(deployArgs("tv-sign-in", "ref")).toEqual(["functions", "deploy", "tv-sign-in", "--project-ref", "ref", "--use-api", "--no-verify-jwt"]);
  expect(deployArgs("other", "ref")).not.toContain("--no-verify-jwt");
});

test("the workflow reads secrets only in the deploy job, from the branch's environment, and asks for no write access", () => {
  const wf = readFileSync(join(import.meta.dir, "../.github/workflows/supabase.yml"), "utf8");
  const [pending, deploy] = wf.split(/^ {2}deploy:$/m);
  expect(pending).not.toContain("secrets.");
  expect(deploy).toContain("environment: ${{ github.ref == 'refs/heads/master' && 'supabase-production' || 'supabase-dev' }}");
  expect(wf).toMatch(/^permissions:\n {2}contents: read$/m);
  expect(wf).not.toMatch(/: write\b/);
});
