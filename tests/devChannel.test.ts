import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEV_APP,
  FEED,
  KEEP,
  buildList,
  buildOf,
  devConf,
  devFileName,
  devVersion,
  keptBuilds,
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

test("files carry the build number", () => {
  expect(devFileName("Polarity Dev_0.18.1-dev.57_x64-setup.exe", 57)).toBe("polarity-dev.57-Windows-x64-setup.exe");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_x64-setup.exe.sig", 57)).toBe("polarity-dev.57-Windows-x64-setup.exe.sig");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_x64_mpv-sources.tar", 57)).toBe("polarity-dev.57-Windows-x64-mpv-sources.tar");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_aarch64.dmg", 57)).toBe("polarity-dev.57-macOS-arm64.dmg");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_aarch64.app.tar.gz.sig", 57)).toBe("polarity-dev.57-macOS-arm64.app.tar.gz.sig");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_aarch64_mpv-sources.tar", 57)).toBe("polarity-dev.57-macOS-arm64-mpv-sources.tar");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_amd64.AppImage", 57)).toBe("polarity-dev.57-Linux-x64.AppImage");
  expect(devFileName("Polarity Dev_0.18.1-dev.57_amd64.deb", 57)).toBe("polarity-dev.57-Linux-x64.deb");
  expect(devFileName("notes.md", 57)).toBeNull();
  expect(buildOf("polarity-dev.57-Linux-x64.deb")).toBe(57);
  expect(buildOf("latest-dev.57.json")).toBe(57);
  expect(buildOf("latest.json")).toBeNull();
});

const filesOf = (b: number) => [`polarity-dev.${b}-Windows-x64-setup.exe`, `polarity-dev.${b}-Windows-x64-setup.exe.sig`, `latest-dev.${b}.json`];

test("the current build and the previous ten are kept; the eleventh-oldest's files go", () => {
  expect(KEEP).toBe(11);
  const assets = ["latest.json", ...[46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56].flatMap(filesOf)];
  expect(keptBuilds(assets, 57)).toEqual([57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47]);
  expect(staleAssets(assets, 57)).toEqual(filesOf(46));
  // Fewer than eleven: nothing goes, and the feed itself never does.
  expect(staleAssets(["latest.json", ...filesOf(56)], 57)).toEqual([]);
  // Gaps in run numbers (failed runs) count kept builds, not numbers.
  expect(keptBuilds([...filesOf(10), ...filesOf(30)], 31)).toEqual([31, 30, 10]);
});

test("the updater entries point at this build's signed files", () => {
  const files = [...filesOf(57), "polarity-dev.57-macOS-arm64.app.tar.gz", "polarity-dev.57-Linux-x64.AppImage", "polarity-dev.57-Linux-x64.AppImage.sig"];
  const p = platformsOf(files, 57, (f) => `sig of ${f}\n`);
  expect(Object.keys(p).sort()).toEqual(["linux-x86_64", "linux-x86_64-appimage", "windows-x86_64", "windows-x86_64-nsis"]);
  expect(p["windows-x86_64"]).toEqual({
    signature: "sig of polarity-dev.57-Windows-x64-setup.exe.sig",
    url: "https://github.com/unzoid/polarity/releases/download/dev/polarity-dev.57-Windows-x64-setup.exe",
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
  const notes = releaseNotes(list);
  expect(notes).toStartWith("**Dev build abc57 (0.18.1-dev.57)**, build 57, 2026-11-07: PR 57");
  expect(notes).toContain("- 55: `abc55` (0.18.1-dev.55), 2026-11-07, PR 55");
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
