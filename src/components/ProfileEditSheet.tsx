import "../styles/account.css";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { type AvatarId, useAccount } from "../lib/account";
import { hasPin } from "../lib/account/profileRules";
import { errorMessage } from "../lib/errors";
import { openSettings } from "../lib/settings";
import { prefersReducedMotion } from "../lib/ui";
import { maskStyle, useAppleCorners } from "../lib/ui/cornerSmoothing";
import { IconPicker } from "../screens/account/ProfilesScreen";
import { Avatar } from "./Avatar";
import { Captions, ChevronRight, Lock, Play, Trash } from "./icons";
import { ProfileLockRows } from "./profileLock/ProfileLockRows";
import { FamilyConfirmTray } from "./settings/FamilyTray";

const HERO_SPRING = { type: "spring" as const, stiffness: 460, damping: 38, mass: 0.85 };

/**
 * Mobile Edit Profile page:
 * - Top: Family Wallet-style full-width Apple-smoothed hero card that scales seamlessly from the
 *   Profiles grid card (`layoutId`) with Avatar, live Profile Name, status, and translucent `Customize` pill,
 *   followed by a clean Netflix-style floating-label Profile Name input.
 * - Below: Individual Netflix-style rounded rows (Viewing Restrictions, Profile Lock, Audio & Subtitles,
 *   Playback & Autoplay, Kids Profile toggle, and Delete Profile confirmation tray) in Polarity's theme palette.
 */
export function ProfileEditSheet({
  id,
  onDone,
  onHead,
}: {
  id: string;
  onDone: () => void;
  /** Tells the phone sheet's header when a nested sub-view (Icon Picker) owns the Back button. */
  onHead?: (head: { label: string; back: () => void } | undefined) => void;
}) {
  const account = useAccount();
  const profile = account.profiles.find((p) => p.id === id);
  const [name, setName] = useState(profile?.name ?? "");
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  // 22 at 60% smoothing: the corner reaches 35 along each edge (cornerSmoothing.ts).
  const heroCorners = useAppleCorners(heroRef, 22, 60, !picking);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    onHead?.(picking ? { label: "Choose Icon", back: () => setPicking(false) } : undefined);
    return () => onHead?.(undefined);
  }, [picking, onHead]);
  if (!profile) return null;

  const inUse = account.profile?.id === profile.id;
  const canDelete = account.profiles.length > 1;
  const locked = hasPin(profile);
  const displayName = name.trim() || profile.name;

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
    <div className="fpe-wrap">
      {/* Top Hero Card: Family Wallet Card with shared-element layoutId scale from the Profiles grid */}
      <motion.div
        ref={heroRef}
        layoutId={`profile-card-${profile.id}`}
        transition={reduced ? { duration: 0.08 } : HERO_SPRING}
        className={`fpe-hero-card${inUse ? " is-active" : ""}`}
        style={maskStyle(heroCorners.mask)}
      >
        <div className="fpe-hero-top">
          <button
            type="button"
            className="fpe-hero-avatar"
            aria-label="Change profile icon"
            onClick={() => setPicking(true)}
          >
            {/* Shares its layoutId with the grid card's picture, so it moves and scales as one picture with the
                card instead of two cross-fading (which dipped it to half-transparent mid-way). */}
            <motion.span className="fpe-hero-avatar-art" layoutId={`profile-avatar-${profile.id}`} transition={reduced ? { duration: 0.08 } : HERO_SPRING}>
              <Avatar id={profile.avatar} />
            </motion.span>
            {locked && (
              <span className="fmp-card-lock" aria-hidden>
                <Lock size={11} />
              </span>
            )}
          </button>
          <span className="fpe-hero-pill-meta">
            {inUse ? "Active Profile" : "Profile"}
          </span>
        </div>
        <div className="fpe-hero-bottom">
          <div className="fpe-hero-text">
            <strong className="fpe-hero-name">{displayName}</strong>
          </div>
          <button type="button" className="fpe-hero-customize" onClick={() => setPicking(true)}>
            Customize
          </button>
        </div>
        {heroCorners.active && (
          <svg
            className="ft-smooth-stroke"
            width={heroCorners.width}
            height={heroCorners.height}
            viewBox={`0 0 ${heroCorners.width} ${heroCorners.height}`}
            aria-hidden
          >
            <path
              d={heroCorners.strokePath(1)}
              fill="none"
              stroke={inUse ? "rgb(255 255 255 / 0.22)" : "var(--fmp-card-rim)"}
              strokeWidth="1.5"
            />
          </svg>
        )}
      </motion.div>

      {/* Under the card: blurs in as the card scales up, and out as it scales back (the list does the opposite). */}
      <motion.div
        className="fpe-body"
        initial={reduced ? { opacity: 0 } : { opacity: 0, filter: "blur(6px)" }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, filter: "blur(0px)" }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, filter: "blur(6px)" }}
        transition={{ duration: reduced ? 0.08 : 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <label className="fpe-name-field">
          <span className="fpe-name-label">Profile Name</span>
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

        {/* Netflix-style individual rounded cards below Profile Name (using Polarity's colors) */}
        <div className="fpe-rows">
          <ProfileLockRows profile={profile} variant="netflix" />

          {inUse && (
            <>
              <button type="button" className="fpe-row" onClick={() => openSettings("subtitles", { embedded: true })}>
                <span className="fpe-row-ico" aria-hidden>
                  <Captions size={22} />
                </span>
                <span className="fpe-row-text">
                  <span className="fpe-row-title">Audio &amp; Subtitles</span>
                  <span className="fpe-row-sub">Language, style and default tracks</span>
                </span>
                <ChevronRight size={18} className="fpe-row-chev" aria-hidden />
              </button>
              <button type="button" className="fpe-row" onClick={() => openSettings("playback", { embedded: true })}>
                <span className="fpe-row-ico" aria-hidden>
                  <Play size={22} />
                </span>
                <span className="fpe-row-text">
                  <span className="fpe-row-title">Playback &amp; Autoplay</span>
                  <span className="fpe-row-sub">Next episode, skipping and resuming</span>
                </span>
                <ChevronRight size={18} className="fpe-row-chev" aria-hidden />
              </button>
            </>
          )}

          {canDelete && (
            <>
              <button
                type="button"
                className="fpe-row fpe-row-danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <span className="fpe-row-ico" aria-hidden>
                  <Trash size={21} />
                </span>
                <span className="fpe-row-text">
                  <span className="fpe-row-title">Delete Profile</span>
                  <span className="fpe-row-sub">Removes this profile and its watch history</span>
                </span>
                <ChevronRight size={18} className="fpe-row-chev" aria-hidden />
              </button>
              <FamilyConfirmTray
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title="Delete Profile"
                description={`Delete "${profile.name}" and its watch history? This can't be undone.`}
                confirmLabel={busy ? "Deleting…" : "Delete Profile"}
                pending={busy}
                onConfirm={() => run(() => account.deleteProfile(profile.id), onDone)}
              />
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
