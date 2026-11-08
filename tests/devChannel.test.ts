import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEV_APP,
  FEED,
  KEEP,
  buildFeed,
  buildList,
  buildOf,
  devConf,
  devFileName,
  devVersion,
  keptBuilds,
  legacyBuildFeed,
  needsLegacyFeed,
  padded,
  platformsOf,
  prTitle,
  releaseNotes,
  staleAssets,
  type DevBuild,
} from "../scripts/devChannel";
import { compareVersions } from "../src/lib/updateFeed";

test("the version follows the newest stable tag", () => {
  expect(devVersion(["v0.17.0", "v0.18.0", "v0.9.9"], 57)).toBe("0.18.1-dev.57");
  expect(devVersion(["v0.18.0", "v0.19.0", "dev", "v0.19.0-rc.1", "v1.0"], 3)).toBe("0.19.1-dev.3");
  expect(devVersion(["v0.10.0", "v0.9.12"], 1)).toBe("0.10.1-dev.1");
  expect(devVersion([], 1)).toBe("0.0.1-dev.1");
  expect(() => devVersion(["v0.18.0"], 0)).toThrow();
});

test("a dev build sorts above the release it follows and below the next one", () => {
  const dev = devVersion(["v0.18.0"], 57);
  expect(compareVersions(dev, "0.18.0")).toBe(1);
  expect(compareVersions(dev, "0.18.1")).toBe(-1);
  expect(compareVersions(dev, "0.19.0")).toBe(-1);
  expect(compareVersions("0.18.1-dev.58", dev)).toBe(1);
  expect(compareVersions("0.18.1-dev.100", "0.18.1-dev.99")).toBe(1);
  expect(compareVersions("0.18.1-dev.9", "0.18.1-dev.9")).toBe(0);
});

test("the overlay points the updater at the dev feed with the dev key", () => {
  const conf = devConf("0.18.1-dev.57", 57, " PUBKEY\n");
  expect(conf.version).toBe("0.18.1-dev.57");
  expect(conf.plugins.updater).toEqual({ pubkey: "PUBKEY", endpoints: [FEED] });
  expect(FEED).toBe("https://github.com/unzoid/polarity/releases/download/dev/latest.json");
  expect(conf.bundle.macOS.bundleVersion).toBe("57");
  expect(() => devConf("0.18.1-dev.57", 57, "")).toThrow();
});

test("a dev build is its own app next to the released one", () => {
  const conf = devConf("0.18.1-dev.57", 57, "PUBKEY", "win32");
  expect(conf.productName).toBe("Polarity Dev");
  expect(conf.mainBinaryName).toBe("polarity-dev");
  expect(conf.identifier).toBe("app.getpolar.desktop.dev");
  expect(conf.plugins["deep-link"].desktop.schemes).toEqual(["polarity-dev"]);
  expect(devConf("0.18.1-dev.57", 57, "PUBKEY", "darwin").plugins["deep-link"].desktop.schemes).toEqual(["polarity-dev", "stremio"]);
  // The shell and the web view build in the same names; the released app keeps its own.
  const shell = readFileSync(join(import.meta.dir, "../src-tauri/src/dev_channel.rs"), "utf8");
  const released = JSON.parse(readFileSync(join(import.meta.dir, "../src-tauri/tauri.conf.json"), "utf8"));
  expect(shell).toContain(`if DEV { "${DEV_APP.identifier}" } else { "${released.identifier}" }`);
  expect(shell).toContain(`if DEV { "${DEV_APP.scheme}" } else { "${released.plugins["deep-link"].desktop.schemes[0]}" }`);
  expect(shell).toContain(`if DEV { "${DEV_APP.productName}" } else { "${released.productName}" }`);
  expect(released.identifier).not.toBe(DEV_APP.identifier);
});

