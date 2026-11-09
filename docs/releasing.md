# Releasing

How a release is made, what its files are called and what its notes say. Dev builds of the `dev` branch
are a channel of their own (docs/dev-channel.md).

## Making a release

1. Set the version in `Cargo.toml`, `package.json` and `src-tauri/tauri.conf.json`, and commit.
2. `git tag -a v0.19.0 -m "- What's new"` on that commit and push the tag. The tag message is the
   "What's new" list: Markdown bullets, shown in the release notes and in the app's update prompt.
3. The Release workflow (`.github/workflows/release.yml`) builds Windows, macOS, Linux, the Android
   debug APK and the unsigned iOS IPA, then drafts the release (`scripts/release-publish.ts`).
4. Check the draft's files and notes on GitHub, then press **Publish**. Installed copies only see the
   update once it is published.

The draft needs every desktop build. If the Android or iOS build fails, the draft is made without it
and the workflow says so; attach the file by hand under its release name below, or leave that
platform out of this release.

Secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the updater key),
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the account backend).

**Test release.** On a fork with its own updater key and secrets, push a tag: the draft is made in the
fork (the workflow drafts in the repository it runs in). Delete the draft and the tag afterwards.
Actions → Release → Run workflow builds everything without drafting; the files come back as workflow
artifacts under the build's own names.

## File names

GitHub lists a release's files alphabetically and can't group or reorder them, so the names group them
(`scripts/releaseAssets.ts`):

| File | What it is |
|---|---|
| `Polarity-<version>-Windows-x64-setup.exe` | Windows installer (recommended) |
| `Polarity-<version>-Windows-x64.msi` | Windows Installer package |
| `Polarity-<version>-macOS-arm64.dmg` | macOS, Apple silicon |
| `Polarity-<version>-macOS-arm64.app.tar.gz` | The macOS app as the updater downloads it |
| `Polarity-<version>-Linux-x64.AppImage` | Linux, any distribution; updates itself |
| `Polarity-<version>-Linux-x64.deb` | Debian, Ubuntu |
| `Polarity-<version>-Linux-x64.rpm` | Fedora, openSUSE |
| `Polarity-<version>-Android-arm64-debug.apk` | Android debug build for 64-bit phones |
| `Polarity-<version>-iOS-arm64-unsigned.ipa` | iOS, unsigned |
| `Sources-Polarity-<version>-Windows-x64-mpv.tar` | Exact sources of the bundled `mpv.exe` (docs/licensing.md) |
| `Sources-Polarity-<version>-macOS-arm64-mpv.tar` | Exact sources of the bundled libmpv, with Homebrew's recipes |
| `Sources-Polarity-<version>-Android-mpv.tar.xz` | Exact sources of the APK's libmpv and FFmpeg |
| `Sources-Polarity-<version>-iOS-mpv.tar.xz` | Exact sources of the IPA's libmpv and FFmpeg |
| `Tools-Polarity-<version>-Windows-x64-mpv.zip` | The Windows player with its licence texts, for building from source (`scripts/fetch-mpv.ts`) |
| `latest.json` | The updater's feed |

Each platform's apps sort together, then the sources, then the tools. Releases up to 0.18.0 used
Tauri's own names (`Polarity_0.18.0_x64-setup.exe`, `Polarity_0.18.0_aarch64.dmg`, …).

Updater signatures (`.sig`) are not attached: `latest.json` carries each one itself.

## Release notes

`scripts/release-publish.ts` writes them, in this order:

1. **Downloads**: per platform (Windows, macOS, Linux, Android, iOS), one line per file people
   install, linked, with what it's for.
2. **What's new**: the tag message.
3. **Source code for bundled components**: the `Sources-` archives, one line per platform, and the
   `Tools-` zip.

## Updates

Installed copies read `https://github.com/unzoid/polarity/releases/latest/download/latest.json`
(`src-tauri/tauri.conf.json`). The feed keeps the entries every release has had
(`windows-x86_64`, `windows-x86_64-nsis`, `windows-x86_64-msi`, `darwin-aarch64`, `darwin-aarch64-app`,
`linux-x86_64`, `linux-x86_64-appimage`), with each file's new URL and signature. The updater recognises
the Windows installer by its content, not its name, and runs it quietly as before, so 0.18.0 updates to
a release with the new names.

To check that before a real release: installed 0.18.0 copies read only this repository's feed, so on a
fork, build v0.18.0 from its tag with the fork's feed and updater key
(`bunx tauri build -c '{"plugins":{"updater":{"endpoints":["https://github.com/<fork>/releases/latest/download/latest.json"],"pubkey":"<fork's public key>"}}}'`),
install it (Windows setup `.exe` and `.msi`, macOS, Linux AppImage), then publish the fork's test release
of the next version. Settings → About → **Check for Updates** offers it; **Download**, then **Restart to Update** installs it and restarts into it.
