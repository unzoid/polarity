import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Calendar, ChevronLeft, ChevronRight, Edit, OpenFile, Profile, Settings, SignOut, Users, WatchParty } from "./icons";
import { canOpenFiles, setOpenFilesOpen } from "../lib/localFiles";
import { closePartySurface, getParty, leaveParty, partyAvailable, setJoinPartyOpen, usePartySurface } from "../lib/party";
import { friendsAvailable, setFriendsOpen, useFriends } from "../lib/friends";
import { useRouter } from "../lib/router";
import { useAccount } from "../lib/account";
import { openSettings, useSettingsOverlay } from "../lib/settings";
import { FriendsBody } from "./friends/FriendsPanel";
import { JoinForm, LinkForm } from "./party/PartyUI";
import { useSettings } from "../lib/net";
import { useFormFactor } from "../lib/ui";
import { Avatar } from "./Avatar";
import { Sheet } from "./Sheet";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "./ui/Popover";
import { FitHeight, backOnEscape, useViewSlide } from "./ViewStack";
import { anchorOf, buildChannel, nativeDialogsAvailable, showNativeDialog, type DialogAction } from "../lib/platform";
import { warnFailed } from "../lib/errors";

/** Used for the template profile when nobody's signed in. */
const GUEST_AVATAR = "guest";

/**
 * `stay`: on a phone the profile sheet stays open (Friends and Join open as views inside it, Settings over it).
 * `view`: opens one of the menu's own views (Friends, Join). `count`: waiting for an answer (friend requests).
 */
type Choice = { id: string; label: string; icon: ReactNode; run: () => void; stay?: boolean; view?: boolean; count?: number };

/** "Friends (2)" where there's no room for a badge. */
const labelOf = (c: Choice) => (c.count ? `${c.label} (${c.count})` : c.label);

type Me = { name: string; avatar: string };
type View = "list" | "friends" | "join";
const VIEW_TITLES = { friends: "Friends", join: "Join a Watch Party" } as const;

/**
 * Navbar avatar, always there: Settings lives in its menu, for everyone, and
 * the Calendar while it isn't a navbar tab.
 * Without an account it's a template "Guest" profile (Settings, Sign In);
 * signed in it adds switching profiles, managing them, the account and
 * signing out. The same choices three ways: a popover under the avatar, a sheet
 * from the bottom edge on a phone (in reach of a thumb), and on iOS the
 * system's own menu. The popover and the sheet show Friends and Join as views
 * inside themselves.
 */
export function ProfileMenu() {
  const account = useAccount();
  const phone = useFormFactor().form === "phone";
  const signedIn = account.enabled && account.status !== "guest" && !!account.profile;
  const me = signedIn ? account.profile! : null;
  const others = me ? account.profiles.filter((p) => p.id !== me.id) : [];
  const name = me?.name ?? "Guest";
  const avatar = me?.avatar ?? GUEST_AVATAR;
  const { tab } = useRouter();
  // While Settings → Browsing → Show the Calendar makes it a navbar tab, it isn't listed here too (#92).
  const { data: settings } = useSettings();
  // Requests waiting for an answer show on the Friends item (#135).
  const { entries } = useFriends();
  const requests = entries.filter((e) => e.state === "pending" && e.incoming).length;

  const profiles: Choice[] = others.map((p) => ({ id: `profile:${p.id}`, label: p.name, icon: <Avatar id={p.avatar} />, run: () => void account.chooseProfile(p) }));
  const manage: Choice[] = me ? [{ id: "manage", label: "Manage Profiles", icon: <Edit />, run: () => account.switchProfile("manage") }] : [];
  const actions: Choice[] = [
    ...(me && partyAvailable() ? [{ id: "party", label: "Join Watch Party", icon: <WatchParty />, run: () => setJoinPartyOpen(true), stay: true, view: true }] : []),
    ...(me && friendsAvailable() ? [{ id: "friends", label: "Friends", count: requests, icon: <Users />, run: () => setFriendsOpen(true), stay: true, view: true }] : []),
    ...(canOpenFiles ? [{ id: "open-file", label: "Open File…", icon: <OpenFile />, run: () => setOpenFilesOpen(true) }] : []),
    ...(!settings?.showCalendar ? [{ id: "calendar", label: "Calendar", icon: <Calendar />, run: () => tab({ name: "calendar" }) }] : []),
    { id: "settings", label: "Settings", icon: <Settings />, run: () => openSettings(), stay: true },
    ...(me ? [{ id: "account", label: "Account", icon: <Profile />, run: () => openSettings("account"), stay: true }] : []),
  ];
  const session: Choice[] = me
    ? [{ id: "sign-out", label: "Sign Out", icon: <SignOut />, run: () => void account.signOut() }]
    : account.enabled
      ? [{ id: "sign-in", label: "Sign In", icon: <Profile />, run: account.showSignIn }]
      : // A dev build without a database (docs/dev-channel.md): signed out until one is connected.
        buildChannel === "dev"
        ? [{ id: "connect-database", label: "Connect a Database…", icon: <Profile />, run: () => openSettings("advanced"), stay: true }]
        : [];

  if (nativeDialogsAvailable) {
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
      <button type="button" className="navbar-profile pressable" aria-label={`Profile: ${name}`} aria-haspopup="menu" onClick={(e) => open(e.currentTarget)}>
        <Avatar id={avatar} />
      </button>
    );
  }

  const status = me ? undefined : !account.enabled && buildChannel === "dev" ? "No database connected" : "Not signed in";
  const props = { name, avatar, me, email: me ? account.user?.email : undefined, status, profiles, manage: manage[0], groups: [actions, session] };
  return phone ? <ProfileSheet {...props} /> : <ProfilePopover {...props} />;
}

