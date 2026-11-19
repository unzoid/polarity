/**
 * Keeps a profile's preferences the same on every device: player and subtitle settings, interface
 * options, keyboard shortcuts. One small JSON document per profile (settingsDoc.ts), holding only
 * what the profile changed from the defaults; two devices' edits merge per key against the copy
 * they last agreed on (critique H3).
 *
 * API keys and add-on links travel too (#89): as they are, readable by the server under row-level
 * security, or sealed with a passphrase set in Settings → Account. What stays on the device: the
 * metadata source, volume, TV mode and its sounds, controller alerts.
 *
 * Settings are global in the Rust store, so entering a profile first puts
 * back the copy this device last synced for it (`restore`), then `syncSettings`
 * catches up with the server. The device's own settings (guest, signed out)
 * are kept aside while a profile has the store, and put back at sign-out.
 */
import { useSyncExternalStore } from "react";
import { storeLocal } from "../errors";
import { api } from "../api";
import { queryClient } from "../net/queries";
import { applyBindingOverrides, bindingOverrides, DEFAULT_BINDINGS } from "../settings/keybinds";
import { isRecord, likeTemplate, storedJson, strings } from "../parse";
import { getPrefs, PREF_DEFAULTS, readPrefs, setPrefs, SYNCED_PREFS } from "../settings/prefs";
import type { Settings } from "../types";
import { AccountError, type AccountBackend } from "./backend";
import { keys } from "../net/queryKeys";
import {
  changedFrom,
  firstDoc,
  fromWire,
  openedDoc,
  mergeDocs,
  sameDoc,
  sealing,
  SECRET_KEYS,
  stable,
  synced,
  toWire,
  withDefaults,
  withUnknown,
  type Doc,
  type Lock,
} from "./settingsDoc";
import type { Secrets } from "./secrets";
import { forgetNotices, noteFirstPlainSync, secretsExposed } from "./secretsNotice";
import { forgetPrivate, privateOf, ready, setPrivate } from "./localSecrets";

/**
 * This device's copy of a profile's settings, as last agreed with the server. Its secrets, missing
 * links and the passphrase are kept apart, in the keychain where there is one (localSecrets.ts, #195).
 */
interface Saved {
  /** The document as last agreed with the server (secrets in plain text: this device's own). */
  doc: Doc;
  /** Its `updatedAt` there. */
  at: number;
  /** Addon URLs from sealed secrets that couldn't be installed here (yet). */
  missing: string[];
}

const storageKey = (space: string) => `polar.settingsSync.${space}`;

/** This profile's passphrase on this device. */
const readLock = (space: string): Lock => privateOf(space).lock;
function writeLock(space: string, lock: Lock) {
  setPrivate(space, { ...privateOf(space), lock: lock.passphrase ? lock : {} });
}

/** Settings → Account: a new passphrase for this account's keys and add-on links; the next round seals them with it. */
export function setSecretsPassphrase(space: string, value: string) {
  const was = readLock(space);
  writeLock(space, { passphrase: value, previous: was.passphrase ?? was.previous, pending: "set" });
}
/** Settings → Account: the passphrase the account's keys are already sealed with, typed on this device. */
export function unlockSecrets(space: string, value: string) {
  writeLock(space, { passphrase: value });
}
/** Settings → Account, confirmed: the next round sends the keys back as they are, for every device. */
export function removeSecretsPassphrase(space: string) {
  const was = readLock(space);
  writeLock(space, { ...was, pending: "remove" });
}

/**
 * How this account's keys and add-on links travel, as Settings → Account says it: as they are,
 * sealed with this device's passphrase, or sealed with one this device doesn't have (`locked`).
 */
export function secretsState(space: string): "plain" | "sealed" | "locked" {
  if (locked.has(space)) return "locked";
  const lock = readLock(space);
  return lock.passphrase && lock.pending !== "remove" ? "sealed" : "plain";
}

/** Profiles whose account holds sealed keys this device couldn't open: Settings → Account asks for the passphrase. */
const locked = new Set<string>();
const lockedListeners = new Set<() => void>();
function setLocked(space: string, yes: boolean) {
  if (locked.has(space) === yes) return;
  if (yes) locked.add(space);
  else locked.delete(space);
  for (const l of lockedListeners) l();
}

/**
 * Whether `space`'s account keys and add-on links are sealed with a passphrase this device doesn't
 * have, kept current as sync rounds open them (#470): the add-ons from the account can't be used here until then.
 */
