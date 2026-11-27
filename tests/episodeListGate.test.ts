import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// #167 / #350: an episode list opens an episode by `isOpenable` (listed up to a week ahead) and dates it with
// `airLabel`. A list that disables by the listed date alone, or writes its own "Coming …", misses episodes
// already out on streaming (the player's rail did until #350). Up Next and watched counts keep `isReleased`.
const SRC = join(import.meta.dir, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const GATES = [
  /disabled(=\{|:)\s*!\s*(released|isReleased\()/,
  /\{\s*released\s*&&\s*<DownloadButton/,
  /`Coming \$\{formatDate\(/,
  // isReleased written out under another name (`aired`, `future`): the desk and phone title pages did (0.22.0).
  /new Date\(\w+\.released\)\.getTime\(\)\s*(<=|>)\s*Date\.now\(\)(?!\s*\+)/,
];
/** Where isReleased and isOpenable themselves are written. */
const HOME = "lib/format.ts";

test("no episode list disables, hides Download or dates by the listed date alone", () => {
  const found = files(SRC).filter((f) => !f.endsWith(HOME)).flatMap((f) => {
    const lines = readFileSync(f, "utf8").split("\n");
    return lines.flatMap((l, i) => (GATES.some((g) => g.test(l)) ? [`${f.slice(SRC.length + 1)}:${i + 1}: ${l.trim()}`] : []));
  });
  expect(found).toEqual([]);
});

test("the check itself catches the rail's old gate", () => {
  for (const old of [
    "disabled={!released}",
    "disabled: !released,",
    "{released && <DownloadButton item={meta} />}",
    "`Coming ${formatDate(v.released)}`",
    "const aired = !v.released || new Date(v.released).getTime() <= Date.now();",
    "const future = !!v.released && new Date(v.released).getTime() > Date.now();",
  ])
    expect(GATES.some((g) => g.test(old))).toBe(true);
  expect(GATES.some((g) => g.test("new Date(v.released).getTime() <= Date.now() + EARLY_DAYS * 86_400_000"))).toBe(false);
});
