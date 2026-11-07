// The dev channel (.github/workflows/dev-build.yml, docs/dev-channel.md): every push to `dev`
// builds installers that update from dev builds only. They are published in one rolling
// pre-release, "Dev build" (tag `dev`), which keeps the current build and the previous ten
// for going back (Settings → About in a dev build).
//
//   bun scripts/devChannel.ts version <run number>
//       X.Y.(Z+1)-dev.N from the newest vX.Y.Z tag
//   bun scripts/devChannel.ts conf <version> <run number> <updater public key>
//       the tauri.conf.json overlay of a dev build, on stdout
//   bun scripts/devChannel.ts publish <dir> <version> <run number> <commit>
//       renames what the build jobs collected, writes the feeds and updates the release
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const REPO = "unzoid/polarity";
export const TAG = "dev";
/** The current build and the previous ten. */
export const KEEP = 11;
export const download = (file: string) => `https://github.com/${REPO}/releases/download/${TAG}/${file}`;
export const FEED = download("latest.json");

/**
 * `X.Y.(Z+1)-dev.N` after the newest stable tag `vX.Y.Z`: above the release it follows, below
 * the next one (semver orders `0.18.1-dev.57` after `0.18.0` and before `0.18.1`).
 */
export function devVersion(tags: string[], run: number): string {
  if (!Number.isInteger(run) || run < 1) throw new Error(`Not a run number: ${run}`);
  let newest: [number, number, number] | null = null;
  for (const tag of tags) {
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
    if (!m) continue;
    const v: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (cmp(v, newest) > 0) newest = v;
  }
  const [x, y, z] = newest ?? [0, 0, 0];
  return `${x}.${y}.${z + 1}-dev.${run}`;
}

