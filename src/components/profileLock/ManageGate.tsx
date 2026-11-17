import { useState, type ReactNode } from "react";
import { useAccount } from "../../lib/account";
import { guardManage } from "../../lib/account/profileGuard";
import { unlockToManage } from "../../lib/account/profileRules";
import { manageGranted } from "../../lib/account/unlock";
import { ActionRow, Card } from "../settings/rows";

/**
 * Settings → Account from a restricted profile (lib/account/profileRules.ts): locked until a PIN of a profile
 * without a limit, or the account itself, is given. Everything on the page (and what's added to it later) is
 * behind it.
 */
export function ManageGate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const [, opened] = useState(0);
  const actor = account.profile ?? null;
  const unlock = unlockToManage(actor, account.profiles ?? []);
  if (unlock.by === "none" || manageGranted(actor?.id ?? null)) return children;
  return (
    <Card footer="Profiles, the email, sign-ins and the account itself are managed from a profile without a viewing limit.">
      <ActionRow
        title="This profile has a viewing limit"
        caption={unlock.by === "pin" ? "Enter a parent's PIN to manage the account." : "Confirm it's your account with a code sent to its email."}
        label="Unlock"
        variant="primary"
        onClick={() => void guardManage(account.guardContext()).then((ok) => ok && opened((n) => n + 1))}
      />
    </Card>
  );
}
