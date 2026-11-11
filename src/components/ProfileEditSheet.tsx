import { useState } from "react";
import { type AvatarId, useAccount } from "../lib/account";
import { errorMessage } from "../lib/errors";
import { openSettings } from "../lib/settings";
import { IconPicker } from "../screens/account/ProfilesScreen";
import { Avatar } from "./Avatar";
import { Captions, ChevronRight, Edit, Play, Trash } from "./icons";

/**
 * A profile's page in the phone's profile sheet (ProfileMenu.tsx), from Manage: its picture (tap for the icons), its
 * name, and for the profile in use the settings that are its own (they follow the profile it's synced with), then
 * Delete. Each change is kept as it's made, as a phone's settings are: a new picture when it's picked, the name when
 * the field is left. `onDone`: back to the profiles (after Delete too).
 */
export function ProfileEditSheet({ id, onDone }: { id: string; onDone: () => void }) {
  const account = useAccount();
  const profile = account.profiles.find((p) => p.id === id);
  const [name, setName] = useState(profile?.name ?? "");
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!profile) return null;

  const inUse = account.profile?.id === profile.id;
  const canDelete = account.profiles.length > 1;
  const run = (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    fn().then(
      () => {
        setBusy(false);
        after?.();
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };
  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) return setName(profile.name);
    if (trimmed !== profile.name) run(() => account.updateProfile(profile.id, { name: trimmed }));
  };

  if (picking)
    return (
      <IconPicker
        bare
        name={profile.name}
        current={profile.avatar as AvatarId}
        taken={account.profiles.filter((p) => p.id !== profile.id).map((p) => p.avatar)}
        onPick={(avatar) => {
          setPicking(false);
          if (avatar !== profile.avatar) run(() => account.updateProfile(profile.id, { avatar }));
        }}
        onBack={() => setPicking(false)}
      />
    );

  return (
    <div className="profile-edit">
      <button type="button" className="profile-edit-avatar pressable" onClick={() => setPicking(true)} aria-label="Change profile icon">
        <Avatar id={profile.avatar} />
        <span className="profile-edit-avatar-badge" aria-hidden>
          <Edit size={16} strokeWidth={2.5} />
        </span>
      </button>
      <label className="profile-edit-name">
        <span>Profile Name</span>
        <input
          value={name}
          maxLength={40}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {/* Settings belong to the profile in use: only its own are offered here. */}
      {inUse && (
        <div className="profile-sheet-card">
          <button type="button" className="profile-sheet-row" onClick={() => openSettings("subtitles")}>
            <Captions />
            <span>Subtitles & Audio</span>
            <ChevronRight size={18} aria-hidden />
          </button>
          <button type="button" className="profile-sheet-row" onClick={() => openSettings("playback")}>
            <Play />
            <span>Playback & Autoplay</span>
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
      )}
      {canDelete && (
        <div className="profile-sheet-card">
          <button
            type="button"
            className="profile-sheet-row profile-edit-delete"
            disabled={busy}
            onClick={() => (confirmDelete ? run(() => account.deleteProfile(profile.id), onDone) : setConfirmDelete(true))}
          >
            <Trash />
            <span>{confirmDelete ? "Delete Profile and Its History" : "Delete Profile"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
