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

export const buildChannel: BuildChannel = channelOf(import.meta.env.VITE_POLAR_CHANNEL);
/** The short hash of the commit this build is made from. */
export const buildCommit: string = typeof __GIT_COMMIT__ === "string" ? __GIT_COMMIT__ : "unknown";

/** How Settings → About and the update prompt name a build: "Dev build 3f9c2a1 (0.18.1-dev.57)", "Local build 3f9c2a1". */
export function buildLabel(channel: BuildChannel, version: string, commit = buildCommit): string {
  if (channel === "dev") return commit ? `Dev build ${commit} (${version})` : `Dev build ${version}`;
  if (channel === "local") return `Local build ${commit}`;
  return version;
}