export function useSecretsLocked(space: string | null | undefined): boolean {
  return useSyncExternalStore(onSecretsLockedChange, () => !!space && locked.has(space));
}

/** Calls `changed` whenever a profile's keys become locked or open; returns how to stop. */
export function onSecretsLockedChange(changed: () => void): () => void {
  lockedListeners.add(changed);
  return () => void lockedListeners.delete(changed);
}

/**
 * The document the server refused as too large (critique M7), as sent: not tried again until it
 * changes, and Settings → Account says so meanwhile.
 */
let refused: string | null = null;

/**
 * The server has no settings table (its `profile_settings` migration hasn't run, #16): library,
 * progress and playlists still sync, settings and add-ons stay on this device. Logged once, and
 * Settings → Account says so until a round reaches the table.
 */
let notSetUp = false;
const problemListeners = new Set<() => void>();

/** Why settings don't reach the account, for Settings → Account; null while they sync. */
export function settingsSyncProblem(): "not_set_up" | "too_large" | null {
  return notSetUp ? "not_set_up" : refused !== null ? "too_large" : null;
}

/** `settingsSyncProblem`, kept current as sync rounds find it. */
export function useSettingsSyncProblem() {
  return useSyncExternalStore((changed) => {
    problemListeners.add(changed);
    return () => void problemListeners.delete(changed);
  }, settingsSyncProblem);
}

function setProblem(next: { notSetUp?: boolean; refused?: string | null }) {
  const before = settingsSyncProblem();
  if (next.notSetUp !== undefined) notSetUp = next.notSetUp;
  if (next.refused !== undefined) refused = next.refused;
  if (settingsSyncProblem() !== before) for (const l of problemListeners) l();
}

function load(space: string): Saved | null {
  const v = storedJson(localStorage, storageKey(space));
  if (!isRecord(v) || !isRecord(v.doc)) return null;
  const doc = readDoc(v.doc);
  const own = privateOf(space);
  if (own.secrets) doc.secrets = own.secrets;
  if (typeof v.doc.unopened === "string") doc.unopened = v.doc.unopened;
  return { doc, at: typeof v.at === "number" ? v.at : 0, missing: own.missing };
}

/**
 * A document from the server or this device's copy, another version's included, as far as it
 * fits (critique M9). Settings are checked against this device's own when applied; shortcuts stay
 * portable ("Mod") as they travel; keys this version doesn't know are kept, to pass on.
 */
function readDoc(v: Record<string, unknown>): Doc {
  const prefs = isRecord(v.prefs) ? v.prefs : {};
  const keybinds = isRecord(v.keybinds) ? v.keybinds : {};
  return {
    settings: isRecord(v.settings) ? v.settings : {},
    keybinds: Object.fromEntries(Object.entries(keybinds).flatMap(([a, c]) => (Array.isArray(c) ? [[a, strings(c)]] : []))),
    prefs: { ...Object.fromEntries(Object.entries(prefs).filter(([k]) => !knows.prefs(k))), ...readPrefs(prefs) },
  };
}

/** The keys this version syncs; others in a document are another version's, passed on as they came. */
const knows = {
  settings: (k: string) => !!defaultsNow && k in defaultsNow,
  keybinds: (k: string) => k in DEFAULT_BINDINGS,
  prefs: (k: string) => (SYNCED_PREFS as readonly string[]).includes(k),
};
function save(space: string, { doc: { secrets, ...doc }, at, missing }: Saved) {
  setPrivate(space, { ...privateOf(space), secrets, missing });
  storeLocal(storageKey(space), JSON.stringify({ doc, at }));
}
export const forgetSettings = (space: string) => {
  localStorage.removeItem(storageKey(space));
  localStorage.removeItem(`polar.secretsPassphrase.${space}`);
  forgetPrivate(space);
  forgetNotices(space);
};

/** True while a synced doc is being written locally, so it isn't pushed straight back. */
export let applying = false;

let defaults: Promise<Record<string, unknown>> | null = null;
let defaultsNow: Record<string, unknown> | null = null;
/** The store's defaults, asked once (they only change with the app). */
const settingsDefaults = () => (defaults ??= api.settingsDefaults().then((d) => (defaultsNow = d as unknown as Record<string, unknown>)));

