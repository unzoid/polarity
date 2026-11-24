import "../styles/account.css";
import "../styles/family-settings-phone.css";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, Edit, Feedback, Lock, More, OpenFile, Profile, Settings, SignOut, Users, WatchParty } from "./icons";
import { api } from "../lib/api";
import { appVersion } from "../lib/updater";
import { feedbackContext, feedbackUrl } from "../lib/feedback";

/** Report a Problem: the bug form, with the version once it's known (never held up by it). */
export function reportProblem() {
  void appVersion()
    .catch(() => undefined)
    .then((v) => api.openExternal(feedbackUrl("bug", feedbackContext(v))))
    .catch(warnFailed("Opening the bug report form"));
}
import { canOpenFiles, setOpenFilesOpen } from "../lib/localFiles";
import { closePartySurface, getParty, leaveParty, partyAvailable, setJoinPartyOpen, usePartySurface } from "../lib/party";
import { friendsAvailable, setFriendsOpen, useFriends } from "../lib/friends";
import { useRouter, useNavigation } from "../lib/router";
import { useAccount } from "../lib/account";
import { hasPin } from "../lib/account/profileRules";
import { closeSettings, openSettings, useSettingsOverlay } from "../lib/settings";
import { JoinForm, LinkForm } from "./party/PartyUI";
import { useSettings } from "../lib/net";
import { canPreloadChunks, lazyNamed, prefersReducedMotion, useDismiss, useFormFactor, whenIdle } from "../lib/ui";
import { useAppleCorners } from "../lib/ui/cornerSmoothing";
import type { SettingsHead } from "./SettingsOverlay";
import { Spinner } from "./Spinner";
import { useGuard } from "./profileLock/useGuard";
import { Avatar } from "./Avatar";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "./ui/Popover";
import { FitHeight, backOnEscape, useViewSlide } from "./ViewStack";
import { anchorOf, buildChannel, nativeDialogsAvailable, showNativeDialog, type DialogAction } from "../lib/platform";
import { warnFailed } from "../lib/errors";

/** Settings, as the profile sheet's next view on a phone: loaded when it's first opened, as the window is (App.tsx). */
const SettingsOverlay = lazyNamed(() => import("./SettingsOverlay"), "SettingsOverlay");
const ProfileEditSheet = lazyNamed(() => import("./ProfileEditSheet"), "ProfileEditSheet");
const FriendsBody = lazyNamed(() => import("./friends/FriendsPanel"), "FriendsBody");

/** Used for the template profile when nobody's signed in. */
const GUEST_AVATAR = "guest";

/**
 * `stay`: the menu stays open (Friends and Join open as views inside it; on a phone Settings does too).
 * `view`: opens one of the menu's own views (Friends, Join). `count`: waiting for an answer (friend requests).
 */
type Choice = { id: string; label: string; icon: ReactNode; run: () => void; stay?: boolean; view?: boolean; count?: number; locked?: boolean };

/** "Friends (2)" where there's no room for a badge. */
const labelOf = (c: Choice) => (c.count ? `${c.label} (${c.count})` : c.label);

type Me = { id: string; name: string; avatar: string };
/** `settings` and `edit` (a profile's page) are the phone sheet's only. */
type View = "list" | "friends" | "join" | "settings" | "edit";
const VIEW_TITLES = { friends: "Friends", join: "Join a Watch Party", settings: "Settings", edit: "Edit Profile" } as const;

/**
 * Navbar avatar, always there: Settings lives in its menu, for everyone, and
 * the Calendar while it isn't a navbar tab.
 * Without an account it's a template "Guest" profile (Settings, Sign In);
 * signed in it adds switching profiles, managing them, the account and
 * signing out. The same choices three ways: a popover under the avatar, a sheet
 * from the bottom edge on a phone (in reach of a thumb), and on an iPad the
 * system's own menu. The popover and the sheet show Friends and Join as views
 * inside themselves.
 */
/** Who wants the phone's profile sheet up (the phone shell's profile in its bar and its tab). */
const sheetOpeners = new Set<() => void>();

/** Opens the phone's profile sheet, wherever its ProfileMenu is mounted. */
export function openProfileSheet() {
  sheetOpeners.forEach((open) => open());
}

