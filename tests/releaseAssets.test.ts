import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PLAYER_ZIP, feedPlatforms, releaseFile, releaseNotes } from "../scripts/releaseAssets";

const V = "1.2.3";
const root = join(import.meta.dir, "..");

/** What the Release workflow's jobs collect, as Tauri, Gradle and the mpv scripts name it. */
const BUILT = [
  `Polarity_${V}_x64-setup.exe`,
  `Polarity_${V}_x64_en-US.msi`,
  `Polarity_${V}_x64_mpv-sources.tar`,
  `Polarity_${V}_x64_mpv.zip`,
  `Polarity_${V}_aarch64.dmg`,
  `Polarity_${V}_aarch64.app.tar.gz`,
  `Polarity_${V}_aarch64_mpv-sources.tar`,
  `Polarity_${V}_amd64.AppImage`,
  `Polarity_${V}_amd64.deb`,
  `Polarity-${V}-1.x86_64.rpm`,
  "app-arm64-debug.apk",
  "polarity-android-mpv-sources.tar.xz",
  "Polarity.ipa",
  "polarity-ios-mpv-sources.tar.xz",
];

const NAMES = [
  `Polarity-${V}-Windows-x64-setup.exe`,
  `Polarity-${V}-Windows-x64.msi`,
  `Sources-Polarity-${V}-Windows-x64-mpv.tar`,
  `Tools-Polarity-${V}-Windows-x64-mpv.zip`,
  `Polarity-${V}-macOS-arm64.dmg`,
  `Polarity-${V}-macOS-arm64.app.tar.gz`,
  `Sources-Polarity-${V}-macOS-arm64-mpv.tar`,
  `Polarity-${V}-Linux-x64.AppImage`,
  `Polarity-${V}-Linux-x64.deb`,
  `Polarity-${V}-Linux-x64.rpm`,
  `Polarity-${V}-Android-arm64-debug.apk`,
  `Sources-Polarity-${V}-Android-mpv.tar.xz`,
  `Polarity-${V}-iOS-arm64-unsigned.ipa`,
  `Sources-Polarity-${V}-iOS-mpv.tar.xz`,
];

test("every built file gets a name that starts with what it is, its version and its platform", () => {
  expect(BUILT.map((f) => releaseFile(f, V)?.name)).toEqual(NAMES);
  expect(releaseFile("app-universal-debug.apk", V)?.name).toBe(`Polarity-${V}-Android-universal-debug.apk`);
  expect(releaseFile("app-x86_64-debug.apk", V)?.name).toBe(`Polarity-${V}-Android-x64-debug.apk`);
});

test("signatures and unknown files get no name", () => {
  expect(releaseFile(`Polarity_${V}_x64-setup.exe.sig`, V)).toBeNull();
  expect(releaseFile(`Polarity_${V}_aarch64.app.tar.gz.sig`, V)).toBeNull();
  expect(releaseFile("notes.md", V)).toBeNull();
  expect(releaseFile("app-release-unsigned.apk", V)).toBeNull();
});

test("GitHub's alphabetical list keeps each platform's apps together, then the sources, then the tools", () => {
  const sorts = [(a: string, b: string) => (a < b ? -1 : 1), (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase())];
  for (const sort of sorts) {
    const listed = [...NAMES].sort(sort);
    const prefix = listed.map((n) => n.split("-")[0]);
    expect(prefix).toEqual([...prefix].sort(sort));
    expect(prefix.indexOf("Sources")).toBe(prefix.lastIndexOf("Polarity") + 1);
    const platforms = listed.filter((n) => n.startsWith("Polarity-")).map((n) => n.split("-")[2]);
    // Each platform's files are one run.
    expect(platforms.filter((p, i) => p !== platforms[i - 1])).toEqual([...new Set(platforms)]);
  }
});