/** This device's settings as a document, its keys and add-on links in plain text. */
async function current(saved: Saved | null, missing = saved?.missing ?? []): Promise<Doc> {
  const [settings, base] = await Promise.all([api.settings(), settingsDefaults()]);
  const prefs = getPrefs();
  const doc: Doc = withUnknown(
    {
      settings: changedFrom(settings as unknown as Record<string, unknown>, base, synced),
      keybinds: bindingOverrides() as Record<string, string[]>,
      prefs: changedFrom(
        Object.fromEntries(SYNCED_PREFS.map((k) => [k, prefs[k]])),
        PREF_DEFAULTS as unknown as Record<string, unknown>,
      ),
    },
    saved?.doc,
    knows,
  );
  doc.secrets = await ownSecrets(settings, missing);
  if (saved?.doc.unopened) doc.unopened = saved.doc.unopened;
  return doc;
}

/** This device's keys and add-on links (with those that didn't install yet). */
async function ownSecrets(settings: Settings, missing: string[]): Promise<Secrets> {
  const own = settings as unknown as Record<string, unknown>;
  const addons = await api.addons();
  return {
    keys: Object.fromEntries(SECRET_KEYS.flatMap((k) => (typeof own[k] === "string" && own[k] ? [[k, own[k] as string]] : []))),
    addons: [...new Set([...addons.map((a) => a.manifestUrl), ...missing])].sort(),
  };
}

/** Write `doc` over this device's settings. Returns addon URLs that didn't install. */
async function apply(doc: Doc): Promise<string[]> {
  applying = true;
  try {
    queryClient.setQueryData(["settings"], await saveSynced(doc.settings, doc.secrets));
    applyBindingOverrides(doc.keybinds);
    setPrefs(withDefaults(doc.prefs, Object.fromEntries(SYNCED_PREFS.map((k) => [k, PREF_DEFAULTS[k]]))), { quiet: true });
    return doc.secrets ? await applyAddons(doc.secrets.addons) : [];
  } finally {
    applying = false;
  }
}

/** Installs and removes add-ons until this device has exactly `urls`. Returns those that didn't install. */
async function applyAddons(urls: string[]): Promise<string[]> {
  const wanted = new Set(urls);
  const installed = await api.addons();
  for (const a of installed) if (!wanted.has(a.manifestUrl)) await api.removeAddon(a.manifest.id);
  const have = new Set(installed.map((a) => a.manifestUrl));
  const missing: string[] = [];
  for (const url of wanted) {
    if (have.has(url)) continue;
    await api.installAddon(url).catch(() => missing.push(url));
  }
  queryClient.invalidateQueries({ queryKey: keys.addons });
  queryClient.invalidateQueries({ queryKey: keys.streamsAll });
  return missing;
}

/**
 * Synced settings over this device's: every synced key at its default unless the document changed
 * it, each of the kind it has here; keys and the metadata source stay unless sealed secrets came.
 * When the store still refuses them (a value another version allows), they go in one at a time and
 * the ones it refuses are left out, so a bad value can't stop the rest on every run.
 */
async function saveSynced(changed: Record<string, unknown>, secrets: Secrets | undefined): Promise<Settings> {
  const [local, base] = await Promise.all([api.settings(), settingsDefaults()]);
  const all = withDefaults(changed, base, synced);
  if (secrets) for (const k of SECRET_KEYS) all[k] = secrets.keys[k] ?? null;
  const wanted = Object.entries(likeTemplate(local, all));
  try {
    return await api.saveSettings({ ...local, ...Object.fromEntries(wanted) });
  } catch {
    let saved = local;
    for (const [k, v] of wanted) saved = await api.saveSettings({ ...saved, [k]: v }).catch(() => saved);
    return saved;
  }
}

/** Restores still running, by profile: a sync round waits for its profile's (critique H3). */
const restoring = new Map<string, Promise<void>>();

/**
 * Entering a profile: put back what this device last synced for it. `before` is whose settings the
 * store held until now (`keepDeviceSettings`): when it was this profile's (the app started again),
 * the store is newer than the synced copy, holding changes no round has sent yet (the app was
 * closed or offline within moments of them, as phones end apps), so it stays and the next round
 * sends them.
 */
export function restoreSettings(space: string, before: string | null = null): Promise<void> {
  const run = (async () => {
    await ready(space);
    const saved = load(space);
    if (!saved) return;
    setLocked(space, !!saved.doc.unopened);
    if (before === space) return;
    const missing = await apply(saved.doc);
    save(space, { ...saved, missing });
  })().finally(() => {
    if (restoring.get(space) === run) restoring.delete(space);
  });
  restoring.set(space, run);
  return run;
}

/**
 * Whose settings the global store holds: a profile id, or DEVICE (guest, signed out). Unset after
 * an update while signed in, when nobody knows; then there's no device copy to keep or put back.
 */