/** `trigger`: false leaves the avatar button out (the phone shell has its own ways in: `openProfileSheet`). */
export function ProfileMenu({ trigger = true }: { trigger?: boolean } = {}) {
  const account = useAccount();
  const phone = useFormFactor().form === "phone";
  const signedIn = account.enabled && account.status !== "guest" && !!account.profile;
  const me = signedIn ? account.profile! : null;
  const others = me ? account.profiles.filter((p) => p.id !== me.id) : [];
  const name = me?.name ?? "Guest";
  const avatar = me?.avatar ?? GUEST_AVATAR;
  const { tab } = useNavigation();
  // While Settings → Browsing → Show the Calendar makes it a navbar tab, it isn't listed here too (#92).
  const { data: settings } = useSettings();
  // Requests waiting for an answer show on the Friends item and on the navbar avatar (#135).
  const { entries, invites } = useFriends();
  const requests = entries.filter((e) => e.state === "pending" && e.incoming).length;
  const badgeCount = requests + invites.length;

  const profiles: Choice[] = others.map((p) => ({
    id: `profile:${p.id}`,
    label: p.name,
    icon: <Avatar id={p.avatar} />,
    locked: hasPin(p),
    run: () => void account.chooseProfile(p),
  }));
  const meLocked = me ? hasPin(me) : false;
  const manage: Choice[] = me ? [{ id: "manage", label: "Manage Profiles", icon: <Edit />, run: () => account.switchProfile("manage") }] : [];
  const actions: Choice[] = [
    ...(me && partyAvailable() ? [{ id: "party", label: "Join Watch Party", icon: <WatchParty />, run: () => setJoinPartyOpen(true), stay: true, view: true }] : []),
    ...(me && friendsAvailable() ? [{ id: "friends", label: "Friends", count: requests, icon: <Users />, run: () => setFriendsOpen(true), stay: true, view: true }] : []),
    ...(canOpenFiles ? [{ id: "open-file", label: "Open File…", icon: <OpenFile />, run: () => setOpenFilesOpen(true) }] : []),
    ...(!settings?.showCalendar || phone ? [{ id: "calendar", label: "Calendar", icon: <Calendar />, run: () => tab({ name: "calendar" }) }] : []),
    { id: "settings", label: "Settings", icon: <Settings />, run: () => openSettings(undefined, phone ? { embedded: true } : undefined), stay: true },
    ...(me ? [{ id: "account", label: "Account", icon: <Profile />, run: () => openSettings("account", phone ? { embedded: true } : undefined), stay: true }] : []),
    // The bug form in the browser, filled in with this device (#205); Settings → About has the other kinds.
    { id: "report", label: "Report a Problem", icon: <Feedback />, run: reportProblem },
  ];
  const session: Choice[] = me
    ? [{ id: "sign-out", label: "Sign Out", icon: <SignOut />, run: () => void account.signOut() }]
    : account.enabled
      ? [{ id: "sign-in", label: "Sign In", icon: <Profile />, run: account.showSignIn }]
      : // A dev build without a database (docs/dev-channel.md): signed out until one is connected.
        buildChannel === "dev"
        ? [{ id: "connect-database", label: "Connect a Database…", icon: <Profile />, run: () => openSettings("advanced"), stay: true }]
        : [];

  // An iPad gets iOS's own menu under the avatar; a phone, iPhones too, the sheet below.
  if (nativeDialogsAvailable && !phone) {
    // The web menu below, as groups of choices (a separator between groups).
    const groups = [[...profiles, ...manage], actions, session];
    const choices = groups.flat();
    const open = (el: HTMLElement) => {
      const list = groups.flatMap((g, i) => g.map((c): DialogAction => ({ id: c.id, label: labelOf(c), style: "default", group: i })));
      showNativeDialog({ kind: "menu", title: me ? name : `${name} · Not signed in`, anchor: anchorOf(el), actions: list })
        .then((picked) => choices.find((c) => c.id === picked)?.run())
        .catch(warnFailed("profile menu"));
    };
    return (
      <button
        type="button"
        className="navbar-profile pressable"
        aria-label={badgeCount ? `Profile: ${name} (${badgeCount} pending)` : `Profile: ${name}`}
        aria-haspopup="menu"
        onClick={(e) => open(e.currentTarget)}
      >
        <Avatar id={avatar} />
        {badgeCount > 0 && <span className="navbar-profile-badge" aria-hidden />}
      </button>
    );
  }

  const status = me ? undefined : !account.enabled && buildChannel === "dev" ? "No database connected" : "Not signed in";
  const props = { name, avatar, me, meLocked, badgeCount, status, profiles, manage: manage[0], groups: [actions, session] };
  return phone ? <ProfileSheet {...props} trigger={trigger} /> : <ProfilePopover {...props} />;
}

