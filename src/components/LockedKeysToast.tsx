import { useEffect, useState } from "react";
import { useAccount, useSecretsLocked } from "../lib/account";
import { usePartySurface } from "../lib/party";
import { usePresence } from "../lib/ui";
import { Close } from "./icons";
import { showWhereStored } from "./settings/secretsNote";
import { SAVE_FAILURE_MS, TOAST_OUT_MS } from "./StoreProblemToast";
import { Button, IconButton } from "./ui/Button";
import { Toast } from "./ui/Toast";

/** Profiles whose notice was dismissed this run: it doesn't come back until the app starts again. */
const dismissed = new Set<string>();

/**
 * While the profile's account keys and add-on links are sealed with a passphrase this device doesn't
 * have (signing in on a new device, #470): its add-ons and keys can't be used here until they're
 * unlocked. Unlock opens Settings → Account at the passphrase. Goes as soon as they open; dismissed,
 * it stays away for this run. On TV it goes after a while, as there's nothing to press, and waits
 * while a watch party dialog or panel is up (#247).
 */
export function LockedKeysToast({ tv }: { tv: boolean }) {
  const account = useAccount();
  const space = account.status === "ready" ? (account.profile?.id ?? null) : null;
  const locked = useSecretsLocked(space);
  const [, setDismissals] = useState(0);
  const dismiss = () => {
    if (space) dismissed.add(space);
    setDismissals((n) => n + 1);
  };
  const due = locked && !!space && !dismissed.has(space);
  const waiting = !!usePartySurface();
  useEffect(() => {
    if (!due || !tv || waiting) return;
    const t = setTimeout(dismiss, SAVE_FAILURE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, tv, waiting]);
  const { shown, leaving } = usePresence(due && !waiting ? space : null, TOAST_OUT_MS);
  if (!shown) return null;
  const actions = (
    <>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          dismiss();
          showWhereStored();
        }}
      >
        Unlock
      </Button>
      <IconButton label="Dismiss" onClick={dismiss}>
        <Close size={18} />
      </IconButton>
    </>
  );
  return (
    <Toast variant={tv ? "tv" : undefined} lines actions={!tv && actions} leaving={leaving} className="store-toast" data-kind="secrets-locked">
      <strong>Your add-ons are locked on this device</strong>
      <span>
        Your account's API keys and add-ons are encrypted with your passphrase, and they can't be used here until you type it
        {tv ? " in Settings → Account" : ""}.
      </span>
    </Toast>
  );
}