const OWNER_KEY = "polar.settingsOwner";
const DEVICE = "local";

/** Signed out or a guest: what's in the store now is the device's own. */
export function markDeviceSettings() {
  if (localStorage.getItem(OWNER_KEY) === null) storeLocal(OWNER_KEY, DEVICE);
}

/**
 * Entering a profile: when the store still holds the device's own settings, keep a copy to put
 * back at sign-out (critique M12), then hand the store to the profile. The copy holds the keys and
 * add-ons in plain text, so signing out gives the device back exactly what it had.
 */
export async function keepDeviceSettings(space: string): Promise<string | null> {
  await Promise.all([ready(DEVICE), ready(space)]);
  const before = localStorage.getItem(OWNER_KEY);
  if (before === DEVICE) {
    const missing = load(DEVICE)?.missing ?? [];
    save(DEVICE, { doc: await current(null, missing), at: 0, missing });
  }
  storeLocal(OWNER_KEY, space);
  return before;
}

/** Signed out: the device's settings back as they were before a profile was entered. */
export async function restoreDeviceSettings() {
  if (localStorage.getItem(OWNER_KEY) !== DEVICE) await restoreSettings(DEVICE);
  storeLocal(OWNER_KEY, DEVICE);
}

/**
 * Entering a profile this device has never synced (#80, #429), as Settings → Account → Share add-ons and
 * keys says. "device": it keeps whatever the store holds. "account": it keeps the store when the store
 * was another profile's of the same account (`siblings`, the account's profiles; `before`, whose the
 * store was), else starts with the set this device last synced for one of those profiles, if any.
 * Otherwise, and with "none": none of the ones in the store (the guest's, or another account's), only
 * the add-ons the app installs itself; its first round then takes the account's own, and nothing of
 * anyone else's goes up to its account. Settings offers to copy a set from this device (`setupSources`,
 * `copySetup`). Returns whether it changed anything.
 */
export async function startProfile(space: string, before: string | null = null, siblings: string[] = []): Promise<boolean> {
  await ready(space);
  const share = getPrefs().shareSetup;
  if (load(space) || share === "device") return false;
  const mine = siblings.filter((id) => id !== space && id !== DEVICE);
  if (share === "account" && before !== null && mine.includes(before)) return false;
  const cleared = await clearSetup();
  if (share !== "account") return cleared;
  await setupSourcesReady(space, mine);
  const from = setupSources(space, mine).find((s) => s.id !== DEVICE);
  if (!from) return cleared;
  await copySetup(from.id);
  return true;
}

/** The store's add-ons and keys gone, but for the add-ons the app installs itself. Whether there was anything to clear. */
async function clearSetup(): Promise<boolean> {
  const [settings, installed, bundled] = await Promise.all([api.settings(), api.addons(), api.bundledAddons().catch(() => [] as string[])]);
  const own = settings as unknown as Record<string, unknown>;
  const keyed = SECRET_KEYS.some((k) => own[k]);
  const others = installed.filter((a) => !bundled.includes(a.manifestUrl));
  if (!keyed && !others.length) return false;
  applying = true;
  try {
    if (keyed) queryClient.setQueryData(["settings"], await api.saveSettings({ ...settings, ...Object.fromEntries(SECRET_KEYS.map((k) => [k, null])) }));
    if (others.length) await applyAddons(installed.filter((a) => bundled.includes(a.manifestUrl)).map((a) => a.manifestUrl));
  } finally {
    applying = false;
  }
  return true;
}

/** A set of add-ons and keys on this device that a profile could start from. */
export interface SetupSource {
  /** DEVICE ("local") for the guest's, else a profile id. */
  id: string;
  keys: number;
  addons: number;
}

/**
 * Where `space` could copy add-ons and keys from (#80): the guest's set kept on this device, and the
 * sets of `others` (the account's other profiles) as this device last synced them. Only sets with
 * something in them.
 */
export function setupSources(space: string, others: string[]): SetupSource[] {
  return [DEVICE, ...others.filter((id) => id !== space && id !== DEVICE)].flatMap((id) => {
    const secrets = load(id)?.doc.secrets;
    const keys = secrets ? Object.values(secrets.keys).filter(Boolean).length : 0;
    const addons = secrets?.addons.length ?? 0;
    return keys || addons ? [{ id, keys, addons }] : [];
  });
}

/** Reads the sets `setupSources` counts from the keychain; once per run each. */
export async function setupSourcesReady(space: string, others: string[]): Promise<true> {
  await Promise.all([DEVICE, ...others.filter((id) => id !== space)].map(ready));
  return true;
}

