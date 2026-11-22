import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "../components/Avatar";
import { useAccount, type Profile } from "../lib/account";
import { hasPin } from "../lib/account/profileRules";
import { prefersReducedMotion } from "../lib/ui";
import { flyToNavbar, hasNavbarTarget } from "../screens/account/profileHandoff";

type SwitchState = { profile: Profile; phase: "in" | "out" } | null;

let current: SwitchState = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setSwitch = (next: SwitchState) => {
  current = next;
  emit();
};

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * Animates switching to another profile from the desktop profile menu: brings up a brief dark frosted veil
 * with the chosen profile's avatar and name at center, switches the profile underneath, and then flies the
 * avatar straight into the navbar while dissolving onto the new profile's Home page.
 */
export async function switchProfileWithAnimation(profile: Profile, choose: (p: Profile) => Promise<void>) {
  if (prefersReducedMotion()) {
    await choose(profile);
    return;
  }
  const locked = hasPin(profile);
  const enteredAt = performance.now();
  if (!locked) {
    setSwitch({ profile, phase: "in" });
    // Let the veil paint for one frame before switching the tree underneath.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  try {
    await choose(profile);
  } catch (e) {
    setSwitch(null);
    throw e;
  }
  // If the profile was PIN-locked, `ProfileSwitchHost` will only have shown once unlocked; if cancelled, nothing ran.
  if (locked) return;
  const elapsed = performance.now() - enteredAt;
  if (elapsed < 260) await wait(260 - elapsed);
  setSwitch({ profile, phase: "out" });
}

let pendingPinProfile: Profile | null = null;

/** Starts an animated switch for both unlocked and PIN-locked profiles (only animates locked ones if unlocked). */
export function runAnimatedProfileSwitch(profile: Profile, choose: (p: Profile) => Promise<void>) {
  if (hasPin(profile) && !prefersReducedMotion()) {
    pendingPinProfile = profile;
    void choose(profile).finally(() => {
      if (pendingPinProfile?.id === profile.id) pendingPinProfile = null;
    });
    return;
  }
  void switchProfileWithAnimation(profile, choose);
}

/**
 * Mounted at the App root (outside RouterProvider) so the transition smoothly bridges the remount of
 * DeskApp / Home when `profile.id` changes.
 */
export function ProfileSwitchHost() {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const account = useAccount();
  const activeId = account.status === "ready" ? account.profile?.id : undefined;
  const artRef = useRef<HTMLDivElement>(null);
  const [fading, setFading] = useState(false);

  // If a PIN-locked profile switch succeeded, show the brief reveal + flight now.
  useEffect(() => {
    if (!activeId || !pendingPinProfile || pendingPinProfile.id !== activeId) return;
    const target = pendingPinProfile;
    pendingPinProfile = null;
    setSwitch({ profile: target, phase: "in" });
    const t = window.setTimeout(() => setSwitch({ profile: target, phase: "out" }), 240);
    return () => window.clearTimeout(t);
  }, [activeId]);

  useLayoutEffect(() => {
    if (!state) {
      setFading(false);
      return;
    }
    if (state.phase !== "out") {
      setFading(false);
      return;
    }
    const avatar = artRef.current?.querySelector<HTMLElement>(".avatar");
    if (!avatar || prefersReducedMotion()) {
      setSwitch(null);
      return;
    }
    document.documentElement.dataset.profileHandoff = "";
    let raf = 0;
    let doneTimer = 0;
    let flew = false;
    const startedAt = performance.now();
    const go = () => {
      if (hasNavbarTarget() || performance.now() - startedAt > 360) {
        setFading(true);
        if (flyToNavbar(avatar)) flew = true;
        else delete document.documentElement.dataset.profileHandoff;
        doneTimer = window.setTimeout(() => setSwitch(null), 540);
        return;
      }
      raf = requestAnimationFrame(go);
    };
    raf = requestAnimationFrame(go);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(doneTimer);
      if (!flew) delete document.documentElement.dataset.profileHandoff;
    };
  }, [state]);

  if (!state) return null;

  return (
    <div className="dk-pswitch" data-fading={fading || undefined} aria-hidden>
      <div className="dk-pswitch-card" ref={artRef}>
        <Avatar id={state.profile.avatar} className="dk-pswitch-avatar" />
        <span className="dk-pswitch-name">{state.profile.name}</span>
      </div>
    </div>
  );
}
