/**
 * Checks that a release build leaves out what only dev builds have (#425): the Database setting and
 * the connection code it reads (src/lib/account/devDatabase.ts, AdvancedPage's DatabaseCard), and the
 * watch log with its Copy Watch Log buttons (src/lib/playback/watchLog.ts). Those parts sit behind
 * `buildChannel === "dev"` and `WATCH_LOG`, which the bundler folds to constants, so in a release
 * bundle they are dropped, not just hidden.
 *
 *   bun scripts/releaseBundle.ts [folder]
 *
 * builds the web app twice, as a dev build and as a release (`VITE_POLAR_CHANNEL`), into `folder`
 * (default: a temporary one), and fails if any marker below is in the release bundle, or if one is
 * missing from the dev bundle (a marker that no longer matches the code would check nothing).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

/** Texts only the dev-only parts contain, each with the part it stands for. */
export const DEV_ONLY_MARKERS: { text: string; part: string }[] = [
  { text: "polarity-db:", part: "the connection code parser" },
  { text: "A connection code starts with", part: "the connection code parser" },
  { text: "polar.devdb", part: "the dev database kept in the keychain" },
  { text: "Paste a connection code", part: "the Database setting" },
  { text: "Dev builds have no database built in", part: "the Database setting" },
  { text: "No database connected", part: "the profile menu's dev database line" },
  { text: "Copy Watch Log", part: "the watch log's button" },
  { text: "Polarity watch log", part: "the watch log" },
];

const BUNDLED = /\.(js|mjs|html|css)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : BUNDLED.test(name) ? [path] : [];
  });
}

/** Every marker found in the bundle in `dir`, with the file it is in. */
export function findMarkers(dir: string, markers = DEV_ONLY_MARKERS): { text: string; part: string; file: string }[] {
  const found: { text: string; part: string; file: string }[] = [];
  for (const file of files(dir)) {
    const body = readFileSync(file, "utf8");
    for (const m of markers) if (body.includes(m.text)) found.push({ ...m, file: relative(dir, file) });
  }
  return found;
}

/** What is wrong with a release bundle and a dev bundle of the same code, or an empty list. */
export function bundleProblems(releaseDir: string, devDir: string, markers = DEV_ONLY_MARKERS): string[] {
  const inRelease = findMarkers(releaseDir, markers).map((m) => `The release bundle has ${m.part}: "${m.text}" in ${m.file.split(sep).join("/")}`);
  const inDev = new Set(findMarkers(devDir, markers).map((m) => m.text));
  const stale = markers
    .filter((m) => !inDev.has(m.text))
    .map((m) => `The dev bundle lacks "${m.text}" (${m.part}): update the marker in scripts/releaseBundle.ts`);
  return [...inRelease, ...stale];
}

function build(channel: "release" | "dev", outDir: string) {
  const run = Bun.spawnSync(["bunx", "vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {
    env: { ...process.env, VITE_POLAR_CHANNEL: channel },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (run.exitCode !== 0) throw new Error(`The ${channel} build failed`);
}

if (import.meta.main) {
  const given = process.argv[2];
  const root = given ?? mkdtempSync(join(tmpdir(), "polar-bundles-"));
  const releaseDir = join(root, "release");
  const devDir = join(root, "dev");
  try {
    build("release", releaseDir);
    build("dev", devDir);
    const problems = bundleProblems(releaseDir, devDir);
    for (const p of problems) console.error(p);
    if (problems.length) process.exitCode = 1;
    else console.log(`The release bundle has none of the ${DEV_ONLY_MARKERS.length} dev-only markers; the dev bundle has them all.`);
  } finally {
    if (!given) rmSync(root, { recursive: true, force: true });
  }
}