type MenuProps = {
  name: string;
  avatar: string;
  me: Me | null;
  meLocked?: boolean;
  badgeCount?: number;
  /** Under the name when there's no account: why. */
  status?: string;
  profiles: Choice[];
  manage?: Choice;
  groups: Choice[][];
};

/**
 * Which view the profile menu shows, and moving between them, for the sheet and the popover alike.
 *
 * The views are the party surfaces' (lib/party/surface.ts): opened from anywhere else (a friend's request, a
 * notice), the menu comes up at that view, and the player coming up closes them as it closes the dialogs.
 * `over`: the phone sheet's own views. Settings comes before the party's (opened from anywhere, Manage Add-ons
 * too, the sheet comes up at it); a profile's page only shows on the list it was opened from.
 */
function useProfileViews(signedIn: boolean, over?: "settings" | "edit") {
  const [listed, setListed] = useState(false);
  const surface = usePartySurface();
  const view: View =
    over === "settings" ? "settings" : surface === "friends" ? "friends" : surface === "join" && signedIn ? "join" : (over ?? "list");
  const open = listed || (view !== "list" && view !== "edit");
  const slide = useViewSlide(open, view, "list");
  const { current } = useRouter();
  useEffect(() => {
    if (current.name === "player") setListed(false);
  }, [current.name]);
  const leaveView = () => {
    // Closed while waiting for a friend's host: that's giving up on joining.
    if (getParty()?.knocking) leaveParty();
    closePartySurface("friends");
    closePartySurface("join");
  };
  return {
    view,
    open,
    slide,
    /** Shows the list (true) or closes the menu (false), when no other view is up. */
    list: setListed,
    close: () => {
      leaveView();
      setListed(false);
    },
    back: () => {
      leaveView();
      setListed(true);
    },
    /** Joined, or a link put on: the menu is done. */
    done: () => {
      closePartySurface("friends");
      closePartySurface("join");
      setListed(false);
    },
  };
}

/** "Join a Watch Party" as a view: a friend's code, or a link to watch together. */
function JoinView({ me, done }: { me: Me; done: () => void }) {
  return (
    <div className="profile-sheet-join">
      <p className="party-dialog-text">Enter the code a friend shared with you.</p>
      <JoinForm me={me} onJoined={done} />
      <div className="party-or" aria-hidden>
        <span>or watch a link together</span>
      </div>
      <LinkForm me={me} onDone={done} />
    </div>
  );
}

/**
 * On a desktop or tablet: a popover under the avatar. Who's watching first (the profile, and the others a
 * click each), then the rest as rows. Friends and Join open as views inside it, with a Back (and Escape) to
 * the list; its height follows the view. Any other choice closes it as it runs.
 */
