// What a release's files are called and what its notes say about them (docs/releasing.md).
//
// GitHub lists a release's files alphabetically and can't group them, so the names do it:
//
//   Polarity-<version>-<Platform>-<arch>[-<kind>].<ext>   the apps, each platform's files together
//   Sources-Polarity-<version>-<Platform>[-<arch>]-mpv.<ext>  the exact sources of the bundled mpv builds
//   Tools-Polarity-<version>-Windows-x64-mpv.zip          the Windows player, for building from source
//   latest.json                                           the updater's feed
//
// Updater signatures aren't attached: latest.json carries each one itself.

/** The repository the workflow runs in (a fork drafts its own test release), else ours. */
export const REPO = process.env.GITHUB_REPOSITORY || "unzoid/polarity";

export type Platform = "Windows" | "macOS" | "Linux" | "Android" | "iOS";
export const PLATFORMS: Platform[] = ["Windows", "macOS", "Linux", "Android", "iOS"];

export type Kind = "app" | "update" | "sources" | "tool";

export interface ReleaseFile {
  /** The name in the release. */
  name: string;
  platform: Platform;
  kind: Kind;
}

/** The architecture an Android build was made for, from Gradle's APK name. */
function androidArch(file: string): string {
  if (/universal/.test(file)) return "universal";
  if (/x86_64/.test(file)) return "x64";
  return "arm64";
}

/**
 * The release name of a file the build jobs collected (Tauri's bundle names, Gradle's APK, the mpv
 * source archives); null for updater signatures and for anything the release doesn't carry.
 */
export function releaseFile(file: string, version: string): ReleaseFile | null {
  const app = (platform: Platform, tail: string, kind: Kind = "app"): ReleaseFile => ({ name: `Polarity-${version}-${platform}-${tail}`, platform, kind });
  const sources = (platform: Platform, tail: string): ReleaseFile => ({ name: `Sources-Polarity-${version}-${platform}-${tail}`, platform, kind: "sources" });
  if (file.endsWith(".sig")) return null;
  if (/_x64-setup\.exe$/.test(file)) return app("Windows", "x64-setup.exe");
  if (/_x64_en-US\.msi$/.test(file)) return app("Windows", "x64.msi");
  if (/_x64_mpv-sources\.tar$/.test(file)) return sources("Windows", "x64-mpv.tar");
  if (/_x64_mpv\.zip$/.test(file)) return { name: `Tools-Polarity-${version}-Windows-x64-mpv.zip`, platform: "Windows", kind: "tool" };
  if (/_aarch64\.dmg$/.test(file)) return app("macOS", "arm64.dmg");
  if (/_aarch64\.app\.tar\.gz$/.test(file)) return app("macOS", "arm64.app.tar.gz", "update");
  if (/_aarch64_mpv-sources\.tar$/.test(file)) return sources("macOS", "arm64-mpv.tar");
  if (/\.AppImage$/.test(file)) return app("Linux", "x64.AppImage");
  if (/\.deb$/.test(file)) return app("Linux", "x64.deb");
  if (/\.rpm$/.test(file)) return app("Linux", "x64.rpm");
  if (/-debug\.apk$/.test(file)) return app("Android", `${androidArch(file)}-debug.apk`);
  if (/^polarity-android-mpv-sources\.tar\.xz$/.test(file)) return sources("Android", "mpv.tar.xz");
  if (/\.ipa$/.test(file)) return app("iOS", "arm64-unsigned.ipa");
  if (/^polarity-ios-mpv-sources\.tar\.xz$/.test(file)) return sources("iOS", "mpv.tar.xz");
  return null;
}

/** The Windows player zip in a release, under its old name (up to 0.18.0) or the new one. */
export const PLAYER_ZIP = /(_x64_mpv|-Windows-x64-mpv)\.zip$/;

export const download = (version: string, name: string) => `https://github.com/${REPO}/releases/download/v${version}/${name}`;

type Platforms = Record<string, { signature: string; url: string }>;

/**
 * The updater's entries: `{os}-{arch}` is the default, `{os}-{arch}-{installer}` lets a copy installed
 * one way update the same way. The keys are the ones every release since 0.1.3 has had, so installed
 * copies keep finding their update whatever the files are called; the installers are recognised by
 * their content, not their names (tauri-plugin-updater). `signature` answers for a release name.
 */
