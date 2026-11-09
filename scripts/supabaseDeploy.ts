// Applies the database migrations and deploys the Edge Functions to one Supabase project, for
// .github/workflows/supabase.yml (docs/dev-channel.md, "Database changes"). Only `supabase/migrations` and
// `supabase/functions`: `supabase/optional`, `supabase/admin` and `supabase/checks` stay manual.
//
//   bun scripts/supabaseDeploy.ts changes <before> <after>   what a push changed, as step outputs
//   bun scripts/supabaseDeploy.ts pending <base>             the migrations a merge into <base> would add
//   bun scripts/supabaseDeploy.ts migrations                 apply the new migrations (list, then push)
//   bun scripts/supabaseDeploy.ts functions <name>...        deploy these functions
//
// The project comes from the job's GitHub environment: SUPABASE_PROJECT_REF and SUPABASE_DB_HOST (variables),
// SUPABASE_DB_PASSWORD and SUPABASE_ACCESS_TOKEN (secrets). A missing one stops the step and says which.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const MIGRATIONS = "supabase/migrations/";
const FUNCTIONS = "supabase/functions/";

/** Functions called without a user's session, which check what they need themselves (docs/supabase-storage.md §9). */
const WITHOUT_JWT = new Set(["tv-sign-in"]);

/** What each step needs from the environment. */
export const NEEDS = {
  migrations: ["SUPABASE_PROJECT_REF", "SUPABASE_DB_HOST", "SUPABASE_DB_PASSWORD"],
  functions: ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN"],
} as const;

/** The names in `names` that `env` leaves empty. */
export function missing(env: Record<string, string | undefined>, names: readonly string[]): string[] {
  return names.filter((n) => !env[n]?.trim());
}

/** The error a step stops with when its settings aren't there. */
export function missingMessage(names: string[], environment: string): string {
  return (
    `Missing in the GitHub environment "${environment}": ${names.join(", ")}. ` +
    "Settings → Environments → " +
    `${environment} (docs/dev-channel.md, "Database changes").`
  );
}

export interface Changes {
  migrations: boolean;
  /** The folders under supabase/functions that changed, sorted ("_shared"-style ones included). */
  functions: string[];
}

/** What a list of changed paths means for the database. */
export function changesOf(paths: string[]): Changes {
  const functions = new Set<string>();
  let migrations = false;
  for (const p of paths) {
    if (p.startsWith(MIGRATIONS) && p.endsWith(".sql")) migrations = true;
    else if (p.startsWith(FUNCTIONS)) {
      const name = p.slice(FUNCTIONS.length).split("/")[0];
      if (name) functions.add(name);
    }
  }
  return { migrations, functions: [...functions].sort() };
}

/** A migration's version: the digits before the first "_" of its file name. */
export function versionOf(file: string): string | undefined {
  return /^(\d{14})_[^/]+\.sql$/.exec(file)?.[1];
}

export interface Pending {
  /** Migrations in the branch that the base doesn't have, in the order they'd be applied. */
  added: string[];
  /** Why the merge would go wrong: a file name without a version, a version used twice, or one older than the base's newest. */
  problems: string[];
}

/** The migrations a merge would bring, from the file names on each side. */
export function pendingOf(base: string[], head: string[]): Pending {
  const problems: string[] = [];
  const baseSet = new Set(base);
  const newest = base.map(versionOf).filter(Boolean).sort().at(-1) ?? "";
  const added = head.filter((f) => !baseSet.has(f)).sort();
  const seen = new Map<string, string>();
  for (const f of [...head].sort()) {
    const v = versionOf(f);
    if (!v) {
      problems.push(`${f}: not named <14-digit version>_<name>.sql`);
      continue;
    }
    const other = seen.get(v);
    if (other) problems.push(`${f}: version ${v} is also ${other}`);
    seen.set(v, f);
  }
  for (const f of added) {
    const v = versionOf(f);
    // supabase db push refuses a migration older than the last one applied (it would need --include-all).
    if (v && v <= newest) problems.push(`${f}: older than ${newest}, the newest already in the base; give it a later version`);
  }
  return { added, problems };
}

