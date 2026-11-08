// Publishes what the Release workflow built (.github/workflows/release.yml):
// every installer in one GitHub release under the names scripts/releaseAssets.ts
// gives them, notes with a downloads section, and the `latest.json` feed the
// in-app updater reads, covering each platform that was built.
//
//   bun scripts/release-publish.ts <x.y.z> <dir with the built files> [notes.md]
//
// The directory may have subfolders (the Android APK comes in Gradle's). The
// release is created as a draft: installed apps only see it once you press
// Publish on GitHub, so you can check the files and notes first.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO, feedPlatforms, releaseFile, releaseNotes } from "./releaseAssets";

const [version, dir, notesFile] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !dir) {
  console.error("Usage: bun scripts/release-publish.ts <x.y.z> <dir> [notes.md]");
  process.exit(1);
}
const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const out = join(dir, "..", "release-upload");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

// Each built file under its release name; its signature, if any, goes into the feed.
const signatures = new Map<string, string>();
const unknown: string[] = [];
for (const path of walk(dir)) {
  const base = path.split(/[\\/]/).pop()!;
  if (base.endsWith(".sig")) continue;
  const file = releaseFile(base, version);
  if (!file) {
    unknown.push(relative(dir, path));
    continue;
  }
  if (existsSync(join(out, file.name))) {
    console.error(`Two built files would both be ${file.name}`);
    process.exit(1);
  }
  copyFileSync(path, join(out, file.name));
  if (existsSync(`${path}.sig`)) signatures.set(file.name, readFileSync(`${path}.sig`, "utf8"));
}
if (unknown.length) {
  console.error(`No release name for: ${unknown.join(", ")} (scripts/releaseAssets.ts)`);
  process.exit(1);
}

const names = readdirSync(out).sort();
const platforms = feedPlatforms(names, version, (name) => signatures.get(name));
if (!Object.keys(platforms).length) {
  console.error(`No signed installers in ${dir}: was TAURI_SIGNING_PRIVATE_KEY set for the build?`);
  process.exit(1);
}
writeFileSync(join(out, "latest.json"), JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2));
const bodyPath = join(dir, "..", "release-body.md");
writeFileSync(bodyPath, releaseNotes(version, names, notes));

const r = spawnSync(
  "gh",
  [
    "release", "create", `v${version}`,
    "-R", REPO,
    "--verify-tag",
    "--draft",
    "--title", `Polarity ${version}`,
    "--notes-file", bodyPath,
    ...readdirSync(out).map((f) => join(out, f)),
  ],
  { stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`Drafted Polarity ${version}: ${names.length + 1} files, ${Object.keys(platforms).length} updater entries.`);