test("files are named platform first, then by a padded build number", () => {
  expect(devFileName("Polarity Dev_0.18.1-dev.57_x64-setup.exe", 57)).toBe("Polarity-Dev-Windows-x64-0057-setup.exe");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_x64-setup.exe.sig", 57)).toBe("Polarity-Dev-Windows-x64-0057-setup.exe.sig");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_x64_mpv-sources.tar", 57)).toBe("Sources-Polarity-Dev-Windows-x64-0057-mpv.tar");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_aarch64.dmg", 57)).toBe("Polarity-Dev-macOS-arm64-0057.dmg");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_aarch64.app.tar.gz.sig", 57)).toBe("Polarity-Dev-macOS-arm64-0057.app.tar.gz.sig");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_aarch64_mpv-sources.tar", 57)).toBe("Sources-Polarity-Dev-macOS-arm64-0057-mpv.tar");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_amd64.AppImage", 57)).toBe("Polarity-Dev-Linux-x64-0057.AppImage");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_amd64.deb", 57)).toBe("Polarity-Dev-Linux-x64-0057.deb");
  expect(devFileName("notes.md", 57)).toBeNull();
  expect(buildFeed(57)).toBe("Updates-Dev-0057.json");
  expect(legacyBuildFeed(57)).toBe("latest-dev.57.json");
  for (const name of [
    "Polarity-Dev-Linux-x64-0057.deb",
    "Polarity-Dev-Windows-x64-0057-setup.exe.sig",
    "Sources-Polarity-Dev-macOS-arm64-0057-mpv.tar",
    "Updates-Dev-0057.json",
  ])
    expect(buildOf(name)).toBe(57);
  expect(buildOf("Polarity-Dev-Linux-x64-12345.deb")).toBe(12345);
  // Builds made before the platform-first names.
  expect(buildOf("polarity-dev.5-Linux-x64.deb")).toBe(5);
  expect(buildOf("latest-dev.5.json")).toBe(5);
  expect(buildOf("latest.json")).toBeNull();
});

/** GitHub's order: by name, ignoring case. */
const listed = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
const built = [
  "x64-setup.exe",
  "x64-setup.exe.sig",
  "x64_mpv-sources.tar",
  "aarch64.dmg",
  "aarch64.app.tar.gz",
  "aarch64_mpv-sources.tar",
  "amd64.AppImage",
  "amd64.deb",
];
const namesOf = (b: number) => [...built.map((f) => devFileName(`Polarity Dev_0.18.1-dev.${b}_${f}`, b)!).filter((f) => !f.endsWith(".sig")), buildFeed(b)];

test("each platform's builds sit together, oldest first, with sources and feeds after the installers", () => {
  const names = listed(["latest.json", ...[5, 9, 10, 57].flatMap(namesOf)]);
  const installers = names.filter((n) => n.startsWith("Polarity-"));
  expect(installers.slice(0, 4)).toEqual([
    "Polarity-Dev-Linux-x64-0005.AppImage",
    "Polarity-Dev-Linux-x64-0005.deb",
    "Polarity-Dev-Linux-x64-0009.AppImage",
    "Polarity-Dev-Linux-x64-0009.deb",
  ]);
  expect(installers.filter((n) => n.includes("-Windows-"))).toEqual([5, 9, 10, 57].map((b) => `Polarity-Dev-Windows-x64-${padded(b)}-setup.exe`));
  // Everything that isn't for people comes after the installers, but latest.json: every installed build asks for it by that name.
  const lastInstaller = names.lastIndexOf(installers[installers.length - 1]);
  expect(names.slice(lastInstaller + 1).every((n) => n.startsWith("Sources-") || n.startsWith("Updates-"))).toBe(true);
  expect(names.slice(lastInstaller + 1)).toHaveLength(names.length - installers.length - 1);
});

const oldFilesOf = (b: number) => [`polarity-dev.${b}-Windows-x64-setup.exe`, `polarity-dev.${b}-Windows-x64-setup.exe.sig`, `latest-dev.${b}.json`];

