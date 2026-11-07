import { useSyncExternalStore } from "react";
import { appUpdates, type FoundUpdate } from "./platform/updates";
import { inShell } from "./platform/bridge";
import { buildChannel } from "./platform/build";
import { isRecord, str, storedJson } from "./parse";
import { errorMessage } from "./errors";
import { getPrefs } from "./settings/prefs";
import { compareVersions, parseDevBuilds, type DevBuild } from "./updateFeed";

export { compareVersions, parseDevBuilds, type DevBuild };

/**
 * App updates, from the signed `latest.json` on the newest GitHub release, or in a dev build on
 * the "Dev build" pre-release (docs/dev-channel.md). Local builds never check.
 *
 * Checked a few seconds after launch and then every few hours. With
 * "Download updates automatically" on (the default) a new build downloads in
 * the background and the user only has to restart; otherwise they're told
 * it exists and choose when to download it. Installing never happens on its own.
 */
export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current"; checkedAt: number }
  | { phase: "available"; version: string; name: string; notes: string }
  | { phase: "downloading"; version: string; name: string; notes: string; progress: number | null }
  | { phase: "ready"; version: string; name: string; notes: string }
  | { phase: "installing"; version: string; name: string }
  | { phase: "error"; message: string };

const RELEASES = "https://github.com/unzoid/polarity/releases";
export const releaseUrl = (version?: string) =>
  buildChannel === "dev" ? `${RELEASES}/tag/dev` : version ? `${RELEASES}/tag/v${version}` : RELEASES;

let state: UpdateState = { phase: "idle" };
let update: FoundUpdate | null = null;
/** The toast was closed for this version; the navbar pill stays. */
let dismissed: string | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useUpdate = () => useSyncExternalStore(subscribe, () => state);
export const useUpdateDismissed = () => useSyncExternalStore(subscribe, () => dismissed);
export function dismissUpdate() {
  dismissed = "version" in state ? state.version : null;
  listeners.forEach((l) => l());
}

export async function checkForUpdates({ quiet = false } = {}) {
  if (!inShell || !appUpdates.canUpdate) return;
  // Paused in a dev build's About: only "Check for Updates" asks.
  if (quiet && devUpdatesPaused()) return;
  // Already found one: nothing newer is worth interrupting a download for.
  if (state.phase === "checking" || state.phase === "downloading" || state.phase === "ready" || state.phase === "installing") return;
  if (!quiet) set({ phase: "checking" });
  try {
    const found = await appUpdates.check();
    if (!found) {
      update = null;
      set({ phase: "current", checkedAt: Date.now() });
      return;
    }
    offer(found);
    if (getPrefs().autoDownloadUpdates) void downloadUpdate();
  } catch (e) {
    // Offline, or no release feed yet: a background check stays silent.
    if (!quiet) set({ phase: "error", message: describe(e) });
  }
}

function offer(found: FoundUpdate) {
  update = found;
  set({ phase: "available", version: found.version, name: found.name, notes: found.notes });
}

export async function downloadUpdate() {
  if (!update || state.phase !== "available") return;
  const { version, name, notes } = state;
  set({ phase: "downloading", version, name, notes, progress: null });
  try {
    await update.download((got, total) => {
      if (total) set({ phase: "downloading", version, name, notes, progress: Math.min(1, got / total) });
    });
    set({ phase: "ready", version, name, notes });
  } catch (e) {
    set({ phase: "error", message: describe(e) });
  }
}

/** Installs the downloaded build and starts it again. On Windows the installer closes the app itself. */
export async function installUpdate() {
  if (!update || state.phase !== "ready") return;
  const { version, name, notes } = state;
  rememberNotes(version, notes);
  set({ phase: "installing", version, name });
  try {
    await update.install();
    await appUpdates.relaunch();
  } catch (e) {
    set({ phase: "error", message: describe(e) });
  }
}

function describe(e: unknown) {
  const s = errorMessage(e);
  if (/network|dns|connect|timed out|offline/i.test(s)) return "Couldn't reach the update server. Check your connection.";
  return s;
}