/** The session pooler's address for the project: IPv4, which GitHub's runners need. */
export function dbUrl(ref: string, host: string, password: string): string {
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

/** `supabase functions deploy`'s arguments for one function. */
export function deployArgs(name: string, ref: string): string[] {
  return ["functions", "deploy", name, "--project-ref", ref, "--use-api", ...(WITHOUT_JWT.has(name) ? ["--no-verify-jwt"] : [])];
}

function git(...args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

const lines = (s: string) => s.split("\n").filter(Boolean);

/** The function folders in the checkout. */
function allFunctions(): string[] {
  if (!existsSync(FUNCTIONS)) return [];
  return readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();
}

function supabase(args: string[], env: NodeJS.ProcessEnv): number {
  return spawnSync("supabase", args, { stdio: "inherit", env }).status ?? 1;
}

function fail(message: string): never {
  console.log(`::error::${message}`);
  process.exit(1);
}

function needs(step: keyof typeof NEEDS) {
  const gone = missing(process.env, NEEDS[step]);
  if (gone.length) fail(missingMessage(gone, process.env.SUPABASE_ENVIRONMENT ?? "supabase-…"));
}

function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "changes") {
    const [before, after] = rest;
    // A new branch, a force push or a run by hand: no "before" to compare with, so everything goes.
    const known = before && !/^0+$/.test(before) && spawnSync("git", ["cat-file", "-e", `${before}^{commit}`]).status === 0;
    const changes = known
      ? changesOf(lines(git("diff", "--name-only", before, after ?? "HEAD", "--", MIGRATIONS, FUNCTIONS)))
      : { migrations: true, functions: allFunctions() };
    // Shared code changed (a "_" folder): every function is deployed again.
    const functions = changes.functions.some((f) => f.startsWith("_")) ? allFunctions() : changes.functions.filter((f) => existsSync(FUNCTIONS + f));
    console.log(`migrations=${changes.migrations}`);
    console.log(`functions=${functions.join(" ")}`);
    return;
  }
  if (command === "pending") {
    const base = rest[0] ?? "origin/dev";
    const names = (ref?: string) =>
      lines(ref ? git("ls-tree", "--name-only", `${ref}:${MIGRATIONS}`) : git("ls-files", MIGRATIONS)).map((p) => p.replace(MIGRATIONS, ""));
    const { added, problems } = pendingOf(names(base), names());
    console.log(added.length ? `Migrations this merge would apply, in order:\n${added.map((f) => `- ${f}`).join("\n")}` : "No new migrations.");
    for (const p of problems) console.log(`::error file=${MIGRATIONS}${p.split(":")[0]}::${p}`);
    if (problems.length) process.exit(1);
    return;
  }
  if (command === "migrations") {
    needs("migrations");
    const { SUPABASE_PROJECT_REF: ref, SUPABASE_DB_HOST: host, SUPABASE_DB_PASSWORD: password } = process.env;
    const url = dbUrl(ref!, host!, password!);
    console.log(`::add-mask::${url}`);
    // The list first, so the log says what is about to run; then the migrations, in order, each in its own
    // transaction. The first that fails stops the push (the CLI names it) and nothing after it runs.
    if (supabase(["db", "push", "--db-url", url, "--dry-run"], process.env) !== 0) fail("Couldn't read the database's migration history (see above).");
    if (supabase(["db", "push", "--db-url", url], process.env) !== 0)
      fail("A migration failed and the push stopped there (the one named above). Nothing is retried: fix it in a new migration.");
    return;
  }
  if (command === "functions") {
    if (!rest.length) return console.log("No functions to deploy.");
    needs("functions");
    for (const name of rest) {
      if (!allFunctions().includes(name)) fail(`No function "${name}" in ${FUNCTIONS}.`);
      if (supabase(deployArgs(name, process.env.SUPABASE_PROJECT_REF!), process.env) !== 0) fail(`Deploying the function "${name}" failed (see above).`);
    }
    return;
  }
  fail(`Unknown command "${command ?? ""}": changes, pending, migrations or functions.`);
}

if (import.meta.main) main(process.argv.slice(2));