export function feedPlatforms(names: string[], version: string, signature: (name: string) => string | undefined): Platforms {
  const entry = (tail: string) => {
    const name = `Polarity-${version}-${tail}`;
    const sig = names.includes(name) ? signature(name)?.trim() : undefined;
    return sig ? { signature: sig, url: download(version, name) } : undefined;
  };
  const nsis = entry("Windows-x64-setup.exe");
  const msi = entry("Windows-x64.msi");
  const mac = entry("macOS-arm64.app.tar.gz");
  const appimage = entry("Linux-x64.AppImage");
  const platforms: Platforms = {};
  const add = (key: string, value: Platforms[string] | undefined) => value && (platforms[key] = value);
  add("windows-x86_64", nsis ?? msi);
  add("windows-x86_64-nsis", nsis);
  add("windows-x86_64-msi", msi);
  add("darwin-aarch64", mac);
  add("darwin-aarch64-app", mac);
  add("linux-x86_64", appimage);
  add("linux-x86_64-appimage", appimage);
  return platforms;
}

/** What each file people download is for, by the end of its name. */
const FOR_PEOPLE: { platform: Platform; tail: string; text: string }[] = [
  { platform: "Windows", tail: "x64-setup.exe", text: "the installer (recommended). It adds Microsoft's WebView2 if it's missing." },
  { platform: "Windows", tail: "x64.msi", text: "the same app as a Windows Installer package, for installing with deployment tools." },
  {
    platform: "macOS",
    tail: "arm64.dmg",
    text: "for Apple silicon. Open it and drag Polarity to Applications. Not notarized yet: the first time, right-click Polarity in Applications and choose **Open**. If macOS says it's damaged, run `xattr -cr /Applications/Polarity.app`.",
  },
  { platform: "Linux", tail: "x64.AppImage", text: "runs on most distributions and updates itself. Playback uses your system's mpv: install `mpv` with your package manager." },
  { platform: "Linux", tail: "x64.deb", text: "for Debian, Ubuntu and their relatives; installs mpv with it." },
  { platform: "Linux", tail: "x64.rpm", text: "for Fedora, openSUSE and their relatives; installs mpv with it." },
  { platform: "Android", tail: "arm64-debug.apk", text: "a debug build for 64-bit phones (preview). Install it with your phone set to allow apps from this source. It doesn't update itself yet." },
  { platform: "Android", tail: "universal-debug.apk", text: "a debug build for phones and the emulator (preview). Install it with your phone set to allow apps from this source. It doesn't update itself yet." },
  {
    platform: "iOS",
    tail: "arm64-unsigned.ipa",
    text: "an unsigned build (preview). It installs only after you sign it yourself, for example with Xcode and your own Apple developer account.",
  },
];

const SOURCES_TEXT: Record<Platform, string> = {
  Windows: "mpv.exe and every library built into it, with the build scripts.",
  macOS: "libmpv and every library bundled with it, with Homebrew's build recipes.",
  Linux: "",
  Android: "libmpv, FFmpeg and the libraries they link, with the build script.",
  iOS: "libmpv, FFmpeg and the libraries they link, with the build script.",
};

/** The release's notes: downloads by platform, then what's new, then the bundled components' sources. */
export function releaseNotes(version: string, names: string[], whatsNew: string): string {
  const link = (name: string) => `[\`${name}\`](${download(version, name)})`;
  const downloads = PLATFORMS.flatMap((platform) => {
    const lines = FOR_PEOPLE.filter((f) => f.platform === platform && names.includes(`Polarity-${version}-${platform}-${f.tail}`)).map(
      (f) => `- ${link(`Polarity-${version}-${platform}-${f.tail}`)}: ${f.text}`,
    );
    return lines.length ? [`**${platform}**`, ...lines, ""] : [];
  });
  const sources = PLATFORMS.flatMap((platform) => {
    const name = names.find((n) => n.startsWith(`Sources-Polarity-${version}-${platform}-`));
    return name ? [`- ${platform}: ${link(name)}, ${SOURCES_TEXT[platform]}`] : [];
  });
  const tool = names.find((n) => n.startsWith("Tools-"));
  const withMpv = PLATFORMS.filter((p) => names.some((n) => n.startsWith(`Sources-Polarity-${version}-${p}-`)));
  return `## Downloads

${downloads.join("\n")}
Already installed? Polarity updates itself and asks you to restart when it's ready.

## What's new

${whatsNew.trim() || "_Add the notes before publishing._"}
${
  sources.length
    ? `
## Source code for bundled components

mpv and FFmpeg are bundled on ${list(withMpv)}. Their licences are installed with the app under \`licenses/mpv\`; the exact sources each build was made from:

${sources.join("\n")}
`
    : ""
}${tool ? `\n${link(tool)} is the Windows player with its licence texts, for building Polarity from source (\`scripts/fetch-mpv.ts\`).\n` : ""}`;
}

function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