test("the current build and the previous ten are kept; the eleventh-oldest's files go", () => {
  expect(KEEP).toBe(11);
  const assets = ["latest.json", ...[46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56].flatMap(namesOf)];
  expect(keptBuilds(assets, 57)).toEqual([57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47]);
  expect(staleAssets(assets, 57)).toEqual(namesOf(46));
  // Fewer than eleven: nothing goes, and the feed itself never does.
  expect(staleAssets(["latest.json", ...namesOf(56)], 57)).toEqual([]);
  // Gaps in run numbers (failed runs) count kept builds, not numbers.
  expect(keptBuilds([...namesOf(10), ...namesOf(30)], 31)).toEqual([31, 30, 10]);
});

test("builds under the old names are kept and go like the others; their signatures go now", () => {
  const assets = ["latest.json", ...oldFilesOf(5), ...namesOf(6)];
  expect(keptBuilds(assets, 7)).toEqual([7, 6, 5]);
  expect(staleAssets(assets, 7)).toEqual(["polarity-dev.5-Windows-x64-setup.exe.sig"]);
  // Build 5 asks for a kept build's feed as latest-dev.<N>.json: new builds publish it too while build 5 is kept.
  expect(needsLegacyFeed(assets, 7)).toBe(true);
  expect(needsLegacyFeed([...oldFilesOf(5), ...[6, 7, 8, 9, 10, 11, 12, 13, 14, 15].flatMap(namesOf)], 16)).toBe(false);
  expect(staleAssets([...oldFilesOf(5), ...[6, 7, 8, 9, 10, 11, 12, 13, 14, 15].flatMap(namesOf)], 16)).toEqual(oldFilesOf(5));
});

test("the shell asks for a kept build's feed by the name devChannel.ts gives it, then the old one", () => {
  const shell = readFileSync(join(import.meta.dir, "../src-tauri/src/dev_channel.rs"), "utf8");
  expect(shell).toContain('format!("{RELEASE_FILES}Updates-Dev-{n:04}.json"), format!("{RELEASE_FILES}latest-dev.{n}.json")');
  expect(buildFeed(7)).toBe(`Updates-Dev-${"7".padStart(4, "0")}.json`);
});

test("the updater entries point at this build's signed files", () => {
  const files = built.map((f) => devFileName(`Polarity Dev_0.18.1-dev.57_${f}`, 57)!).concat("Polarity-Dev-Linux-x64-0057.AppImage.sig");
  const p = platformsOf(files, 57, (f) => `sig of ${f}\n`);
  expect(Object.keys(p).sort()).toEqual(["linux-x86_64", "linux-x86_64-appimage", "windows-x86_64", "windows-x86_64-nsis"]);
  expect(p["windows-x86_64"]).toEqual({
    signature: "sig of Polarity-Dev-Windows-x64-0057-setup.exe.sig",
    url: "https://github.com/unzoid/polarity/releases/download/dev/Polarity-Dev-Windows-x64-0057-setup.exe",
  });
});

test("the build's title comes from the merged pull request", () => {
  expect(prTitle("Merge pull request #342 from someone/feature/326-original-audio\n\nOriginal language for every title\n")).toBe(
    "Original language for every title (#342)",
  );
  expect(prTitle("Fix the season pill\n\nLonger text")).toBe("Fix the season pill");
});

test("the kept list carries over from the previous feed, newest first", () => {
  const b = (build: number): DevBuild => ({ build, version: `0.18.1-dev.${build}`, commit: `abc${build}`, date: "2026-11-07T10:00:00Z", title: `PR ${build}` });
  const previous = { builds: [b(56), b(55), { build: "x" }, b(40)] };
  const list = buildList(b(57), previous, [57, 56, 55]);
  expect(list.map((x) => x.build)).toEqual([57, 56, 55]);
  expect(buildList(b(57), null, [57])).toEqual([b(57)]);
  expect(releaseNotes(list, [...namesOf(57), ...namesOf(56)])).toStartWith("**Dev build abc57 (0.18.1-dev.57)**, build 57, 2026-11-07: PR 57");
});

