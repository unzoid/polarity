import type { Profile } from "./backend";
import type { ProfileLock } from "./profileLock";
import { hashPin, needsRehash } from "./pin";
import { hasPin, unlockToChangeLock, unlockToEnter, unlockToManage, type Unlock } from "./profileRules";
import { askPin, grantEnter, grantManage, manageGranted, takeEnterGrant, type Reauth } from "./unlock";

/**
 * The steps that ask before a profile is entered, managed or has its PIN or limit changed: profileRules.ts
 * says what unlocks each, the prompt (unlock.ts `askPin`) asks for it. Each resolves to whether to go on.
 */

export interface GuardContext {
  /** The profile in use; null on "Who's watching?" before one is in. */
  actor: Profile | null;
  profiles: Profile[];
  /** The account's re-check; null without one (then only PINs unlock). */
  reauth: Reauth | null;
  setLock(id: string, patch: Partial<ProfileLock>): Promise<unknown>;
}

const named = (p: Profile) => p.name || "this profile";

/** A PIN typed right that was hashed with fewer rounds is hashed again (best effort, pin.ts `needsRehash`). */
async function rehash(ctx: GuardContext, profileId: string, pin: string) {
  const p = ctx.profiles.find((x) => x.id === profileId);
  if (!p?.lock?.pin || !needsRehash(p.lock.pin)) return;
  await ctx.setLock(p.id, { pin: await hashPin(pin) }).catch(() => {});
}

async function askFor(unlock: Unlock, ctx: GuardContext, words: { title: string; text?: string }, forgot: boolean): Promise<string | "account" | null> {
  if (unlock.by === "none") return "none";
  if (unlock.by === "account") {
    if (!ctx.reauth) return null;
    return (await askPin({ kind: "account", ...words, reauth: ctx.reauth })) === true ? "account" : null;
  }
  const answer = await askPin({ kind: "check", ...words, profiles: unlock.profiles, forgot: (forgot && ctx.reauth) || undefined });
  if (answer === "account") return "account";
  if (answer && typeof answer === "object" && "profile" in answer) {
    void rehash(ctx, answer.profile, answer.pin);
    return answer.profile;
  }
  return null;
}

/**
 * Before entering `target`: its PIN, if it has one. A forgotten PIN, confirmed through the account, is
 * removed. Not asked again right after "Who's watching?" asked it.
 */
export async function guardEnter(target: Profile, ctx: GuardContext): Promise<boolean> {
  if (!hasPin(target) || takeEnterGrant(target.id)) return true;
  const got = await askFor(unlockToEnter(target), ctx, { title: `Enter ${named(target)}'s PIN` }, true);
  if (got === "account") await ctx.setLock(target.id, { pin: null });
  if (!got) return false;
  grantEnter(target.id);
  return true;
}

/** Before managing profiles or opening the account's settings. One unlock lasts a while (unlock.ts). */
export async function guardManage(ctx: GuardContext): Promise<boolean> {
  const unlock = unlockToManage(ctx.actor, ctx.profiles);
  const actor = ctx.actor?.id ?? null;
  if (unlock.by === "none" || manageGranted(actor)) return true;
  const several = unlock.by === "pin" && unlock.profiles.length > 1;
  const got = await askFor(
    unlock,
    ctx,
    unlock.by === "pin"
      ? { title: several ? "Enter a parent's PIN" : `Enter ${named(unlock.profiles[0])}'s PIN`, text: "This profile has a viewing limit." }
      : { title: "Confirm it's your account", text: "This profile has a viewing limit. No other profile has a PIN, so the account's email confirms it's you." },
    false,
  );
  if (!got) return false;
  grantManage(actor);
  return true;
}

/** Before changing or removing `target`'s PIN or limit, or deleting it: its PIN, if it has one (or the account, when it's forgotten). */
export async function guardLockChange(target: Profile, ctx: GuardContext): Promise<boolean> {
  if (!(await guardManage(ctx))) return false;
  const got = await askFor(unlockToChangeLock(target), ctx, { title: `Enter ${named(target)}'s current PIN` }, true);
  return !!got;
}

/** A new PIN for `target`, typed twice, hashed and stored. */
export async function setNewPin(target: Profile, ctx: GuardContext): Promise<boolean> {
  const answer = await askPin({ kind: "new", title: `A PIN for ${named(target)}`, text: "Four digits, asked before this profile opens on any of your devices." });
  if (!answer || typeof answer !== "object" || !("pin" in answer)) return false;
  await ctx.setLock(target.id, { pin: await hashPin(answer.pin) });
  return true;
}