function cmp(a: number[], b: number[] | null) {
  if (!b) return 1;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The overlay `tauri build -c` takes: the version, the macOS build number, the dev feed and its key. */
export function devConf(version: string, run: number, pubkey: string) {
  if (!pubkey.trim()) throw new Error("No dev updater public key");
  return {
    version,
    bundle: { macOS: { bundleVersion: String(run) } },
    plugins: { updater: { pubkey: pubkey.trim(), endpoints: [FEED] } },
  };
}

/** What a built file is called in the release: the build number in it, so ten builds fit side by side. */
export function devFileName(file: string, run: number): string | null {
  const p = `Polarity-dev.${run}`;
  const rules: [RegExp, string][] = [
    [/_x64-setup\.exe(\.sig)?$/, `${p}-Windows-x64-setup.exe$1`],
    [/_x64_mpv-sources\.tar$/, `${p}-Windows-x64-mpv-sources.tar`],
    [/_aarch64\.dmg$/, `${p}-macOS-arm64.dmg`],
    [/\.app\.tar\.gz(\.sig)?$/, `${p}-macOS-arm64.app.tar.gz$1`],
    [/_aarch64_mpv-sources\.tar$/, `${p}-macOS-arm64-mpv-sources.tar`],
    [/\.AppImage(\.sig)?$/, `${p}-Linux-x64.AppImage$1`],
    [/\.deb$/, `${p}-Linux-x64.deb`],
    [/\.rpm$/, `${p}-Linux-x64.rpm`],
  ];
  for (const [re, name] of rules) {
    const m = re.exec(file);
    if (m) return name.replace("$1", m[1] ?? "");
  }
  return null;
}

/** The build a release file belongs to; null for the channel's own `latest.json`. */
export function buildOf(asset: string): number | null {
  const m = /^Polarity-dev\.(\d+)-/.exec(asset) ?? /^latest-dev\.(\d+)\.json$/.exec(asset);
  return m ? Number(m[1]) : null;
}

/** The builds kept after `current` is added: the newest `KEEP`, newest first. */
export function keptBuilds(assets: string[], current: number): number[] {
  const builds = new Set<number>([current]);
  for (const a of assets) {
    const b = buildOf(a);
    if (b !== null) builds.add(b);
  }
  return [...builds].sort((a, b) => b - a).slice(0, KEEP);
}

/** The release's files that belong to builds no longer kept. */
export function staleAssets(assets: string[], current: number): string[] {
  const kept = new Set(keptBuilds(assets, current));
  return assets.filter((a) => {
    const b = buildOf(a);
    return b !== null && !kept.has(b);
  });
}

/** One build as the feed and About list it. */
export interface DevBuild {
  build: number;
  version: string;
  commit: string;
  /** ISO date. */
  date: string;
  /** The merged pull request's title, or the commit's subject. */
  title: string;
}

/** The pull request a merge commit came from ("Merge pull request #12 from …", then its title), or the subject. */
export function prTitle(message: string): string {
  const lines = message.split(/\r?\n/).map((l) => l.trim());
  const m = /^Merge pull request (#\d+) from /.exec(lines[0] ?? "");
  if (m) {
    const title = lines.slice(1).find(Boolean);
    return title ? `${title} (${m[1]})` : m[1];
  }
  return lines[0] ?? "";
}

type Platforms = Record<string, { signature: string; url: string }>;

/** Updater entries for the files of one build that have a signature next to them. */
export function platformsOf(files: string[], run: number, signature: (file: string) => string): Platforms {
  const p = `Polarity-dev.${run}`;
  const platforms: Platforms = {};
  const add = (keys: string[], file: string) => {
    if (!files.includes(file) || !files.includes(`${file}.sig`)) return;
    for (const k of keys) platforms[k] = { signature: signature(`${file}.sig`).trim(), url: download(file) };
  };
  add(["windows-x86_64", "windows-x86_64-nsis"], `${p}-Windows-x64-setup.exe`);
  add(["darwin-aarch64", "darwin-aarch64-app"], `${p}-macOS-arm64.app.tar.gz`);
  add(["linux-x86_64", "linux-x86_64-appimage"], `${p}-Linux-x64.AppImage`);
  return platforms;
}

/** The kept builds read from the previous `latest.json`, with this one in front. */
export function buildList(current: DevBuild, previous: unknown, kept: number[]): DevBuild[] {
  const old = previous && typeof previous === "object" && Array.isArray((previous as { builds?: unknown }).builds) ? (previous as { builds: unknown[] }).builds : [];
  const valid = old.filter(
    (b): b is DevBuild =>
      !!b &&
      typeof b === "object" &&
      typeof (b as DevBuild).build === "number" &&
      typeof (b as DevBuild).version === "string" &&
      typeof (b as DevBuild).commit === "string",
  );
  const list = [current, ...valid.filter((b) => b.build !== current.build)];
  return list.filter((b) => kept.includes(b.build)).sort((a, b) => b.build - a.build);
}

export const buildName = (b: Pick<DevBuild, "commit" | "version">) => `Dev build ${b.commit} (${b.version})`;

/** The release entry's notes: this build, then every kept one. */
export function releaseNotes(builds: DevBuild[]): string {
  const [now] = builds;
  const day = (iso: string) => iso.slice(0, 10);
  return `**${buildName(now)}**, build ${now.build}, ${day(now.date)}: ${now.title}

Development builds of the \`dev\` branch, for testing. They update from this entry only, never to or from a release, and have no database built in (docs/dev-channel.md). Files carry their build number; the previous ${KEEP - 1} builds stay here for going back.

### Kept builds
${builds.map((b) => `- ${b.build}: \`${b.commit}\` (${b.version}), ${day(b.date)}, ${b.title}`).join("\n")}
`;
}

// --- The workflow's commands ---------------------------------------------------------------

function run(cmd: string, args: string[], allowFail = false) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0 && !allowFail) {
    console.error(`${cmd} ${args.join(" ")} failed`);
    process.exit(r.status ?? 1);
  }
  return r.status === 0 ? r.stdout : null;
}

function publish(dir: string, version: string, build: number, commit: string) {
  for (const f of readdirSync(dir)) {
    const name = devFileName(f, build);
    if (name) renameSync(join(dir, f), join(dir, name));
    else console.warn(`Not published: ${f}`);
  }
  const files = readdirSync(dir).filter((f) => buildOf(f) === build);
  const platforms = platformsOf(files, build, (f) => readFileSync(join(dir, f), "utf8"));
  if (!Object.keys(platforms).length) {
    console.error(`No signed installers in ${dir}: was the dev updater key set for the build?`);
    process.exit(1);
  }

  const exists = run("gh", ["release", "view", TAG, "-R", REPO, "--json", "assets", "--jq", ".assets[].name"], true);
  const assets = exists ? exists.split("\n").filter(Boolean) : [];
  let previous: unknown = null;
  if (assets.includes("latest.json")) {
    const prev = join(dir, "previous.json");
    run("gh", ["release", "download", TAG, "-R", REPO, "-p", "latest.json", "-O", prev, "--clobber"], true);
    try {
      previous = JSON.parse(readFileSync(prev, "utf8"));
    } catch {}
  }

  const sha = run("git", ["rev-parse", "HEAD"])!.trim();
  const message = run("git", ["log", "-1", "--format=%B", sha])!;
  const current: DevBuild = { build, version, commit, date: new Date().toISOString(), title: prTitle(message) };
  const kept = keptBuilds(assets, build);
  const builds = buildList(current, previous, kept);
  const feed = (list: DevBuild[]) => ({ version, notes: `${buildName(current)}: ${current.title}`, pub_date: current.date, platforms, builds: list });
  // The build's own feed, for going back to it later, and the channel's feed every dev build checks.
  writeFileSync(join(dir, `latest-dev.${build}.json`), JSON.stringify(feed([current]), null, 2));
  writeFileSync(join(dir, "latest.json"), JSON.stringify(feed(builds), null, 2));
  const notes = join(dir, "notes.md");
  writeFileSync(notes, releaseNotes(builds));

  // The tag moves to this commit; the entry is made once and stays a pre-release, never "Latest".
  const ref = `repos/${REPO}/git/refs/tags/${TAG}`;
  if (run("gh", ["api", ref, "--silent"], true) === null) run("gh", ["api", `repos/${REPO}/git/refs`, "-f", `ref=refs/tags/${TAG}`, "-f", `sha=${sha}`, "--silent"]);
  else run("gh", ["api", "-X", "PATCH", ref, "-f", `sha=${sha}`, "-F", "force=true", "--silent"]);
  if (exists === null) {
    run("gh", ["release", "create", TAG, "-R", REPO, "--verify-tag", "--prerelease", "--latest=false", "--title", "Dev build", "--notes-file", notes]);
  }
  // This build's files first, the feed that points at them last, then what's no longer kept.
  run("gh", ["release", "upload", TAG, "-R", REPO, "--clobber", ...[...files, `latest-dev.${build}.json`].map((f) => join(dir, f))]);
  run("gh", ["release", "upload", TAG, "-R", REPO, "--clobber", join(dir, "latest.json")]);
  for (const a of staleAssets(assets, build)) run("gh", ["release", "delete-asset", TAG, a, "-R", REPO, "-y"]);
  run("gh", ["release", "edit", TAG, "-R", REPO, "--prerelease", "--latest=false", "--title", "Dev build", "--notes-file", notes]);
  console.log(`Published ${buildName(current)}; kept builds ${kept.join(", ")}.`);
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "version") {
    const tags = (run("git", ["tag", "--list", "v*"]) ?? "").split("\n");
    console.log(devVersion(tags, Number(args[0])));
  } else if (cmd === "conf") {
    console.log(JSON.stringify(devConf(args[0], Number(args[1]), args[2] ?? "")));
  } else if (cmd === "publish" && args.length === 4 && existsSync(args[0])) {
    publish(args[0], args[1], Number(args[2]), args[3]);
  } else {
    console.error("Usage: bun scripts/devChannel.ts version <run> | conf <version> <run> <pubkey> | publish <dir> <version> <run> <commit>");
    process.exit(1);
  }
}