function ProfilePopover({ name, avatar, me, meLocked, badgeCount = 0, status, profiles, manage, groups }: MenuProps) {
  const { view, open, slide, list, close, back, done } = useProfileViews(!!me);
  const pick = (c: Choice) => {
    // A view's choice keeps the menu open through its surface; the rest close it.
    list(false);
    c.run();
  };
  // Keyboard focus follows the view: into the one that came in, back to its row on the list.
  const viewRef = useRef<HTMLDivElement>(null);
  const was = useRef({ open, view });
  useEffect(() => {
    const from = was.current;
    was.current = { open, view };
    if (!open || !from.open || from.view === view) return;
    const el = viewRef.current;
    const target =
      view === "list" ? el?.querySelector(`[data-choice="${from.view === "join" ? "party" : "friends"}"]`) : (el?.querySelector("input") ?? el?.querySelector(".profile-pop-back"));
    (target as HTMLElement | null)?.focus({ preventScroll: true });
  }, [open, view]);
  return (
    <PopoverRoot open={open} onOpenChange={(o) => (o ? list(true) : close())}>
      <PopoverTrigger
        className="navbar-profile pressable"
        aria-label={badgeCount ? `Profile: ${name} (${badgeCount} pending)` : `Profile: ${name}`}
        title={badgeCount ? `${name} · ${badgeCount} pending` : name}
      >
        <Avatar id={avatar} />
        {badgeCount > 0 && <span className="navbar-profile-badge" aria-hidden />}
      </PopoverTrigger>
      <PopoverPopup sideOffset={10} align="end" collisionPadding={12} className="profile-pop" aria-label={view === "list" ? `Profile: ${name}` : VIEW_TITLES[view]}>
        <FitHeight>
          <div
            key={view}
            ref={viewRef}
            className="profile-pop-view"
            data-view={view}
            data-slide={slide}
            onKeyDown={view === "list" ? arrowKeys : backOnEscape(back)}
          >
            {view === "list" ? (
              <ProfilePopList name={name} avatar={avatar} me={me} meLocked={meLocked} status={status} profiles={profiles} manage={manage} groups={groups} pick={pick} />
            ) : (
              <>
                <div className="profile-pop-title">
                  <button className="profile-pop-back pressable" aria-label="Back" onClick={back}>
                    <ChevronLeft size={20} strokeWidth={2.25} />
                  </button>
                  <strong>{VIEW_TITLES[view]}</strong>
                </div>
                {view === "friends" ? (
                  <Suspense fallback={null}>
                    <FriendsBody inDialog={false} />
                  </Suspense>
                ) : (
                  me && <JoinView me={me} done={done} />
                )}
              </>
            )}
          </div>
        </FitHeight>
      </PopoverPopup>
    </PopoverRoot>
  );
}

/** Up and Down move through the list's buttons, as in a menu. */
function arrowKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const step = e.key === "ArrowDown" ? 1 : -1;
  const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
  items[next].focus();
}

function ProfilePopList({ name, avatar, me, meLocked, status, profiles, manage, groups, pick }: MenuProps & { pick: (c: Choice) => void }) {
  return (
    <>
      <div className="profile-menu-head">
        <Avatar id={avatar} />
        <div>
          <strong>{name}</strong>
          {status && <span>{status}</span>}
        </div>
      </div>
      {me && (
        <div className="profile-pop-profiles" role="group" aria-label="Profiles">
          <span className="profile-pop-profile" aria-current="true">
            <span className="profile-pop-face">
              <Avatar id={avatar} />
              {meLocked && (
                <span className="profile-pop-lock" aria-hidden>
                  <Lock size={10} />
                </span>
              )}
            </span>
            <span>{name}</span>
          </span>
          {profiles.map((c) => (
            <button key={c.id} className="profile-pop-profile pressable" aria-label={`Switch to ${c.label}`} onClick={() => pick(c)}>
              <span className="profile-pop-face">
                {c.icon}
                {c.locked && (
                  <span className="profile-pop-lock" aria-hidden>
                    <Lock size={10} />
                  </span>
                )}
              </span>
              <span>{c.label}</span>
            </button>
          ))}
          {manage && (
            <button className="profile-pop-profile pressable" onClick={() => pick(manage)} aria-label={manage.label}>
              <span className="profile-pop-manage" aria-hidden>
                <Edit size={18} />
              </span>
              <span>Manage</span>
            </button>
          )}
        </div>
      )}
      {groups
        .filter((g) => g.length)
        .map((g) => (
          <div key={g[0].id} className="profile-pop-group">
            {g.map((c) => (
              <button key={c.id} className="profile-pop-row" data-choice={c.id} onClick={() => pick(c)}>
                {c.icon}
                <span>{c.label}</span>
                {!!c.count && (
                  <span className="profile-pop-count" aria-label={`${c.count} waiting`}>
                    {c.count}
                  </span>
                )}
                {c.view && <ChevronRight size={16} aria-hidden />}
              </button>
            ))}
          </div>
        ))}
    </>
  );
}

const PROFILE_ENTER = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };
const PROFILE_PUSH = { type: "spring" as const, stiffness: 560, damping: 44, mass: 0.85 };
const PROFILE_CARD_SPRING = { type: "spring" as const, stiffness: 460, damping: 38, mass: 0.85 };

/**
 * On a phone: full-screen Family-style Profiles page (modeled on Family's Wallets page — no bottom drawer).
 * Top section shows Apple-smoothed profile cards ("Your Profiles"); below are borderless Family rows.
 * Friends, Join Watch Party, Edit Profile, and App Settings push horizontally with zero darkening.
 */
