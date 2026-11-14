import { useAccount, type Profile } from "../../lib/account";
import { guardEnter, guardManage } from "../../lib/account/profileGuard";
import { hasPin, unlockToManage } from "../../lib/account/profileRules";

/**
 * The asks a screen makes before it goes on (lib/account/profileGuard.ts), for the profile screens and menus:
 * `enter` before a profile is gone into, `manage` before profiles are edited, added or deleted. Each resolves
 * to whether to go on; nothing is asked when nothing needs it.
 */
export function useGuard() {
  const account = useAccount();
  return {
    enter: (p: Profile) => (hasPin(p) ? guardEnter(p, account.guardContext()) : Promise.resolve(true)),
    manage: () =>
      unlockToManage(account.profile ?? null, account.profiles ?? []).by === "none" ? Promise.resolve(true) : guardManage(account.guardContext()),
  };
}
