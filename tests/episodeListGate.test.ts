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

const GATES = [/disabled(=\{|:)\s*!\s*(released|isReleased\()/, /\{\s*released\s*&&\s*<DownloadButton/, /`Coming \$\{formatDate\(/];

test("no episode list disables, hides Download or dates by the listed date alone", () => {
  const found = files(SRC).flatMap((f) => {
    const lines = readFileSync(f, "utf8").split("\n");
    return lines.flatMap((l, i) => (GATES.some((g) => g.test(l)) ? [`${f.slice(SRC.length + 1)}:${i + 1}: ${l.trim()}`] : []));
  });
  expect(found).toEqual([]);
});

test("the check itself catches the rail's old gate", () => {
  for (const old of ["disabled={!released}", "disabled: !released,", "{released && <DownloadButton item={meta} />}", "`Coming ${formatDate(v.released)}`"])
    expect(GATES.some((g) => g.test(old))).toBe(true);
});