function ProfileSheet({ name, avatar, me, meLocked, badgeCount = 0, status, profiles, manage, groups, trigger = true }: MenuProps & { trigger?: boolean }) {
  const settingsState = useSettingsOverlay();
  const settingsOpen = settingsState.open && settingsState.embedded;
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editHead, setEditHead] = useState<{ label: string; back: () => void }>();
  const guard = useGuard();
  const reduced = prefersReducedMotion();
  const { view, open, list, close, back, done } = useProfileViews(!!me, settingsOpen ? "settings" : editing ? "edit" : undefined);
  const [settingsHead, setSettingsHead] = useState<SettingsHead>();
  const shut = useCallback(() => {
    close();
    closeSettings();
    setManaging(false);
    setEditing(null);
  }, [close]);
  const toList = useCallback(() => {
    setEditing(null);
    back();
  }, [back]);
  const leaveSettings = useCallback(() => {
    closeSettings();
    list(true);
  }, [list]);
  const pick = (c: Choice) => {
    list(!!c.stay);
    c.run();
  };

  useEffect(() => {
    const openFn = () => list(true);
    sheetOpeners.add(openFn);
    return () => void sheetOpeners.delete(openFn);
  }, [list]);

  // Slide .ph-main down pixel-locked with the full-screen Family Profiles page.
  useLayoutEffect(() => {
    if (!open) return;
    document.documentElement.dataset.profilesOpen = "";
    return () => void delete document.documentElement.dataset.profilesOpen;
  }, [open]);

  // Escape / Android back dismisses sub-views first (Settings handles its own Escape), then closes Profiles.
  useDismiss(
    open && view !== "settings",
    useCallback(() => {
      if (view === "edit" && editHead) editHead.back();
      else if (view !== "list") toList();
      else if (managing) setManaging(false);
      else shut();
    }, [view, editHead, managing, toList, shut]),
  );

  useEffect(() => {
    if (!canPreloadChunks()) return;
    let cancelIdle: (() => void) | undefined;
    const later = window.setTimeout(() => {
      cancelIdle = whenIdle(() => void SettingsOverlay.preload().catch(() => {}), 5000);
    }, 5000);
    return () => {
      window.clearTimeout(later);
      cancelIdle?.();
    };
  }, []);

  const [bar, setBar] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setBar(document.querySelector<HTMLElement>(".sheet-host") ?? document.body), []);

  const headerTitle =
    view === "list"
      ? "Profiles"
      : view === "settings"
        ? (settingsHead?.label ?? VIEW_TITLES.settings)
        : view === "edit" && editHead
          ? editHead.label
          : VIEW_TITLES[view];

  const onHeaderLeft =
    view === "list"
      ? shut
      : view === "settings"
        ? (settingsHead?.back ?? leaveSettings)
        : view === "edit" && editHead
          ? editHead.back
          : toList;

  const isRoot = view === "list";
  const isSettings = view === "settings";
  const isEdit = view === "edit";
  const lastSubViewRef = useRef<View>("friends");
  if (!isRoot) lastSubViewRef.current = view;
  const verticalSettings = isSettings || (isRoot && lastSubViewRef.current === "settings");
  const morphEdit = isEdit || (isRoot && lastSubViewRef.current === "edit");
  // The profile whose card scales to its page and back (still wanted on the way back, once `editing` is cleared).
  const lastEditedRef = useRef<string | null>(null);
  if (editing) lastEditedRef.current = editing;

  return (
    <>
      {trigger && (
        <button
          type="button"
          className="navbar-profile pressable"
          aria-label={badgeCount ? `Profile: ${name} (${badgeCount} pending)` : `Profile: ${name}`}
          aria-haspopup="dialog"
          onClick={() => list(true)}
        >
          <Avatar id={avatar} />
          {badgeCount > 0 && <span className="navbar-profile-badge" aria-hidden />}
        </button>
      )}
      {bar &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                className="sheet fms-root fms-profiles-page"
                role="dialog"
                aria-modal="true"
                aria-label={headerTitle}
                initial={reduced ? { opacity: 0 } : { y: "-100%" }}
                animate={reduced ? { opacity: 1 } : { y: "0%" }}
                exit={reduced ? { opacity: 0 } : { y: "-100%" }}
                transition={reduced ? { duration: 0.1 } : PROFILE_ENTER}
              >
                <header className="fms-header">
                  <button
                    type="button"
                    className="fms-head-btn"
                    aria-label={isRoot ? "Close" : "Back"}
                    onClick={onHeaderLeft}
                  >
                    {isRoot ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M15 5l-7 7 7 7" />
                      </svg>
                    )}
                  </button>
                  <div className="fms-head-title-wrap">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.h2
                        key={headerTitle}
                        className="fms-head-title"
                        initial={reduced ? { opacity: 0 } : verticalSettings ? { opacity: 0, y: isSettings ? 10 : -10 } : { opacity: 0, x: isRoot ? -20 : 20 }}
                        animate={{ opacity: 1, x: 0, y: 0 }}
                        exit={reduced ? { opacity: 0 } : verticalSettings ? { opacity: 0, y: isSettings ? -10 : 10 } : { opacity: 0, x: isRoot ? 20 : -20 }}
                        transition={{ duration: reduced ? 0.08 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                      >
                        {headerTitle}
                      </motion.h2>
                    </AnimatePresence>
                  </div>
                  {isRoot && manage ? (
                    <button
                      type="button"
                      className="fmp-head-action"
                      aria-label={managing ? "Done" : "Manage Profiles"}
                      aria-pressed={managing}
                      onClick={() => (managing ? setManaging(false) : void guard.manage().then((ok) => ok && setManaging(true)))}
                    >
                      {managing ? "Done" : "Edit"}
                    </button>
                  ) : (
                    <span className="fms-head-spacer" aria-hidden />
                  )}
                </header>

                <LayoutGroup id="family-profiles">
                  <div className="fms-stack">
                    {/* Layer 0: Profiles root. Pulls up in lockstep when opening Settings. For a profile's page it stays
                        put and its content blurs out around the card (FamilyProfilesList `veiled`). */}
                    <motion.div
                      className="fms-layer fms-layer-list"
                      aria-hidden={!isRoot || undefined}
                      style={{ pointerEvents: isRoot ? "auto" : "none" }}
                      animate={
                        reduced
                          ? { opacity: isRoot ? 1 : 0 }
                          : isRoot
                            ? { x: "0%", y: "0%", opacity: 1 }
                            : isSettings
                              ? { x: "0%", y: "-100%", opacity: 1 }
                              : isEdit
                                ? { x: "0%", y: "0%", opacity: 1 }
                                : { x: "-35%", y: "0%", opacity: 0 }
                      }
                      transition={
                        reduced
                          ? { duration: 0.08 }
                          : verticalSettings
                            ? PROFILE_ENTER
                            : morphEdit
                              ? { duration: 0 }
                              : PROFILE_PUSH
                      }
                    >
                      <div className="fms-scroll">
                        <FamilyProfilesList
                          name={name}
                          avatar={avatar}
                          meLocked={meLocked}
                          email={status}
                          profiles={profiles}
                          groups={groups}
                          pick={pick}
                          managing={managing}
                          onEdit={(id) => setEditing(id)}
                          meId={me?.id}
                          editingId={isEdit ? editing : null}
                          veiled={isEdit && !reduced}
                          morphId={morphEdit ? lastEditedRef.current : null}
                        />
                      </div>
                    </motion.div>

                    <AnimatePresence initial={false}>
                      {!isRoot && (
                        <motion.div
                          key={view}
                          className={`fms-layer fms-layer-pushed${isEdit ? " fmp-edit-layer" : ""}`}
                          initial={
                            reduced
                              ? { opacity: 0 }
                              : isSettings
                                ? { y: "100%", x: "0%", opacity: 1 }
                                : isEdit
                                  ? { x: "0%", y: "0%", opacity: 1 }
                                  : { x: "100%", y: "0%", opacity: 0.35 }
                          }
                          animate={{ x: "0%", y: "0%", opacity: 1 }}
                          exit={
                            reduced
                              ? { opacity: 0 }
                              : isSettings
                                ? { y: "100%", x: "0%", opacity: 1 }
                                : isEdit
                                  ? // Stays while its own content blurs out (ProfileEditSheet) and the card scales back.
                                    { x: "0%", y: "0%", opacity: 1 }
                                  : { x: "100%", y: "0%", opacity: 0 }
                          }
                          transition={reduced ? { duration: 0.08 } : isSettings ? PROFILE_ENTER : isEdit ? { duration: 0 } : PROFILE_PUSH}
                        >
                          {view === "settings" ? (
                            <Suspense
                              fallback={
                                <div className="profile-sheet-loading">
                                  <Spinner size={22} />
                                </div>
                              }
                            >
                              <SettingsOverlay embedded onExit={leaveSettings} onHead={setSettingsHead} />
                            </Suspense>
                          ) : (
                            <div className="fms-scroll fmp-sub-scroll">
                              {view === "friends" && (
                                <Suspense fallback={null}>
                                  <FriendsBody inDialog={false} />
                                </Suspense>
                              )}
                              {view === "join" && me && <JoinView me={me} done={done} />}
                              {view === "edit" && editing && (
                                <Suspense fallback={null}>
                                  <ProfileEditSheet id={editing} onDone={() => setEditing(null)} onHead={setEditHead} />
                                </Suspense>
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </LayoutGroup>
              </motion.div>
            )}
          </AnimatePresence>,
          bar,
        )}
    </>
  );
}

type SmoothProfileCardProps = {
  profileId?: string;
  hiddenForMorph?: boolean;
  active?: boolean;
  locked?: boolean;
  managing?: boolean;
  name: string;
  sub?: string;
  avatarNode: ReactNode;
  onClick?: () => void;
  onEditClick?: () => void;
};

/**
 * Apple 60% corner-smoothed profile card (modeled on Family's "Your Wallets" cards). While its profile's page is
 * open the page's hero card holds the shared `layoutId`, so the grid keeps a placeholder in its slot. The card
 * itself is its own component so it measures its corners again each time it comes back.
 */
function SmoothProfileCard({ hiddenForMorph, veil, ...props }: SmoothProfileCardProps & { veil?: boolean }) {
  // The slot takes the press scale and the blur: the card's own transform is the layout animation's.
  return (
    <div className={`fmp-card-slot${veil ? " fmp-veil" : ""}`}>
      {hiddenForMorph ? <div className="fmp-card-placeholder" aria-hidden /> : <SmoothProfileCardBody {...props} />}
    </div>
  );
}

function SmoothProfileCardBody({ profileId, active, locked, managing, name, sub, avatarNode, onClick, onEditClick }: Omit<SmoothProfileCardProps, "hiddenForMorph">) {
  const ref = useRef<HTMLDivElement>(null);
  const corners = useAppleCorners(ref, 28, 60);
  const interactive = !!onClick;
  return (
    <motion.div
      ref={ref}
      layoutId={profileId ? `profile-card-${profileId}` : undefined}
      transition={PROFILE_CARD_SPRING}
      className={`fmp-card${active ? " is-active" : ""}${managing ? " is-managing" : ""}`}
      style={corners.clipPath ? { clipPath: corners.clipPath, borderRadius: 0 } : undefined}
    >
      {interactive ? (
        <button type="button" className="fmp-card-hit" aria-label={managing ? `Edit ${name}` : name} onClick={onClick}>
          <div className="fmp-card-top">
            <span className="fmp-card-avatar">
              {avatarNode}
              {locked && (
                <span className="fmp-card-lock" aria-hidden>
                  <Lock size={10} />
                </span>
              )}
            </span>
            {managing ? (
              <span className="fmp-card-badge" aria-hidden>
                <Edit size={13} />
              </span>
            ) : active ? (
              <span className="fmp-card-dots" aria-hidden>
                <More size={15} />
              </span>
            ) : null}
          </div>
          <div className="fmp-card-foot">
            <strong className="fmp-card-name">{name}</strong>
            {sub && <span className="fmp-card-sub">{sub}</span>}
          </div>
        </button>
      ) : (
        <div className="fmp-card-inner">
          <div className="fmp-card-top">
            <span className="fmp-card-avatar">
              {avatarNode}
              {locked && (
                <span className="fmp-card-lock" aria-hidden>
                  <Lock size={10} />
                </span>
              )}
            </span>
            {onEditClick && (
              <button type="button" className="fmp-card-dots" aria-label={`Edit ${name}`} onClick={onEditClick}>
                <More size={15} />
              </button>
            )}
          </div>
          <div className="fmp-card-foot">
            <strong className="fmp-card-name">{name}</strong>
            {sub && <span className="fmp-card-sub">{sub}</span>}
          </div>
        </div>
      )}
      {corners.active && (
        <svg
          className="ft-smooth-stroke"
          width={corners.width}
          height={corners.height}
          viewBox={`0 0 ${corners.width} ${corners.height}`}
          aria-hidden
        >
          <path
            d={corners.strokePath(active ? 1.25 : 0.75)}
            fill="none"
            stroke={active ? "var(--fmp-active-ring)" : "var(--fmp-card-rim)"}
            strokeWidth={active ? 2.5 : 1}
          />
        </svg>
      )}
    </motion.div>
  );
}

function FamilyProfilesList({
  name,
  avatar,
  meLocked,
  email,
  profiles,
  groups,
  pick,
  managing,
  onEdit,
  meId,
  editingId,
  veiled,
  morphId,
}: {
  name: string;
  avatar: string;
  meLocked?: boolean;
  email?: string;
  profiles: Choice[];
  groups: Choice[][];
  pick: (c: Choice) => void;
  managing: boolean;
  onEdit: (id: string) => void;
  meId?: string;
  editingId?: string | null;
  /** A profile's page is open over the list: everything but that profile's card blurs out (Family's card scale). */
  veiled?: boolean;
  /** The card scaling to or from a profile's page, which stays sharp while the rest blurs. */
  morphId?: string | null;
}) {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const primaryGroup = groups[0] ?? [];
  const sessionGroup = groups[1] ?? [];

  return (
    <div className="fmp-body" data-managing={managing || undefined} data-veiled={veiled || undefined}>
      <section className="fmp-wallets">
        <div className="fmp-section-head fmp-veil">
          <h3 className="fmp-section-title">Your Profiles</h3>
          {email && <span className="fmp-section-sub">{email}</span>}
        </div>
        <div className="fmp-grid" role="group" aria-label="Profiles">
          <SmoothProfileCard
            profileId={meId}
            veil={!meId || morphId !== meId}
            hiddenForMorph={!!meId && editingId === meId}
            active
            locked={meLocked}
            managing={managing}
            name={name}
            sub={meId ? "Active" : (email ?? "Not signed in")}
            avatarNode={<Avatar id={avatar} />}
            onClick={meId ? () => onEdit(meId) : undefined}
          />
          {profiles.map((c) => {
            const pid = c.id.replace(/^profile:/, "");
            return (
              <SmoothProfileCard
                key={c.id}
                profileId={pid}
                veil={morphId !== pid}
                hiddenForMorph={editingId === pid}
                locked={c.locked}
                managing={managing}
                name={c.label}
                sub={managing ? "Tap to edit" : "Switch"}
                avatarNode={c.icon}
                onClick={() => (managing ? onEdit(pid) : pick(c))}
              />
            );
          })}
        </div>
      </section>

      {primaryGroup.length > 0 && (
        <div className="fms-group fmp-veil">
          <h3 className="fms-eyebrow">Account</h3>
          <div className="fms-list">
            {primaryGroup.map((c) => (
              <button key={c.id} type="button" className="fms-row" data-id={c.id} onClick={() => pick(c)}>
                <span className="fms-row-ico fmp-row-ico">{c.icon}</span>
                <span className="fms-row-label">{c.id === "settings" ? "App Settings" : c.label}</span>
                {!!c.count && (
                  <span className="fmp-count-pill" aria-label={`${c.count} waiting`}>
                    {c.count}
                  </span>
                )}
                <ChevronRight size={17} className="fms-row-chev" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}

      {sessionGroup.length > 0 && (
        <div className="fms-group fmp-veil">
          <div className="fms-list">
            {sessionGroup.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`fms-row${c.id === "sign-out" ? " fms-row-danger" : ""}`}
                data-id={c.id}
                onClick={() => pick(c)}
              >
                <span className="fms-row-ico fmp-row-ico">{c.icon}</span>
                <span className="fms-row-label">{c.label}</span>
                {c.id !== "sign-out" && <ChevronRight size={17} className="fms-row-chev" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      )}

      {version && <p className="fmp-version fmp-veil">Version {version}</p>}
    </div>
  );
}
