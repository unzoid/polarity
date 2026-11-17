import { useState } from "react";
import { useAccount, type Profile } from "../../lib/account";
import { guardLockChange, setNewPin } from "../../lib/account/profileGuard";
import { hasPin, isRestricted, locksAvailable, needsGuardianAdvice } from "../../lib/account/profileRules";
import { errorMessage } from "../../lib/errors";
import { choicesOf, settingDef } from "../../lib/settings";
import { Dropdown } from "../Dropdown";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";

/**
 * A profile's PIN and viewing limit, in its edit sheet (ProfilesScreen's editor, the phone's ProfileEditSheet).
 * Each change is kept as it's made and asks first what profileGuard.ts says it needs: managing from a restricted
 * profile, the profile's current PIN to change or remove it (or the account, when it's forgotten). The limit's
 * steps and words are Settings → Browsing's (lib/settings/schema.ts).
 */
export function ProfileLockRows({ profile }: { profile: Profile }) {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!locksAvailable(profile)) {
    return <p className="profile-lock-note">A PIN and a viewing limit aren't available on this account server yet.</p>;
  }
  const lock = profile.lock!;
  const limitDef = settingDef("viewingLimit");
  const unratedDef = settingDef("viewingHideUnrated");
  const choices = limitDef.control?.kind === "choice" ? choicesOf(limitDef.control, lock.viewingLimit ?? 0) : [];

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  /** Asks what the change needs, then makes it. */
  const change = (fn: () => Promise<unknown>) =>
    run(async () => {
      if (await guardLockChange(profile, account.guardContext())) await fn();
    });

  const me = account.profile;
  const offerPinFor = me && me.id !== profile.id && !isRestricted(me) && !hasPin(me) ? me : null;
  const advise = isRestricted(profile) && needsGuardianAdvice(profile, account.profiles);

  return (
    <section className="profile-lock" aria-label="PIN and viewing limit">
      <div className="profile-lock-row">
        <span className="profile-lock-text">
          <span className="profile-lock-title">PIN</span>
          <span className="profile-lock-caption">{hasPin(profile) ? "Asked before this profile opens" : "Off"}</span>
        </span>
        <span className="profile-lock-actions">
          {hasPin(profile) ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void change(() => setNewPin(profile, account.guardContext()))}>
                Change PIN
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void change(() => account.setProfileLock(profile.id, { pin: null }))}>
                Remove PIN
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void change(() => setNewPin(profile, account.guardContext()))}>
              Set PIN
            </Button>
          )}
        </span>
      </div>
      <div className="profile-lock-row">
        <span className="profile-lock-text">
          <span className="profile-lock-title">Viewing limit</span>
          <span className="profile-lock-caption">{limitDef.title}</span>
        </span>
        <Dropdown
          label="Viewing limit"
          value={String(lock.viewingLimit ?? 0)}
          onChange={(v) => {
            const limit = Number(v) || null;
            void change(() => account.setProfileLock(profile.id, { viewingLimit: limit, hideUnrated: limit !== null && lock.hideUnrated }));
          }}
          options={choices.map((c) => ({ value: String(c.value), label: c.label }))}
        />
      </div>
      {lock.viewingLimit !== null && (
        <label className="profile-lock-row">
          <span className="profile-lock-text">
            <span className="profile-lock-title">{unratedDef.title}</span>
            <span className="profile-lock-caption">{unratedDef.caption}</span>
          </span>
          <Switch
            checked={lock.hideUnrated}
            disabled={busy}
            onChange={(v) => void change(() => account.setProfileLock(profile.id, { hideUnrated: v }))}
          />
        </label>
      )}
      {lock.viewingLimit !== null && (
        <p className="profile-lock-note">
          {profile.name} can't change this limit, other profiles or the account without{" "}
          {advise ? "the account's email." : "the PIN of a profile without a limit."}
        </p>
      )}
      {advise && (
        <div className="profile-lock-advice" role="note">
          <p>Without a PIN on your own profile, anyone can switch away from this profile and change its limit.</p>
          {offerPinFor && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => setNewPin(offerPinFor, account.guardContext()))}>
              Set a PIN for {offerPinFor.name}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