/** Settings → Account's offer, taken: `from`'s keys and add-ons added to what this profile has. They sync as any change does. */
export async function copySetup(from: string): Promise<string[]> {
  await ready(from);
  const secrets = load(from)?.doc.secrets;
  if (!secrets) return [];
  const settings = await api.settings();
  const own = settings as unknown as Record<string, unknown>;
  const fill = Object.fromEntries(SECRET_KEYS.flatMap((k) => (!own[k] && secrets.keys[k] ? [[k, secrets.keys[k]]] : [])));
  if (Object.keys(fill).length) queryClient.setQueryData(["settings"], await api.saveSettings({ ...settings, ...fill }));
  const installed = (await api.addons()).map((a) => a.manifestUrl);
  return applyAddons([...new Set([...installed, ...secrets.addons])]);
}

/**
 * One round with the server. Safe to call often: a single small read, and a write only when one
 * side changed. Edits on both sides since the last agreed copy merge per key; the first round of a
 * profile on this device takes the server's document but no add-on away; when the server kept a
 * newer document than the one sent, the round merges with that one instead (critique H2, H3).
 */
export async function syncSettings(space: string, backend: AccountBackend, isActive: () => boolean) {
  await restoring.get(space)?.catch(() => {});
  await ready(space);
  for (let tries = 0; tries < 3; tries++) {
    let remote;
    try {
      remote = await backend.settings.get(space);
    } catch (e) {
      // Server hasn't been migrated for settings yet: everything else still syncs.
      if (e instanceof AccountError && e.code === "not_set_up") {
        if (!notSetUp) console.warn("sync: the server has no profile_settings table; settings and add-ons stay on this device");
        setProblem({ notSetUp: true });
        return;
      }
      throw e;
    }
    setProblem({ notSetUp: false });
    if (!isActive()) return;
    const saved = load(space);
    // The store below is the active profile's. After each wait, a profile that was left or signed
    // out meanwhile must not be read from it, written to it, uploaded or saved (plan 002).
    const local = await current(saved);
    if (!isActive()) return;
    let lock = readLock(space);
    const theirs = remote && (await fromWire(remote.data, [lock.passphrase, lock.previous].filter((p) => !!p) as string[], readDoc));
    if (!isActive()) return;
    const { seal, forget } = sealing(lock, remote?.data ?? null);
    if (forget) writeLock(space, (lock = {}));

    let next: Doc;
    if (!remote || !theirs) next = local;
    else if (!saved) next = firstDoc(local, theirs);
    else if (saved.doc.unopened && !theirs.unopened) next = openedDoc(saved.doc, local, theirs);
    else if (remote.updatedAt > saved.at) next = mergeDocs(saved.doc, local, theirs);
    else if (!sameDoc(local, saved.doc) || lock.pending) next = local;
    else return;

    // This device's keys are about to reach the account readable (#195): said once.
    if (!saved && !seal && !next.unopened && secretsExposed(local.secrets)) noteFirstPlainSync(space);
    let missing = saved?.missing ?? [];
    if (theirs && !sameDoc(next, local)) missing = await apply(next);
    if (!isActive()) return;
    setLocked(space, !!next.unopened);
    // Written: a passphrase set here is in force, one removed here is gone.
    const settled = () => lock.pending && writeLock(space, lock.pending === "set" ? { passphrase: lock.passphrase } : {});
    const sealedThere = typeof remote?.data.sealed === "string";
    const sealsNow = !!next.unopened || (!!next.secrets && !!seal);
    if (remote && theirs && sameDoc(next, theirs) && next.unopened === theirs.unopened && sealedThere === sealsNow && !lock.pending) {
      save(space, { doc: next, at: remote.updatedAt, missing });
      settled();
      return;
    }

    const data = await toWire(next, seal);
    if (!isActive()) return;
    const sent = stable(data);
    if (sent === refused) return;
    // Later than anything stored, even a time another device's clock put ahead.
    const updatedAt = Math.max(Date.now(), (remote?.updatedAt ?? 0) + 1);
    let stored;
    try {
      stored = await backend.settings.put(space, { data, updatedAt });
    } catch (e) {
      if (!(e instanceof AccountError && e.code === "settings_too_large")) throw e;
      setProblem({ refused: sent });
      return;
    }
    if (!isActive()) return;
    setProblem({ refused: null });
    if (stored !== null) {
      save(space, { doc: next, at: stored, missing });
      settled();
      return;
    }
    // The server kept a newer document: merge with that one.
  }
}