test("the notes: this build's downloads by platform, then the earlier builds with a link per platform", () => {
  const b = (build: number, title = `PR ${build}`): DevBuild => ({
    build,
    version: `0.18.1-dev.${build}`,
    commit: `abc${build}`,
    date: "2026-11-07T10:00:00Z",
    title,
  });
  const assets = ["latest.json", ...namesOf(7), ...namesOf(6), "polarity-dev.5-Windows-x64-setup.exe", "polarity-dev.5-macOS-arm64.dmg", "latest-dev.5.json"];
  const notes = releaseNotes([b(7), b(6, "Pipes | in a title (#12)"), b(5)], assets);
  const url = (name: string) => `https://github.com/unzoid/polarity/releases/download/dev/${name}`;
  const at = (s: string) => notes.indexOf(s);
  expect(at("## Downloads")).toBeLessThan(at("**Windows**"));
  expect(at("**Windows**")).toBeLessThan(at("**macOS**"));
  expect(at("**macOS**")).toBeLessThan(at("**Linux**"));
  expect(at("**Linux**")).toBeLessThan(at("## Earlier builds"));
  expect(notes).toContain(`- [\`Polarity-Dev-Windows-x64-0007-setup.exe\`](${url("Polarity-Dev-Windows-x64-0007-setup.exe")}): the installer.`);
  expect(notes).toContain(`- [\`Polarity-Dev-Linux-x64-0007.deb\`](${url("Polarity-Dev-Linux-x64-0007.deb")})`);
  expect(notes).toContain("| Build | Commit | Date | Pull request | Windows | macOS | Linux |");
  expect(notes).toContain(
    `| 6 | \`abc6\` | 2026-11-07 | Pipes \\| in a title (#12) | [setup.exe](${url("Polarity-Dev-Windows-x64-0006-setup.exe")}) | [dmg](${url("Polarity-Dev-macOS-arm64-0006.dmg")}) | [AppImage](${url("Polarity-Dev-Linux-x64-0006.AppImage")}) · [deb](${url("Polarity-Dev-Linux-x64-0006.deb")}) |`,
  );
  // A build under the old names links its files as they are; what it doesn't have is a dash.
  expect(notes).toContain(
    `| 5 | \`abc5\` | 2026-11-07 | PR 5 | [setup.exe](${url("polarity-dev.5-Windows-x64-setup.exe")}) | [dmg](${url("polarity-dev.5-macOS-arm64.dmg")}) | – |`,
  );
  expect(notes).not.toContain("| 7 |");
  expect(notes).toContain(`- Windows: [\`Sources-Polarity-Dev-Windows-x64-0007-mpv.tar\`](${url("Sources-Polarity-Dev-Windows-x64-0007-mpv.tar")})`);
  expect(at("## Earlier builds")).toBeLessThan(at("## Source code for bundled components"));
  expect(notes).not.toContain(".sig");
  expect(releaseNotes([b(7)], namesOf(7))).toContain("## Earlier builds\n\n_None yet._");
});

test("release builds are the release channel; dev builds have no database and their own key", () => {
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  expect(release).toMatch(/VITE_POLAR_CHANNEL: release/);
  const dev = readFileSync(new URL("../.github/workflows/dev-build.yml", import.meta.url), "utf8");
  expect(dev).toMatch(/VITE_POLAR_CHANNEL: dev/);
  expect(dev).not.toMatch(/SUPABASE/);
  expect(dev).toMatch(/secrets\.DEV_UPDATER_PRIVATE_KEY\b/);
  expect(dev).not.toMatch(/secrets\.TAURI_SIGNING_PRIVATE_KEY\b/);
  expect(dev).toMatch(/branches: \[dev\]/);
});