test("the feed has the updater entries every release has had, pointing at the new names", () => {
  const sig = (name: string) => `sig of ${name}\n`;
  const platforms = feedPlatforms(NAMES, V, sig);
  expect(Object.keys(platforms).sort()).toEqual(
    ["darwin-aarch64", "darwin-aarch64-app", "linux-x86_64", "linux-x86_64-appimage", "windows-x86_64", "windows-x86_64-msi", "windows-x86_64-nsis"].sort(),
  );
  const url = (n: string) => `https://github.com/unzoid/polarity/releases/download/v${V}/${n}`;
  expect(platforms["windows-x86_64"]).toEqual({ signature: `sig of Polarity-${V}-Windows-x64-setup.exe`, url: url(`Polarity-${V}-Windows-x64-setup.exe`) });
  expect(platforms["windows-x86_64-msi"].url).toBe(url(`Polarity-${V}-Windows-x64.msi`));
  expect(platforms["darwin-aarch64"].url).toBe(url(`Polarity-${V}-macOS-arm64.app.tar.gz`));
  expect(platforms["linux-x86_64-appimage"].url).toBe(url(`Polarity-${V}-Linux-x64.AppImage`));
});

test("a file without a signature has no updater entry; the .msi stands in for a missing setup", () => {
  const platforms = feedPlatforms([`Polarity-${V}-Windows-x64.msi`, `Polarity-${V}-Linux-x64.AppImage`], V, (n) => (n.endsWith(".msi") ? "s" : undefined));
  expect(Object.keys(platforms).sort()).toEqual(["windows-x86_64", "windows-x86_64-msi"]);
});

