import { Popover, PopoverContent, PopoverTitle } from "@ui-sdk/react/popover";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { Calendar, OpenFile, Users, WatchParty } from "../components/icons";
import { ProfileMenu, reportProblem } from "../components/ProfileMenu";
import { useAccount } from "../lib/account";
import { hasPin } from "../lib/account/profileRules";
import { friendsAvailable, setFriendsOpen, useFriends } from "../lib/friends";
import { canOpenFiles, setOpenFilesOpen } from "../lib/localFiles";
import { useSettings } from "../lib/net";
import { partyAvailable, setJoinPartyOpen } from "../lib/party";
import { useNavigation } from "../lib/router";
import { openSettings } from "../lib/settings";
import { appVersion } from "../lib/updater";
import { IconAccount, IconHelp, IconPencil, IconPlus, IconSettings, IconSignOut } from "../phone/icons";
import { runAnimatedProfileSwitch } from "./ProfileSwitch";

let opened = false;
let closedAt = 0;
const listeners = new Set<() => void>();
const setOpen = (next: boolean) => {
  if (!next && opened) closedAt = performance.now();
  opened = next;
  listeners.forEach((l) => l());
};
/** Opens Profiles under the profile picture in the bar (My Polarity's name opens it too). */
export const openProfiles = () => setOpen(true);
const useOpen = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => opened,
  );

/** The visible profile picture in the bar, which Profiles hangs from. */
const shownOf = (selector: string) =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== "hidden");
const anchor = {
  getBoundingClientRect: () => (shownOf(".dk-profile-btn") ?? shownOf(".dk-my-profile") ?? document.body).getBoundingClientRect(),
};

/**
 * The profile picture in the bar. The classic menu stays mounted under it, unseen, for the panels it hosts (Friends,
 * joining a Watch Party), which open from here and from elsewhere in the app.
 */
export function ProfileButton() {
  const account = useAccount();
  const me = account.status !== "guest" ? account.profile : null;
  const open = useOpen();
  const { entries, invites } = useFriends();
  const waiting = entries.filter((e) => e.state === "pending" && e.incoming).length + invites.length;
  return (
    <span className="dk-profile">
      <span className="dk-profile-legacy" aria-hidden inert>
        <ProfileMenu />
      </span>
      <button
        type="button"
        className="dk-profile-btn"
        aria-label={waiting ? `Profiles (${waiting} waiting)` : "Profiles"}
        aria-haspopup="dialog"
        aria-expanded={open}
        // A click that closed it (outside press) mustn't open it again at once.
        onClick={() => performance.now() - closedAt > 250 && setOpen(!opened)}
      >
        <Avatar id={me?.avatar ?? "guest"} />
        {waiting > 0 && <span className="dk-profile-badge" aria-hidden />}
        <svg className="dk-profile-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1.5 3.2h7L5 7.2z" fill="currentColor" />
        </svg>
      </button>
    </span>
  );
}

/**
 * Profiles as a computer's menu: the profile you're on with Edit, the others to switch to, Add and Manage, then
 * Watch Party, Friends, Open File, Calendar, Settings, Account, Help and Sign Out, under the picture in the bar.
 */
export function Profiles() {
  const open = useOpen();
  const account = useAccount();
  const me = account.status !== "guest" ? account.profile : null;
  const others = me ? account.profiles.filter((p) => p.id !== me.id) : [];
  const { tab } = useNavigation();
  const { data: settings } = useSettings();
  const { entries, invites } = useFriends();
  const requests = entries.filter((e) => e.state === "pending" && e.incoming).length + invites.length;
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    if (open) void appVersion().then(setVersion, () => undefined);
  }, [open]);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next)}>
      <PopoverContent className="dk-profiles" anchor={anchor} side="bottom" align="end" sideOffset={10} collisionPadding={12}>
        <PopoverTitle className="dk-sr">Profiles</PopoverTitle>
        <div className="dk-profiles-me">
          <Avatar id={me?.avatar ?? "guest"} className="dk-profiles-avatar" />
          <div className="dk-profiles-who">
            <strong>{me?.name ?? "Guest"}</strong>
            {!me && <span>Not signed in</span>}
          </div>
          {me && (
            <button type="button" className="dk-profiles-edit" aria-label="Edit profile" onClick={run(() => account.switchProfile("manage"))}>
              <IconPencil size={18} />
            </button>
          )}
        </div>
        {me && (
          <div className="dk-profiles-group" role="group" aria-label="Switch profile">
            {others.map((p) => (
              <button key={p.id} type="button" className="dk-profiles-row" onClick={run(() => runAnimatedProfileSwitch(p, account.chooseProfile))}>
                <Avatar id={p.avatar} className="dk-profiles-pic" />
                <span>{p.name}</span>
                {hasPin(p) && (
                  <svg className="dk-profiles-lock" width="14" height="14" viewBox="0 0 24 24" aria-label="Locked">
                    <path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1zm2 0h6V8a3 3 0 0 0-6 0v2z" />
                  </svg>
                )}
              </button>
            ))}
            <button type="button" className="dk-profiles-row" onClick={run(() => account.switchProfile("manage"))}>
              <span className="dk-profiles-pic dk-profiles-add">
                <IconPlus size={18} stroke={1.8} />
              </span>
              <span>Add Profile</span>
            </button>
            <button type="button" className="dk-profiles-row dk-profiles-manage" onClick={run(() => account.switchProfile("manage"))}>
              <span className="dk-profiles-pic" aria-hidden />
              <span>Manage Profiles</span>
            </button>
          </div>
        )}
        <div className="dk-profiles-group">
          {me && partyAvailable() && <Row icon={<WatchParty size={20} />} label="Join Watch Party" onClick={run(() => setJoinPartyOpen(true))} />}
          {me && friendsAvailable() && <Row icon={<Users size={20} />} label="Friends" count={requests} onClick={run(() => setFriendsOpen(true))} />}
          {canOpenFiles && <Row icon={<OpenFile size={20} />} label="Open File…" onClick={run(() => setOpenFilesOpen(true))} />}
          {!settings?.showCalendar && <Row icon={<Calendar size={20} />} label="Calendar" onClick={run(() => tab({ name: "calendar" }))} />}
        </div>
        <div className="dk-profiles-group">
          <Row icon={<IconSettings size={20} />} label="App Settings" onClick={run(() => openSettings())} />
          {me && <Row icon={<IconAccount size={20} />} label="Account" onClick={run(() => openSettings("account"))} />}
          <Row icon={<IconHelp size={20} />} label="Help" onClick={run(reportProblem)} />
          {me ? (
            <Row icon={<IconSignOut size={20} />} label="Sign Out" onClick={run(() => void account.signOut())} />
          ) : (
            account.enabled && <Row icon={<IconAccount size={20} />} label="Sign In" onClick={run(account.showSignIn)} />
          )}
        </div>
        {version && <p className="dk-profiles-version">Version {version}</p>}
      </PopoverContent>
    </Popover>
  );
}

function Row({ icon, label, count, onClick }: { icon: ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" className="dk-profiles-row" onClick={onClick}>
      <span className="dk-profiles-icon">{icon}</span>
      <span>{label}</span>
      {!!count && <span className="dk-profiles-count">{count}</span>}
    </button>
  );
}
