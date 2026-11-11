/**
 * Which channel this build belongs to, set by the workflow that made it (`VITE_POLAR_CHANNEL`):
 * - `release`: release.yml; updates from the newest release's `latest.json`.
 * - `dev`: dev-build.yml; updates from the "Dev build" pre-release only, can go back to a kept
 *   build, and has no database built in (docs/dev-channel.md).
 * - `local`: anything else (`bun tauri dev`, a build made by hand); never checks for updates.
 */
export type BuildChannel = "release" | "dev" | "local";

export function channelOf(value: unknown): BuildChannel {
  return value === "release" || value === "dev" ? value : "local";
}

const channel = import.meta.env.VITE_POLAR_CHANNEL;
/**
 * `channelOf`'s rule, written out rather than called so the bundler sees a constant: in a release build every
 * `buildChannel === "dev"` branch, and what only it uses (the dev database, its Settings card), is
 * left out of the bundle. scripts/releaseBundle.ts checks that it is.
 */
export const buildChannel: BuildChannel = channel === "release" || channel === "dev" ? channel : "local";
/** A dev build is an app of its own next to the released one (scripts/devChannel.ts, `devConf`): its name and link scheme. */
export const appName = buildChannel === "dev" ? "Polarity Dev" : "Polarity";
export const linkScheme = buildChannel === "dev" ? "polarity-dev" : "polarity";
/** The short hash of the commit this build is made from. */
export const buildCommit: string = typeof __GIT_COMMIT__ === "string" ? __GIT_COMMIT__ : "unknown";

/** How Settings → About and the update prompt name a build: "Dev build 3f9c2a1 (0.18.1-dev.57)", "Local build 3f9c2a1". */
export function buildLabel(channel: BuildChannel, version: string, commit = buildCommit): string {
  if (channel === "dev") return commit ? `Dev build ${commit} (${version})` : `Dev build ${version}`;
  if (channel === "local") return `Local build ${commit}`;
  return version;
}