// --- Dev builds: pausing updates, going back --------------------------------------------------

const PAUSED = "polar.devUpdatesPaused";

/** Only in dev builds: no background checks while paused (after going back to an older build, say). */
export function devUpdatesPaused() {
  if (buildChannel !== "dev") return false;
  try {
    return localStorage.getItem(PAUSED) === "1";
  } catch {
    return false;
  }
}

export function setDevUpdatesPaused(paused: boolean) {
  try {
    if (paused) localStorage.setItem(PAUSED, "1");
    else localStorage.removeItem(PAUSED);
  } catch {}
  listeners.forEach((l) => l());
}
export const useDevUpdatesPaused = () => useSyncExternalStore(subscribe, devUpdatesPaused);

/** The kept dev builds (Settings → About in a dev build). */
export async function devBuilds(): Promise<DevBuild[]> {
  if (buildChannel !== "dev" || !inShell || !appUpdates.canUpdate) return [];
  const { feed } = await appUpdates.devFeed();
  return parseDevBuilds(feed);
}

/**
 * Downloads a kept dev build, older ones included, through the usual flow: it is offered, then
 * downloads, then waits for "Restart to Update". The next check offers the newest build again.
 */
export async function installDevBuild(build: number) {
  if (buildChannel !== "dev" || state.phase === "downloading" || state.phase === "installing") return;
  try {
    const { update: found } = await appUpdates.devFeed(build);
    offer(found);
    await downloadUpdate();
  } catch (e) {
    set({ phase: "error", message: describe(e) });
  }
}

let started = false;
/** Called once from the app root. */
export function startUpdateChecks() {
  if (started || !inShell || !appUpdates.canUpdate) return;
  started = true;
  window.setTimeout(() => void checkForUpdates({ quiet: true }), 5_000);
  window.setInterval(() => void checkForUpdates({ quiet: true }), 6 * 60 * 60 * 1000);
}

// --- What's new ----------------------------------------------------------------

const LAST_VERSION = "polar.lastVersion";
const PENDING_NOTES = "polar.updateNotes";

function rememberNotes(version: string, notes: string) {
  try {
    localStorage.setItem(PENDING_NOTES, JSON.stringify({ version, notes }));
  } catch {}
}

export type WhatsNew = { version: string; previous: string; notes: string };

/**
 * After an update (from the app or a fresh installer over an old build), the
 * notes for the version now running, once. A first install shows nothing:
 * there's nothing "new" to someone who has never seen the app.
 */
export async function takeWhatsNew(): Promise<WhatsNew | null> {
  if (!inShell) return null;
  const version = await appUpdates.version();
  const previous = localStorage.getItem(LAST_VERSION);
  localStorage.setItem(LAST_VERSION, version);
  if (!previous || compareVersions(version, previous) <= 0) return null;

  let notes = "";
  const saved = storedJson(localStorage, PENDING_NOTES);
  if (isRecord(saved) && saved.version === version) notes = str(saved.notes) ?? "";
  localStorage.removeItem(PENDING_NOTES);
  // Installed by hand: ask GitHub for the release's notes (dev builds have no release of their own).
  if (!notes && buildChannel === "release") {
    try {
      const res = await fetch(`https://api.github.com/repos/unzoid/polarity/releases/tags/v${version}`);
      if (res.ok) {
        const release: unknown = await res.json();
        notes = releaseNotesSection((isRecord(release) && str(release.body)) || "");
      }
    } catch {}
  }
  return { version, previous, notes };
}

/** A release body has install instructions on top; keep the "What's new" part if it's marked. */
function releaseNotesSection(body: string) {
  const m = body.match(/#+\s*What's new\s*\n([\s\S]*?)(?=\n#+\s|\n\s*mpv is still bundled|$)/i);
  return (m ? m[1] : body).trim();
}

export const appVersion = () => (inShell ? appUpdates.version() : Promise.resolve("dev"));
