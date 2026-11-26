import "../../styles/account.css";
import { useState } from "react";
import { useAccount, type Profile } from "../../lib/account";
import { guardLockChange, setNewPin } from "../../lib/account/profileGuard";
import { hasPin, isRestricted, locksAvailable, needsGuardianAdvice } from "../../lib/account/profileRules";
import { errorMessage } from "../../lib/errors";
import { choicesOf, settingDef } from "../../lib/settings/catalog";
import { Dropdown } from "../Dropdown";
import { ChevronRight, Lock, Star } from "../icons";
import { FamilyPickerTray, FamilyTray } from "../settings/FamilyTray";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";

function RestrictionsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.5 20.2 7.25v9.5L12 21.5 3.8 16.75v-9.5L12 2.5Z" />
      <path d="M12 8.2v4.6" />
      <circle cx="12" cy="16.2" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * A profile's PIN and viewing limit, in its edit sheet (ProfilesScreen's editor, the phone's ProfileEditSheet).
 * Each change is kept as it's made and asks first what profileGuard.ts says it needs: managing from a restricted
 * profile, the profile's current PIN to change or remove it (or the account, when it's forgotten). The limit's
 * steps and words are Settings → Browsing's (lib/settings/schema.ts).
 */
export function ProfileLockRows({ profile, variant = "default" }: { profile: Profile; variant?: "default" | "netflix" }) {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitTrayOpen, setLimitTrayOpen] = useState(false);
  const [pinTrayOpen, setPinTrayOpen] = useState(false);

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
  const isKidsPreset = lock.viewingLimit === 10 && lock.hideUnrated;
  const currentLimitLabel = choices.find((c) => c.value === (lock.viewingLimit ?? 0))?.label ?? "No restrictions";

  if (variant === "netflix") {
    return (
      <>
        <button type="button" className="fpe-row" disabled={busy} onClick={() => setLimitTrayOpen(true)}>
          <span className="fpe-row-ico" aria-hidden>
            <RestrictionsIcon size={22} />
          </span>
          <span className="fpe-row-text">
            <span className="fpe-row-title">Viewing Restrictions</span>
            <span className="fpe-row-sub">
              {lock.viewingLimit === null ? "No restrictions" : `${currentLimitLabel}${lock.hideUnrated ? " · Unrated hidden" : ""}`}
            </span>
          </span>
          <ChevronRight size={18} className="fpe-row-chev" aria-hidden />
        </button>

        <FamilyPickerTray
          open={limitTrayOpen}
          onClose={() => setLimitTrayOpen(false)}
          title="Viewing Restrictions"
          value={String(lock.viewingLimit ?? 0)}
          options={choices.map((c) => ({ value: String(c.value), label: c.label }))}
          onPick={(v) => {
            const limit = Number(v) || null;
            void change(() => account.setProfileLock(profile.id, { viewingLimit: limit, hideUnrated: limit !== null && lock.hideUnrated }));
          }}
        />

        <button
          type="button"
          className="fpe-row"
          disabled={busy}
          onClick={() => {
            if (hasPin(profile)) setPinTrayOpen(true);
            else void change(() => setNewPin(profile, account.guardContext()));
          }}
        >
          <span className="fpe-row-ico" aria-hidden>
            <Lock size={22} />
          </span>
          <span className="fpe-row-text">
            <span className="fpe-row-title">Profile Lock</span>
            <span className="fpe-row-sub">{hasPin(profile) ? "PIN required to open this profile" : "Add a 4-digit PIN to this profile"}</span>
          </span>
          <ChevronRight size={18} className="fpe-row-chev" aria-hidden />
        </button>

        <FamilyTray open={pinTrayOpen} onClose={() => setPinTrayOpen(false)} title="Profile Lock" stepKey="pin-actions">
          <div className="ft-tray-body">
            <p className="ft-desc">A 4-digit PIN is asked before opening {profile.name}.</p>
            <div className="ft-key-warn-actions">
              <button
                type="button"
                className="ft-pill ft-pill-cta"
                disabled={busy}
                onClick={() => {
                  setPinTrayOpen(false);
                  void change(() => setNewPin(profile, account.guardContext()));
                }}
              >
                Change PIN
              </button>
              <button
                type="button"
                className="ft-pill ft-pill-danger"
                disabled={busy}
                onClick={() => {
                  setPinTrayOpen(false);
                  void change(() => account.setProfileLock(profile.id, { pin: null }));
                }}
              >
                Remove PIN
              </button>
            </div>
          </div>
        </FamilyTray>

        <label className="fpe-row fpe-row-toggle">
          <span className="fpe-row-ico" aria-hidden>
            <Star size={22} />
          </span>
          <span className="fpe-row-text">
            <span className="fpe-row-title">Kids Profile</span>
            <span className="fpe-row-sub">Up to 10+ and hides unrated titles</span>
          </span>
          <Switch
            checked={isKidsPreset}
            disabled={busy}
            onChange={(on) =>
              void change(() =>
                account.setProfileLock(profile.id, on ? { viewingLimit: 10, hideUnrated: true } : { viewingLimit: null, hideUnrated: false }),
              )
            }
          />
        </label>

        {lock.viewingLimit !== null && !isKidsPreset && (
          <label className="fpe-row fpe-row-toggle">
            <span className="fpe-row-ico" aria-hidden>
              <RestrictionsIcon size={22} />
            </span>
            <span className="fpe-row-text">
              <span className="fpe-row-title">{unratedDef.title}</span>
              {unratedDef.caption && <span className="fpe-row-sub">{unratedDef.caption}</span>}
            </span>
            <Switch
              checked={lock.hideUnrated}
              disabled={busy}
              onChange={(v) => void change(() => account.setProfileLock(profile.id, { hideUnrated: v }))}
            />
          </label>
        )}

        {advise && (
          <div className="fpe-advice" role="note">
            <p>Without a PIN on your own profile, anyone can switch away and change this limit.</p>
            {offerPinFor && (
              <button
                type="button"
                className="ft-pill ft-pill-cta"
                disabled={busy}
                onClick={() => void run(() => setNewPin(offerPinFor, account.guardContext()))}
              >
                Set a PIN for {offerPinFor.name}
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  }

  return (
    <section className="profile-lock" aria-label="PIN and viewing limit">
      <label className="profile-lock-row">
        <span className="profile-lock-text">
          <span className="profile-lock-title">Kids profile</span>
          <span className="profile-lock-caption">Family-friendly titles (up to 10+) and hides unrated titles</span>
        </span>
        <Switch
          checked={isKidsPreset}
          disabled={busy}
          onChange={(on) =>
            void change(() =>
              account.setProfileLock(profile.id, on ? { viewingLimit: 10, hideUnrated: true } : { viewingLimit: null, hideUnrated: false }),
            )
          }
        />
      </label>
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
