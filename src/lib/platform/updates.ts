import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, Update } from "@tauri-apps/plugin-updater";
import { call } from "./bridge";
import { buildChannel, buildLabel } from "./build";
import { isDesktop } from "./device";

/**
 * Where new versions come from and how they're put in place. Desktop builds
 * update themselves from a signed `latest.json` (lib/updater.ts keeps the state):
 * release builds from the newest GitHub release, dev builds from the "Dev build"
 * pre-release (docs/dev-channel.md). Local builds never check, and app stores
 * update phone and TV builds, so there `canUpdate` is false and only the version is read.
 */
export interface AppUpdates {
  /** False where the store installs updates (Android, iOS, tvOS) and in local builds: no checks, no buttons. */
  canUpdate: boolean;
  version(): Promise<string>;
  /** The newer build, or null when this one is current. */
  check(): Promise<FoundUpdate | null>;
  /** Start the installed build again (after `install`). */
  relaunch(): Promise<void>;
  /**
   * Dev builds only: what the channel's feed (no `build`) or a kept build's own feed offers,
   * installable even when it is older than this build, with the feed's JSON.
   */
  devFeed(build?: number): Promise<{ update: FoundUpdate; feed: Record<string, unknown> }>;
}

export interface FoundUpdate {
  version: string;
  /** How it's named to people: "Polarity 0.18.0", "Dev build 3f9c2a1 (0.18.1-dev.57)". */
  name: string;
  notes: string;
  /** Fetch it; `progress` gets bytes so far and the total (0 when the server doesn't say). */
  download(progress: (got: number, total: number) => void): Promise<void>;
  /** Put the downloaded build in place. On Windows the installer closes the app itself. */
  install(): Promise<void>;
}

/** A dev feed lists its builds newest first (scripts/devChannel.ts); the offered one names its commit. */
export function updateName(version: string, feed: Record<string, unknown> | undefined): string {
  if (buildChannel !== "dev") return `Polarity ${version}`;
  const builds = Array.isArray(feed?.builds) ? (feed.builds as unknown[]) : [];
  const own = builds.find((b): b is { version: string; commit: string } => {
    const x = b as { version?: unknown; commit?: unknown } | null;
    return !!x && x.version === version && typeof x.commit === "string";
  });
  return buildLabel("dev", version, own?.commit ?? "");
}

function wrap(found: Update): FoundUpdate {
  return {
    version: found.version,
    name: updateName(found.version, found.rawJson),
    notes: found.body ?? "",
    async download(progress) {
      let total = 0;
      let got = 0;
      await found.download((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") progress((got += e.data.chunkLength), total);
      });
    },
    install: () => found.install(),
  };
}

export const appUpdates: AppUpdates = {
  canUpdate: isDesktop && buildChannel !== "local",
  version: () => getVersion(),
  async check() {
    const found = await check();
    return found ? wrap(found) : null;
  },
  relaunch: () => relaunch(),
  async devFeed(build) {
    // src-tauri/src/dev_channel.rs; the plugin's Update class takes what it returns.
    const meta = await call<ConstructorParameters<typeof Update>[0]>("dev_build_feed", { build: build ?? null });
    return { update: wrap(new Update(meta)), feed: meta.rawJson };
  },
};