type MenuProps = {
  name: string;
  avatar: string;
  me: Me | null;
  email?: string;
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
 */
function useProfileViews(signedIn: boolean) {
  const [listed, setListed] = useState(false);
  const surface = usePartySurface();
  const view: View = surface === "friends" ? "friends" : surface === "join" && signedIn ? "join" : "list";
  const open = listed || view !== "list";
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
function ProfilePopover({ name, avatar, me, email, status, profiles, manage, groups }: MenuProps) {
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
      <PopoverTrigger className="navbar-profile pressable" aria-label={`Profile: ${name}`} title={name}>
        <Avatar id={avatar} />
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
              <ProfilePopList name={name} avatar={avatar} me={me} email={email} status={status} profiles={profiles} manage={manage} groups={groups} pick={pick} />
            ) : (
              <>
                <div className="profile-pop-title">
                  <button className="profile-pop-back pressable" aria-label="Back" onClick={back}>
                    <ChevronLeft size={20} strokeWidth={2.25} />
                  </button>
                  <strong>{VIEW_TITLES[view]}</strong>
                </div>
                {view === "friends" ? <FriendsBody inDialog={false} /> : me && <JoinView me={me} done={done} />}
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

function ProfilePopList({ name, avatar, me, email, status, profiles, manage, groups, pick }: MenuProps & { pick: (c: Choice) => void }) {
  return (
    <>
      <div className="profile-menu-head">
        <Avatar id={avatar} />
        <div>
          <strong>{name}</strong>
          {email ? <span className="profile-menu-email">{email}</span> : <span>{status}</span>}
        </div>
      </div>
      {me && (
        <div className="profile-pop-profiles" role="group" aria-label="Profiles">
          <span className="profile-pop-profile" aria-current="true">
            <Avatar id={avatar} />
            <span>{name}</span>
          </span>
          {profiles.map((c) => (
            <button key={c.id} className="profile-pop-profile pressable" aria-label={`Switch to ${c.label}`} onClick={() => pick(c)}>
              {c.icon}
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

/**
 * On a phone: a sheet from the bottom edge. Who's watching first (the profile, then the others to switch to, a
 * tap each), then the rest as rows in cards. Friends and Join Watch Party open as views inside it, with a Back to
 * the list; the sheet's height follows the view. Settings and Account rise over it, and close back to it. Any
 * other choice closes it as it runs.
 */
function ProfileSheet({ name, avatar, me, email, status, profiles, manage, groups }: MenuProps) {
  const { view, open, slide, list, close, back, done } = useProfileViews(!!me);
  // Settings over the sheet takes Escape and Back first: they close it, not the sheet under it. Read from the last
  // render, so the Escape that closes Settings doesn't see it closed already and close the sheet too.
  const settingsOpen = useSettingsOverlay().open;
  const covered = useRef(settingsOpen);
  useEffect(() => {
    covered.current = settingsOpen;
  }, [settingsOpen]);
  const pick = (c: Choice) => {
    list(!!c.stay);
    c.run();
  };
  const title =
    view === "list" ? (
      "Profiles"
    ) : (
      <span className="profile-sheet-title">
        <button className="profile-sheet-back pressable" aria-label="Back" onPointerDown={(e) => e.stopPropagation()} onClick={back}>
          <ChevronLeft size={22} strokeWidth={2.25} />
        </button>
        {VIEW_TITLES[view]}
      </span>
    );
  return (
    <>
      <button type="button" className="navbar-profile pressable" aria-label={`Profile: ${name}`} aria-haspopup="dialog" onClick={() => list(true)}>
        <Avatar id={avatar} />
      </button>
      <Sheet open={open} onClose={() => !covered.current && close()} title={title}>
        <FitHeight>
          <div key={view} className="profile-sheet" data-view={view} data-slide={slide}>
            {view === "friends" && <FriendsBody inDialog={false} />}
            {view === "join" && me && <JoinView me={me} done={done} />}
            {view === "list" && (
              <ProfileList name={name} avatar={avatar} email={email ?? status} profiles={profiles} manage={manage} groups={groups} pick={pick} />
            )}
          </div>
        </FitHeight>
      </Sheet>
    </>
  );
}

function ProfileList({
  name,
  avatar,
  email,
  profiles,
  manage,
  groups,
  pick,
}: {
  name: string;
  avatar: string;
  email?: string;
  profiles: Choice[];
  manage?: Choice;
  groups: Choice[][];
  pick: (c: Choice) => void;
}) {
  return (
    <>
      <div className="profile-sheet-me">
        <Avatar id={avatar} />
        <strong>{name}</strong>
        <span>{email ?? "Not signed in"}</span>
      </div>
      {(profiles.length > 0 || manage) && (
        <div className="profile-sheet-others">
          {profiles.map((c) => (
            <button key={c.id} className="profile-sheet-other pressable" onClick={() => pick(c)}>
              {c.icon}
              <span>{c.label}</span>
            </button>
          ))}
          {manage && (
            <button className="profile-sheet-other pressable" onClick={() => pick(manage)}>
              <span className="profile-sheet-manage" aria-hidden>
                <Edit size={22} />
              </span>
              <span>Manage</span>
            </button>
          )}
        </div>
      )}
      {groups
        .filter((g) => g.length)
        .map((g) => (
          <div key={g[0].id} className="profile-sheet-card">
            {g.map((c) => (
              <button key={c.id} className="profile-sheet-row" onClick={() => pick(c)}>
                {c.icon}
                <span>{labelOf(c)}</span>
                <ChevronRight size={18} aria-hidden />
              </button>
            ))}
          </div>
        ))}
    </>
  );
}