test("the notes open with downloads by platform, then what's new, then the bundled components' sources", () => {
  const notes = releaseNotes(V, NAMES, "- Things got better");
  const heads = [...notes.matchAll(/^(## .+|\*\*\w+\*\*)$/gm)].map((m) => m[1]);
  expect(heads).toEqual(["## Downloads", "**Windows**", "**macOS**", "**Linux**", "**Android**", "**iOS**", "## What's new", "## Source code for bundled components"]);
  const downloads = notes.slice(0, notes.indexOf("## What's new"));
  for (const n of NAMES.filter((n) => n.startsWith("Polarity-") && !n.endsWith(".app.tar.gz"))) expect(downloads).toContain(`[\`${n}\`](`);
  expect(downloads).not.toContain(".app.tar.gz");
  expect(downloads).not.toContain("Sources-");
  expect(downloads).toMatch(/setup\.exe`\]\([^)]+\): the installer \(recommended\)/);
  expect(downloads).toMatch(/debug\.apk`\]\([^)]+\): a debug build/);
  expect(downloads).toMatch(/unsigned\.ipa`\]\([^)]+\): an unsigned build/);
  expect(notes).toContain("- Things got better");
  const sources = notes.slice(notes.indexOf("## Source code"));
  expect(sources).toContain("bundled on Windows, macOS, Android and iOS");
  for (const n of NAMES.filter((n) => n.startsWith("Sources-"))) expect(sources).toContain(`[\`${n}\`](https://github.com/unzoid/polarity/releases/download/v${V}/${n})`);
  expect(sources).toContain(`Tools-Polarity-${V}-Windows-x64-mpv.zip`);
});

test("a release with only some platforms lists only those", () => {
  const notes = releaseNotes(V, [`Polarity-${V}-Linux-x64.AppImage`, `Polarity-${V}-Linux-x64.deb`], "");
  expect(notes).toContain("**Linux**");
  expect(notes).not.toContain("**Windows**");
  expect(notes).not.toContain("## Source code");
  expect(notes).toContain("_Add the notes before publishing._");
});

test("fetch-mpv finds the player in a release under the old name and the new one", () => {
  expect(PLAYER_ZIP.test("Polarity_0.18.0_x64_mpv.zip")).toBe(true);
  expect(PLAYER_ZIP.test(`Tools-Polarity-${V}-Windows-x64-mpv.zip`)).toBe(true);
  expect(PLAYER_ZIP.test(`Sources-Polarity-${V}-Windows-x64-mpv.tar`)).toBe(false);
});

test("release-publish drafts the release with the new names, no signatures, the feed and the notes", () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "release-publish-"));
  try {
    const built = join(dir, "release");
    mkdirSync(join(built, "arm64", "debug"), { recursive: true });
    for (const f of BUILT) writeFileSync(f.endsWith(".apk") ? join(built, "arm64", "debug", f) : join(built, f), f);
    for (const f of [`Polarity_${V}_x64-setup.exe`, `Polarity_${V}_x64_en-US.msi`, `Polarity_${V}_aarch64.app.tar.gz`, `Polarity_${V}_amd64.AppImage`]) {
      writeFileSync(join(built, `${f}.sig`), `sig of ${f}\n`);
    }
    writeFileSync(join(dir, "notes.md"), "- New things\n");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${join(dir, "gh-args")}"\n`);
    chmodSync(join(bin, "gh"), 0o755);

    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "" };
    const r = spawnSync("bun", [join(root, "scripts", "release-publish.ts"), V, built, join(dir, "notes.md")], { encoding: "utf8", env });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);

    const args = readFileSync(join(dir, "gh-args"), "utf8").trim().split("\n");
    expect(args.slice(0, 4)).toEqual(["release", "create", `v${V}`, "-R"]);
    expect(args).toContain("--draft");
    const files = args.filter((a) => a.startsWith(join(dir, "release-upload"))).map((a) => a.split("/").pop()!);
    expect(files.sort()).toEqual([...NAMES, "latest.json"].sort());

    const feed = JSON.parse(readFileSync(join(dir, "release-upload", "latest.json"), "utf8"));
    expect(feed.version).toBe(V);
    expect(feed.notes).toBe("- New things");
    expect(feed.platforms["windows-x86_64-nsis"].signature).toBe(`sig of Polarity_${V}_x64-setup.exe`);
    expect(feed.platforms["darwin-aarch64"].url).toEndWith(`/v${V}/Polarity-${V}-macOS-arm64.app.tar.gz`);
    expect(readFileSync(join(dir, "release-upload", `Polarity-${V}-Android-arm64-debug.apk`), "utf8")).toBe("app-arm64-debug.apk");

    const body = readFileSync(args[args.indexOf("--notes-file") + 1], "utf8");
    expect(body.startsWith("## Downloads")).toBe(true);
    expect(body).toContain("- New things");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release-publish refuses a built file it has no name for", () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "release-publish-"));
  try {
    const built = join(dir, "release");
    mkdirSync(built);
    writeFileSync(join(built, `Polarity_${V}_x64-setup.exe`), "");
    writeFileSync(join(built, `Polarity_${V}_x64-setup.exe.sig`), "s");
    writeFileSync(join(built, "stray.zip"), "");
    // No gh on PATH: nothing may reach it.
    const r = spawnSync(process.execPath, [join(root, "scripts", "release-publish.ts"), V, built], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("No release name for: stray.zip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Release workflow builds the phone apps and drafts the release with them", () => {
  const wf = Bun.YAML.parse(readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8"));
  expect(wf.jobs.publish.needs).toEqual(["build", "android", "ios"]);
  expect(wf.jobs.publish.if).toContain("needs.build.result == 'success'");
  const artifact = (job: string) => wf.jobs[job].steps.find((s: { uses?: string }) => s.uses?.startsWith("actions/upload-artifact")).with.name;
  expect(artifact("android")).toBe("polarity-Android");
  expect(artifact("ios")).toBe("polarity-iOS");
  // Gradle names the APK universal whatever it holds; the job builds arm64 and says so.
  const android = wf.jobs.android.steps.map((s: { run?: string }) => s.run ?? "").join("\n");
  expect(android).toContain("--debug --apk --target aarch64\n");
  expect(releaseFile(android.match(/out\/(app-[\w-]+\.apk)/)![1], V)?.name).toBe(`Polarity-${V}-Android-arm64-debug.apk`);
  const download = wf.jobs.publish.steps.find((s: { uses?: string }) => s.uses?.startsWith("actions/download-artifact")).with;
  expect(download.pattern).toBe("polarity-*");
});
